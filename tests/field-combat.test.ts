import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount } from '../src/arsenal';
import type { Contract } from '../src/campaign-types';
import { createCombatRuntime } from '../src/combat-runtime';
import { generateMissionMap } from '../src/missions';
import { createMissionState, enemiesStep, missileTracking, projectilesStep, weaponsStep, type Controls, type Unit } from '../src/simulation';
import { groundHeight } from '../src/terrain-elevation';
import type { WeaponCue } from '../src/weapon-feedback';

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
	expect(state.effects.at(-1)?.feedback).toMatchObject({ type: 'impact', family: 'rocket', heavy: true, surface: 'concrete', scuff: true, affected: [31], normal: { x: -1, y: 0, elevation: 0 } });
});

test('a fixed step publishes every swept contact once, with the struck surface and firing actor', async function () {
	const initial = scenario(); initial.enemies = [{ ...scout(31, 610), stationary: true, cooldown: Infinity }];
	const map = initial.mission?.map;
	if (!map?.terrain) throw new Error('Missing field terrain');
	map.terrain = { ...map.terrain, obstacles: [...map.terrain.obstacles, { kind: 'tree', x: 700, y: 1100, width: 20, depth: 30, height: 60 }] };
	const rounds = { vx: 4000, vy: 0, elevation: 36, life: 1, damage: 4, target: undefined, kind: 'bullet' } as const;
	initial.shots = [
		{ ...rounds, x: 565, y: 900 },
		{ ...rounds, x: 570, y: 900, squadmateId: 'wing' },
		{ ...rounds, x: 670, y: 935, kind: 'enemy', owner: 43, weapon: 'autocannon' },
		{ ...rounds, x: 650, y: 790, elevation: 3, vElevation: -600 },
		{ ...rounds, x: 675, y: 1100, elevation: 55 },
	];
	const runtime = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(runtime.plugin).withFixedTimestep(1 / 60).build();
	await world.initialize();
	try {
		const state = runtime.attach(initial); runtime.setEnabled(true);
		const steps: (readonly WeaponCue[])[] = [];
		world.eventBus.subscribe('combatStepFinished', function (data) { steps.push(data.weaponCues); });
		world.update(1 / 60); world.update(1 / 60);
		expect(steps).toHaveLength(2);
		expect(steps[0]).toMatchObject([
			{ type: 'impact', family: 'bullet', shooter: 0, surface: 'armor', target: 31, direction: { x: 1, y: 0, elevation: 0 } },
			{ type: 'impact', shooter: 'wing', surface: 'armor', target: 31 },
			{ type: 'impact', family: 'cannon', shooter: 43, surface: 'concrete', normal: { x: -1, y: 0, elevation: 0 } },
			{ type: 'impact', family: 'bullet', surface: 'ground', normal: { x: 0, y: 0, elevation: 1 } },
			{ type: 'impact', family: 'bullet', surface: 'wood', normal: { x: -1, y: 0, elevation: 0 } },
		]);
		expect(steps[0]?.at(-1)).not.toHaveProperty('scuff');
		expect(steps[1]).toEqual([]);
		expect(state.effects).toHaveLength(5); expect(state.shots).toHaveLength(0);
		expect(state.enemies[0]?.hp).toBe(992);
	} finally { await world.dispose(); }
});

test('laser endpoint, damage and missile acquisition switch together when the line of fire clears the roof', function () {
	for (const height of [120, 1]) {
		const state = scenario(height); const target = scout(31, 860); state.enemies = [target];
		weaponsStep(state, { drive: 0, turn: 0, stop: false, aim: target, targetId: target.id, fire: [false, false, true, false], coolant: false }, 1 / 60);
		const beam = state.beam;
		if (!beam) throw new Error('Laser did not fire');
		expect(beam.contact).toBe(true);
		if (height === 120) {
			expect(missileTracking(state, target.id)).toBe('BLOCKED'); expect(beam.x).toBeCloseTo(690); expect(target.hp).toBe(1000);
		} else {
			expect(missileTracking(state, target.id)).toBe('TRACKING'); expect(beam.x).toBeGreaterThan(800); expect(target.hp).toBeLessThan(1000);
		}
	}
});

test('a ridge shelters a target from direct fire and missile locks until the firing mech reaches the crest', function () {
	const state = scenario();
	const map = state.mission?.map;
	if (!map) throw new Error('Expected a mission');
	const profile = [-120, -120, 80, 80, -65, -65];
	map.terrain = { obstacles: [], roads: [], elevation: {
		xs: [0, 450, 675, 735, 860, map.width], ys: [0, map.height],
		heights: Float32Array.from([...profile, ...profile]), minHeight: -120, maxHeight: 80,
	} };
	const target = scout(31, 945); state.enemies = [target];
	state.loadout.push({ ...createMount('autocannon'), slot: 0 });
	const controls: Controls = { drive: 0, turn: 0, stop: false, aim: target, targetId: target.id, fire: [true, false, true, false], coolant: false };
	weaponsStep(state, controls, 1 / 60);
	const beam = state.beams[0]; const round = state.shots[0];
	if (!beam?.origin || !round?.origin) throw new Error('Expected laser and cannon fire');
	expect(beam.origin.elevation).toBeLessThan(0);
	expect(missileTracking(state, target.id)).toBe('BLOCKED');
	expect(beam.x).toBeGreaterThan(450); expect(beam.x).toBeLessThan(675);
	expect(beam.elevation).toBeCloseTo(groundHeight(map.terrain, beam), 6);
	projectilesStep(state, .4);
	expect(state.shots).toHaveLength(0); expect(target.hp).toBe(1000);
	expect(round.x).toBeGreaterThan(450); expect(round.x).toBeLessThan(675);
	expect(round.elevation).toBeCloseTo(groundHeight(map.terrain, round), 6);
	expect(round.age).toBeCloseTo((round.x - round.origin.x) / round.vx, 6);
	const impact = state.effects.find(function (effect) { return effect.feedback?.type === 'impact'; })?.feedback;
	if (impact?.type !== 'impact') throw new Error('Expected the round to hit terrain');
	expect(impact.surface).toBe('ground'); expect(impact.normal?.x).toBeLessThan(0);

	state.player.x = 700;
	expect(missileTracking(state, target.id)).toBe('TRACKING');
	weaponsStep(state, controls, 1 / 60);
	expect(state.beams[0]?.origin?.elevation).toBeGreaterThan(80);
	expect(state.beams[0]?.x).toBeGreaterThan(900);
	expect(target.hp).toBeLessThan(1000);
});

test('without a selected target the cannon and laser follow the grade to the reticle', function () {
	for (const grade of [-.22, .22]) {
		const state = scenario();
		const map = state.mission?.map;
		if (!map) throw new Error('Expected a mission');
		const farHeight = map.width * grade;
		map.terrain = { obstacles: [], roads: [], elevation: {
			xs: [0, map.width], ys: [0, map.height], heights: Float32Array.of(0, farHeight, 0, farHeight),
			minHeight: Math.min(0, farHeight), maxHeight: Math.max(0, farHeight),
		} };
		state.loadout.push({ ...createMount('autocannon'), slot: 0 });
		weaponsStep(state, { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 900 }, fire: [true, false, true, false], coolant: false }, 1 / 60);
		const shot = state.shots[0], beam = state.beams[0];
		if (!shot || shot.vElevation === undefined || !beam?.origin || beam.elevation === undefined) throw new Error('Expected cannon and laser fire');
		expect(shot.vElevation / Math.hypot(shot.vx, shot.vy)).toBeCloseTo(grade, 5);
		expect((beam.elevation - beam.origin.elevation) / Math.hypot(beam.x - beam.origin.x, beam.y - beam.origin.y)).toBeCloseTo(grade, 5);
		expect(beam.contact).toBe(false);
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
