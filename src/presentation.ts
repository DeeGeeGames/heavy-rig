import { definePlugin } from 'ecspresso';
import { createGroupComponents, createRenderer3DPlugin, type Renderer3DComponentTypes, type Renderer3DEventTypes, type Renderer3DResourceTypes } from 'ecspresso/plugins/rendering/renderer3D';
import { clampCombatZoom, MIN_COMBAT_ZOOM, zoomForWheel } from './shared/camera-zoom';
import { ACESFilmicToneMapping, BufferGeometry, Color, DirectionalLight, Fog, HemisphereLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, OrthographicCamera, PCFShadowMap, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { createGait, createEnemyGait, type Gaits } from './gait';
import { getFrame, type FrameId } from './frames';
import { FRAME_RIGS } from './frame-rig';
import { createMech, weaponRecoil } from './mech-3d';
import { drawOverlay, type ScreenRect } from './overlay';
import { alignCamera, toGround, toScreen, viewScale } from './projection-3d';
import { cameraLookAhead, constrainCameraOffset, smoothCameraOffset } from './camera-follow';
import { playerAimPoint, enemyAimPoint, squadmateAimPoint, type EnemyKind, type Point, type CombatStateView } from './simulation';
import type { SpatialPoint } from './weapon-rig';
import type { AuthoredPoseContext } from './authored-pose';
import type { WeaponMount } from './arsenal';
import { createWorldObjects } from './world-3d';
import { SURFACE_PALETTES } from './mission-environment';
import type { Biome } from './campaign-types';
import { factionMechSkin, type MechSkinId } from './mech-skin';
import { createSolidInk } from './solid-ink';
import { minimumInkZoom, selectInkCellSize, type InkCellSize } from './solid-ink-grid';
import { createMechCadences } from './mech-cadence';
import type { AuthoredGait } from './authored-run';
import { getMechAssetBinding } from './mech-asset-registry';
import { createFiringArc } from './firing-arc-3d';
import { createLaunchFlight } from './launch-flight';
import { createSurfaceLanding, planLaunchLanding } from './launch-surface';
import { LAUNCH_TIMING } from './launch-timing';

interface CombatEntities {
	entityForPlayer: () => number | undefined;
	entityForEnemy: (id: number) => number | undefined;
	entityForSquadmate: (pilotId: string) => number | undefined;
}
interface MechView {
	model: ReturnType<typeof createMech>;
	kind: EnemyKind | undefined;
	commander: boolean;
	frame: FrameId;
	skin: MechSkinId;
	damage: { hp: number | undefined; hitAt: number };
}
interface ViewBindings {
	ensure: (id: number, kind?: EnemyKind, commander?: boolean, frame?: FrameId, skin?: MechSkinId) => MechView;
	pose: (id: number, view: MechView, gait: Gaits['player'], heading: number, hp: number, time: number, pose: MechPose) => void;
	scale: (id: number, scale: number) => void;
}
interface MechPose {
	loadout: readonly WeaponMount[];
	elevation?: number;
	visible?: boolean;
	heat?: number;
	target?: SpatialPoint | undefined;
	authoredPose?: AuthoredPoseContext | undefined;
	legGait?: AuthoredGait | undefined;
}
interface OverlayFrame {
	state: CombatStateView; aim: Point; gaits: Gaits; obstructions: readonly ScreenRect[]; couchMode: boolean;
	player: MechView | undefined;
	enemyLabelHeights: ReadonlyMap<number, number>;
	squadmateLabelHeights: ReadonlyMap<string, number>;
}

// This adapter contributes renderer/view components to the application world.
// Model disposal follows the combat entity: there is no parallel render world
// or second collection of live enemies.
export const createPresentation = function (canvas: HTMLCanvasElement) {
	const allocated: Array<() => void> = [];
	const disposeAllocated = function () {
		const errors: unknown[] = [];
		for (const release of allocated.splice(0).reverse()) {
			try { release(); } catch (error: unknown) { errors.push(error); }
		}
		if (errors.length > 0) throw new AggregateError(errors, 'Presentation resource cleanup failed');
	};
	try {
		const labels = document.createElement('canvas'); labels.className = 'world-labels'; labels.setAttribute('aria-hidden', 'true');
		allocated.push(function () { labels.remove(); });
		const ctx = labels.getContext('2d'); if (!ctx) throw new Error('Overlay unavailable');
		const renderer = new WebGLRenderer({ canvas, antialias: true });
		// Dispose GPU allocations and listeners without losing the canvas context;
		// the same DOM canvas must remain usable when the application hot reloads.
		allocated.push(function () { renderer.dispose(); });
		renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
		renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
		renderer.localClippingEnabled = true;
		canvas.after(labels);
		const scene = new Scene(); allocated.push(function () { scene.clear(); }); scene.background = new Color('#142329');
		const fog = new Fog('#1c3035', 1700, 3200); scene.fog = fog;
		const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
		scene.add(new HemisphereLight('#c4e5e7', '#28302c', 1.4));
		const sun = new DirectionalLight('#ffd9a0', 3.1); allocated.push(function () { sun.shadow.dispose(); }); sun.position.set(-300, 800, 500); sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -680; sun.shadow.camera.right = 680;
		sun.shadow.camera.top = 680; sun.shadow.camera.bottom = -680; sun.shadow.camera.near = 10; sun.shadow.camera.far = 2200;
		sun.shadow.normalBias = 2; sun.shadow.bias = -0.0003; scene.add(sun, sun.target);
		const fill = new DirectionalLight('#a3d1d8', 1.05); scene.add(fill, fill.target);
		const objects = createWorldObjects(scene); allocated.push(function () { objects.dispose(); });
		const firingArc = createFiringArc(); allocated.push(firingArc.dispose); scene.add(firingArc.mesh);
		const reticleGeometry = new RingGeometry(17, 18.5, 48); allocated.push(function () { reticleGeometry.dispose(); });
		const reticleMaterial = new MeshBasicMaterial({ color: '#d8f2de', transparent: true, opacity: 0.85, depthWrite: false }); allocated.push(function () { reticleMaterial.dispose(); });
		const reticle = new Mesh(reticleGeometry, reticleMaterial); reticle.rotation.x = -Math.PI / 2; scene.add(reticle);
		const barrelGeometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]); allocated.push(function () { barrelGeometry.dispose(); });
		const barrelMaterial = new LineBasicMaterial({ color: '#b5e4e0', transparent: true, opacity: 0.25, depthWrite: false }); allocated.push(function () { barrelMaterial.dispose(); });
		const barrel = new Line(barrelGeometry, barrelMaterial); barrel.frustumCulled = false; scene.add(barrel);
		let views: ViewBindings | undefined;
		let combat: CombatEntities | undefined;
		let overlay: OverlayFrame | undefined;
		let width = 1; let height = 1; let disposed = false; let previousState: CombatStateView | undefined; let previousStateTime = 0;
		let zoom = 1;
		let inkCellSize: InkCellSize = 1.5;
		const setZoom = function (value: number) {
			if (!Number.isFinite(value)) return;
			zoom = clampCombatZoom(value);
			inkCellSize = selectInkCellSize(zoom, inkCellSize);
		};
		let playerSkin: MechSkinId = 'original';
		const centeredCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
		let cameraOffset: Point = { x: 0, y: 0 };
		let cameraSample: { state: CombatStateView; time: number; position: Point } | undefined;
		let biome: Biome | undefined;
		let relayHp: number | undefined; let relayHitAt = -10;
		const ink = createSolidInk(renderer);
		const inkAnchor = new Vector3();
		allocated.push(ink.dispose);
		let launchTime: number | undefined;
		let launchDockHeight = 0;
		let launchOwner: CombatStateView | undefined;
		let launchPlan: ReturnType<typeof planLaunchLanding> | undefined;
		let flight: ReturnType<typeof createLaunchFlight> | undefined;
		let surface: ReturnType<typeof createSurfaceLanding> | undefined;
		const releaseLaunch = function () {
			flight?.dispose(); flight = undefined;
			surface?.dispose(); surface = undefined;
			launchOwner = undefined;
			launchPlan = undefined;
		};
		allocated.push(releaseLaunch);
		let comparison: { state: CombatStateView; enabled: boolean; lighter: boolean; bakedYard: boolean } | undefined;
		const inkEnabled = function (state: CombatStateView) { return comparison?.state !== state || comparison.enabled; };
		const cadence = createMechCadences();
		const plugin = definePlugin('heavy-rig-presentation')
			.withComponentTypes<Renderer3DComponentTypes & { mechView: MechView }>()
			.withEventTypes<Renderer3DEventTypes>()
			.withResourceTypes<Renderer3DResourceTypes>()
			.withGroups<'renderer3d'>()
			.withLabels<'renderer3d-render' | 'battlefield-render'>()
			.install(function (world, onCleanup) {
				if (views) throw new Error('Presentation is already attached to a world');
				world.installPlugin(createRenderer3DPlugin({ renderer, scene, camera, startLoop: false }));
				// The plugin still owns scene graph and transform synchronization.
				world.removeSystem('renderer3d-render');
				world.addSystem('battlefield-render').inPhase('render').inGroup('renderer3d').setProcess(function () {
					if (flight && launchOwner && launchTime !== undefined) {
						flight.render(renderer, ink, launchOwner, playerSkin, launchTime, width, height);
						return;
					}
					if (!overlay) return;
					const enabled = inkEnabled(overlay.state);
					const bake = comparison?.state !== overlay.state || comparison.bakedYard;
					const terrain = objects.bakedTerrainForFrame(enabled && bake && ink.available, renderer, camera, sun.color);
					if (!enabled) { renderer.render(scene, camera); return; }
					const responsiveScale = viewScale(width, height);
					const displayZoom = zoom * camera.zoom;
					const cellSize = camera.zoom === 1 ? inkCellSize : selectInkCellSize(displayZoom, inkCellSize);
					// Budget the extra-wide view separately so it cannot reduce mech detail at ordinary zooms.
					const minimumZoom = displayZoom < minimumInkZoom[2] ? MIN_COMBAT_ZOOM : minimumInkZoom[cellSize];
					const player = overlay.state.player;
					// Match the Warden study's standing reference height. Keep the
					// anchor independent of chassis pose, look-ahead and camera shake.
					inkAnchor.set(player.x, 50.875, player.y);
					const frame = {
						anchor: inkAnchor,
						cell: cellSize * responsiveScale * displayZoom,
						minimumCell: cellSize * responsiveScale * minimumZoom,
						lighterHousing: comparison?.lighter ?? true,
					};
					if (!ink.render(scene, camera, width, height, terrain ? { ...frame, terrain } : frame) && terrain) {
						objects.disableTerrainBake();
						ink.render(scene, camera, width, height, frame);
					}
				});
				world.registerDispose('mechView', function ({ value }) { value.model.dispose(); });
				views = {
					ensure: function (id, kind, commander = false, frame: FrameId = 'warden', skin: MechSkinId = 'original') {
						const previous = world.getComponent(id, 'mechView');
						if (previous && previous.kind === kind && previous.commander === commander && previous.frame === frame && previous.skin === skin) return previous;
						if (previous) { world.removeComponent(id, 'group'); world.removeComponent(id, 'mechView'); }
						const view: MechView = { model: createMech(kind, commander, frame, skin), kind, commander, frame, skin, damage: { hp: undefined, hitAt: -10 } };
						world.addComponents(id, { ...createGroupComponents(view.model.root), mechView: view });
						return view;
					},
					pose: function (id, view, gait, heading, hp, time, { loadout, heat = 0, authoredPose, target, legGait, elevation = 0, visible = true }) {
						if (view.damage.hp !== undefined && hp < view.damage.hp) view.damage.hitAt = time;
						view.damage.hp = hp;
						const transform = world.getComponent(id, 'localTransform3D');
						if (!transform) return;
						transform.x = gait.body.x; transform.y = elevation; transform.z = gait.body.y;
						world.markChanged(id, 'localTransform3D');
						view.model.root.visible = visible;
						view.model.pose(gait, heading, {
							hit: Math.max(0, 1 - (time - view.damage.hitAt) / 0.16), recoil: weaponRecoil(loadout), heat, time,
							...(!view.kind ? { equippedSlots: loadout.map(function (mount, index) { return mount.slot ?? index; }) } : {}),
							...(legGait ? { legGait } : {}), ...(authoredPose ? { authoredPose } : {}), ...(target ? { target } : {}),
						});
					},
					scale: function (id, scale) {
						const transform = world.getComponent(id, 'localTransform3D');
						if (!transform) return;
						transform.sx = transform.sy = transform.sz = scale;
						world.markChanged(id, 'localTransform3D');
					},
				};
				onCleanup(function () { views = undefined; overlay = undefined; });
			});
		// The application disposes its shared world first, releasing mechView models
		// and renderer listeners. Supplied Three.js objects remain adapter-owned.
		const dispose = function () {
			if (disposed) return; disposed = true;
			views = undefined; combat = undefined; overlay = undefined;
			disposeAllocated();
		};
		const alignView = function (state: CombatStateView, viewHeight: number, focus: Point) {
			const depthOffset = alignCamera(camera, width, viewHeight, state, zoom, focus);
			fog.near = 1700 + depthOffset; fog.far = 3200 + depthOffset;
		};
		const resize = function (state: CombatStateView, nextWidth: number, nextHeight: number) {
			width = nextWidth; height = nextHeight;
			if (disposed || width <= 0 || height <= 0) return;
			const dpr = Math.min(devicePixelRatio, 2);
			if (renderer.getPixelRatio() !== dpr || canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
				renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
			}
			if (labels.width !== canvas.width || labels.height !== canvas.height) { labels.width = canvas.width; labels.height = canvas.height; }
			camera.clearViewOffset(); camera.zoom = 1; alignCamera(centeredCamera, width, height, state, zoom);
			const focus = toGround({ x: width * (0.5 + cameraOffset.x), y: height * (0.52 + cameraOffset.y) }, centeredCamera, width, height) ?? state.player;
			alignView(state, height, focus);
			if (state.shake > 0) camera.setViewOffset(width, height, -Math.sin(state.time * 79) * state.shake, -Math.cos(state.time * 91) * state.shake, width, height);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		const updateCamera = function (state: CombatStateView, pointer: Point | undefined, obstructions: readonly ScreenRect[]) {
			const elapsed = cameraSample ? state.time - cameraSample.time : 0;
			const distance = cameraSample ? Math.hypot(state.player.x - cameraSample.position.x, state.player.y - cameraSample.position.y) : 0;
			const frame = getFrame(state.frame);
			if (!cameraSample || cameraSample.state !== state || elapsed < 0 || distance > frame.speed * Math.max(0, elapsed) + 80) {
				cameraOffset = { x: 0, y: 0 };
			} else if (elapsed > 0) {
				const velocity = { x: (state.player.x - cameraSample.position.x) / elapsed, y: (state.player.y - cameraSample.position.y) / elapsed };
				cameraOffset = smoothCameraOffset(cameraOffset, cameraLookAhead({ width, height, velocity, maxSpeed: frame.speed, turret: state.player.turret, pointer }), elapsed);
			}
			cameraSample = { state, time: state.time, position: { x: state.player.x, y: state.player.y } };
			const clearance = viewScale(width, height) * zoom * frame.size;
			cameraOffset = constrainCameraOffset(cameraOffset, width, height, { x: 55 * clearance, y: 100 * clearance }, obstructions);
			resize(state, width, height);
		};
		return {
			plugin,
			updateCamera,
			bind: function (entities: CombatEntities) { combat = entities; },
			resize,
			zoomWithWheel: function (event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) { setZoom(zoomForWheel(zoom, event, height)); },
			toggleWideView: function () { setZoom(zoom === MIN_COMBAT_ZOOM ? 1 : MIN_COMBAT_ZOOM); },
			getZoom: function () { return zoom; },
			setZoom,
			resetZoom: function () { setZoom(1); },
			setLaunchTime: function (seconds: number | undefined, dockHeight = 0) {
				if (launchTime !== undefined && (seconds === undefined || seconds < launchTime)) releaseLaunch();
				launchTime = seconds;
				launchDockHeight = dockHeight;
			},
			toGround: function (point: Point) { return toGround(point, camera, width, height); },
			toScreen: function (point: Point, elevation = 0) { return toScreen(point, camera, width, height, elevation); },
			canCompareKestrel: function () { return ink.available && !!getMechAssetBinding('kestrel'); },
			canBakeYard: objects.canBakeTerrain,
			resetTerrainBake: objects.resetTerrainBake,
			setKestrelComparison: function (state: CombatStateView | undefined, enabled: boolean, lighter: boolean, bakedYard: boolean) {
				comparison = state?.frame === 'kestrel' ? { state, enabled, lighter, bakedYard } : undefined;
			},
			stepMechCadence: cadence.advance,
			setSkin: function (skin: MechSkinId) { playerSkin = skin; },
			prepare: function (state: CombatStateView, aim: Point, gaits: Gaits, attract = false, obstructions: readonly ScreenRect[] = [], couchMode = false, hangar = false) {
				if (disposed || !views || !combat || width <= 0 || height <= 0) { overlay = undefined; return; }
				if (launchOwner && launchOwner !== state) releaseLaunch();
				if (launchTime !== undefined && state.mission) {
					launchOwner = state;
					launchPlan ??= planLaunchLanding(state, state.mission.map);
					if (launchTime < LAUNCH_TIMING.approach) {
						flight ??= createLaunchFlight(launchPlan.berths);
						overlay = undefined;
						return;
					}
					if (flight) { flight.dispose(); flight = undefined; }
					surface ??= createSurfaceLanding(scene, state, state.mission.map, launchPlan);
				}
				const landing = launchTime !== undefined ? surface?.update(launchTime, width, height) : undefined;
				if (comparison && comparison.state !== state) comparison = undefined;
				const nativeComparison = !inkEnabled(state);
				const sampledLegs = function (actor: Point, gait: AuthoredGait) { return nativeComparison ? undefined : cadence.visualGait(actor, gait); };
				const playerId = combat.entityForPlayer();
				const player = playerId === undefined ? undefined : views.ensure(playerId, undefined, false, state.frame, comparison?.enabled ? 'accord' : playerSkin);
				if (biome !== state.mission?.map.biome) {
					biome = state.mission?.map.biome;
					const palette = biome ? SURFACE_PALETTES[biome] : undefined;
					scene.background = new Color(palette?.sky ?? '#142329');
					fog.color.set(palette?.haze ?? '#1c3035');
					sun.color.set(palette?.light ?? '#ffd9a0');
				}
				if (state !== previousState || state.time < previousStateTime) {
					if (player) { player.damage.hp = undefined; player.damage.hitAt = -10; }
					relayHp = undefined; relayHitAt = -10;
				}
				if (relayHp !== undefined && state.relay < relayHp) relayHitAt = state.time;
				relayHp = state.relay;
				previousState = state; previousStateTime = state.time;
				if (attract || hangar || landing) cameraOffset = { x: 0, y: 0 };
				resize(state, width, height);
				sun.position.set(state.player.x - 420, 900, state.player.y - 500); sun.target.position.set(state.player.x, 0, state.player.y);
				fill.position.set(state.player.x + 700, 450, state.player.y + 600); fill.target.position.set(state.player.x, 50, state.player.y);
				if (landing) {
					const viewHeight = Math.max(1, height - launchDockHeight * landing.dockBlend);
					alignView(state, viewHeight, landing.focus);
					camera.zoom = landing.zoom;
					if (viewHeight < height) camera.setViewOffset(width, viewHeight, 0, 0, width, height);
					else camera.updateProjectionMatrix();
				} else if (hangar) {
					camera.zoom = 1.65;
					camera.setViewOffset(width, height, width > 700 ? -width * 0.29 : -width * 0.16, width > 700 ? -height * 0.11 : height * 0.27, width, height);
					camera.updateProjectionMatrix();
				} else if (attract && width > 700) {
					camera.zoom = 1.65;
					camera.setViewOffset(width, height, -width * 0.2, -height * 0.11, width, height);
					camera.updateProjectionMatrix();
				}
				if (player && playerId !== undefined) {
					const arrival = landing?.poses[0];
					const heading = arrival?.gait.body.angle ?? (attract ? Math.PI / 4 - 0.22 : state.player.turret);
					const gait = arrival?.gait ?? (attract ? createGait({ ...state.player, angle: Math.PI / 4 + 0.15 }, getFrame(state.frame).size, FRAME_RIGS[state.frame]) : gaits.player);
					views.pose(playerId, player, gait, heading, state.player.hp, state.time, {
						loadout: state.loadout, heat: state.player.heat, authoredPose: arrival ? arrival.authored : state.authoredPose,
						elevation: arrival?.elevation ?? 0, visible: landing?.visible ?? true,
						legGait: arrival?.gait ?? (attract ? undefined : sampledLegs(state.player, state.authoredPose?.gait ?? gait)),
						target: attract || hangar || landing ? undefined : playerAimPoint(state),
					});
					views.scale(playerId, hangar ? Math.min(width > 700 ? 1.55 : 0.9, height / (width > 700 ? 520 : 900)) : attract && width > 700 ? 1.55 : 1);
				}
				const squadmateLabelHeights = new Map<string, number>();
				for (const [index, mate] of state.squadmates.entries()) {
					const id = combat.entityForSquadmate(mate.pilotId);
					if (id === undefined) continue;
					const view = views.ensure(id, undefined, false, mate.frameId, playerSkin);
					const arrival = landing?.poses[index + 1];
					const gait = arrival?.gait ?? gaits.squadmates.get(mate.pilotId) ?? createGait(mate, getFrame(mate.frameId).size, FRAME_RIGS[mate.frameId]);
					views.pose(id, view, gait, arrival?.gait.body.angle ?? mate.turret, mate.hp, state.time, {
						loadout: mate.loadout, heat: mate.heat, authoredPose: arrival ? arrival.authored : mate.authoredPose,
						elevation: arrival?.elevation ?? 0, visible: landing?.visible ?? true,
						legGait: arrival?.gait ?? sampledLegs(mate, mate.authoredPose?.gait ?? gait),
						target: !landing && mate.hp > 0 ? squadmateAimPoint(state, mate) : undefined,
					});
					squadmateLabelHeights.set(mate.pilotId, view.model.labelHeight + 12);
				}
				const enemyLabelHeights = new Map<number, number>();
				for (const enemy of state.enemies) {
					const id = combat.entityForEnemy(enemy.id);
					if (id === undefined) continue;
					const view = views.ensure(id, enemy.catalog ? undefined : enemy.kind, Boolean(enemy.commander), enemy.catalog?.frameId ?? 'warden', factionMechSkin(state.mission?.contract.opponent));
					const gait = gaits.enemies.get(enemy.id) ?? createEnemyGait(enemy);
					views.pose(id, view, gait, enemy.angle, enemy.hp, state.time, {
						loadout: enemy.loadout ?? [], heat: enemy.reactor?.heat ?? 0, authoredPose: enemy.catalog?.authoredPose,
							target: enemyAimPoint(state, enemy), legGait: sampledLegs(enemy, enemy.catalog?.authoredPose?.gait ?? gait),
					});
					if (enemy.catalog || enemy.kind === 'helicopter' || enemy.kind === 'vtol' || enemy.kind === 'tank') enemyLabelHeights.set(enemy.id, view.model.labelHeight + 16);
				}
				const worldAnchor = function (anchor: Vector3) { return new Vector3(anchor.x + state.player.x, anchor.y, anchor.z + state.player.y); };
				objects.update(state, player ? {
					muzzles: player.model.muzzles.map(worldAnchor), exhaust: player.model.exhaust ? worldAnchor(player.model.exhaust) : undefined,
				} : undefined, landing?.poses.map(function (rig) { return landing.visible && rig.elevation < 3 ? rig.gait.body : undefined; }));
				firingArc.update(state, Boolean(player) && !attract && !hangar && !landing);
				reticle.visible = barrel.visible = !attract && !landing;
				reticle.position.set(aim.x, 0.25, aim.y);
				const positions = barrelGeometry.getAttribute('position'); const p = state.player;
				positions.setXYZ(0, p.x, 0.25, p.y); positions.setXYZ(1, p.x + Math.cos(p.turret) * 110, 0.25, p.y + Math.sin(p.turret) * 110); positions.needsUpdate = true;
				overlay = { state, aim, gaits, obstructions, couchMode, player, enemyLabelHeights, squadmateLabelHeights };
			},
			drawOverlay: function () {
				if (launchTime !== undefined) {
					ctx.clearRect(0, 0, width, height);
					if (surface && launchTime < LAUNCH_TIMING.touchdown) surface.drawSurvey(ctx, width, height, camera, launchTime);
					return;
				}
				if (disposed || !overlay || width <= 0 || height <= 0) return;
				const { state, aim, gaits, obstructions, couchMode, player, enemyLabelHeights, squadmateLabelHeights } = overlay;
				drawOverlay(ctx, width, height, state, aim, { showRadar: width > 700 && height > 520, gaits, camera, obstructions, couchMode, enemyLabelHeights, squadmateLabelHeights,
					armorHit: Math.max(0, 1 - (state.time - (player?.damage.hitAt ?? -10)) / 0.9),
					...(player && getFrame(state.frame).chassisId !== 'warden' ? { armorHitHeight: player.model.labelHeight + 20 } : {}),
					relayHit: Math.max(0, 1 - (state.time - relayHitAt) / 1.6) });
			},
			diagnostics: function () { return { calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
			dispose,
		};
	} catch (error: unknown) {
		try { disposeAllocated(); }
		catch (cleanupError: unknown) { throw new AggregateError([error, cleanupError], 'Presentation initialization failed'); }
		throw error;
	}
};
