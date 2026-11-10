import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount, WEAPONS } from '../src/arsenal';
import { consumeFire, coolReactor, frameWeight, isReserveLoadout, loadedMounts, weightSpeedModifier } from '../src/combat-resources';
import { createCombatRuntime } from '../src/combat-runtime';
import { createMissionState, createState, deathsStep, enemiesStep, enemyWeight, ENEMY_STATS, movementStep, outcomeStep, weaponsStep, artilleryStep, type Controls } from '../src/simulation';
import { FRAMES } from '../src/frames';
import type { Contract } from '../src/campaign-types';

const idle: Controls = { drive: 0, stop: false, turn: 0, aim: { x: 900, y: 100 }, fire: [false, false, false, false], coolant: false };
const fire: Controls = { ...idle, fire: [true, true, true, true] };
const contract: Contract = { id: 'resources', seed: 7, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Resource exercise', briefing: '', reward: 100, favor: 1, hostility: 1, tier: 1, requiredReputation: -100 };

test('reserve boundaries reject corrupt values, missing slots and sparse arrays before deployment', function () {
	for (const rounds of [-1, 0.5, Infinity, NaN, 2401]) {
		expect(isReserveLoadout(['machine-gun', null], [rounds, 0])).toBe(false);
	}
	expect(isReserveLoadout(['machine-gun', null], new Array<number>(2))).toBe(false);
	expect(isReserveLoadout(['laser'], [1])).toBe(false);
	expect(function () { loadedMounts(['machine-gun'], []); }).toThrow(RangeError);
	expect(function () { createMissionState(contract, { reserves: [NaN, 0] }); }).toThrow(RangeError);
	for (const weight of [-1, Infinity, NaN]) expect(function () { weightSpeedModifier(weight, 80); }).toThrow(RangeError);
	for (const recommended of [0, -1, Infinity, NaN]) expect(function () { weightSpeedModifier(80, recommended); }).toThrow(RangeError);
});

test('all equipment has finite mass and energy sustained heat exceeds every ammunition weapon', function () {
	const rates = WEAPONS.filter(function (weapon) { return weapon.ammunition !== null; }).map(function (weapon) { return weapon.heat / weapon.interval; });
	for (const weapon of WEAPONS) {
		expect(Number.isFinite(weapon.mass) && weapon.mass > 0).toBe(true);
		const mount = createMount(weapon.id);
		if (weapon.ammunition) {
			expect(weapon.ammunition.mass).toBeGreaterThan(0); expect(mount.rounds).toBeGreaterThan(0);
			expect(mount.rounds).toBeLessThanOrEqual(weapon.ammunition.capacity);
		} else {
			expect(mount.rounds).toBe(0);
			expect(weapon.kind === 'laser' ? weapon.heat : weapon.heat / weapon.interval).toBeGreaterThan(Math.max(...rates));
		}
	}
	for (const frame of FRAMES) expect(frameWeight(frame.id, [createMount(frame.starter)]).total).toBeGreaterThan(frame.mass);
	for (const stats of Object.values(ENEMY_STATS)) expect(stats.recommendedMass).toBeGreaterThan(stats.mass);
});

test('partial simultaneous and staggered salvos consume exactly emitted rounds and never refill', function () {
	for (const weapon of WEAPONS.filter(function (weapon) { return weapon.ammunition !== null; })) {
		const state = createState({ starter: weapon.id });
		const mount = state.loadout[0]; if (!mount) throw new Error('Missing mount');
		mount.rounds = Math.min(3, weapon.projectiles);
		const supplied = mount.rounds;
		weaponsStep(state, fire, 1 / 60);
		for (let tick = 0; tick < 20; tick++) weaponsStep(state, idle, 1 / 60);
		expect(state.stats.shotsFired).toBe(supplied); expect(mount.rounds).toBe(0);
		for (let tick = 0; tick < 100; tick++) { mount.cooldown = 0; weaponsStep(state, fire, 1 / 60); }
		expect(state.stats.shotsFired).toBe(supplied); expect(mount.rounds).toBe(0);
	}
});

test('the shared heat lock blocks a second mount and delayed rounds until reactor recovery', function () {
	const state = createState(); state.player.heat = 99;
	state.loadout = [createMount('autocannon', 2), createMount('machine-gun', 2)];
	weaponsStep(state, fire, 1 / 60);
	expect(state.stats.shotsFired).toBe(1); expect(state.loadout.map(function (mount) { return mount.rounds; })).toEqual([1, 2]);
	expect(state.player.overheated).toBe(true); expect(state.stats.overheats).toBe(1);
	const rockets = createState({ frame: 'maul', starter: 'stream-rockets-6' }); rockets.player.heat = 98;
	weaponsStep(rockets, fire, 1 / 60);
	for (let tick = 0; tick < 40; tick++) weaponsStep(rockets, idle, 1 / 60);
	expect(rockets.stats.shotsFired).toBe(2); expect(rockets.player.overheated).toBe(true);
	const laser = createMount('laser'); const reactor = { heat: 100, overheated: true };
	expect(consumeFire(laser, reactor, 1 / 60)).toBe(false);
	coolReactor(reactor, 10, 6.4); expect(reactor.overheated).toBe(true);
	coolReactor(reactor, 10, 0.1); expect(reactor.overheated).toBe(false);
	expect(consumeFire(laser, reactor, 1 / 60)).toBe(true); expect(laser.rounds).toBe(0);
});

test('burning carried ammunition changes target speed smoothly in forward and reverse inside map bounds', function () {
	expect(weightSpeedModifier(80, 80)).toBe(1);
	expect(weightSpeedModifier(40, 80) - 1).toBeLessThan(1 - weightSpeedModifier(120, 80));
	expect(weightSpeedModifier(800, 80)).toBeGreaterThan(0);
	const state = createState(); state.loadout = [createMount('autocannon', 320), createMount('autocannon', 320)];
	const loaded = frameWeight(state.frame, state.loadout);
	expect(loaded.modifier).toBeLessThan(1);
	for (const reverse of [false, true]) {
		state.player.throttle = reverse ? -1 : 1; state.player.speed = (reverse ? -48 : 90) * loaded.modifier;
		for (const mount of state.loadout) mount.rounds = 0;
		const previous = state.player.speed; movementStep(state, idle, 1 / 60);
		expect(Math.abs(state.player.speed)).toBeGreaterThan(Math.abs(previous));
		expect(Math.abs(state.player.speed - previous)).toBeLessThan(1);
	}
	state.player.x = 35; state.player.angle = Math.PI; movementStep(state, idle, 1); expect(state.player.x).toBeGreaterThanOrEqual(35);
});

test('all dry enemy classes remain targetable without falsely clearing objectives and use the shared weight curve', function () {
	for (const kind of ['scout', 'striker', 'siege', 'helicopter', 'vtol', 'tank'] as const) {
		const state = createMissionState(contract);
		const enemy = state.enemies[0]; if (!enemy) throw new Error('Missing enemy');
		enemy.kind = kind; enemy.loadout = []; enemy.engaged = true; state.enemies = [enemy];
		const position = { x: enemy.x, y: enemy.y };
		enemiesStep(state, 1); outcomeStep(state, 1);
		expect(state.enemies).toContain(enemy); expect(state.kills).toBe(0); expect(state.mission?.stage).toBe('active');
		expect(enemy.x !== position.x || enemy.y !== position.y).toBe(true);
		expect(enemy.x).toBeGreaterThanOrEqual(35); expect(enemy.y).toBeGreaterThanOrEqual(35);
		const weight = enemyWeight(enemy); expect(weight.modifier).toBe(weightSpeedModifier(weight.total, weight.recommended));
	}
});

test('dry tank disengagement retains its hull traverse limit', function () {
	const state = createState();
	const tank = { id: 1, x: 1000, y: 780, hp: 500, maxHp: 500, kind: 'tank' as const, heavy: true, angle: Math.PI, hullAngle: Math.PI, cooldown: 0, loadout: [] };
	state.enemies = [tank]; enemiesStep(state, 1 / 60);
	expect(Math.abs(tank.hullAngle - Math.PI)).toBeLessThanOrEqual(0.5 / 60 + 1e-9);
	expect(state.enemies).toContain(tank);
});

test('artillery charges only committed shells and those impacts survive a dry destroyed commander', function () {
	const state = createState(); state.spawnIn = 3600;
	state.enemies = [{ id: 1, x: 750, y: 780, hp: 500, maxHp: 500, kind: 'siege', commander: true, heavy: true, angle: 0, cooldown: 0,
		loadout: [{ ...createMount('autocannon', 2), slot: 4 }], reactor: { heat: 99, overheated: false } }];
	enemiesStep(state, 0);
	const enemy = state.enemies[0]; if (!enemy) throw new Error('Missing commander');
	expect(state.strikes).toHaveLength(1); expect(enemy.loadout?.[0]?.rounds).toBe(1); expect(enemy.reactor?.overheated).toBe(true);
	enemy.hp = 0; deathsStep(state); expect(state.enemies).toHaveLength(0);
	artilleryStep(state, 4); expect(state.player.hp).toBeLessThan(100); expect(state.strikes).toHaveLength(0);
});

test('live enemy resources are authoritative, freeze on pause and are released on mission replacement', async function () {
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize();
		const initial = createState(); initial.spawnIn = 3600;
		initial.enemies = [{ id: 1, x: 750, y: 780, hp: 500, maxHp: 500, kind: 'vtol', heavy: false, angle: 0, cooldown: 0,
			loadout: [{ ...createMount('stream-missiles-6', 3), slot: 0 }], reactor: { heat: 0, overheated: false } }];
		const state = combat.attach(initial); combat.setEnabled(true); world.update(1 / 60);
		const id = combat.entityForEnemy(1); if (id === undefined) throw new Error('Missing ECS enemy');
		expect(state.enemies[0]?.loadout?.[0]?.rounds).toBe(2);
		const snapshot = JSON.stringify(state); combat.setEnabled(false);
		for (let tick = 0; tick < 60; tick++) world.update(1 / 60);
		expect(JSON.stringify(state)).toBe(snapshot);
		world.addComponent(id, 'enemyReactor', { heat: 100, overheated: true });
		expect(state.enemies[0]?.reactor?.heat).toBe(100);
		combat.setEnabled(true); for (let tick = 0; tick < 10; tick++) world.update(1 / 60);
		expect(state.enemies[0]?.loadout?.[0]?.rounds).toBe(2);
		for (let tick = 0; tick < 500; tick++) world.update(1 / 60);
		expect(state.enemies[0]?.loadout?.[0]?.rounds).toBeLessThan(2);
		combat.attach(createState()); expect(world.getComponent(id, 'enemyReactor')).toBeUndefined();
		expect(world.getEntitiesWithQuery(['enemyWeapons'])).toHaveLength(0);
	} finally { await world.dispose(); }
});
