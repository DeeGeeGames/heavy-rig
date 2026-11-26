import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount, getWeapon } from '../src/arsenal';
import { createCombatRuntime } from '../src/combat-runtime';
import type { Contract } from '../src/campaign-types';
import { defaultReserves } from '../src/combat-resources';
import { createStarterLoadout } from '../src/hardpoints';
import { EXTRACTION_RADIUS, EXTRACTION_SECONDS } from '../src/missions';
import { createMissionState, createState, distance, step, type CombatStateView, type Controls, type SquadmateOptions } from '../src/simulation';
import { createTraining, stepTraining } from '../src/training';
import { createSituationMission } from '../src/situation-sim';

const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 500 }, fire: [false, false, false, false], coolant: false };
const harness = async function (initial: CombatStateView) {
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	await world.initialize();
	const state = combat.attach(initial); combat.setEnabled(true);
	return { world, combat, state };
};
const scenario = function () {
	const state = createState(); state.spawnIn = 100;
	state.loadout = [createMount('autocannon'), createMount('machine-gun'), createMount('cluster-missiles'), createMount('stream-rockets')];
	state.enemies.push({ id: state.nextId++, x: 900, y: 580, hp: 100, maxHp: 100, kind: 'scout', heavy: false, angle: Math.PI / 2, cooldown: 0 });
	state.enemies.push({ id: state.nextId++, x: 850, y: 800, hp: 500, maxHp: 500, kind: 'siege', heavy: true, angle: Math.atan2(-20, 50), cooldown: 0 });
	state.warnings.push({ x: 1000, y: 780, kind: 'striker', life: 1 / 60 });
	state.shots.push({ x: 900, y: 650, vx: 0, vy: -4000, life: 1, kind: 'ppc', target: undefined, damage: 38, hitIds: [] });
	return state;
};

test('a fixed battery can engage across the entire map and each committed round gets two full seconds of flight', async function () {
	const initial = createSituationMission({ kind: 'clearance', planetId: 'meridian', tier: 4, frame: 'warden', wing: [] }, 15, 'standard');
	const map = initial.mission?.map;
	if (!map) throw new Error('Missing battlefield');
	map.terrain = { roads: [], obstacles: [{ kind: 'shed', x: map.width / 2, y: map.height / 2, width: 320, depth: 320, height: 200 }] };
	initial.enemies = initial.enemies.filter(function (unit) { return unit.kind === 'artillery'; }).slice(0, 2);
	expect(initial.enemies).toHaveLength(2);
	const pads = initial.enemies.map(function (gun, index) {
		const pad = { x: 100, y: 100 + 140 * index, hullAngle: Math.PI };
		Object.assign(gun, pad, { cooldown: 0 });
		return pad;
	});
	Object.assign(initial.player, { x: map.width - 800, y: map.height - 700 });
	const { world, state } = await harness(initial);
	const ticks = function (count: number) { for (let i = 0; i < count; i++) world.update(1 / 60); };
	try {
		ticks(1);
		expect(state.enemies.map(function (gun) { return gun.artilleryAim?.remaining; })).toEqual([2, 2]);
		ticks(60);
		const destination = { x: map.width - 55, y: map.height - 55 };
		Object.assign(state.player, destination);
		ticks(59);
		expect(state.strikes).toHaveLength(0);
		ticks(1);
		expect(state.strikes).toHaveLength(2);
		const [first, second] = state.strikes;
		if (!first || !second) throw new Error('Missing battery rounds');
		expect(distance(first, second)).toBeGreaterThan(first.radius);
		expect([first, second].some(function (round) { return distance(round, destination) > round.radius; })).toBe(true);
		expect(state.enemies.map(function ({ x, y, hullAngle }) { return { x, y, hullAngle }; })).toEqual(pads);
		for (const gun of state.enemies) {
			expect(distance(gun, destination)).toBeGreaterThan(5200);
			const shot = state.strikes.find(function (round) { return round.owner === gun.id; });
			if (!shot?.emplacement) throw new Error('Missing gun launch');
			expect(distance(shot.emplacement.origin, gun)).toBeLessThan(100);
			expect(shot).toMatchObject({ life: 2, duration: 2, slot: 0 });
			expect(distance(shot, destination)).toBeLessThanOrEqual(240);
			expect(shot.x).toBeWithin(0, map.width); expect(shot.y).toBeWithin(0, map.height);
			gun.hp = 0;
		}
		const mark = { x: first.x, y: first.y };
		// After firing, moving the target or destroying the guns cannot move or cancel a marker.
		Object.assign(state.player, { x: mark.x - 400, y: mark.y - 400 });
		ticks(119);
		expect(state.enemies).toHaveLength(0); expect(state.wrecks).toHaveLength(2);
		expect(state.strikes[0]).toMatchObject(mark);
		expect(state.player.hp).toBe(100);
		Object.assign(state.player, mark);
		ticks(1);
		expect(state.strikes).toHaveLength(0);
		expect(state.player.hp).toBeLessThan(100);
	} finally { await world.dispose(); }
});

test('mixed vehicle combat stays authoritative in ECS through movement, pause, and mission replacement', async function () {
	const initial = createState(); initial.spawnIn = 3600;
	for (const [index, kind] of (['helicopter', 'vtol', 'tank'] as const).entries()) initial.warnings.push({ kind, x: initial.player.x - 250 - index * 60, y: initial.player.y, life: 0.001 });
	const expected = structuredClone(initial); const { world, combat, state } = await harness(initial);
	try {
		for (let tick = 0; tick < 180; tick++) {
			step(expected, idle, 1 / 60); world.update(1 / 60); expect(state).toEqual(expected);
		}
		for (const enemy of state.enemies) expect(combat.entityForEnemy(enemy.id)).toBeDefined();
		const snapshot = JSON.stringify(state); combat.setEnabled(false);
		for (let tick = 0; tick < 60; tick++) world.update(1 / 60);
		expect(JSON.stringify(state)).toBe(snapshot);
		combat.attach(createState()); expect(world.getEntitiesWithQuery(['enemy'])).toHaveLength(0);
	} finally { await world.dispose(); }
});

test('ECS combat preserves same-tick spawn, firing, piercing, committed artillery and death order', async function () {
	const expected = scenario(); const { world, combat, state } = await harness(scenario());
	try {
		for (let tick = 0; tick < 360; tick++) {
			const controls: Controls = { ...idle, drive: tick > 18 ? 1 : 0, turn: tick > 100 ? 0.2 : 0, fire: [tick % 70 < 30, tick < 30, tick % 80 < 10, tick < 25], coolant: tick === 140 };
			combat.setControls(function () { return controls; }); step(expected, controls, 1 / 60); world.update(1 / 60);
			expect(state).toEqual(expected);
			if (tick === 0) {
				expect(state.strikes.length).toBeGreaterThan(0);
				expect(state.enemies).toHaveLength(3);
				expect(state.shots.some(function (shot) { return shot.kind === 'cannon' && shot.y < 750; })).toBe(true);
			}
			if (tick === 5) { const actual = state.enemies.find(function (enemy) { return enemy.kind === 'siege'; }); const baseline = expected.enemies.find(function (enemy) { return enemy.kind === 'siege'; }); if (actual && baseline) { actual.hp = 0; baseline.hp = 0; } }
		}
	} finally { await world.dispose(); }
});

test('a defeated rig keeps its entity for the fall and immediately leaves combat', async function () {
	const initial = createState(); initial.spawnIn = 3600;
	const body = { x: 300, y: 400, hp: 0, maxHp: 100, heavy: true, angle: .5, cooldown: 2 };
	initial.enemies = [
		{ ...body, id: 1, kind: 'siege', hullAngle: -.3, commander: true, catalog: { frameId: 'maul-c', speed: 0, throttle: 0, shotsFired: 0 }, loadout: [{ ...createMount('ppc'), slot: 1 }] },
		{ ...body, id: 2, kind: 'tank' },
	];
	const { world, combat, state } = await harness(initial);
	try {
		const rig = combat.entityForEnemy(1), tank = combat.entityForEnemy(2);
		if (rig === undefined || tank === undefined) throw new Error('Missing combat identities');
		world.update(1 / 60);
		expect(state.enemies).toHaveLength(0);
		expect(state.kills).toBe(2);
		expect(state.wrecks).toHaveLength(2);
		expect(world.getComponent(rig, 'wreck')).toBe(state.wrecks[0]);
		expect(state.wrecks[0]?.rig).toEqual({ defeatedAt: state.time, hullAngle: -.3, frame: 'maul-c', commander: true, equippedSlots: [1] });
		expect(state.wrecks[1]?.rig).toBeUndefined();
		expect(world.getEntity(tank)).toBeUndefined();
		for (const name of ['enemy', 'position', 'heading', 'health', 'enemyWeapons', 'enemyReactor'] as const) expect(world.getComponent(rig, name)).toBeUndefined();
		world.update(1 / 60);
		expect(state.kills).toBe(2);
		state.wrecks = [];
		expect(world.getEntity(rig)).toBeUndefined();
	} finally { await world.dispose(); }
});

test('a live defense section survives pause and releases its two rigs and perimeter escort once each', async function () {
	const initial = createSituationMission({ kind: 'defend', planetId: 'meridian', tier: 3, frame: 'warden', wing: [] }, 25, 'standard');
	initial.spawnIn = 0;
	const { world, combat, state } = await harness(initial);
	const advance = function (seconds: number) { for (let tick = 0; tick < seconds * 60; tick++) world.update(1 / 60); };
	try {
		advance(6);
		const [first, second, support] = state.warnings;
		if (!first?.drop || !first.frameId || !second?.drop || !second.frameId || !support?.perimeter) throw new Error('Missing defense section');
		expect(first.drop.flight).toBe(second.drop.flight);
		combat.setEnabled(false);
		const before = state.time, remaining = first.life;
		advance(5);
		expect(state.time).toBe(before); expect(first.life).toBe(remaining); expect(state.enemies).toHaveLength(0);
		combat.setEnabled(true); advance(4.1);
		expect(state.enemies.map(function (e) { return e.catalog?.frameId ?? e.kind; })).toEqual([first.frameId, second.frameId, support.kind]);
		const escort = state.enemies[2], map = state.mission?.map;
		if (!escort?.entry || !map) throw new Error('Expected an approaching escort');
		expect(Math.min(escort.x, escort.y, map.width - escort.x, map.height - escort.y)).toBeLessThan(0);
		expect(distance(escort, support.perimeter.start)).toBeLessThan(12);
		advance(9);
		expect(escort.entry).toBeUndefined();
		expect(Math.min(escort.x, escort.y, map.width - escort.x, map.height - escort.y)).toBeGreaterThanOrEqual(35);
		expect(state.spawned).toBe(3); expect(state.warnings).toHaveLength(0);
	} finally { await world.dispose(); }
});

test('ECS pause retains entities and clocks; replacement releases mission entities and input hooks', async function () {
	const { world, combat, state } = await harness(scenario());
	try {
		combat.setControls(function () { return { ...idle, drive: 1, fire: [true, false, false, false] }; });
		world.update(1 / 60); const time = state.time; const shots = state.shots.map(function (shot) { return { ...shot }; }); const player = combat.entityForPlayer();
		combat.setEnabled(false); for (let frame = 0; frame < 100; frame++) world.update(1 / 60);
		expect(state.time).toBe(time); expect(state.shots).toEqual(shots); expect(combat.entityForPlayer()).toBe(player);
		const next = combat.attach(createState());
		expect(next.shots).toEqual([]); expect(next.strikes).toEqual([]); expect(next.enemies).toEqual([]);
		expect(world.getEntitiesWithQuery(['combatOwned'])).toHaveLength(1);
		expect(combat.entityForEnemy(1)).toBeUndefined();
	} finally { await world.dispose(); }
});

test('ECS facility ownership and fatal damage preserve extraction precedence', async function () {
	const contract: Contract = { id: 'runtime-demolition', seed: 123, planetId: 'meridian', kind: 'demolition', employer: 'freeholds', opponent: 'combine', title: 'Test', briefing: 'Test', reward: 1000, favor: 8, hostility: 5, tier: 1, requiredReputation: 0 };
	const initial = createMissionState(contract); const { world, combat, state } = await harness(initial);
	try {
		const mission = state.mission; if (!mission?.structure) throw new Error('Missing facility');
		expect(world.getEntitiesWithQuery(['structure'])[0]?.components.structure).toBe(mission.structure);
		mission.structure.hp = 0; mission.stage = 'extract'; mission.extractTime = 3;
		state.player.x = mission.map.extraction.x; state.player.y = mission.map.extraction.y;
		state.shots.push({ x: state.player.x, y: state.player.y, vx: 0, vy: 0, life: 1, kind: 'enemy', damage: 1000, target: undefined });
		combat.setControls(function () { return idle; }); world.update(1 / 60);
		expect(state.outcome).toBe('lost'); expect(state.events).toContain('defeat'); expect(state.events).not.toContain('victory');
	} finally { await world.dispose(); }
});

test('ECS training uses the same combat systems through every qualification stage', async function () {
	const expected = createTraining(); const training = createTraining(); const { world, combat } = await harness(training.state);
	combat.attach(training.state, training);
	try {
		for (let tick = 0; tick < 3600 && expected.stage !== 'complete'; tick++) {
			const stage = expected.stage;
			const controls: Controls = { ...idle, ...(expected.state.enemies[0] ? { targetId: expected.state.enemies[0].id } : {}), aim: expected.state.enemies[0] ?? expected.state.player, drive: stage === 'drive' || stage === 'evade' && expected.state.strikes.length > 0 ? 1 : 0, stop: stage === 'neutral', turn: stage === 'steer' ? 1 : 0, fire: [stage === 'cannon', stage === 'combined', stage === 'missiles' || stage === 'heat', stage === 'combined'], coolant: stage === 'coolant' };
			combat.setControls(function () { return controls; }); stepTraining(expected, controls, 1 / 60); world.update(1 / 60);
			expect(training).toEqual(expected);
		}
		expect(training.stage).toBe('complete');
	} finally { await world.dispose(); }
});

test('the practice range fires the selected hardpoint, replaces targets, and refits a fresh frame', async function () {
	const training = createTraining({ frame: 'kestrel-c', loadout: [null, 'stream-rockets:t3'], reserves: [0, 4] });
	const { world, combat } = await harness(training.state);
	try {
		const state = combat.attach(training.state, training);
		const targets = state.enemies.map(function (enemy) { return enemy.id; });
		const aim = { x: state.player.x, y: idle.aim.y };
		combat.setControls(function () { return { ...idle, aim, fire: [true, false, false, false] }; });
		world.update(1 / 60);
		expect(state.stats.shotsFired).toBe(0);
		combat.setControls(function () { return { ...idle, aim, fire: [false, true, false, false] }; });
		world.update(1 / 60);
		expect(state.stats.shotsFired).toBe(1);
		expect(state.loadout[0]).toMatchObject({ slot: 1, weapon: 'stream-rockets:t3', rounds: 3 });
		for (const enemy of state.enemies) enemy.hp = 0;
		combat.setControls(function () { return { ...idle, aim, coolant: true }; });
		world.update(1 / 60);
		expect(state.coolantCharges).toBe(1);
		expect(state.enemies).toHaveLength(0);
		expect(state.wrecks).toHaveLength(targets.length);
		for (let tick = 0; tick < 80; tick++) world.update(1 / 60);
		expect(state.wrecks).toHaveLength(0);
		expect(state.enemies).toHaveLength(targets.length);
		expect(state.enemies.every(function (enemy) { return enemy.stationary && !targets.includes(enemy.id); })).toBe(true);
		expect(training.stage).toBe('range');
		const refit = createTraining({ frame: 'maul-c', loadout: [null, 'ppc:t5', null, null], reserves: [0, 0, 0, 0] });
		const fresh = combat.attach(refit.state, refit);
		expect(fresh.frame).toBe('maul-c');
		expect(fresh.loadout.map(function (mount) { return [mount.slot, mount.weapon]; })).toEqual([[1, 'ppc:t5']]);
		expect(fresh.shots).toHaveLength(0);
		expect(fresh.coolantCharges).toBe(2);
	} finally { await world.dispose(); }
});

test('capability and resource replacement remain authoritative through live views', async function () {
	const { world, combat, state } = await harness(scenario());
	try {
		const player = combat.entityForPlayer(); const enemy = combat.entityForEnemy(1);
		if (player === undefined || enemy === undefined) throw new Error('Missing combat identities');
		world.addComponent(player, 'position', { x: 123, y: 456 });
		world.addComponent(player, 'health', { hp: 41, maxHp: 100 });
		world.addComponent(player, 'reactor', { heat: 63, overheated: false, coolantCharges: 1, coolantHeld: false });
		world.addComponent(player, 'weaponBank', { mounts: [createMount('machine-gun')] });
		expect([state.player.x, state.player.y, state.player.hp, state.player.heat, state.coolantCharges]).toEqual([123, 456, 41, 63, 1]);
		expect(state.loadout[0]?.weapon).toBe('machine-gun');
		state.player.x = 321; state.player.hp = 72; state.coolantCharges = 2;
		expect(world.getComponent(player, 'position')?.x).toBe(321); expect(world.getComponent(player, 'health')?.hp).toBe(72); expect(world.getComponent(player, 'reactor')?.coolantCharges).toBe(2);
		const unit = state.enemies.find(function (candidate) { return candidate.id === 1; }); if (!unit) throw new Error('Missing enemy view');
		world.addComponent(enemy, 'position', { x: 700, y: 800 }); world.addComponent(enemy, 'health', { hp: 333, maxHp: 400 });
		world.addComponent(enemy, 'enemyWeapons', { mounts: [createMount('stream-missiles')] });
		expect([unit.x, unit.y, unit.hp, unit.maxHp, unit.loadout?.[0]?.weapon]).toEqual([700, 800, 333, 400, 'stream-missiles']);
		unit.hp = 222; expect(world.getComponent(enemy, 'health')?.hp).toBe(222);
		const progress = world.getResource('combatProgress'); world.addResource('combatProgress', { ...progress, time: 81 });
		expect(state.time).toBe(81); state.time = 82; expect(world.getResource('combatProgress').time).toBe(82);
	} finally { await world.dispose(); }
});

test('ordered collection replacement preserves identities and rejects mutation of query snapshots', async function () {
	const initial = scenario(); initial.enemies.push({ id: 3, x: 1200, y: 900, hp: 100, maxHp: 100, kind: 'scout', heavy: false, angle: 0, cooldown: 100 });
	const { world, combat, state } = await harness(initial);
	try {
		const first = state.enemies[0]; const third = state.enemies[2]; if (!first || !third) throw new Error('Missing enemies');
		const firstId = combat.entityForEnemy(first.id); const thirdId = combat.entityForEnemy(third.id);
		state.enemies = [third, first];
		expect(state.enemies.map(function (enemy) { return enemy.id; })).toEqual([3, 1]);
		expect(combat.entityForEnemy(first.id)).toBe(firstId); expect(combat.entityForEnemy(third.id)).toBe(thirdId); expect(combat.entityForEnemy(2)).toBeUndefined();
		expect(Object.isFrozen(state.enemies)).toBe(true);
		expect(function () { Object.defineProperty(state.enemies, '0', { value: first }); }).toThrow();
		state.enemies.push({ id: 4, x: 1100, y: 900, hp: 100, maxHp: 100, kind: 'scout', heavy: false, angle: 0, cooldown: 100 });
		expect(state.enemies.map(function (enemy) { return enemy.id; })).toEqual([3, 1, 4]);
		const rebound = combat.attach(state);
		expect(rebound.enemies.map(function (enemy) { return enemy.id; })).toEqual([3, 1, 4]);
	} finally { await world.dispose(); }
});

test('changed observers see repeated facility damage and no paused capability writes', async function () {
	const contract: Contract = { id: 'runtime-change-tracking', seed: 123, planetId: 'meridian', kind: 'demolition', employer: 'freeholds', opponent: 'combine', title: 'Test', briefing: 'Test', reward: 1000, favor: 8, hostility: 5, tier: 1, requiredReputation: 0 };
	const initial = createMissionState(contract); initial.frame = 'longbow'; initial.loadout = [createMount('laser')]; initial.enemies = [];
	const facility = initial.mission?.structure; if (!facility) throw new Error('Missing facility');
	initial.player.x = facility.x + 200; initial.player.y = facility.y; initial.player.angle = Math.PI; initial.player.turret = Math.PI;
	const { world, combat, state } = await harness(initial); const damage: number[] = []; let movementChanges = 0; let reactorChanges = 0;
	world.addSystem('test:facility-change-observer').inPhase('update').setProcessEach({ with: ['structure'], changed: ['structure'], mutates: [] }, function ({ entity }) { damage.push(entity.components.structure.hp); });
	world.addSystem('test:position-change-observer').inPhase('update').setProcessEach({ with: ['player', 'position'], changed: ['position'], mutates: [] }, function () { movementChanges++; });
	world.addSystem('test:reactor-change-observer').inPhase('update').setProcessEach({ with: ['player', 'reactor'], changed: ['reactor'], mutates: [] }, function () { reactorChanges++; });
	try {
		combat.setControls(function () { return { ...idle, aim: facility, drive: 1, fire: [true, false, false, false] }; });
		for (let tick = 0; tick < 4; tick++) world.update(1 / 60);
		expect(damage).toHaveLength(4); expect(damage[3]).toBeLessThan(damage[2] ?? 0);
		const before = { damage: damage.length, movementChanges, reactorChanges, x: state.player.x, heat: state.player.heat };
		combat.setEnabled(false); for (let tick = 0; tick < 4; tick++) world.update(1 / 60);
		expect({ damage: damage.length, movementChanges, reactorChanges, x: state.player.x, heat: state.player.heat }).toEqual(before);
	} finally { await world.dispose(); }
});

test('training completion hooks publish capability resets after the combat phases', async function () {
	const training = createTraining(); training.stage = 'coolant'; training.state.player.x = 35; training.state.player.y = 600; training.state.player.angle = Math.PI; training.state.player.turret = Math.PI;
	const { world, combat } = await harness(training.state); combat.attach(training.state, training);
	const positions: number[] = [];
	world.addSystem('test:training-position-observer').inPhase('update').setProcessEach({ with: ['player', 'position'], changed: ['position'], mutates: [] }, function ({ entity }) { positions.push(entity.components.position.x); });
	try {
		combat.setControls(function () { return { ...idle, aim: { x: 0, y: 600 } }; }); world.update(1 / 60);
		expect(positions).toEqual([35]);
		combat.setControls(function () { return { ...idle, aim: { x: 0, y: 600 }, coolant: true }; }); world.update(1 / 60);
		expect(String(training.stage)).toBe('evade'); expect(positions).toEqual([35, 900]);
	} finally { await world.dispose(); }
});

test('ordinary enemy component replacement rebinds capability owners before the next AI tick', async function () {
	const initial = createState(); initial.spawnIn = 100;
	initial.enemies = [{ id: 1, x: 1000, y: 700, hp: 100, maxHp: 100, kind: 'scout', heavy: false, angle: 0, cooldown: 100 }];
	const { world, combat, state } = await harness(initial);
	try {
		const id = combat.entityForEnemy(1); if (id === undefined) throw new Error('Missing enemy identity');
		world.addComponent(id, 'enemy', { id: 1, x: 400, y: 800, hp: 333, maxHp: 400, kind: 'striker', heavy: false, angle: 0, cooldown: 100, loadout: [createMount('machine-gun')] });
		const replacement = state.enemies[0]; if (!replacement) throw new Error('Missing replacement view');
		expect(world.getComponent(id, 'position')).toEqual({ x: 400, y: 800 }); expect(world.getComponent(id, 'health')).toEqual({ hp: 333, maxHp: 400 });
		expect(replacement.loadout).toBe(world.getComponent(id, 'enemyWeapons')?.mounts);
		state.shots.push({ x: 400, y: 800, vx: 0, vy: 0, life: 1, kind: 'bullet', target: undefined, damage: 20 });
		combat.setControls(function () { return idle; }); world.update(1 / 60);
		const position = world.getComponent(id, 'position'); const heading = world.getComponent(id, 'heading'); const health = world.getComponent(id, 'health');
		if (!position || !heading || !health) throw new Error('Missing replacement capabilities');
		expect(replacement.x).toBeGreaterThan(400); expect(replacement.x).toBe(position.x); expect(replacement.angle).toBe(heading.angle);
		expect(replacement.hp).toBe(313); expect(replacement.hp).toBe(health.hp);
	} finally { await world.dispose(); }
});

test('rocket volleys stagger by 0.1 seconds, finish on release, and freeze during pause', async function () {
	const initial = createState({ frame: 'maul' }); initial.spawnIn = 3600;
	initial.loadout = [{ ...createMount('cluster-rockets'), slot: 0 }];
	const { world, combat, state } = await harness(initial);
	try {
		combat.setControls(function () { return { ...idle, fire: [true, false, false, false] }; });
		world.update(1 / 60);
		expect(state.stats.shotsFired).toBe(1); expect(state.player.heat).toBe(getWeapon('cluster-rockets').heat / getWeapon('cluster-rockets').projectiles);
		combat.setControls(function () { return idle; });
		for (let rocket = 2; rocket <= 2; rocket++) {
			for (let tick = 0; tick < 5; tick++) world.update(1 / 60);
			expect(state.stats.shotsFired).toBe(rocket - 1);
			combat.setEnabled(false);
			for (let tick = 0; tick < 30; tick++) world.update(1 / 60);
			expect(state.stats.shotsFired).toBe(rocket - 1);
			combat.setEnabled(true); world.update(1 / 60);
			expect(state.stats.shotsFired).toBe(rocket);
			expect(state.events).toContain('rocket');
		}
		expect(state.loadout[0]?.rocketVolley).toBeUndefined();
		for (let tick = 0; tick < 120; tick++) world.update(1 / 60);
		expect(state.stats.shotsFired).toBe(2);
	} finally { await world.dispose(); }
});

test('new mission objectives run in ECS, pause their timers, and release raid structures on replacement', async function () {
	const contract: Contract = { id: 'objectives', seed: 123, planetId: 'meridian', kind: 'raid', employer: 'freeholds', opponent: 'combine', title: 'Objectives', briefing: 'Test', reward: 100, favor: 8, hostility: 5, tier: 1, requiredReputation: -100 };
	const { world, combat, state } = await harness(createMissionState(contract));
	try {
		expect(world.getEntitiesWithQuery(['structure'])).toHaveLength(3);
		for (const target of state.mission?.raidTargets ?? []) target.hp = 0;
		world.update(1 / 60); expect(state.mission?.stage).toBe('extract');
		for (const kind of ['recovery', 'acquisition'] as const) {
			const next = combat.attach(createMissionState({ ...contract, kind }));
			expect(world.getEntitiesWithQuery(['structure'])).toHaveLength(0);
			const site = next.mission?.captureSites?.[0]; if (!site) throw new Error('Missing capture site');
			next.player.x = site.x; next.player.y = site.y; next.enemies = [];
			combat.setEnabled(true); world.update(1 / 60);
			const snapshot = JSON.stringify(next.mission); combat.setEnabled(false);
			for (let i = 0; i < 60; i++) world.update(1 / 60);
			expect(JSON.stringify(next.mission)).toBe(snapshot);
			combat.setEnabled(true); for (let i = 0; i < 301; i++) world.update(1 / 60);
			expect(site.complete).toBe(true);
		}
		combat.attach(createState()); expect(world.getEntitiesWithQuery(['structure'])).toHaveLength(0);
	} finally { await world.dispose(); }
});

test('live squadmates take field damage, recover the objective, and prepare pickup for the player', async function () {
	const contract: Contract = { id: 'squad-recovery', seed: 123, planetId: 'meridian', kind: 'recovery', employer: 'freeholds', opponent: 'combine', title: 'Recover', briefing: 'Recover the data', reward: 100, favor: 8, hostility: 5, tier: 1, requiredReputation: -100 };
	const loadout = createStarterLoadout('kestrel');
	const mate: SquadmateOptions = { pilotId: 'rook', callsign: 'Rook', specialty: 'marksman', frameId: 'kestrel', loadout, reserves: defaultReserves(loadout), integrity: 80 };
	const secondLoadout = createStarterLoadout('warden');
	const second: SquadmateOptions = { ...mate, pilotId: 'kite', callsign: 'Kite', frameId: 'warden', loadout: secondLoadout, reserves: defaultReserves(secondLoadout), integrity: 71 };
	const { world, combat, state } = await harness(createMissionState(contract, { squadmates: [mate, second] }));
	try {
		const [wing, straggler] = state.squadmates;
		const mission = state.mission;
		const site = mission?.captureSites?.[0];
		if (!wing || !straggler || !mission || !site) throw new Error('Missing recovery squad or its mission');
		expect(world.getEntitiesWithQuery(['squadmate'])).toHaveLength(2);
		expect(combat.entityForSquadmate(wing.pilotId)).toBeDefined();
		state.enemies = [];
		Object.assign(state.player, { x: site.x + 240, y: site.y });
		Object.assign(wing, { x: site.x, y: site.y });
		state.shots.push({ x: site.x - 70, y: site.y, elevation: 40, vx: 6000, vy: 0, life: 1, kind: 'enemy', target: undefined, damage: 10 });
		world.update(1 / 60);
		expect(wing.hp).toBeLessThan(mate.integrity);
		expect(state.player.hp).toBe(100);
		for (let i = 0; i < 301; i++) world.update(1 / 60);
		expect(site.complete).toBe(true);
		expect(mission.stage).toBe('extract');
		Object.assign(wing, mission.map.extraction);
		for (let i = 0; i < 181; i++) world.update(1 / 60);
		expect(mission.extractTime).toBe(EXTRACTION_SECONDS);
		expect(state.outcome).toBe('playing');
		expect(distance(straggler, mission.map.extraction)).toBeGreaterThan(EXTRACTION_RADIUS);
		Object.assign(state.player, mission.map.extraction);
		world.update(1 / 60);
		expect(state.outcome).toBe('won');
		expect(straggler.hp).toBe(second.integrity);
		combat.attach(createState());
		expect(combat.entityForSquadmate(wing.pilotId)).toBeUndefined();
	} finally { await world.dispose(); }
});

test('squad rocket volleys use their own sparse mount and leave player accuracy alone', async function () {
	const contract: Contract = { id: 'squad-fire', seed: 123, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Clear', briefing: 'Clear the site', reward: 100, favor: 8, hostility: 5, tier: 1, requiredReputation: -100 };
	const { world, state } = await harness(createMissionState(contract, { squadmates: [
		{ pilotId: 'kite', callsign: 'Kite', specialty: 'marksman', frameId: 'warden', loadout: [null, null, 'stream-rockets-4', null], reserves: [0, 0, 4, 0], integrity: 100 },
	] }));
	try {
		const wing = state.squadmates[0]; if (!wing) throw new Error('Missing squadmate');
		Object.assign(state.player, { x: 1000, y: 1000, angle: 0 });
		Object.assign(wing, { x: 880, y: 915, angle: 0, turret: 0 });
		const target = { id: state.nextId++, x: 1280, y: 915, hp: 1000, maxHp: 1000, kind: 'scout', heavy: false, angle: 0, cooldown: 3600, stationary: true } as const;
		state.enemies = [{ ...target }];
		const shots = new Set(state.shots);
		for (let i = 0; i < 50; i++) {
			world.update(1 / 60);
			for (const shot of state.shots) shots.add(shot);
		}
		expect([...shots].map(function (shot) { return [shot.kind, shot.slot, shot.squadmateId]; })).toEqual(Array.from({ length: 4 }, function () { return ['rocket', 2, wing.pilotId]; }));
		expect(state.enemies[0]?.hp).toBeLessThan(target.hp);
		expect(wing.loadout[0]?.rounds).toBe(0);
		expect(state.stats.shotsFired).toBe(0);
		expect(state.stats.shotsHit).toBe(0);
	} finally { await world.dispose(); }
});

test('squad order batches commit only to the paused current sortie and never partially apply', async function () {
	const contract: Contract = { id: 'squad-orders', seed: 123, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Clear', briefing: 'Clear the site', reward: 100, favor: 8, hostility: 5, tier: 1, requiredReputation: -100 };
	const loadout = createStarterLoadout('kestrel');
	const mate: SquadmateOptions = { pilotId: 'rook', callsign: 'Rook', specialty: 'marksman', frameId: 'kestrel', loadout, reserves: defaultReserves(loadout), integrity: 100 };
	const initial = function () { return createMissionState(contract, { squadmates: [mate, { ...mate, pilotId: 'kite', callsign: 'Kite' }] }); };
	const { world, combat, state } = await harness(initial());
	try {
		const [rook, kite] = state.squadmates;
		if (!rook || !kite) throw new Error('Missing order recipients');
		const hold = { pilotId: rook.pilotId, order: { kind: 'hold', point: { x: rook.x, y: rook.y } }, fireDiscipline: 'hold' } as const;
		expect(combat.applySquadOrders(state, [hold])).toBe(false);
		combat.setEnabled(false);
		expect(combat.applySquadOrders(state, [hold, { pilotId: 'absent', order: { kind: 'form' } }])).toBe(false);
		expect(rook.order).toBeUndefined();
		expect(rook.fireDiscipline).toBeUndefined();
		expect(combat.applySquadOrders(state, [hold, { pilotId: kite.pilotId, order: { kind: 'form' } }])).toBe(true);
		const time = state.time;
		world.update(1 / 60);
		expect(state.time).toBe(time);
		expect(rook.order).toEqual(hold.order);
		expect(rook.fireDiscipline).toBe('hold');
		expect(kite.order).toEqual({ kind: 'form' });
		const replacement = combat.attach(initial());
		expect(combat.applySquadOrders(state, [hold])).toBe(false);
		expect(replacement.squadmates[0]?.order).toBeUndefined();
	} finally { await world.dispose(); }
});
