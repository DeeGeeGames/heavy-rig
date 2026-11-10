import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount, getWeapon } from '../src/arsenal';
import { createCombatRuntime } from '../src/combat-runtime';
import type { Contract } from '../src/campaign-types';
import { createMissionState, createState, step, type CombatStateView, type Controls } from '../src/simulation';
import { createTraining, stepTraining } from '../src/training';

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
			const controls: Controls = { ...idle, ...(expected.state.enemies[0] ? { targetId: expected.state.enemies[0].id } : {}), aim: expected.state.enemies[0] ?? expected.state.player, drive: stage === 'drive' || stage === 'evade' && expected.strikeIssued ? 1 : 0, stop: stage === 'neutral', turn: stage === 'steer' ? 1 : 0, fire: [stage === 'cannon' || stage === 'heat', stage === 'combined', stage === 'missiles', stage === 'combined'], coolant: stage === 'coolant' };
			combat.setControls(function () { return controls; }); stepTraining(expected, controls, 1 / 60); world.update(1 / 60);
			expect(training).toEqual(expected);
		}
		expect(training.stage).toBe('complete');
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
