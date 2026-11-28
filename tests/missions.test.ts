import { acquireMissileTarget } from './missile-fixture';
import { describe, expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount, WEAPONS } from '../src/arsenal';
import type { Contract, MissionKind, MissionMap } from '../src/campaign-types';
import { createOpeningProgress, getChainStatus } from '../src/contract-chains';
import { createCombatRuntime } from '../src/combat-runtime';
import { isFieldContact } from '../src/enemy-perimeter';
import { createFieldTrial, DEFENSE_TRIAL_SEED } from '../src/field-trial';
import { RIG_RADIUS } from '../src/combat-spatial';
import { hasTerrainRoute, terrainPathClear } from '../src/field-terrain';
import { EXTRACTION_RADIUS, EXTRACTION_SECONDS, FACILITY_TARGET_ID, CAPTURE_RADIUS, RECOVERY_SECONDS, BEACON_SECONDS, defenseFieldsTanks, missionStructures, generateMissionMap, missionArtilleryCount, missionHostileCount, missionObjective, missionOpposition, missionSpawn } from '../src/missions';
import { getMissionTier, MISSION_TIERS } from '../src/reputation';
import { ARENA, createState, createMissionState, distance, spawningStep, step, type Controls, type State } from '../src/simulation';
import { createSituationMission } from '../src/situation-sim';
import { TANK_DELAY_SECONDS } from '../src/strategic-impact';

const contract = function (kind: MissionKind, seed = 123): Contract {
	return { id: `test-${kind}-${seed}`, seed, planetId: 'meridian', kind, employer: 'freeholds', opponent: 'combine', title: 'Field test', briefing: 'Complete the objective and extract.', reward: 1000, favor: 8, hostility: 5, tier: 1, requiredReputation: 0 };
};
const idle: Controls = { drive: 0, turn: 0, stop: false, fire: [false, false, false, false], coolant: false, aim: { x: 0, y: 0 } };
const run = function (state: State, seconds: number, controls = idle) { for (let tick = 0; tick < Math.ceil(seconds * 60); tick++) step(state, controls, 1 / 60); };
const missionOf = function (state: State) { if (!state.mission) throw new Error('Expected mission state'); return state.mission; };

describe('Heavy Rig surface contracts', function () {
	test('the long approach holds enemy drops until the player reaches the relay, then counts down even if they move away', function () {
		const state = createFieldTrial(DEFENSE_TRIAL_SEED, true);
		const { drop, objective } = missionOf(state).map;
		run(state, 20);
		expect(state.warnings).toHaveLength(0);
		expect(missionObjective(state)).toBe('Reach the relay · 2270 m');

		const [wingmate] = state.squadmates;
		if (!wingmate) throw new Error('Missing test wingmate');
		Object.assign(wingmate, objective);
		Object.assign(state.player, { x: objective.x - 151, y: objective.y });
		step(state, idle, 1 / 60);
		expect(missionObjective(state)).toBe('Reach the relay · 151 m');

		state.player.x += 1;
		step(state, idle, 1 / 60);
		expect(missionObjective(state)).toBe('Protect the relay · first dropship in 9s');
		Object.assign(state.player, drop);
		run(state, 8.9);
		expect(state.warnings).toHaveLength(0);
		run(state, 0.2);
		expect(state.warnings.filter(function (warning) { return warning.drop; })).toHaveLength(2);
	});

	test('the reserve raid delays every tank crossing the Defense perimeter without changing helicopter arrivals or section dispatch', async function () {
		const job: Contract = { ...contract('defend', 1272562579), id: 'mission:317-2-meridian-defend-2', opponent: 'accord', tier: 2, fieldLayout: 'extended-defense' };
		expect(defenseFieldsTanks(job)).toBe(true);
		expect(defenseFieldsTanks({ ...contract('assassination'), tier: 2 })).toBe(false);
		expect(defenseFieldsTanks({ ...contract('defend'), id: '317-2-meridian-defend-2', tier: 2 })).toBe(false); // Legacy tier 2 has no tanks.
		const dt = 1 / 60;
		const arrivals = async function (posting: Contract) {
			const combat = createCombatRuntime();
			const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(dt).build();
			try {
				await world.initialize();
				const initial = createMissionState(posting);
				const { map, required } = missionOf(initial);
				Object.assign(initial.player, map.objective);
				// Keep both stationary runs alive through the last section's arrival.
				initial.player.hp = 10_000;
				initial.relay = 10_000;
				const state = combat.attach(initial);
				combat.setControls(function () { return idle; });
				combat.setEnabled(true);
				const tanks: number[] = [], helicopters: number[] = [], dispatch: number[] = [];
				const contacted = new Set<number>();
				for (let tick = 1; tick <= 110 * 60 && contacted.size < required; tick++) {
					const dispatched = state.spawned;
					world.update(dt);
					if (state.spawned !== dispatched) dispatch.push(tick);
					for (const enemy of state.enemies) {
						if (contacted.has(enemy.id) || !isFieldContact(enemy, map)) continue;
						contacted.add(enemy.id);
						if (enemy.kind === 'tank') tanks.push(tick);
						if (enemy.kind === 'helicopter') helicopters.push(tick);
					}
				}
				return { tanks, helicopters, dispatch };
			} finally { await world.dispose(); }
		};
		const baseline = await arrivals(job);
		const delayed = await arrivals({ ...job, delayedTanks: true });
		expect(baseline.tanks).toHaveLength(3);
		expect(baseline.helicopters).toHaveLength(4);
		expect(delayed.helicopters).toEqual(baseline.helicopters);
		expect(delayed.dispatch).toEqual(baseline.dispatch);
		expect(delayed.tanks).toHaveLength(baseline.tanks.length);
		for (const [index, baselineTick] of baseline.tanks.entries()) {
			const delayedTick = delayed.tanks[index];
			if (delayedTick === undefined) throw new Error('Missing delayed tank boundary contact');
			// Fractional fixed-step subtraction can round the warning expiry by one tick.
			expect(Math.abs((delayedTick - baselineTick) - TANK_DELAY_SECONDS * 60)).toBeLessThanOrEqual(1);
		}
	}, 30_000);

	test('extended Defense across biomes has a clear insertion road and can dispatch every section at standoff', function () {
		const planets = ['meridian', 'cinder', 'borealis', 'brackwater', 'elderholt', 'galeward', 'iolith'] as const;
		for (const planetId of planets) for (const { tier } of MISSION_TIERS) {
			const state = createMissionState({ ...contract('defend', 12394 * tier), planetId, tier, fieldLayout: 'extended-defense' });
			const mission = missionOf(state);
			const { terrain, objective, drop } = mission.map;
			const road = terrain?.roads[0];
			if (!terrain || !road) throw new Error('Missing approach survey');
			expect(distance(drop, objective)).toBeWithin(2200, 2400);
			expect(road[0]).toEqual(drop);
			expect(road.at(-1)).toEqual(objective);
			for (let i = 1; i < road.length; i++) {
				const from = road[i - 1], to = road[i];
				if (!from || !to) throw new Error('Missing road segment');
				expect(terrainPathClear(terrain, from, to, RIG_RADIUS)).toBe(true);
			}

			Object.assign(state.player, objective);
			spawningStep(state, 1 / 60);
			for (let section = 0; section < Math.ceil(mission.required / 3); section++) {
				const previous = state.spawned;
				state.spawnIn = 0; state.time += 29;
				spawningStep(state, 1 / 60);
				expect(state.spawned).toBeGreaterThan(previous);
				if (tier === 1) expect(new Set(state.warnings.map(function (warning) { return `${warning.x},${warning.y}`; })).size).toBe(state.warnings.length);
				for (const warning of state.warnings) if (warning.drop) {
					expect(distance(warning, objective)).toBeGreaterThanOrEqual(1600);
					expect(hasTerrainRoute(terrain, warning, objective, RIG_RADIUS)).toBe(true);
				}
				state.warnings = [];
			}
			expect(state.spawned).toBe(mission.required);
		}
	});

	test('a widely spread squad cannot indefinitely stall extended Defense reinforcement placement', function () {
		const state = createSituationMission({ kind: 'defend', planetId: 'cinder', tier: 10, frame: 'warden', wing: [
			{ pilotId: 'kite', frame: 'kestrel' }, { pilotId: 'flint', frame: 'kestrel' }, { pilotId: 'brace', frame: 'kestrel' },
		] }, 1341332682, 'story');
		const { objective } = missionOf(state).map;
		Object.assign(state.player, objective);
		spawningStep(state, 1 / 60);
		const positions = [{ x: 1978.4, y: 3403.1 }, { x: 5253.7, y: 1273.5 }, { x: 4520.9, y: 4289.6 }, { x: 1288.8, y: 1597.5 }];
		const squad = [state.player, ...state.squadmates];
		squad.forEach(function (rig, i) { Object.assign(rig, positions[i]); });
		state.spawnIn = 0;
		spawningStep(state, 1 / 60);
		const transported = state.warnings.filter(function (warning) { return warning.drop; });
		expect(transported).toHaveLength(2);
		expect(transported.every(function (warning) {
			return distance(warning, objective) >= 1600 && squad.every(function (rig) { return distance(warning, rig) >= 1250; });
		})).toBe(true);
	});

	test('seeded maps vary routes and deployment while keeping all mission sites within larger bounds', function () {
		const layouts = new Set<string>();
		for (let seed = 0; seed < 40; seed++) {
			const definition = contract('clearance', seed); const map = generateMissionMap(definition);
			expect(generateMissionMap(definition)).toEqual(map);
			expect(map.width * map.height).toBeGreaterThan(ARENA.width * ARENA.height * 4);
			expect(distance(map.drop, map.objective)).toBeGreaterThan(1200);
			expect(distance(map.extraction, map.objective)).toBeGreaterThan(600);
			for (const point of [map.drop, map.objective, map.extraction, ...map.sites, ...map.landmarks]) {
				expect(point.x).toBeGreaterThan(35); expect(point.x).toBeLessThan(map.width - 35);
				expect(point.y).toBeGreaterThan(35); expect(point.y).toBeLessThan(map.height - 35);
			}
			layouts.add(JSON.stringify([map.drop, map.objective, map.extraction, map.sites]));
		}
		expect(layouts.size).toBe(40);
		expect(generateMissionMap({ ...contract('demolition'), planetId: 'borealis' }).biome).toBe('tundra');
		expect(generateMissionMap({ ...contract('demolition'), planetId: 'cinder' }).biome).toBe('volcanic');
	});

	test('fortified contracts can deploy every rolled artillery count without raising the late-game cap', function () {
		const samples = 768;
		const minimums = [1, 1, 2, 2, 3, 3, 4, 4, 5, 6];
		for (const { tier } of MISSION_TIERS) for (const kind of ['demolition', 'raid', 'clearance'] as const) {
			const minimum = minimums[tier - 1];
			if (minimum === undefined) throw new Error('Missing expected gun range');
			const rolls = new Map<number, { frequency: number; job: Contract }>();
			for (let i = 0; i < samples; i++) {
				const job = { ...contract(kind, Math.imul(i + 1, 0x9e3779b1) >>> 0), tier };
				const count = missionArtilleryCount(job);
				const roll = rolls.get(count);
				if (roll) roll.frequency++;
				else rolls.set(count, { frequency: 1, job });
			}
			const counts = Array.from({ length: minimum + 1 }, function (_, i) { return minimum + i; });
			expect([...rolls.keys()].sort(function (a, b) { return a - b; })).toEqual(counts);
			const expectedFrequency = samples / counts.length;
			for (const [count, { frequency, job }] of rolls) {
				expect(frequency).toBeGreaterThan(expectedFrequency * .75);
				expect(frequency).toBeLessThan(expectedFrequency * 1.25);
				expect(createMissionState(job).enemies.filter(function (enemy) { return enemy.kind === 'artillery'; })).toHaveLength(count);
			}
		}
		const opening = createOpeningProgress(), recorder = getChainStatus(opening)?.offers[0]?.contract;
		if (!recorder) throw new Error('Missing authored recorder mission');
		const fuelWorks = getChainStatus({ ...opening, completed: [recorder.id] })?.offers.find(function (entry) { return entry.contract.kind === 'demolition'; })?.contract;
		if (!fuelWorks) throw new Error('Missing authored fuel works');
		expect(createMissionState(fuelWorks).enemies.map(function (enemy) { return enemy.kind; })).toEqual(['helicopter', 'helicopter', 'helicopter', 'helicopter']);
	});

	test('a supplied field only briefs and deploys guns with a reachable, supported foundation', function () {
		const job: Contract = { ...contract('clearance', 2563011894), tier: 10 };
		const site = { x: 200, y: 600 };
		const wall = { kind: 'fissure' as const, x: 350, y: 600, width: 140, depth: 1200, height: 0 };
		const map: MissionMap = { seed: job.seed, biome: 'badlands', width: 1800, height: 1200, sites: [site], objective: site,
			drop: { x: 130, y: 1100 }, extraction: { x: 120, y: 120 }, landmarks: [], terrain: { roads: [], obstacles: [wall] } };
		const field = createMissionState(job, { map });
		const guns = field.enemies.filter(function (unit) { return unit.kind === 'artillery'; });
		expect(guns.length).toBeGreaterThan(0);
		expect(guns.every(function (gun) { return gun.x < wall.x - wall.width / 2; })).toBe(true);
		expect(field.mission?.required).toBe(field.enemies.length);
		expect(missionHostileCount(job, map)).toBe(field.enemies.length);
		expect(missionOpposition(job, map)).toContain(`${guns.length} fixed artillery`);
		expect(function () { missionSpawn(job, map, field.enemies.length); }).toThrow(RangeError);

		const slope = { xs: [0, map.width], ys: [0, map.height], heights: new Float32Array([0, 200, 0, 200]), minHeight: 0, maxHeight: 200 };
		const hillside = { ...map, terrain: { roads: [], obstacles: [], elevation: slope } };
		const onSlope = createMissionState(job, { map: hillside });
		expect(onSlope.enemies.every(function (unit) { return unit.kind !== 'artillery'; })).toBe(true);
		expect(onSlope.mission?.required).toBe(getMissionTier(10).assault - 2);
		expect(missionOpposition(job, hillside)).toContain('0 fixed artillery guns');
	});

	test('artillery surrounds demolition facilities, guards the far side of raid yards, and covers clearance road shoulders', function () {
		for (const planetId of ['meridian', 'elderholt'] as const) for (const kind of ['demolition', 'raid', 'clearance'] as const) {
			const state = createMissionState({ ...contract(kind, 2563011894), planetId, tier: 10 });
			const map = missionOf(state).map, guns = state.enemies.filter(function (unit) { return unit.kind === 'artillery'; });
			if (kind === 'demolition') {
				const quadrants = new Set(guns.map(function (gun) { return `${gun.x >= map.objective.x}/${gun.y >= map.objective.y}`; }));
				expect(quadrants.size).toBeGreaterThanOrEqual(3);
				continue;
			}
			const coveringApproach = guns.filter(function (gun) {
				const site = map.sites.reduce(function (near, other) { return distance(gun, near) < distance(gun, other) ? near : other; });
				const road = map.terrain?.roads.find(function (route) { const end = route.at(-1); return end && distance(end, site) < 1; });
				const from = road?.at(-2) ?? map.drop;
				const angle = Math.atan2(gun.y - site.y, gun.x - site.x) - Math.atan2(from.y - site.y, from.x - site.x);
				return kind === 'raid' ? Math.cos(angle) < 0 : Math.cos(angle) > 0 && Math.abs(Math.sin(angle)) > .35;
			});
			expect(coveringApproach.length).toBeGreaterThan(guns.length / 2);
		}
	});

	test('fixed guns can shell the drop while mobile patrols hold their sites until contacted', function () {
		const state = createMissionState({ ...contract('demolition'), tier: 3 }); const mission = missionOf(state);
		const original = state.enemies.map(function (enemy) { return { x: enemy.x, y: enemy.y }; });
		const guns = state.enemies.filter(function (enemy) { return enemy.kind === 'artillery'; });
		expect(guns.length).toBeGreaterThanOrEqual(2);
		const shooters = new Set<number | undefined>();
		for (let tick = 0; tick < 270; tick++) {
			step(state, idle, 1 / 60);
			for (const shell of state.strikes) shooters.add(shell.owner);
		}
		expect(state.enemies.map(function (enemy) { return { x: enemy.x, y: enemy.y }; })).toEqual(original);
		expect(shooters).toEqual(new Set(guns.map(function (gun) { return gun.id; }))); expect(state.shots).toHaveLength(0);
		state.player.x = mission.map.width - 40; state.player.y = mission.map.height - 40; state.player.angle = 0;
		run(state, 3, { ...idle, drive: 1 });
		expect(state.player.x).toBe(mission.map.width - 35); expect(state.player.y).toBeGreaterThan(ARENA.height);
		const first = state.enemies[0]; if (!first) throw new Error('Missing guard');
		state.player.x = first.x - 700; state.player.y = first.y; state.player.throttle = 0; state.player.speed = 0;
		step(state, idle, 1 / 60); expect(first.engaged).toBe(true);
	});

	test('assassination and demolition allow surviving escorts but require uninterrupted extraction', function () {
		for (const kind of ['assassination', 'demolition'] as const) {
			const state = createMissionState(contract(kind)); const mission = missionOf(state);
			state.relay = 0; // Offensive sorties have no friendly relay failure condition.
			if (mission.structure) mission.structure.hp = 0;
			const target = state.enemies.find(function (enemy) { return enemy.id === mission.targetId; }); if (target) target.hp = 0;
			step(state, idle, 1 / 60);
			expect(mission.stage).toBe('extract'); expect(state.outcome).toBe('playing'); expect(state.enemies.length).toBeGreaterThan(0);
			state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
			run(state, 1.5); expect(mission.extractTime).toBeGreaterThan(1); expect(state.outcome).toBe('playing');
			state.player.x += EXTRACTION_RADIUS + 1; step(state, idle, 1 / 60); expect(mission.extractTime).toBe(0);
			state.player.x = mission.map.extraction.x; run(state, EXTRACTION_SECONDS + 0.1);
			expect(state.outcome).toBe('won'); expect(state.phase).toBe('combat'); expect(state.wave).toBe(1);
		}
	});

	test('clearance requires every deployed hostile and fatal damage wins over extraction on the same tick', function () {
		const state = createMissionState({ ...contract('clearance'), tier: 2 }); const mission = missionOf(state);
		for (const enemy of state.enemies) if (enemy.kind !== 'artillery') enemy.hp = 0;
		step(state, idle, 1 / 60); expect(mission.stage).toBe('active');
		expect(state.kills).toBe(getMissionTier(2).assault - 1);
		for (const enemy of state.enemies) enemy.hp = 0;
		step(state, idle, 1 / 60); expect(mission.stage).toBe('extract'); expect(mission.progress).toBe(mission.required);
		state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
		mission.extractTime = EXTRACTION_SECONDS - 0.001; state.player.hp = 1;
		state.shots.push({ x: state.player.x, y: state.player.y, vx: 0, vy: 0, life: 1, kind: 'enemy', target: undefined, damage: 10 });
		step(state, idle, 1 / 60); expect(state.outcome).toBe('lost'); expect(state.events).not.toContain('victory');
	});

	test('defense is a finite local assault and incoming ordnance can still destroy its relocated relay', function () {
		const state = createMissionState(contract('defend')); const mission = missionOf(state);
		const quota = missionHostileCount(mission.contract);
		for (let tick = 0; tick < 60 * 180 && mission.stage === 'active'; tick++) {
			for (const enemy of state.enemies) enemy.hp = 0;
			step(state, idle, 1 / 60);
		}
		expect(state.spawned).toBe(quota); expect(state.kills).toBe(quota); expect(mission.stage).toBe('extract');
		expect(state.warnings).toHaveLength(0); expect(state.phase).toBe('combat'); expect(state.wave).toBe(1);
		state.relay = 1;
		state.strikes.push({ id: state.nextId++, ...mission.map.objective, life: 0.001, duration: 1, radius: 62, damage: 10 });
		step(state, idle, 1 / 60); expect(state.outcome).toBe('lost');
		const abandoned = createMissionState(contract('defend'));
		run(abandoned, 180); expect(abandoned.outcome).toBe('lost');
	});

	test('every weapon family can damage a facility and guidance locks to its target identity', function () {
		for (const weapon of WEAPONS) {
			const frame = createState({ starter: weapon.id }).frame;
			const state = createMissionState(contract('demolition'), { frame }); const mission = missionOf(state); const structure = mission.structure;
			if (!structure) throw new Error('Missing facility');
			state.enemies = []; state.loadout = [createMount(weapon.id)];
			state.player.x = structure.x - 300; state.player.y = structure.y; state.player.angle = 0; state.player.turret = 0;
			acquireMissileTarget(state, FACILITY_TARGET_ID);
			const input = { ...idle, targetId: FACILITY_TARGET_ID, aim: structure, fire: [true, false, false, false] as const };
			step(state, input, 1 / 60);
			if (weapon.kind === 'missile') expect(state.shots.every(function (shot) { return shot.target === FACILITY_TARGET_ID; })).toBe(true);
			run(state, 2, input); expect(structure.hp).toBeLessThan(structure.maxHp);
		}
	});

	test('structures block ordinary shots, piercing records one hit, and cluster splash reaches nearby facilities', function () {
		const state = createMissionState(contract('demolition')); const structure = missionOf(state).structure;
		if (!structure) throw new Error('Missing facility');
		state.enemies = [{ id: state.nextId++, x: structure.x + 100, y: structure.y, hp: 100, maxHp: 100, kind: 'scout', heavy: false, angle: 0, cooldown: 100 }];
		state.shots.push({ x: structure.x - 100, y: structure.y, vx: 10000, vy: 0, life: 1, kind: 'cannon', target: undefined, damage: 38 });
		step(state, idle, 0.04); expect(structure.hp).toBe(structure.maxHp - 38); expect(state.enemies[0]?.hp).toBe(100);
		state.shots.push({ x: structure.x - 80, y: structure.y, vx: 100, vy: 0, life: 2, kind: 'ppc', target: undefined, damage: 82, hitIds: [] });
		run(state, 1); expect(structure.hp).toBe(structure.maxHp - 120);
		const enemy = state.enemies[0]; if (!enemy) throw new Error('Missing guard');
		enemy.x = structure.x - 100; enemy.y = structure.y;
		state.shots = [{ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 1, kind: 'rocket', target: undefined, damage: 30, splash: 80 }];
		step(state, idle, 1 / 60); expect(structure.hp).toBeCloseTo(structure.maxHp - 138);
	});
});

test('raid requires all three sites, supports every weapon and independent guidance identities, and allows surviving guards', function () {
	for (const weapon of WEAPONS) {
		const frame = createState({ starter: weapon.id }).frame;
		const state = createMissionState(contract('raid'), { frame }); const mission = missionOf(state);
		const targets = missionStructures(mission); expect(new Set(targets.map(function (target) { return target.id; })).size).toBe(3);
		state.loadout = [createMount(weapon.id)];
		for (const target of [...targets].reverse()) {
			state.loadout = [createMount(weapon.id)]; state.player.heat = 0; state.player.overheated = false; state.shots = [];
			// Isolate weapon/objective behavior from guards while retaining living opposition.
			for (const enemy of state.enemies) { enemy.x = 50; enemy.y = 50; enemy.cooldown = 1000; }
			state.player.x = target.body.x - 300; state.player.y = target.body.y; state.player.angle = 0; state.player.turret = 0;
			const controls = { ...idle, aim: target.body, targetId: target.id, fire: [true, false, false, false] as const };
			step(state, controls, 1 / 60);
			if (weapon.kind === 'missile') expect(state.shots.filter(function (shot) { return shot.kind === 'missile'; }).every(function (shot) { return shot.target === target.id; })).toBe(true);
			run(state, 2, controls); expect(target.body.hp).toBeLessThan(target.body.maxHp);
			target.body.hp = 0; step(state, idle, 1 / 60);
			expect(mission.stage).toBe(mission.progress === 3 ? 'extract' : 'active');
		}
		expect(state.enemies.length).toBeGreaterThan(0);
		state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
		run(state, EXTRACTION_SECONDS + .1); expect(state.outcome).toBe('won');
	}
});

test('recovery requires an uninterrupted pickup and extraction rather than kills or merely visiting the cache', function () {
	const state = createMissionState(contract('recovery')); const mission = missionOf(state);
	const site = mission.captureSites?.[0]; if (!site) throw new Error('Missing cache');
	for (const enemy of state.enemies) { enemy.x = 50; enemy.y = 50; }
	state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
	run(state, 4); expect(state.outcome).toBe('playing'); expect(mission.stage).toBe('active');
	state.player.x = site.x; state.player.y = site.y;
	run(state, 2); expect(site.complete).toBe(false); expect(site.holdTime).toBeGreaterThan(1);
	state.player.x += CAPTURE_RADIUS + 1; step(state, idle, 1 / 60); expect(site.holdTime).toBe(0);
	state.player.x = site.x; run(state, RECOVERY_SECONDS + .1);
	expect(site.complete).toBe(true); expect(mission.stage).toBe('extract'); expect(state.kills).toBe(0);
	state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
	run(state, EXTRACTION_SECONDS + .1); expect(state.outcome).toBe('won');
});

test('acquisition preserves activated beacons, requires all three, stops its clock on completion, and loses on deadline', function () {
	const state = createMissionState(contract('acquisition')); const mission = missionOf(state);
	for (const enemy of state.enemies) { enemy.x = 50; enemy.y = 50; }
	for (const site of [...mission.captureSites ?? []].reverse()) {
		state.player.x = site.x; state.player.y = site.y; run(state, BEACON_SECONDS + .1);
		expect(site.complete).toBe(true);
		state.player.x += CAPTURE_RADIUS + 1; step(state, idle, 1 / 60);
		expect(site.complete).toBe(true); expect(site.holdTime).toBe(BEACON_SECONDS);
		expect(mission.stage).toBe(mission.progress === 3 ? 'extract' : 'active');
	}
	mission.acquisitionTime = .001; run(state, 1); expect(state.outcome).toBe('playing'); expect(mission.acquisitionTime).toBe(.001);
	state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
	run(state, EXTRACTION_SECONDS + .1); expect(state.outcome).toBe('won');
	const expired = createMissionState(contract('acquisition')); const late = missionOf(expired);
	late.acquisitionTime = .001; step(expired, idle, 1 / 60);
	expect(expired.outcome).toBe('lost'); expect(expired.events).toContain('defeat'); expect(late.stage).toBe('active');
	const fatal = createMissionState(contract('acquisition')); const final = missionOf(fatal);
	final.progress = 2;
	for (const [index, site] of (final.captureSites ?? []).entries()) { site.complete = index < 2; site.holdTime = BEACON_SECONDS - .001; fatal.player.x = site.x; fatal.player.y = site.y; }
	fatal.player.hp = 0; step(fatal, idle, 1 / 60); expect(fatal.outcome).toBe('lost'); expect(final.stage).toBe('active');
});
