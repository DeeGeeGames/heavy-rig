import { acquireMissileTarget } from './missile-fixture';
import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount, type WeaponId } from '../src/arsenal';
import { createCombatRuntime } from '../src/combat-runtime';
import { getFrame, FRAMES } from '../src/frames';
import { targetSolution } from '../src/overlay';
import { angleDelta, createState, enemiesStep, movementStep, weaponsStep, type Controls, type Unit } from '../src/simulation';
import { inFiringArc, TORSO_LIMIT } from '../src/torso-arc';

const dt = 1 / 60;
const idle: Controls = { drive: 0, stop: false, turn: 0, aim: { x: 1500, y: 780 }, fire: [false, false, false, false], coolant: false };
const point = function (body: { x: number; y: number }, angle: number, range = 150) { return { x: body.x + Math.cos(angle) * range, y: body.y + Math.sin(angle) * range }; };
const enemy = function (id: number, kind: Unit['kind'], x = 1100, y = 780): Unit {
	return { id, kind, x, y, angle: 0, hullAngle: 0, hp: 1000, maxHp: 1000, cooldown: 0, heavy: kind === 'siege' };
};

test('all chassis stop at both limits, hold their rear side, and switch through the front across world angle seams', function () {
	for (const frame of FRAMES) for (const heading of [0, Math.PI - 0.01, -Math.PI + 0.01, Math.PI * 8]) for (const side of [-1, 1]) {
		const state = createState({ frame: frame.id }); const p = state.player;
		p.angle = heading; p.turret = heading + side * TORSO_LIMIT;
		for (const rear of [side * 2.5, side * 3.13, -side * 3.13, -side * 2.5]) {
			for (let tick = 0; tick < 20; tick++) movementStep(state, { ...idle, aim: point(p, heading + rear) }, dt);
			expect(angleDelta(p.angle, p.turret)).toBeCloseTo(side * TORSO_LIMIT);
			expect(p.angle).toBe(heading);
		}
		const destination = heading - side * TORSO_LIMIT; let crossedFront = false;
		for (let tick = 0; tick < 300; tick++) {
			const before = angleDelta(p.angle, p.turret);
			movementStep(state, { ...idle, aim: point(p, destination) }, dt);
			const after = angleDelta(p.angle, p.turret);
			expect(Math.abs(after)).toBeLessThanOrEqual(TORSO_LIMIT + 1e-9);
			expect(Math.abs(after - before)).toBeLessThanOrEqual(frame.turretRate * dt + 1e-9);
			if (Math.abs(after) < frame.turretRate * dt) crossedFront = true;
		}
		expect(crossedFront).toBe(true); expect(angleDelta(p.angle, p.turret)).toBeCloseTo(-side * TORSO_LIMIT);
	}
});

test('manual rate aim hits both stops, holds on release, and yields to legs while reversing', function () {
	const state = createState(); const p = state.player; p.angle = 0; p.turret = 0;
	for (const side of [1, -1]) {
		for (let tick = 0; tick < 240; tick++) movementStep(state, { ...idle, turretTurn: side }, dt);
		expect(angleDelta(p.angle, p.turret)).toBeCloseTo(side * TORSO_LIMIT);
		movementStep(state, { ...idle, turretTurn: 0 }, dt);
		expect(angleDelta(p.angle, p.turret)).toBeCloseTo(side * TORSO_LIMIT);
	}
	p.throttle = -1;
	for (let tick = 0; tick < 400; tick++) {
		movementStep(state, { ...idle, turn: 1, turretTurn: 0 }, dt);
		expect(Math.abs(angleDelta(p.angle, p.turret))).toBeLessThanOrEqual(TORSO_LIMIT + 1e-9);
	}
	expect(p.angle).toBeCloseTo(400 * dt * getFrame(state.frame).turnRate);
	expect(p.speed).toBeLessThan(0); expect(p.throttle).toBe(-1);
});

test('out-of-arc selection blocks every weapon without spending ammo, heat or cooldown', function () {
	const weapons: readonly WeaponId[] = ['autocannon', 'machine-gun', 'laser', 'ppc', 'stream-missiles', 'cluster-missiles', 'stream-rockets', 'cluster-rockets'];
	for (const starter of weapons) {
		const state = createState({ starter }); const p = state.player; p.angle = 0; p.turret = TORSO_LIMIT;
		const target = enemy(1, 'striker', p.x - 150, p.y); state.enemies = [target];
		const supplies = JSON.stringify(state.loadout);
		weaponsStep(state, { ...idle, targetId: 1, fire: [true, true, true, true] }, dt);
		expect(state.shots).toHaveLength(0); expect(state.beams).toHaveLength(0);
		expect(JSON.stringify(state.loadout)).toBe(supplies); expect(p.heat).toBe(0); expect(p.targetId).toBe(1);
		expect(targetSolution(state, target, target).guided).toBe(false);
		target.x = p.x + 150; p.turret = 0; acquireMissileTarget(state, 1);
		weaponsStep(state, { ...idle, targetId: 1, fire: [true, true, true, true] }, dt);
		expect(state.shots.length + state.beams.length).toBeGreaterThan(0); expect(p.heat).toBeGreaterThan(0);
	}
});

test('blind-sector free aim cannot fire and missiles require explicit selected acquisition', function () {
	const state = createState({ starter: 'stream-missiles' }); const p = state.player; p.angle = 0; p.turret = 0;
	const rear = enemy(1, 'scout', p.x - 100, p.y); const front = enemy(2, 'scout', p.x + 400, p.y);
	state.enemies = [rear, front];
	weaponsStep(state, { ...idle, aim: rear, fire: [true, true, true, true] }, dt);
	expect(state.shots).toHaveLength(0);
	weaponsStep(state, { ...idle, fire: [true, true, true, true] }, dt);
	expect(state.shots).toHaveLength(0);
	acquireMissileTarget(state, 2);
	weaponsStep(state, { ...idle, targetId: 2, fire: [true, true, true, true] }, dt);
	expect(state.shots[0]?.target).toBe(2);
	// Both boundaries are inclusive; stepping beyond either one blocks acquisition.
	for (const side of [-1, 1]) {
		Object.assign(front, point(p, side * TORSO_LIMIT));
		expect(inFiringArc(p, p.angle, front)).toBe(true);
		Object.assign(front, point(p, side * (TORSO_LIMIT + 0.001)));
		expect(inFiringArc(p, p.angle, front)).toBe(false);
	}
});

test('player salvos cancel remaining rounds when a tracked target leaves the arc', function () {
	for (const starter of ['cluster-rockets', 'stream-missiles-4'] as const) {
		const state = createState({ starter }); const p = state.player; p.angle = 0; p.turret = 0;
		const target = enemy(1, 'scout'); state.enemies = [target]; acquireMissileTarget(state, 1);
		weaponsStep(state, { ...idle, targetId: 1, fire: [true, true, true, true] }, dt);
		const mount = state.loadout[0]; if (!mount?.rocketVolley) throw new Error('Missing salvo');
		const rounds = mount.rounds; const heat = p.heat; const launched = state.shots.length;
		target.x = p.x - 100;
		weaponsStep(state, { ...idle, targetId: 1 }, 0.5);
		expect(mount.rocketVolley).toBeUndefined(); expect(mount.rounds).toBe(rounds); expect(p.heat).toBe(heat); expect(state.shots).toHaveLength(launched);
	}
});

test('enemy mechs hold their rear side, refuse guns, missiles and artillery, and resume inside the arc', function () {
	for (const kind of ['scout', 'striker', 'siege'] as const) {
		const state = createState(); const unit = enemy(1, kind, 900, 780); state.enemies = [unit];
		// Isolate the firing arc from mobile enemies choosing to turn their legs.
		unit.stationary = true;
		unit.angle = TORSO_LIMIT;
		for (const behind of [3.13, -3.13]) {
			Object.assign(state.player, point(unit, behind, 100));
			for (let tick = 0; tick < 60; tick++) enemiesStep(state, dt);
			expect(unit.hullAngle).toBe(0); expect(unit.angle).toBeCloseTo(TORSO_LIMIT);
			expect(state.shots).toHaveLength(0); expect(state.strikes).toHaveLength(0);
		}
		Object.assign(state.player, point(unit, -1, 100));
		for (let tick = 0; tick < 400; tick++) {
			enemiesStep(state, dt);
			expect(Math.abs(angleDelta(unit.hullAngle ?? unit.angle, unit.angle))).toBeLessThanOrEqual(TORSO_LIMIT + 1e-9);
		}
		expect(state.shots.length + state.strikes.length).toBeGreaterThan(0);
	}
});

test('enemy queued missiles cancel without spending supplies outside the leg-relative arc; vehicles retain full traverse', function () {
	for (const kind of ['striker', 'vtol'] as const) {
		const state = createState(); const unit = enemy(1, kind, 900, 780); state.enemies = [unit];
		Object.assign(state.player, point(unit, Math.PI, 100));
		const mount = { ...createMount('stream-missiles'), slot: kind === 'vtol' ? 0 : 2, rocketVolley: { remaining: 1, nextIn: 0 } };
		unit.loadout = [mount]; unit.cooldown = 100; const rounds = mount.rounds;
		enemiesStep(state, dt);
		if (kind === 'striker') {
			expect(state.shots).toHaveLength(0); expect(mount.rounds).toBe(rounds); expect(mount.rocketVolley).toBeUndefined();
		} else expect(state.shots).toHaveLength(1);
	}
});

test('ECS applies the arc before same-tick firing, freezes on pause and resets with a new state', async function () {
	const combat = createCombatRuntime(); const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(dt).build();
	try {
		await world.initialize(); const initial = createState(); initial.spawnIn = Infinity;
		initial.player.angle = 0; initial.player.turret = TORSO_LIMIT;
		initial.enemies = [enemy(1, 'scout', initial.player.x - 100, initial.player.y)];
		const state = combat.attach(initial); combat.setEnabled(true);
		combat.setControls(function () { return { ...idle, targetId: 1, turretTurn: 1, fire: [true, true, true, true] }; });
		world.update(dt); expect(state.player.turret).toBeCloseTo(TORSO_LIMIT); expect(state.stats.shotsFired).toBe(0); expect(state.beams).toHaveLength(0);
		combat.setEnabled(false); const paused = JSON.stringify(state); world.update(0.1); expect(JSON.stringify(state)).toBe(paused);
		const next = combat.attach(createState()); expect(next.player.turret).toBe(next.player.angle); expect(next.player.targetId).toBeUndefined();
	} finally { await world.dispose(); }
});
