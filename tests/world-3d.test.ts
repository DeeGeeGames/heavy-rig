import { expect, test } from 'bun:test';
import { InstancedMesh, LineSegments, Mesh, Scene, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { createMount } from '../src/arsenal';
import { getHardpoints } from '../src/hardpoints';
import { createGaits } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { createState, step, weaponsStep } from '../src/simulation';
import { createWorldObjects } from '../src/world-3d';

test('world pools track live combat state and restart removes transient objects', function () {
	const scene = new Scene(); const presentation = createWorldObjects(scene); const state = createState();
	state.warnings.push({ x: 80, y: 90, kind: 'scout', life: 2 });
	state.strikes.push({ id: 2, x: 180, y: 200, life: 1.8, duration: 2.8, radius: 62, damage: 13 });
	state.shots.push({ x: 100, y: 120, vx: 200, vy: 100, life: 1, kind: 'cannon', target: undefined, damage: 38 });
	state.effects.push({ x: 100, y: 120, life: 0.4, size: 30, color: '#ff8866' });
	state.wrecks.push({ x: 60, y: 90, angle: 0.4, kind: 'striker' });
	state.enemies.push({ id: 3, x: 300, y: 320, angle: 0, hp: 125, maxHp: 125, cooldown: 0, heavy: true, kind: 'siege', attack: { phase: 'committed', remaining: 2, cycle: 1 } });
	state.player.heat = 80; state.beam = { x: 300, y: 400 };
	try {
		presentation.update(state);
		for (const name of ['inbound-warning', 'artillery-warning', 'projectile', 'impact-effect', 'wreck', 'siege-defense']) expect(scene.getObjectByName(name)).toBeDefined();
		expect(scene.getObjectByName('laser')?.visible).toBe(true); expect(scene.getObjectByName('reactor-vent')?.visible).toBe(true);
		presentation.update(createState());
		for (const name of ['inbound-warning', 'artillery-warning', 'projectile', 'impact-effect', 'wreck', 'siege-defense']) expect(scene.getObjectByName(name)).toBeUndefined();
		expect(scene.getObjectByName('laser')?.visible).toBe(false); expect(scene.getObjectByName('reactor-vent')?.visible).toBe(false);
		expect(scene.getObjectByName('relay')).toBeDefined();
		const floor = scene.getObjectByName('industrial-apron');
		expect(floor instanceof InstancedMesh && floor.count).toBe(150);
	} finally { presentation.dispose(); }
	expect(scene.children).toHaveLength(0);
});

test('transparent world effects retain depth tests without writing depth and disposal releases each shared asset once', function () {
	const scene = new Scene(); const presentation = createWorldObjects(scene); const state = createState();
	state.effects.push({ x: 100, y: 120, life: 0.4, size: 30, color: '#ff8866' });
	state.strikes.push({ id: 1, x: 180, y: 200, life: 1.8, duration: 2.8, radius: 62, damage: 13 });
	state.enemies.push({ id: 2, x: 300, y: 320, angle: 0, hp: 125, maxHp: 125, cooldown: 0, heavy: true, kind: 'siege' });
	presentation.update(state);
	const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); const disposed = new Map<BufferGeometry | Material, number>();
	scene.traverse(function (object) {
		if (!(object instanceof Mesh) && !(object instanceof LineSegments)) return;
		geometries.add(object.geometry);
		for (const surface of Array.isArray(object.material) ? object.material : [object.material]) {
			materials.add(surface); expect(surface.depthTest).toBe(true);
			if (surface.transparent) expect(surface.depthWrite).toBe(false);
		}
	});
	for (const asset of [...geometries, ...materials]) asset.addEventListener('dispose', function () { disposed.set(asset, (disposed.get(asset) ?? 0) + 1); });
	presentation.dispose(); presentation.dispose();
	for (const asset of [...geometries, ...materials]) expect(disposed.get(asset)).toBe(1);
	presentation.update(state); expect(scene.children).toHaveLength(0);
});

test('vent drift advances with simulation time and stays fixed while paused', function () {
	const scene = new Scene(); const presentation = createWorldObjects(scene); const state = createState();
	state.player.heat = 80; state.time = 0.2;
	try {
		presentation.update(state);
		const vent = scene.getObjectByName('reactor-vent');
		const ventHeight = vent?.position.y;
		presentation.update(state);
		expect(vent?.position.y).toBe(ventHeight);
		state.time = 1.2; presentation.update(state);
		expect(vent?.position.y).not.toBe(ventHeight);
	} finally { presentation.dispose(); }
});

const meshChild = function (parent: Object3D | undefined, index: number): Mesh {
	const child = parent?.children[index];
	if (!(child instanceof Mesh)) throw new Error(`Missing effect mesh ${index}`);
	return child;
};
const projectiles = function (scene: Scene) {
	const values: Object3D[] = [];
	scene.traverse(function (object) { if (object.name === 'projectile') values.push(object); });
	return values;
};
const frameEffects = function (model: ReturnType<typeof createMech>, state: ReturnType<typeof createState>) {
	const offset = new Vector3(state.player.x, 0, state.player.y);
	return { muzzles: model.muzzles.map(function (point) { return point.clone().add(offset); }), exhaust: model.exhaust?.clone().add(offset) };
};
const segmentEnds = function (mesh: Mesh) {
	return [mesh.localToWorld(new Vector3(0, -0.5, 0)), mesh.localToWorld(new Vector3(0, 0.5, 0))] as const;
};

test('all frames launch from posed weapon faces even before ECS updates a stale root transform', function () {
	for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
		const scene = new Scene(); const world = createWorldObjects(scene); const state = createState({ frame });
		const model = createMech(undefined, false, frame);
		state.player.angle = 0; state.player.turret = Math.PI / 2;
		const gait = createGaits(state).player;
		const feedback = { recoil: 0.7, hit: 0, heat: 0, time: 0 };
		try {
			model.pose(gait, state.player.turret, feedback);
			const faces: Vector3[] = [];
			model.root.traverse(function (part) { if (part.name === 'weapon-muzzle') faces.push(part.localToWorld(new Vector3())); });
			expect(faces.length).toBeGreaterThan(0);
			// renderer3D synchronizes the root after posing. Anchors must stay
			// local even when its previous world transform is translated/scaled.
			model.root.position.set(-700, 11, 2300); model.root.scale.setScalar(1.7);
			model.pose(gait, state.player.turret, feedback);
			const effects = frameEffects(model, state);
			for (const anchor of model.muzzles) {
				expect(faces.some(function (face) { return anchor.distanceTo(face) < 0.000001; })).toBe(true);
				state.shots.push({ x: state.player.x, y: state.player.y + 30, vx: 0, vy: 300, life: 2, kind: frame === 'longbow' ? 'ppc' : 'rocket', target: undefined, damage: 1 });
			}
			world.update(state, effects);
			for (const [index, projectile] of projectiles(scene).entries()) {
				const muzzle = effects.muzzles[index]; if (!muzzle) throw new Error('Missing launch socket');
				expect(meshChild(projectile, 1).position.distanceTo(muzzle)).toBeLessThan(0.000001);
				expect(meshChild(projectile, 0).visible).toBe(false);
			}
		} finally { model.dispose(); world.dispose(); }
	}
});

test('airborne shots keep their launch origin across later aim and movement, pause, and convergence to the collision path', function () {
	const scene = new Scene(); const world = createWorldObjects(scene); const state = createState({ frame: 'longbow' });
	const model = createMech(undefined, false, 'longbow');
	state.player.angle = state.player.turret = 0;
	const shot = { x: state.player.x + 30, y: state.player.y, vx: 300, vy: 0, life: 2, kind: 'ppc' as const, target: undefined, damage: 1 };
	state.shots.push(shot);
	try {
		model.pose(createGaits(state).player, 0);
		const effects = frameEffects(model, state); const muzzle = effects.muzzles[0];
		if (!muzzle) throw new Error('Missing Longbow muzzle');
		world.update(state, effects);
		const projectile = projectiles(scene)[0]; const head = meshChild(projectile, 1); const trail = meshChild(projectile, 0);
		const launch = head.position.clone();
		expect(launch.distanceTo(muzzle)).toBeLessThan(0.000001);
		expect(launch.y).toBeGreaterThan(80);
		// A retained reference to the live muzzle would pull an old shot along
		// with the mech, even though its simulation position has not changed.
		muzzle.set(-500, 400, -800);
		state.player.x += 350; state.player.y -= 240; state.player.turret = Math.PI;
		model.pose(createGaits(state).player, state.player.turret);
		for (let i = 0; i < 3; i++) {
			world.update(state, effects);
			expect(head.position.distanceTo(launch)).toBeLessThan(0.000001);
			world.update(state, frameEffects(model, state));
			expect(head.position.distanceTo(launch)).toBeLessThan(0.000001);
		}
		const launchDistance = launch.distanceTo(new Vector3(shot.x, 42, shot.y));
		shot.x += 12; state.time += 0.04;
		world.update(state, frameEffects(model, state)); scene.updateMatrixWorld(true);
		expect(head.position.y).toBeGreaterThan(42); expect(head.position.y).toBeLessThan(launch.y);
		expect(head.position.distanceTo(new Vector3(shot.x, 42, shot.y))).toBeLessThan(launchDistance);
		const [tail, tip] = segmentEnds(trail);
		expect(tail.distanceTo(launch)).toBeLessThan(0.000001);
		expect(tip.distanceTo(head.position)).toBeLessThan(0.000001);
		const pausedHead = head.position.clone(); const pausedTrail = trail.matrix.clone();
		for (let i = 0; i < 4; i++) world.update(state, frameEffects(model, state));
		expect(head.position.equals(pausedHead)).toBe(true);
		trail.updateMatrix(); expect(trail.matrix.equals(pausedTrail)).toBe(true);
		shot.x += 300; state.time += 1;
		world.update(state, frameEffects(model, state)); scene.updateMatrixWorld(true);
		expect(head.position.distanceTo(new Vector3(shot.x, 42, shot.y))).toBeLessThan(0.000001);
		for (const point of segmentEnds(trail)) expect(point.y).toBeCloseTo(42, 6);
	} finally { model.dispose(); world.dispose(); }
});

test('all frame lasers and heat exhaust follow live posed hardware while impact coordinates stay unchanged', function () {
	for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
		const scene = new Scene(); const world = createWorldObjects(scene); const state = createState({ frame });
		const model = createMech(undefined, false, frame);
		state.player.heat = 90; state.beam = { x: 1250, y: 500 };
		try {
			for (const heading of [0, Math.PI / 2, Math.PI]) {
				state.player.x += 20; state.player.y -= 10; state.player.turret = heading;
				model.pose(createGaits(state).player, heading, { recoil: 0.5, heat: 90, hit: 0, time: state.time });
				const effects = frameEffects(model, state); const muzzle = effects.muzzles[0];
				if (!muzzle || !effects.exhaust) throw new Error('Missing frame effects anchors');
				world.update(state, effects); scene.updateMatrixWorld(true);
				const laser = scene.getObjectByName('laser'); const [origin, impact] = segmentEnds(meshChild(laser, 0));
				expect(origin.distanceTo(muzzle)).toBeLessThan(0.000001);
				expect(impact.distanceTo(new Vector3(state.beam.x, 42, state.beam.y))).toBeLessThan(0.000001);
				const exhaust = scene.getObjectByName('reactor-vent'); if (!exhaust) throw new Error('Missing vent effect');
				expect(exhaust.position.x).toBe(effects.exhaust.x); expect(exhaust.position.z).toBe(effects.exhaust.z);
				expect(exhaust.position.y).toBeCloseTo(effects.exhaust.y + state.time * 25 % 24, 6);
				state.time += 0.2; world.update(state, effects);
				expect(exhaust.position.x).toBe(effects.exhaust.x); expect(exhaust.position.z).toBe(effects.exhaust.z);
				expect(exhaust.position.y).toBeCloseTo(effects.exhaust.y + state.time * 25 % 24, 6);
			}
		} finally { model.dispose(); world.dispose(); }
	}
});

test('hostile rounds ignore every redesigned player frame muzzle anchor', function () {
	for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
		const scene = new Scene(); const world = createWorldObjects(scene); const state = createState({ frame });
		const model = createMech(undefined, false, frame);
		const enemy = { x: 1000, y: 780, vx: 300, vy: 0, life: 1, kind: 'enemy' as const, target: undefined, damage: 1 };
		state.shots.push(enemy);
		try {
			model.pose(createGaits(state).player, Math.PI / 2);
			expect(model.muzzles.length).toBeGreaterThan(0);
			world.update(state, frameEffects(model, state)); scene.updateMatrixWorld(true);
			const projectile = projectiles(scene)[0];
			expect(meshChild(projectile, 1).position.toArray()).toEqual([enemy.x, 42, enemy.y]);
			for (const point of segmentEnds(meshChild(projectile, 0))) expect(point.y).toBeCloseTo(42, 6);
		} finally { model.dispose(); world.dispose(); }
	}
});

test('real weapon flashes anchor once to redesigned hardware without lifting coolant or impact effects', function () {
	for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
		const scene = new Scene(); const world = createWorldObjects(scene); const state = createState({ frame });
		const model = createMech(undefined, false, frame);
		state.player.heat = 40; state.player.hp = 70;
		state.shots.push({ x: state.player.x, y: state.player.y, vx: 0, vy: 0, life: 1, kind: 'enemy', target: undefined, damage: 1 });
		try {
			step(state, { drive: 0, stop: false, turn: 0, aim: { x: state.player.x, y: 200 }, fire: [true, false, false, false], coolant: true }, 1 / 60);
			expect(state.events).toContain('coolant'); expect(state.events).toContain('impact');
			expect(state.effects).toHaveLength(3);
			expect(state.effects.filter(function (effect) { return effect.source === 'muzzle'; })).toHaveLength(1);
			model.pose(createGaits(state).player, state.player.turret);
			const anchors = frameEffects(model, state);
			world.update(state, anchors);
			const rendered: Object3D[] = [];
			scene.traverse(function (object) { if (object.name === 'impact-effect') rendered.push(object); });
			expect(rendered).toHaveLength(state.effects.length);
			for (const [index, effect] of state.effects.entries()) {
				const visual = rendered[index]; if (!visual) throw new Error('Missing simulated effect');
				const expected = effect.source === 'muzzle' ? anchors.muzzles[0] : new Vector3(effect.x, 36, effect.y);
				if (!expected) throw new Error('Missing frame muzzle');
				expect(visual.position.distanceTo(expected)).toBeLessThan(0.000001);
			}
			const origins = rendered.map(function (effect) { return effect.position.clone(); });
			// A burst stays at the firing position while the player moves or
			// aims elsewhere; rendering a paused frame must not relocate it.
			anchors.muzzles[0]?.set(-500, 400, -800);
			state.player.x += 200; state.player.y += 100; state.player.turret += Math.PI;
			model.pose(createGaits(state).player, state.player.turret);
			world.update(state, frameEffects(model, state));
			for (const [index, visual] of rendered.entries()) {
				const origin = origins[index]; if (!origin) throw new Error('Missing original effect position');
				expect(visual.position.distanceTo(origin)).toBeLessThan(0.000001);
			}
		} finally { model.dispose(); world.dispose(); }
	}
});

// Exercise real firing with sparse loadouts: rendering order and earlier volleys
// must never choose the side or family of the next shot's hardware.
test('isolated and clustered fire stays on its equipped hardpoint across every player frame', function () {
	for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
		for (const [slot, hardpoint] of getHardpoints(frame).entries()) {
			const state = createState({ frame }); const scene = new Scene();
			const world = createWorldObjects(scene); const model = createMech(undefined, false, frame);
			const weapon = hardpoint.family === 'energy' ? 'ppc' : hardpoint.family === 'launcher' ? 'cluster-rockets' : 'machine-gun';
			state.loadout = [{ ...createMount(weapon), slot }]; state.player.turret = 0;
			try {
				model.pose(createGaits(state).player, 0);
				const anchors = frameEffects(model, state); const muzzle = anchors.muzzles[slot];
				if (!muzzle) throw new Error(`Missing ${frame} slot ${slot}`);
				expect(muzzle.z - state.player.y < 0).toBe(hardpoint.id.startsWith('left'));
				if (frame === 'warden') expect(muzzle.y > (anchors.muzzles[0]?.y ?? 0)).toBe(slot >= 2);
				for (let volley = 0; volley < 3; volley++) {
					for (const mount of state.loadout) mount.cooldown = 0;
					weaponsStep(state, { drive: 0, stop: false, turn: 0, aim: { x: 1500, y: 780 }, fire: [slot === 0, slot === 1, slot === 2, slot === 3], coolant: false }, 1 / 60);
					world.update(state, anchors);
					for (const shot of state.shots) expect(shot.slot).toBe(slot);
					for (const projectile of projectiles(scene)) expect(meshChild(projectile, 1).position.distanceTo(muzzle)).toBeLessThan(0.000001);
					scene.traverse(function (object) { if (object.name === 'impact-effect') expect(object.position.distanceTo(muzzle)).toBeLessThan(0.000001); });
				}
			} finally { model.dispose(); world.dispose(); }
		}
	}
});

test('enemy fire uses the owning enemy slot and freezes the airborne origin', function () {
	const state = createState(); const scene = new Scene(); const world = createWorldObjects(scene);
	const enemy = { id: 7, x: 500, y: 500, angle: 0, hp: 100, maxHp: 100, cooldown: 0, heavy: false, kind: 'striker' as const };
	state.enemies.push(enemy);
	const shot = { owner: 7, slot: 3, x: 530, y: 500, vx: 230, vy: 0, life: 2, kind: 'enemy' as const, target: undefined, damage: 1 };
	state.shots.push(shot);
	const muzzle = new Vector3(503, 100, 534);
	const anchors = { muzzles: [new Vector3(-100, -100, -100)], exhaust: undefined, enemies: new Map([[7, [new Vector3(), new Vector3(), new Vector3(), muzzle]]]) };
	try {
		world.update(state, anchors);
		const head = meshChild(projectiles(scene)[0], 1);
		expect(head.position.distanceTo(muzzle)).toBeLessThan(0.000001);
		const origin = head.position.clone(); muzzle.set(900, 200, 900); enemy.x += 100;
		world.update(state, anchors);
		expect(head.position.distanceTo(origin)).toBeLessThan(0.000001);
		state.enemies = []; anchors.enemies.clear();
		world.update(state, anchors);
		expect(head.position.distanceTo(origin)).toBeLessThan(0.000001);
	} finally { world.dispose(); }
});

test('rocket volleys launch from pod tubes and retain parallel paths after turret movement', function () {
	const state = createState({ frame: 'maul' }); const scene = new Scene();
	const world = createWorldObjects(scene); const model = createMech(undefined, false, 'maul');
	state.player.turret = 0; state.loadout = [{ ...createMount('cluster-rockets'), slot: 0 }];
	try {
		model.pose(createGaits(state).player, 0);
		const offset = new Vector3(state.player.x, 0, state.player.y);
		const rocketMuzzles = model.rocketMuzzles.map(function (tubes) { return tubes.map(function (tube) { return tube.clone().add(offset); }); });
		const tubes = rocketMuzzles[0]; if (!tubes?.length) throw new Error('Missing pod tubes');
		weaponsStep(state, { drive: 0, stop: false, turn: 0, aim: { x: 1500, y: 780 }, fire: [true, false, false, false], coolant: false }, 1 / 60);
		for (let tick = 0; tick < 24; tick++) weaponsStep(state, { drive: 0, stop: false, turn: 0, aim: { x: 1500, y: 780 }, fire: [false, false, false, false], coolant: false }, 1 / 60);
		expect(state.shots).toHaveLength(2);
		for (const shot of state.shots) { expect(shot.vx).toBe(1880); expect(shot.vy).toBe(0); }
		world.update(state, { ...frameEffects(model, state), rocketMuzzles });
		const starts = projectiles(scene).map(function (projectile) { return meshChild(projectile, 1).position.clone(); });
		for (const start of starts) expect(tubes.some(function (tube) { return tube.distanceTo(start) < 0.000001; })).toBe(true);
		for (const shot of state.shots) shot.x += 200;
		state.player.turret = 1; model.pose(createGaits(state).player, 1);
		world.update(state, frameEffects(model, state));
		for (const [index, projectile] of projectiles(scene).entries()) {
			const start = starts[index]; if (!start) throw new Error('Missing launch');
			expect(meshChild(projectile, 1).position.distanceTo(start.clone().add(new Vector3(200, 0, 0)))).toBeLessThan(0.000001);
		}
	} finally { model.dispose(); world.dispose(); }
});
