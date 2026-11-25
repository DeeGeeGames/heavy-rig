import { BoxGeometry, BufferGeometry, CircleGeometry, Color, CubicBezierCurve3, CylinderGeometry, Float32BufferAttribute, Group, InstancedMesh, LatheGeometry, LineBasicMaterial, LineSegments, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, RingGeometry, Scene, SphereGeometry, Vector2, Vector3, type OrthographicCamera, type WebGLRenderer } from 'three';
import { ARENA, getEnemyDefense, type ArtilleryStrike, type Effect, type Point, type Shot, type CombatStateView } from './simulation';
import { mechScale } from './gait';
import { createEnvironment } from './environment-3d';
import { createEnemyDropshipViews } from './enemy-dropship-view';
import { createMissionEnvironment } from './mission-environment';
import type { MissionMap } from './campaign-types';
import { createProjectileSmoke } from './projectile-smoke';
import { createWeaponVfx } from './weapon-vfx';
import { createCuttingLasers } from './cutting-laser';
import { getFrame } from './frames';
import { bakeTerrain, type BakedTerrain, type TerrainBakeSource } from './terrain-bake';
import { groundHeight, groundNormal } from './terrain-elevation';
import { drapeGroundGeometry } from './terrain-decals';
import type { FieldTerrain } from './field-terrain';
import { fieldClippingPlanes } from './field-clipping';
import { createArtilleryWreckAssets } from './artillery-emplacement';

interface PooledObject { root: Object3D; dispose?: () => void }
interface FrameEffects { muzzles: readonly Vector3[]; exhaust: Vector3 | undefined }

// World presentation owns its meshes and GPU assets. Simulation objects never
// retain Three.js objects; pools shrink with live state, including on restart.
export const createWorldObjects = function (scene: Scene, wideViewWidth = function () { return 0; }) {
	const root = new Group(); root.name = 'heavy-rig-world'; scene.add(root);
	const dropships = createEnemyDropshipViews(root, wideViewWidth);
	// Live effects retain their own materials and draw against the stylized world's depth.
	const feedback = new Group(); feedback.name = 'combat-feedback'; feedback.userData['nativeEffects'] = true; root.add(feedback);
	const projectileSmoke = createProjectileSmoke(); feedback.add(projectileSmoke.root);
	const weaponVfx = createWeaponVfx(); feedback.add(weaponVfx.afterglowRoot, weaponVfx.contacts.root);
	const lasers = createCuttingLasers(); feedback.add(lasers.root);
	const { createShot, createEffect } = weaponVfx;
	const yard = new Group(); yard.name = 'legacy-terrain'; root.add(yard);
	const yardArt = new Group(); yard.add(yardArt);
	const environment = createEnvironment(); yardArt.add(environment.root);
	const groundArt = new Group(); yardArt.add(groundArt);
	if (environment.ground) groundArt.add(environment.ground);
	let bakedTerrain: BakedTerrain | undefined;
	let terrainBakeFailed = false;
	let missionMap: MissionMap | undefined;
	let missionEnvironment: ReturnType<typeof createMissionEnvironment> | undefined;
	const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>();
	const geometry = function <T extends BufferGeometry>(value: T): T { geometries.add(value); return value; };
	const material = function <T extends Material>(value: T): T { materials.add(value); return value; };
	const solid = function (color: string) { return material(new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.1 })); };
	const glow = function (color: string, opacity = 1) { return material(new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 })); };
	const cube = geometry(new BoxGeometry(1, 1, 1)); const circle = geometry(new CircleGeometry(1, 48));
	const ring = geometry(new RingGeometry(0.98, 1, 64)); const sphere = geometry(new SphereGeometry(1, 8, 6));
	const cylinder = geometry(new CylinderGeometry(1, 1, 1, 8));
	const steel = solid('#667677'); const dark = solid('#293b42'); const cyan = glow('#a3ede3');
	const brass = solid('#a78a53'); const ivory = solid('#b9baa6');
	const shadow = glow('#050d14', 0.3);
	const group = function (name: string) { const value = new Group(); value.name = name; root.add(value); return value; };
	const box = function (parent: Group, surface: Material, x: number, y: number, z: number, length: number, breadth: number, height: number) {
		const value = new Mesh(cube, surface); value.position.set(x, y + height / 2, z); value.scale.set(length, height, breadth); value.castShadow = true; value.receiveShadow = true; parent.add(value); return value;
	};
	const disc = function (parent: Group, surface: Material, radius: number, outline = false) {
		const value = new Mesh(outline ? ring : circle, surface); value.rotation.x = -Math.PI / 2;
		value.scale.setScalar(radius); parent.add(value); return value;
	};
	const scratch = new Object3D(); const tint = new Color();
	// The flat decorative apron keeps its recorded colors without evaluating a
	// physical lighting shader across the whole viewport on software GPUs.
	const floor = new InstancedMesh(cube, glow('#ffffff'), ARENA.width / 120 * (ARENA.height / 120));
	floor.name = 'industrial-apron'; groundArt.add(floor);
	let tile = 0;
	for (let x = 0; x < ARENA.width; x += 120) for (let z = 0; z < ARENA.height; z += 120) {
		scratch.position.set(x + 60, -0.55, z + 60); scratch.scale.set(119.6, 1, 119.6); scratch.updateMatrix();
		floor.setMatrixAt(tile, scratch.matrix); floor.setColorAt(tile++, tint.set((x / 120 + z / 120) % 3 === 0 ? '#354046' : '#303c41'));
	}
	const stains = new InstancedMesh(circle, glow('#202c32', 0.15), 90); stains.name = 'terrain-marks'; groundArt.add(stains);
	scratch.rotation.x = -Math.PI / 2;
	for (let i = 0; i < 90; i++) {
		scratch.position.set((i * 317 + 71) % ARENA.width, 0.015, (i * 173 + 80) % ARENA.height);
		scratch.scale.setScalar(4 + i % 12); scratch.updateMatrix(); stains.setMatrixAt(i, scratch.matrix);
	}
	const lines: Vector3[] = [];
	for (let x = 0; x <= ARENA.width; x += 120) lines.push(new Vector3(x, 0.025, 0), new Vector3(x, 0.025, ARENA.height));
	for (let z = 0; z <= ARENA.height; z += 120) lines.push(new Vector3(0, 0.025, z), new Vector3(ARENA.width, 0.025, z));
	for (let i = 0; i < 90; i += 3) {
		const x = (i * 317 + 71) % ARENA.width; const z = (i * 173 + 80) % ARENA.height;
		lines.push(new Vector3(x, 0.03, z), new Vector3(x + 24, 0.03, z + 10));
	}
	groundArt.add(new LineSegments(geometry(new BufferGeometry().setFromPoints(lines)), material(new LineBasicMaterial({ color: '#405056', transparent: true, opacity: 0.09, depthWrite: false }))));
	const stripes = group('boundary-stripes'); const stripeMaterial = glow('#b49a60');
	groundArt.add(stripes);
	for (let x = 50; x < ARENA.width; x += 110) for (const z of [25, ARENA.height - 25]) box(stripes, stripeMaterial, x + 19, 0.04, z, 38, 5, 0.04);
	const relay = group('relay'); relay.position.set(ARENA.relayX, 0, ARENA.relayY);
	disc(relay, shadow, 97).position.y = 0.04;
	disc(relay, glow('#7da9a2'), 155, true).position.y = 0.08;
	const foundation = new Mesh(cylinder, dark); foundation.scale.set(62, 13, 62); foundation.position.y = 6.5; foundation.rotation.y = Math.PI / 8; relay.add(foundation);
	box(relay, steel, 0, 13, 0, 66, 66, 22); box(relay, dark, 0, 35, 0, 29, 29, 87);
	for (const x of [-47, 47]) {
		box(relay, steel, x, 13, 0, 20, 55, 32); box(relay, brass, x, 45, 0, 21, 56, 4);
		for (const z of [-21, -12, -3, 6, 15, 24]) box(relay, dark, x, 49.2, z, 15, 3, 0.8);
		box(relay, cyan, x, 28, 28, 11, 1.5, 3);
	}
	for (const y of [49, 71, 93]) {
		box(relay, steel, 0, y, 0, 43, 43, 5);
		box(relay, cyan, 0, y + 5, 0, 33, 33, 7);
	}
	for (const x of [-22, 22]) for (const z of [-22, 22]) box(relay, ivory, x, 35, z, 4, 4, 88);
	box(relay, dark, 0, 123, 0, 50, 50, 8); box(relay, ivory, 0, 131, 0, 28, 28, 9);
	box(relay, brass, 0, 140, 0, 3, 3, 38);
	for (const x of [-20, 20]) {
		box(relay, dark, x, 137, 0, 3, 3, 24); box(relay, ivory, x, 154, 0, 17, 5, 3);
	}
	for (let i = 0; i < 8; i++) {
		const angle = i * Math.PI / 4; const x = Math.cos(angle) * 147; const z = Math.sin(angle) * 147;
		box(relay, dark, x, 0.1, z, 14, 8, 2); box(relay, cyan, x, 2.2, z, 9, 4, 0.8);
	}
	const beaconSurface = glow('#c4ffed'); const beacon = new Mesh(sphere, beaconSurface); beacon.position.y = 180; beacon.scale.setScalar(4); relay.add(beacon);
	// Consolidate the manufactured relay parts while retaining the separate
	// beacon and rings. A detailed tower costs six draws rather than sixty.
	const relayBatches: InstancedMesh[] = [];
	for (const surface of [steel, dark, brass, ivory, cyan]) {
		const parts = relay.children.filter(function (child): child is Mesh { return child instanceof Mesh && child.geometry === cube && child.material === surface; });
		const batch = new InstancedMesh(cube, surface, parts.length);
		parts.forEach(function (part, index) { part.updateMatrix(); batch.setMatrixAt(index, part.matrix); relay.remove(part); });
		batch.castShadow = true; batch.receiveShadow = true; relay.add(batch); relayBatches.push(batch);
	}
	const relayStructure = new Group();
	relay.add(relayStructure); relayStructure.add(foundation, ...relayBatches);
	const yardBakeSource: TerrainBakeSource | undefined = environment.ground ? { art: [yardArt, relayStructure], ground: environment.ground, coveredGround: floor } : undefined;
	const terrainBakeSource = function () { return missionEnvironment?.bakeSource ?? yardBakeSource; };
	const resetTerrainBake = function () {
		bakedTerrain?.dispose(); bakedTerrain = undefined; terrainBakeFailed = false;
		for (const group of terrainBakeSource()?.art ?? []) group.visible = true;
	};
	const wrecks: PooledObject[] = [];
	let wreckAssets: ReturnType<typeof createArtilleryWreckAssets> | undefined;
	const createEmplacementWreck = function () {
		wreckAssets ??= createArtilleryWreckAssets();
		return wreckAssets.create();
	};
	const emplacementWrecks: ReturnType<typeof createEmplacementWreck>[] = [];
	const warnings: PooledObject[] = []; const shots: ReturnType<typeof createShot>[] = []; const effects: ReturnType<typeof createEffect>[] = [];
	const strikePools: { emplacement: boolean; views: ReturnType<typeof createStrike>[] }[] = [{ emplacement: false, views: [] }, { emplacement: true, views: [] }];
	const defenses: ReturnType<typeof createDefense>[] = [];
	const shadows: PooledObject[] = [];
	const sync = function <T extends PooledObject>(parent: Group, pool: T[], count: number, create: () => T, update: (value: T, index: number) => void) {
		while (pool.length > count) { const value = pool.pop(); value?.root.removeFromParent(); value?.dispose?.(); }
		while (pool.length < count) { const value = create(); parent.add(value.root); pool.push(value); }
		pool.forEach(update);
	};
	const armorArc = geometry(new RingGeometry(0.9, 1, 32, 1, -Math.PI / 3, Math.PI * 2 / 3));
	const armorSurface = glow('#eec58b', 0.8); const exposedSurface = glow('#a2f0d2', 0.9);
	const committedSurface = glow('#ff8f61', 0.8);
	const impactClockSurface = glow('#ffe4c6', .94);
	const groundMarkers = [shadow, armorSurface, exposedSurface, committedSurface, impactClockSurface];
	const createDefense = function () {
		const value = new Group(); value.name = 'siege-defense';
		const shield = new Mesh(armorArc, armorSurface); shield.rotation.x = -Math.PI / 2; shield.position.y = 0.3;
		const exposed = disc(value, exposedSurface, 1, true); exposed.position.y = 0.32;
		const commitment = disc(value, committedSurface, 1, true); commitment.position.y = 0.34;
		value.add(shield);
		return { root: value, shield, exposed, commitment };
	};
	const normal = new Vector3(1, 1, 1).normalize(); const zAxis = new Vector3(0, 0, 1);
	// The shell's nose is its position on the flight path. The copper driving band
	// and pale nose share one mesh across every round in a battery.
	const shellHull = geometry(new LatheGeometry([
		new Vector2(0, -20), new Vector2(3.4, -20), new Vector2(4.2, -18), new Vector2(4.2, -16),
		new Vector2(3.9, -15.5), new Vector2(3.9, -8.5), new Vector2(3.9, -8), new Vector2(2.8, -4), new Vector2(0, 0),
	], 10));
	const shellVertices = shellHull.getAttribute('position');
	const shellColors = new Float32BufferAttribute(shellVertices.count * 3, 3);
	for (let i = 0; i < shellVertices.count; i++) {
		const y = shellVertices.getY(i);
		tint.set(y <= -16 ? '#ffad62' : y < -8 ? '#83513c' : '#ffe2a8');
		shellColors.setXYZ(i, tint.r, tint.g, tint.b);
	}
	shellHull.setAttribute('color', shellColors);
	const shellMetal = material(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .65, metalness: .18, emissive: '#251609' }));
	const strikeSegments = 64;
	const createStrike = function (emplacement: boolean) {
		const value = new Group(); value.name = 'artillery-warning';
		const surface = new MeshBasicMaterial({ transparent: true, depthWrite: false });
		const line = new MeshBasicMaterial({ transparent: true, opacity: emplacement ? .96 : .85, depthWrite: false });
		const fill = new Mesh(new RingGeometry(0, 1, 48, 5).rotateX(-Math.PI / 2), surface);
		const boundary = new Mesh((emplacement ? new RingGeometry(.944, 1, strikeSegments) : ring.clone()).rotateX(-Math.PI / 2), line);
		const countdown = new Mesh((emplacement ? new RingGeometry(.969, 1, strikeSegments, 1, Math.PI * .75) : ring.clone()).rotateX(-Math.PI / 2), emplacement ? impactClockSurface : line);
		value.add(fill, boundary, countdown);
		fill.position.y = emplacement ? 1.4 : .14; boundary.position.y = emplacement ? 1.5 : .18; countdown.position.y = emplacement ? 1.6 : .2;
		for (const axis of [0, Math.PI / 2]) { const cross = box(value, line, 0, emplacement ? 1.7 : .24, 0, 18, emplacement ? 2.5 : 1.5, .02); cross.rotation.y = axis; }
		const shell = emplacement ? new Mesh(shellHull, shellMetal) : new Mesh(sphere, line); value.add(shell);
		const trail = emplacement ? new Mesh(cylinder, weaponVfx.styles.cannon.trail) : undefined;
		if (trail) { shell.name = 'artillery-shell'; trail.name = 'artillery-tracer'; value.add(trail); }
		else shell.scale.set(4, 12, 4);
		return { root: value, fill, boundary, countdown, shell, trail, surface, line, dispose: function () {
			for (const mark of [fill, boundary, countdown]) mark.geometry.dispose();
			surface.dispose(); line.dispose();
		} };
	};
	const warningMaterial = glow('#f3a16c');
	const smoke = new Mesh(circle, glow('#b3c4cf', 0.27)); smoke.name = 'reactor-vent'; smoke.quaternion.setFromUnitVectors(zAxis, normal); feedback.add(smoke);
	const from = new Vector3(); const to = new Vector3(); const delta = new Vector3(); const up = new Vector3(0, 1, 0);
	const slope = new Vector3();
	const placeOnGround = function (object: Object3D, terrain: FieldTerrain | undefined, point: Point, lift = 0, yaw = 0) {
		object.position.set(point.x, groundHeight(terrain, point) + lift, point.y);
		if (!terrain?.elevation) { object.rotation.set(0, yaw, 0); return; }
		const normal = groundNormal(terrain, point);
		object.quaternion.setFromUnitVectors(up, slope.set(normal.x, normal.elevation, normal.y));
		object.rotateY(yaw);
	};
	const flashes = new WeakMap<Effect, Vector3>();
	let nextFlashMuzzle = 0;
	const segment = function (mesh: Mesh, width: number) {
		delta.subVectors(to, from); const length = delta.length();
		mesh.visible = length > 0.0001; if (!mesh.visible) return;
		mesh.position.copy(from).add(to).multiplyScalar(0.5); mesh.scale.set(width, length, width); mesh.quaternion.setFromUnitVectors(up, delta.normalize());
	};
	const shellArc = new CubicBezierCurve3(); const betweenHandles = new Vector3();
	const updateArtilleryShell = function (view: ReturnType<typeof createStrike>, strike: ArtilleryStrike, remaining: number) {
		const launch = strike.emplacement;
		const shell = view.shell;
		if (!launch || !view.trail) {
			shell.visible = strike.life < .7;
			shell.position.y = 20 + strike.life * 600;
			return;
		}
		// The first control point lies on the bore axis. The second sets the descent
		// into the scattered marker, whose local position (v3) is always zero.
		const { origin, direction } = launch;
		const start = shellArc.v0.set(origin.x, origin.elevation, origin.y).sub(view.root.position);
		const range = Math.hypot(start.x, start.z);
		const departure = shellArc.v1.set(direction.x, direction.elevation, direction.y).normalize()
			.multiplyScalar(Math.max(140, range * .45)).add(start);
		const approach = shellArc.v2.copy(start).multiplyScalar(1 / 3);
		approach.y = Math.max(0, start.y) + Math.min(390, Math.max(190, range * .32));
		const progress = 1 - remaining;
		shellArc.getPoint(progress, to);
		shellArc.getPoint(Math.max(0, progress - .10 / strike.duration), from);
		shell.position.copy(to);
		delta.subVectors(departure, start).multiplyScalar(remaining * remaining);
		delta.addScaledVector(betweenHandles.subVectors(approach, departure), 2 * remaining * progress);
		delta.addScaledVector(approach, -progress * progress);
		shell.quaternion.setFromUnitVectors(up, delta.normalize());
		segment(view.trail, 2.8);
	};
	let disposed = false;
	return {
		canBakeTerrain: function () { return terrainBakeSource() !== undefined && !terrainBakeFailed; },
		resetTerrainBake,
		disableTerrainBake: function () { resetTerrainBake(); terrainBakeFailed = true; },
		bakedTerrainForFrame: function (enabled: boolean, renderer: WebGLRenderer, camera: OrthographicCamera, light: Color) {
			const source = terrainBakeSource();
			if (!source) return undefined;
			if (enabled && !bakedTerrain && !terrainBakeFailed) {
				try {
					bakedTerrain = bakeTerrain(renderer, source, camera, light);
				} catch (error: unknown) {
					terrainBakeFailed = true;
					console.warn('Terrain bake failed. Using screen-space terrain.', error);
				}
			}
			const terrain = enabled ? bakedTerrain : undefined;
			for (const group of source.art) group.visible = terrain === undefined;
			return terrain;
		},
		update: function (state: CombatStateView, frameEffects?: FrameEffects, landingShadows?: readonly (Point | undefined)[], sceneryTime = state.time) {
			if (disposed) return;
			weaponVfx.updateTime(state.time);
			weaponVfx.updateAfterglows(state);
			if (missionMap !== state.mission?.map) {
				resetTerrainBake();
				missionEnvironment?.dispose(); missionEnvironment = undefined;
				missionMap = state.mission?.map;
				if (missionMap) { missionEnvironment = createMissionEnvironment(missionMap); root.add(missionEnvironment.root); }
			}
			yard.visible = !state.mission;
			const terrain = state.mission?.map.terrain;
			const planes = fieldClippingPlanes(state.mission?.map ?? ARENA);
			for (const surface of groundMarkers) surface.clippingPlanes = planes;
			relay.visible = !state.mission || state.mission.contract.kind === 'defend';
			const relaySite = state.mission?.map.objective ?? { x: ARENA.relayX, y: ARENA.relayY };
			relay.position.set(relaySite.x, groundHeight(terrain, relaySite), relaySite.y);
			if (state.mission) missionEnvironment?.update(state.mission, sceneryTime);
			const muzzles = frameEffects?.muzzles ?? [];
			beaconSurface.color.set(state.relay < 30 ? '#ff865e' : '#b9fff0');
			beacon.scale.setScalar(4 + Math.sin(state.time * 2.4) * 0.6);
			const siege = state.enemies.filter(function (enemy) { return !enemy.catalog && (enemy.kind === 'siege' || enemy.kind === 'tank'); });
			sync(feedback, defenses, siege.length, createDefense, function (value, index) {
				const enemy = siege[index]; if (!enemy) return;
				const defense = getEnemyDefense(state, enemy); const radius = (enemy.commander ? 67 : 56) * mechScale(enemy.kind);
				placeOnGround(value.root, terrain, enemy, .2, -(enemy.kind === 'tank' ? enemy.hullAngle ?? enemy.angle : enemy.angle));
				value.shield.scale.setScalar(radius); value.shield.visible = !defense.exposed;
				value.exposed.scale.setScalar(radius); value.exposed.visible = defense.exposed;
				value.commitment.scale.setScalar(radius + 8); value.commitment.visible = enemy.attack?.phase === 'committed';
			});
			const fallen = state.wrecks;
			const vehicleWrecks = fallen.filter(function (wreck) { return wreck.kind !== 'artillery'; });
			const gunWrecks = fallen.filter(function (wreck) { return wreck.kind === 'artillery'; });
			sync(root, emplacementWrecks, gunWrecks.length, createEmplacementWreck, function (view, index) {
				const wreck = gunWrecks[index]; if (wreck) view.place(terrain, wreck);
			});
			sync(root, wrecks, vehicleWrecks.length, function () {
				const value = new Group(); value.name = 'wreck'; disc(value, shadow, 40).position.y = 0.04;
				box(value, dark, 0, 0, 0, 32, 29, 8); box(value, steel, -8, 8, 0, 19, 23, 7).rotation.z = -0.2;
				box(value, dark, 24, 0, -19, 24, 7, 5).rotation.y = 0.5; box(value, dark, -21, 0, 22, 17, 10, 4).rotation.y = -0.3;
				return { root: value };
			}, function (value, index) { const wreck = vehicleWrecks[index]; if (wreck) placeOnGround(value.root, terrain, wreck, 0, -wreck.angle); });
			const inbound = state.warnings;
			dropships.update(state, inbound, planes);
			sync(feedback, warnings, inbound.length, function () { const value = new Group(); value.name = 'inbound-warning'; disc(value, warningMaterial, 1, true); return { root: value }; }, function (value, index) {
				const warning = inbound[index]; if (!warning) return; placeOnGround(value.root, terrain, warning, .3); value.root.scale.setScalar(45 + Math.sin(state.time * 8) * 5);
			});
			const activeStrikes = state.strikes;
			for (const { emplacement, views } of strikePools) {
				const incoming = activeStrikes.filter(function (strike) { return Boolean(strike.emplacement) === emplacement; });
				sync(feedback, views, incoming.length, function () { return createStrike(emplacement); }, function (value, index) {
					const strike = incoming[index]; if (!strike) return;
					value.root.position.set(strike.x, groundHeight(terrain, strike), strike.y);
					const remaining = Math.max(0, Math.min(1, strike.life / strike.duration));
					value.surface.color.set(emplacement ? '#ff502f' : strike.friendly ? '#60dfc7' : '#ff793b');
					value.line.color.set(emplacement ? '#ff8050' : strike.friendly ? '#94ebe4' : '#f3a16c');
					if (emplacement) {
						value.surface.clippingPlanes = planes; value.line.clippingPlanes = planes;
						value.countdown.geometry.setDrawRange(0, Math.ceil(remaining * strikeSegments) * 6);
					}
					const clockRadius = strike.radius * (emplacement ? .86 : Math.max(.03, remaining));
					for (const mark of [value.fill, value.boundary, value.countdown]) {
						const radius = mark === value.countdown ? clockRadius : strike.radius;
						mark.scale.set(radius, 1, radius);
						drapeGroundGeometry(mark.geometry, terrain, strike, 0, radius);
					}
					value.surface.opacity = (emplacement ? .19 : .12) + (1 - remaining) * .18;
					updateArtilleryShell(value, strike, remaining);
				});
			}
			sync(feedback, shadows, state.enemies.length + state.squadmates.length + 1, function () { const value = new Group(); value.name = 'mech-shadow'; disc(value, shadow, 35); return { root: value }; }, function (value, index) {
				const enemy = state.enemies[index - 1];
				const mate = state.squadmates[index - state.enemies.length - 1];
				const unit = enemy ?? (landingShadows ? landingShadows[index === 0 ? 0 : index - state.enemies.length] : index === 0 ? state.player : mate);
				value.root.visible = unit !== undefined;
				if (!unit) return;
				const scale = enemy ? mechScale(enemy.kind) : mate ? getFrame(mate.frameId).size : 1;
				placeOnGround(value.root, terrain, unit, .15); value.root.scale.setScalar(scale);
			});
			const smokePositions = new Map<Shot, Vector3>();
			sync(feedback, shots, state.shots.length, createShot, function (value, index) {
				const shot = state.shots[index]; if (!shot) return; const style = weaponVfx.styles[shot.kind];
				// Simulation owns the complete trajectory. Clamping the tracer to
				// flight age prevents a new round extending behind its muzzle.
				const trailTime = Math.min(style.duration, Math.max(0, shot.age ?? style.duration));
				const elevation = shot.elevation ?? groundHeight(terrain, shot) + 42; const verticalSpeed = shot.vElevation ?? 0;
				from.set(shot.x - shot.vx * trailTime, elevation - verticalSpeed * trailTime, shot.y - shot.vy * trailTime);
				to.set(shot.x, elevation, shot.y);
				weaponVfx.updateShot(value, shot, state.time, elevation); segment(value.trail, style.width);
				if (shot.kind === 'missile' || shot.kind === 'rocket') smokePositions.set(shot, to.clone());
			});
			projectileSmoke.update(state, smokePositions);
			const activeEffects = state.effects;
			weaponVfx.contacts.update(state, activeEffects);
			sync(feedback, effects, activeEffects.length, createEffect, function (value, index) {
				const effect = activeEffects[index]; if (!effect) return;
				value.root.position.set(effect.x, effect.elevation ?? groundHeight(terrain, effect) + 36, effect.y);
				if (effect.source === 'muzzle' && effect.squadmateId === undefined && effect.elevation === undefined && muzzles.length > 0) {
					let origin = flashes.get(effect);
					if (!origin) {
						origin = muzzles[effect.slot ?? nextFlashMuzzle++ % muzzles.length]?.clone();
						if (origin) flashes.set(effect, origin);
					}
					if (origin) value.root.position.copy(origin);
				}
				value.update(effect);
			});
			lasers.update(state, muzzles);
			smoke.visible = state.player.heat > 60;
			if (smoke.visible) {
				smoke.position.set(state.player.x - Math.cos(state.player.angle) * 23, groundHeight(terrain, state.player) + 70 + state.time * 25 % 24, state.player.y - Math.sin(state.player.angle) * 23);
				if (frameEffects?.exhaust) {
					smoke.position.copy(frameEffects.exhaust); smoke.position.y += state.time * 25 % 24;
				}
				smoke.scale.setScalar((6 + state.player.heat / 15) / Math.sqrt(1.5));
			}
		},
		dispose: function () {
			if (disposed) return; disposed = true;
			for (const effect of effects) effect.dispose();
			for (const shot of shots) shot.dispose();
			dropships.dispose();
			lasers.dispose();
			weaponVfx.dispose();
			for (const pool of strikePools) for (const strike of pool.views) strike.dispose();
			wreckAssets?.dispose();
			for (const batch of relayBatches) batch.dispose();
			missionEnvironment?.dispose();
			resetTerrainBake();
			environment.dispose();
			projectileSmoke.dispose();
			floor.dispose(); stains.dispose();
			for (const value of geometries) value.dispose(); for (const value of materials) value.dispose();
			root.removeFromParent(); root.clear();
		},
	};
};
