import { definePlugin } from 'ecspresso';
import { createGroupComponents, createRenderer3DPlugin, type Renderer3DComponentTypes, type Renderer3DEventTypes, type Renderer3DResourceTypes } from 'ecspresso/plugins/rendering/renderer3D';
import { zoomForWheel } from './shared/wheel-zoom';
import { ACESFilmicToneMapping, BufferGeometry, Color, DirectionalLight, Fog, HemisphereLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, OrthographicCamera, PCFShadowMap, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { createGait, mechScale, type Gaits } from './gait';
import { getFrame, type FrameId } from './frames';
import { FRAME_RIGS } from './frame-rig';
import { createMech, weaponRecoil } from './mech-3d';
import { drawOverlay, type ScreenRect } from './overlay';
import { alignCamera, toGround, toScreen, viewScale } from './projection-3d';
import { cameraLookAhead, constrainCameraOffset, smoothCameraOffset } from './camera-follow';
import type { EnemyKind, Point, CombatStateView } from './simulation';
import { createWorldObjects } from './world-3d';
import { SURFACE_PALETTES } from './mission-environment';
import type { Biome } from './campaign-types';

interface CombatEntities {
	entityForPlayer: () => number | undefined;
	entityForEnemy: (id: number) => number | undefined;
}
interface MechView {
	model: ReturnType<typeof createMech>;
	kind: EnemyKind | undefined;
	commander: boolean;
	frame: FrameId;
	damage: { hp: number | undefined; hitAt: number };
}
interface ViewBindings {
	ensure: (id: number, kind?: EnemyKind, commander?: boolean, frame?: FrameId) => MechView;
	pose: (id: number, view: MechView, gait: Gaits['player'], heading: number, hp: number, state: CombatStateView, recoil?: number) => void;
	scale: (id: number, scale: number) => void;
}
interface OverlayFrame {
	state: CombatStateView; aim: Point; gaits: Gaits; obstructions: readonly ScreenRect[]; couchMode: boolean;
	player: MechView | undefined;
	enemyLabelHeights: ReadonlyMap<number, number>;
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
		canvas.after(labels);
		const scene = new Scene(); allocated.push(function () { scene.clear(); }); scene.background = new Color('#142329'); scene.fog = new Fog('#1c3035', 1700, 3200);
		const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
		scene.add(new HemisphereLight('#c4e5e7', '#28302c', 1.4));
		const sun = new DirectionalLight('#ffd9a0', 3.1); allocated.push(function () { sun.shadow.dispose(); }); sun.position.set(-300, 800, 500); sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -680; sun.shadow.camera.right = 680;
		sun.shadow.camera.top = 680; sun.shadow.camera.bottom = -680; sun.shadow.camera.near = 10; sun.shadow.camera.far = 2200;
		sun.shadow.normalBias = 2; sun.shadow.bias = -0.0003; scene.add(sun, sun.target);
		const fill = new DirectionalLight('#a3d1d8', 1.05); scene.add(fill, fill.target);
		const objects = createWorldObjects(scene); allocated.push(function () { objects.dispose(); });
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
		const centeredCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
		let cameraOffset: Point = { x: 0, y: 0 };
		let cameraSample: { state: CombatStateView; time: number; position: Point } | undefined;
		let biome: Biome | undefined;
		let relayHp: number | undefined; let relayHitAt = -10;
		const plugin = definePlugin('heavy-rig-presentation')
			.withComponentTypes<Renderer3DComponentTypes & { mechView: MechView }>()
			.withEventTypes<Renderer3DEventTypes>()
			.withResourceTypes<Renderer3DResourceTypes>()
			.withGroups<'renderer3d'>()
			.install(function (world, onCleanup) {
				if (views) throw new Error('Presentation is already attached to a world');
				world.installPlugin(createRenderer3DPlugin({ renderer, scene, camera, startLoop: false }));
				world.registerDispose('mechView', function ({ value }) { value.model.dispose(); });
				views = {
					ensure: function (id, kind, commander = false, frame: FrameId = 'warden') {
						const previous = world.getComponent(id, 'mechView');
						if (previous && previous.kind === kind && previous.commander === commander && previous.frame === frame) return previous;
						if (previous) { world.removeComponent(id, 'group'); world.removeComponent(id, 'mechView'); }
						const view: MechView = { model: createMech(kind, commander, frame), kind, commander, frame, damage: { hp: undefined, hitAt: -10 } };
						world.addComponents(id, { ...createGroupComponents(view.model.root), mechView: view });
						return view;
					},
					pose: function (id, view, gait, heading, hp, state, recoil = 0) {
						if (view.damage.hp !== undefined && hp < view.damage.hp) view.damage.hitAt = state.time;
						view.damage.hp = hp;
						const transform = world.getComponent(id, 'localTransform3D');
						if (!transform) return;
						transform.x = gait.body.x; transform.z = gait.body.y;
						world.markChanged(id, 'localTransform3D');
						view.model.pose(gait, heading, { hit: Math.max(0, 1 - (state.time - view.damage.hitAt) / 0.16), recoil, heat: view.kind ? 0 : state.player.heat, time: state.time });
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
			alignCamera(camera, width, height, state, zoom, focus);
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
			zoomWithWheel: function (event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) { zoom = zoomForWheel(zoom, event, height); },
			resetZoom: function () { zoom = 1; },
			toGround: function (point: Point) { return toGround(point, camera, width, height); },
			toScreen: function (point: Point, elevation = 0) { return toScreen(point, camera, width, height, elevation); },
			prepare: function (state: CombatStateView, aim: Point, gaits: Gaits, attract = false, obstructions: readonly ScreenRect[] = [], couchMode = false, hangar = false) {
				if (disposed || !views || !combat || width <= 0 || height <= 0) { overlay = undefined; return; }
				const playerId = combat.entityForPlayer();
				const player = playerId === undefined ? undefined : views.ensure(playerId, undefined, false, state.frame);
				if (biome !== state.mission?.map.biome) {
					biome = state.mission?.map.biome;
					const palette = biome ? SURFACE_PALETTES[biome] : undefined;
					scene.background = new Color(palette?.sky ?? '#142329');
					scene.fog = new Fog(palette?.haze ?? '#1c3035', 1700, 3200);
					sun.color.set(palette?.light ?? '#ffd9a0');
				}
				if (state !== previousState || state.time < previousStateTime) {
					if (player) { player.damage.hp = undefined; player.damage.hitAt = -10; }
					relayHp = undefined; relayHitAt = -10;
				}
				if (relayHp !== undefined && state.relay < relayHp) relayHitAt = state.time;
				relayHp = state.relay;
				previousState = state; previousStateTime = state.time;
				if (attract || hangar) cameraOffset = { x: 0, y: 0 };
				resize(state, width, height);
				sun.position.set(state.player.x - 420, 900, state.player.y - 500); sun.target.position.set(state.player.x, 0, state.player.y);
				fill.position.set(state.player.x + 700, 450, state.player.y + 600); fill.target.position.set(state.player.x, 50, state.player.y);
				if (hangar) {
					camera.zoom = 1.65;
					camera.setViewOffset(width, height, width > 700 ? -width * 0.29 : -width * 0.16, width > 700 ? -height * 0.11 : height * 0.27, width, height);
					camera.updateProjectionMatrix();
				} else if (attract && width > 700) {
					camera.zoom = 1.65;
					camera.setViewOffset(width, height, -width * 0.2, -height * 0.11, width, height);
					camera.updateProjectionMatrix();
				}
				if (player && playerId !== undefined) {
					const heading = attract ? Math.PI / 4 - 0.22 : state.player.turret;
					const gait = attract ? createGait({ ...state.player, angle: Math.PI / 4 + 0.15 }, getFrame(state.frame).size, FRAME_RIGS[state.frame]) : gaits.player;
					views.pose(playerId, player, gait, heading, state.player.hp, state, weaponRecoil(state.loadout));
					views.scale(playerId, hangar ? Math.min(width > 700 ? 1.55 : 0.9, height / (width > 700 ? 520 : 900)) : attract && width > 700 ? 1.55 : 1);
				}
				const enemyMuzzles = new Map<number, readonly Vector3[]>();
				const enemyLabelHeights = new Map<number, number>();
				for (const enemy of state.enemies) {
					const id = combat.entityForEnemy(enemy.id);
					if (id === undefined) continue;
					const view = views.ensure(id, enemy.kind, Boolean(enemy.commander));
					views.pose(id, view, gaits.enemies.get(enemy.id) ?? createGait({ x: enemy.x, y: enemy.y, angle: enemy.hullAngle ?? enemy.angle }, mechScale(enemy.kind)), enemy.angle, enemy.hp, state, weaponRecoil(enemy.loadout ?? []));
					enemyMuzzles.set(enemy.id, view.model.muzzles.map(function (anchor) { return new Vector3(anchor.x + enemy.x, anchor.y, anchor.z + enemy.y); }));
					if (enemy.kind === 'helicopter' || enemy.kind === 'vtol' || enemy.kind === 'tank') enemyLabelHeights.set(enemy.id, view.model.labelHeight + 16);
				}
				const worldAnchor = function (anchor: Vector3) { return new Vector3(anchor.x + state.player.x, anchor.y, anchor.z + state.player.y); };
				objects.update(state, player ? {
					muzzles: player.model.muzzles.map(worldAnchor), rocketMuzzles: player.model.rocketMuzzles.map(function (tubes) { return tubes.map(worldAnchor); }), enemies: enemyMuzzles, exhaust: player.model.exhaust ? worldAnchor(player.model.exhaust) : undefined,
				} : undefined);
				reticle.visible = barrel.visible = !attract;
				reticle.position.set(aim.x, 0.25, aim.y);
				const positions = barrelGeometry.getAttribute('position'); const p = state.player;
				positions.setXYZ(0, p.x, 0.25, p.y); positions.setXYZ(1, p.x + Math.cos(p.turret) * 110, 0.25, p.y + Math.sin(p.turret) * 110); positions.needsUpdate = true;
				overlay = { state, aim, gaits, obstructions, couchMode, player, enemyLabelHeights };
			},
			drawOverlay: function () {
				if (disposed || !overlay || width <= 0 || height <= 0) return;
				const { state, aim, gaits, obstructions, couchMode, player, enemyLabelHeights } = overlay;
				drawOverlay(ctx, width, height, state, aim, { showRadar: width > 700 && height > 520, gaits, camera, obstructions, couchMode, enemyLabelHeights,
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
