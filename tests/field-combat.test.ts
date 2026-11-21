import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import type { Contract } from '../src/campaign-types';
import { createCombatRuntime } from '../src/combat-runtime';
import { generateMissionMap } from '../src/missions';
import { createMissionState, enemiesStep, missileTracking, projectilesStep, weaponsStep, type Controls, type Unit } from '../src/simulation';

const contract: Contract = {
	id: 'cover', seed: 123, planetId: 'cinder', kind: 'recovery', employer: 'accord', opponent: 'combine',
	title: 'Cover', briefing: '', reward: 0, favor: 0, hostility: 0, tier: 1, requiredReputation: 0,
};
const scenario = function (height = 120) {
	const map = generateMissionMap(contract);
	map.drop = { x: 400, y: 900 }; map.objective = { x: 1300, y: 900 };
	map.terrain = { obstacles: [{ kind: 'shed', x: 700, y: 900, width: 20, depth: 150, height }], roads: [] };
	const state = createMissionState(contract, { map, frame: 'warden-c', loadout: [null, null, 'laser', 'stream-missiles'] });
	state.enemies = [];
	return state;
};
const scout = function (id: number, x: number): Unit {
	return { id, x, y: 900, kind: 'scout', hp: 1000, maxHp: 1000, angle: Math.PI, cooldown: 0, heavy: false };
};

test('the cockpit reports a stopped or sliding hull while its throttle remains latched in the live drive component', async function () {
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize();
		const s = combat.attach(scenario());
		let controls: Controls = { drive: 1, turn: 0, stop: false, aim: { x: 1300, y: 900 }, fire: [false, false, false, false], coolant: false };
		combat.setControls(function () { return controls; }); combat.setEnabled(true);
		for (let tick = 0; tick < 420; tick++) world.update(1 / 60);
		expect(s.player.x).toBeCloseTo(663, 2); expect(s.player.throttle).toBe(1); expect(s.player.speed).toBeCloseTo(0);
		controls = { ...controls, drive: 0, heading: Math.PI / 4 };
		for (let tick = 0; tick < 60; tick++) world.update(1 / 60);
		const y = s.player.y;
		world.update(1 / 60);
		expect(s.player.throttle).toBe(1); expect(s.player.x).toBeCloseTo(663, 2);
		expect(s.player.speed).toBeCloseTo((s.player.y - y) * 60); expect(s.player.speed).toBeGreaterThan(40);
	} finally { await world.dispose(); }
});

test('a shed intercepts both sides, ends a piercing shot after the exposed target, and shields its far side from splash', function () {
	const state = scenario();
	const exposed = scout(31, 610); const sheltered = scout(32, 748);
	state.enemies = [exposed, sheltered];
	state.shots = [
		{ x: 520, y: 900, elevation: 42, vx: 1800, vy: 0, life: 1, target: undefined, kind: 'ppc', hitIds: [], damage: 10 },
		{ x: 900, y: 900, elevation: 42, vx: -1800, vy: 0, life: 1, target: undefined, kind: 'enemy', damage: 10 },
	];
	projectilesStep(state, 0.4);
	expect(state.shots).toHaveLength(0);
	expect(exposed.hp).toBe(990); expect(sheltered.hp).toBe(1000); expect(state.player.hp).toBe(100);
	expect(state.effects.some(function (effect) { return Math.abs(effect.x - 710) < 0.001; })).toBe(true);
	state.shots.push({ x: 620, y: 948, elevation: 42, vx: 1800, vy: 0, life: 1, target: undefined, kind: 'rocket', splash: 110, damage: 10 });
	projectilesStep(state, 0.2);
	expect(exposed.hp).toBe(984); expect(sheltered.hp).toBe(1000);
});

test('laser endpoint, damage and missile acquisition switch together when the line of fire clears the roof', function () {
	for (const height of [120, 1]) {
		const state = scenario(height); const target = scout(31, 860); state.enemies = [target];
		weaponsStep(state, { drive: 0, turn: 0, stop: false, aim: target, targetId: target.id, fire: [false, false, true, false], coolant: false }, 1 / 60);
		const beam = state.beam;
		if (!beam) throw new Error('Laser did not fire');
		if (height === 120) {
			expect(missileTracking(state, target.id)).toBe('BLOCKED'); expect(beam.x).toBeCloseTo(690); expect(target.hp).toBe(1000);
		} else {
			expect(missileTracking(state, target.id)).toBe('TRACKING'); expect(beam.x).toBeGreaterThan(800); expect(target.hp).toBeLessThan(1000);
		}
	}
});

test('an in-range scout uses a route around cover to get a firing angle', function () {
	const state = scenario(); state.player.x = 455;
	const guard = scout(31, 745); state.enemies = [guard];
	enemiesStep(state, 1 / 60);
	expect(state.shots).toHaveLength(0);
	for (let tick = 0; tick < 900 && state.shots.length === 0; tick++) {
		enemiesStep(state, 1 / 60);
		expect(Math.abs(guard.x - 700) < 35 && Math.abs(guard.y - 900) < 100).toBe(false);
	}
	expect(state.shots.some(function (shot) { return shot.owner === guard.id; })).toBe(true);
	expect(Math.abs(guard.y - 900)).toBeGreaterThan(70);
});
