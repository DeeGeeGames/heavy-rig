import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount } from '../src/arsenal';
import { createCombatRuntime } from '../src/combat-runtime';
import { createState, weaponsStep, projectilesStep, type Controls, type EnemyKind, type Unit } from '../src/simulation';
import { enemyVolume } from '../src/combat-spatial';
import { getPlayerMuzzle } from '../src/weapon-rig';

const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 1300, y: 780 }, fire: [false, false, false, false], coolant: false };
const enemy = function (id: number, x: number, kind: EnemyKind): Unit { return { id, x, y: 780, kind, hp: 1000, maxHp: 1000, angle: 0, cooldown: 999, heavy: false }; };
const setup = function () { const state = createState(); state.spawnIn = 999; state.player.turret = 0; return state; };

test('acquired aircraft fire starts at the articulated muzzle and stays straight after the target and shooter move', function () {
	const state = setup(); const target = enemy(1, 1300, 'vtol'); state.enemies = [target];
	weaponsStep(state, { ...idle, targetId: target.id, fire: [true, false, false, false] }, 1 / 60);
	const shot = state.shots[0]; if (!shot || shot.elevation === undefined || shot.vElevation === undefined) throw new Error('Missing spatial shot');
	const expected = getPlayerMuzzle(state.frame, 0, state.player, 0, undefined, enemyVolume(target));
	expect(shot.x).toBeCloseTo(expected.x); expect(shot.y).toBeCloseTo(expected.y); expect(shot.elevation).toBeCloseTo(expected.elevation);
	expect(shot.vElevation).toBeGreaterThan(0);
	const velocity = [shot.vx, shot.vy, shot.vElevation]; const origin = { ...shot };
	target.x += 100; target.y += 200; state.player.x -= 200; state.player.turret = 2;
	projectilesStep(state, 0.1);
	expect([shot.vx, shot.vy, shot.vElevation]).toEqual(velocity);
	expect(shot.x).toBeCloseTo(origin.x + shot.vx * 0.1); expect(shot.elevation).toBeCloseTo(expected.elevation + shot.vElevation * 0.1);
});

test('free fire remains horizontal and cannot hit aircraft sharing its ground-plane path', function () {
	const state = setup(); const target = enemy(1, 1200, 'helicopter'); state.enemies = [target];
	weaponsStep(state, { ...idle, fire: [true, false, false, false] }, 1 / 60);
	const shot = state.shots[0]; if (!shot) throw new Error('Missing shot');
	expect(shot.vElevation).toBe(0); const elevation = shot.elevation;
	projectilesStep(state, 0.7);
	expect(target.hp).toBe(1000); expect(shot.elevation).toBe(elevation);
});

test('3D swept collision hits fast acquired rounds and intercepts a closer unit at the same altitude', function () {
	for (const blocked of [false, true]) {
		const state = setup(); const target = enemy(1, 1300, 'helicopter'); const blocker = enemy(2, 1200, 'helicopter');
		state.enemies = blocked ? [target, blocker] : [target];
		weaponsStep(state, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
		projectilesStep(state, 0.8);
		expect(target.hp < 1000).toBe(!blocked); expect(blocker.hp < 1000).toBe(blocked); expect(state.shots.length).toBe(0);
		expect(state.effects.some(function (effect) { return effect.source !== 'muzzle' && (effect.elevation ?? 0) > 80; })).toBe(true);
	}
});

test('target elevation preserves turret traverse and dead acquisition returns to horizontal fire', function () {
	const state = setup(); const target = enemy(1, 500, 'vtol'); state.enemies = [target];
	weaponsStep(state, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
	expect(state.shots[0]?.vx).toBeGreaterThan(0);
	target.hp = 0; state.loadout = [createMount('autocannon')];
	weaponsStep(state, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
	expect(state.player.targetId).toBeUndefined(); expect(state.shots[1]?.vElevation).toBe(0);
});

test('guided missiles steer vertically while beams stop at the first 3D contact', function () {
	const state = createState({ frame: 'morrow' }); state.player.turret = 0; const target = enemy(1, 1300, 'vtol'); state.enemies = [target];
	weaponsStep(state, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
	const missile = state.shots[0]; if (!missile) throw new Error('Missing missile'); const before = missile.vElevation;
	target.kind = 'tank'; projectilesStep(state, 0.05); expect(missile.vElevation).toBeLessThan(before ?? 0);
	const beamState = createState({ frame: 'longbow', starter: 'laser' }); beamState.player.turret = 0;
	const air = enemy(1, 1300, 'vtol'); beamState.enemies = [air];
	weaponsStep(beamState, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
	expect(air.hp).toBeLessThan(1000); expect(beamState.beams[0]?.origin).toBeDefined(); expect(beamState.beams[0]?.elevation).toBeGreaterThan(120);
});

test('ECS owns acquired identity through firing, pause and state replacement', async function () {
	const combat = createCombatRuntime(); const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize(); const initial = setup(); initial.enemies = [enemy(1, 1300, 'vtol')];
		const state = combat.attach(initial); combat.setControls(function () { return { ...idle, targetId: 1, fire: [true, false, false, false] }; }); combat.setEnabled(true);
		world.update(1 / 60); expect(state.player.targetId).toBe(1); expect(world.getResource('combatControls').current.targetId).toBe(1); expect(state.shots[0]?.vElevation).toBeGreaterThan(0);
		combat.setEnabled(false); const snapshot = JSON.stringify(state); world.update(0.1); expect(JSON.stringify(state)).toBe(snapshot);
		expect(combat.attach(createState()).player.targetId).toBeUndefined();
	} finally { await world.dispose(); }
});

test('missiles can turn around and ground contact still resolves on the final lifetime step', function () {
	const state = setup(); state.enemies = [enemy(1, 800, 'striker')];
	const missile = { x: 900, y: 780, elevation: 45, vx: 100, vy: 0, vElevation: 0, life: 5, kind: 'missile' as const, target: 1, damage: 1 };
	state.shots = [missile];
	for (let tick = 0; tick < 70; tick++) projectilesStep(state, 1 / 60);
	expect(missile.vx).toBeLessThan(0); expect(Math.hypot(missile.vx, missile.vy, missile.vElevation)).toBeCloseTo(100);
	state.enemies = [enemy(2, 900, 'tank')];
	state.shots = [{ x: 940, y: 780, elevation: 1, vx: 0, vy: 0, vElevation: -120, life: 1 / 60, kind: 'rocket', target: undefined, damage: 30, splash: 80 }];
	projectilesStep(state, 1 / 60);
	expect(state.enemies[0]?.hp).toBeLessThan(1000); expect(state.events).toContain('impact'); expect(state.effects.at(-1)?.elevation).toBe(0);
	const laserState = createState({ frame: 'longbow', starter: 'laser' }); laserState.player.turret = 0; laserState.enemies = [enemy(1, 800, 'tank')];
	weaponsStep(laserState, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
	expect(laserState.beams[0]?.elevation).toBe(0);
});

test('close acquired aircraft remain hittable without a global convergence distance', function () {
	const state = setup(); const target = enemy(1, state.player.x + 60, 'helicopter'); state.enemies = [target];
	weaponsStep(state, { ...idle, targetId: 1, fire: [true, false, false, false] }, 1 / 60);
	for (let tick = 0; tick < 20; tick++) projectilesStep(state, 1 / 60);
	expect(target.hp).toBeLessThan(1000);
});
