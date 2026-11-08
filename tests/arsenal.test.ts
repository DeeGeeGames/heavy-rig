import { describe, expect, test } from 'bun:test';
import { WEAPONS, createMount, getWeapon } from '../src/arsenal';
import { createMissionState, createState, step, type Controls, type State } from '../src/simulation';
import type { Contract } from '../src/campaign-types';

const contract: Contract = { id: 'deployment-test', seed: 83, planetId: 'meridian', kind: 'defend', employer: 'freeholds', opponent: 'combine', title: 'Deployment test', briefing: 'Hold the relay.', reward: 1200, favor: 8, hostility: 6, tier: 1, requiredReputation: -100 };

const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 200 }, fire: [false, false, false, false], coolant: false };
const target = function (state: State, x: number, y: number, hp = 1000) {
	const unit = { id: state.nextId++, x, y, angle: 0, cooldown: 3600, hp, maxHp: hp, kind: 'striker' as const, heavy: false };
	state.enemies.push(unit); return unit;
};
const advance = function (state: State, seconds: number, input = idle) { for (let tick = 0; tick < seconds * 60; tick++) step(state, input, 1 / 60); };

describe('Heavy Rig arsenal', function () {
	test('deployment preserves empty mount positions, damage and supplies without mutating the saved loadout', function () {
		const loadout = ['autocannon', null, 'stream-rockets', null] as const;
		const state = createMissionState(contract, { frame: 'warden', loadout, integrity: 46.5, coolantCharges: 1 });
		state.spawnIn = 3600;
		expect(state.player.hp).toBe(46.5); expect(state.coolantCharges).toBe(1);
		expect(state.loadout.map(function (mount) { return [mount.weapon, mount.slot]; })).toEqual([['autocannon', 0], ['stream-rockets', 2]]);
		step(state, { ...idle, fire: [false, true, false, true] }, 1 / 60);
		expect(state.shots).toHaveLength(0);
		step(state, { ...idle, fire: [false, false, true, false] }, 1 / 60);
		expect(state.shots.map(function (shot) { return shot.kind; })).toEqual(['rocket']);
		expect(state.loadout[0]?.cooldown).toBe(0);
		expect(loadout).toEqual(['autocannon', null, 'stream-rockets', null]);
		expect(createMissionState(contract, { loadout: [null, null] }).loadout).toHaveLength(0);
	});

	test('deployment bounds integrity and supplies and never revives a destroyed frame', function () {
		for (const integrity of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
			const state = createMissionState(contract, { integrity });
			expect(state.player.hp).toBe(0); expect(state.outcome).toBe('lost');
			step(state, { ...idle, fire: [true, true, true, true] }, 1 / 60);
			expect(state.shots).toHaveLength(0); expect(state.time).toBe(0);
		}
		const full = createMissionState(contract, { integrity: 120, coolantCharges: 5 });
		expect(full.player.hp).toBe(100); expect(full.coolantCharges).toBe(3);
		expect(createMissionState(contract, { coolantCharges: Number.NaN }).coolantCharges).toBe(0);
	});

	test('eliminations never pause for weapons or restore integrity and supplies', function () {
		const state = createMissionState(contract, { integrity: 50, coolantCharges: 1 });
		state.spawnIn = 3600;
		for (let index = 0; index < 9; index++) target(state, state.player.x, state.player.y, 0);
		state.strikes.push({ id: state.nextId++, x: state.player.x, y: state.player.y, life: 1, duration: 2.8, radius: 62, damage: 10 });
		step(state, idle, 1 / 60);
		expect(state.kills).toBe(9);
		expect(state.player.hp).toBe(50); expect(state.coolantCharges).toBe(1);
		advance(state, 1.1);
		expect(state.time).toBeGreaterThan(1); expect(state.player.hp).toBe(37);
		expect(state.loadout.map(function (mount) { return [mount.weapon, mount.level]; })).toEqual([['machine-gun', 1]]);
		expect(state.phase).toBe('combat');
	});

	test('four slots fire concurrently, keep separate cooldowns, and respect the shared heat lock', function () {
		const state = createState(); state.spawnIn = 3600;
		state.loadout = [createMount('autocannon'), createMount('machine-gun'), createMount('stream-missiles'), createMount('stream-rockets')];
		target(state, 900, 600);
		step(state, { ...idle, fire: [true, true, true, true] }, 1 / 60);
		expect(state.shots.map(function (shot) { return shot.kind; }).sort()).toEqual(['bullet', 'cannon', 'missile', 'rocket']);
		expect(state.loadout.every(function (mount) { return mount.firing; })).toBe(true);
		const fired = state.stats.shotsFired;
		advance(state, 0.2, { ...idle, fire: [false, true, true, true] });
		expect(state.beam).toBeUndefined(); expect(state.stats.shotsFired).toBeGreaterThan(fired);
		expect(state.events).not.toContain('cannon'); expect(state.events).not.toContain('rocket');
		state.player.overheated = true; state.player.heat = 90;
		const shots = state.stats.shotsFired;
		advance(state, 0.8, { ...idle, fire: [true, true, true, true] });
		expect(state.stats.shotsFired).toBe(shots); expect(state.beam).toBeUndefined();
		expect(state.loadout.every(function (mount) { return !mount.firing; })).toBe(true);
	});

	test('missiles steer toward the aimed target while rockets retain their launch heading', function () {
		const state = createState({ frame: 'maul' }); state.spawnIn = 3600;
		state.loadout = [createMount('stream-missiles'), createMount('stream-rockets')];
		const enemy = target(state, 1050, 580);
		step(state, { ...idle, aim: enemy, fire: [true, true, false, false] }, 1 / 60);
		const missile = state.shots.find(function (shot) { return shot.kind === 'missile'; });
		const rocket = state.shots.find(function (shot) { return shot.kind === 'rocket'; });
		if (!missile || !rocket) throw new Error('Missing projectiles');
		expect(missile.target).toBe(enemy.id); expect(rocket.target).toBeUndefined();
		const missileX = missile.vx; const rocketX = rocket.vx; const rocketY = rocket.vy;
		enemy.x = 1150;
		advance(state, 0.2);
		expect(missile.vx).toBeGreaterThan(missileX); expect(rocket.vx).toBe(rocketX); expect(rocket.vy).toBe(rocketY);
		state.enemies = [];
		const headingX = missile.vx; const headingY = missile.vy;
		advance(state, 0.1); expect(missile.vx).toBe(headingX); expect(missile.vy).toBe(headingY);
	});

	test('particle bolts pierce multiple targets once each without inflating projectile hit rate', function () {
		const state = createState({ starter: 'ppc' }); state.spawnIn = 3600;
		const enemies = [target(state, 900, 690), target(state, 900, 630), target(state, 900, 570)];
		step(state, { ...idle, fire: [true, false, false, false] }, 1 / 60);
		advance(state, 0.5);
		for (const enemy of enemies) expect(enemy.hp).toBe(1000 - getWeapon('ppc').damage);
		expect(state.stats.shotsFired).toBe(1); expect(state.stats.shotsHit).toBe(1);
	});

	test('cluster volleys apply area damage beyond the directly struck frame', function () {
		for (const weapon of ['cluster-rockets', 'cluster-missiles'] as const) {
			const state = createState({ starter: weapon }); state.spawnIn = 3600;
			const direct = target(state, 900, 700); const neighbor = target(state, 950, 700);
			step(state, { ...idle, aim: direct, fire: [true, false, false, false] }, 1 / 60);
			expect(state.shots).toHaveLength(weapon === 'cluster-rockets' ? 1 : getWeapon(weapon).projectiles);
			advance(state, 0.4);
			expect(direct.hp).toBeLessThan(1000); expect(neighbor.hp).toBeLessThan(1000);
			expect(state.stats.shotsHit).toBeLessThanOrEqual(state.stats.shotsFired);
		}
	});

	test('fatal damage takes precedence over eliminations on the same simulation tick', function () {
		const state = createState(); state.spawnIn = 3600; state.player.hp = 1;
		target(state, 100, 100, 0); target(state, 200, 100, 0);
		state.shots.push({ x: 900, y: 780, vx: 0, vy: 0, life: 1, kind: 'enemy', target: undefined, damage: 10 });
		step(state, idle, 1 / 60);
		expect(state.kills).toBe(2); expect(state.outcome).toBe('lost'); expect(state.phase).toBe('combat');
	});
});

test('deployment and combat reject incompatible weapons and nonexistent chassis slots', function () {
	expect(function () { createMissionState(contract, { frame: 'kestrel', loadout: ['autocannon', null] }); }).toThrow(RangeError);
	expect(function () { createMissionState(contract, { frame: 'longbow', loadout: ['ppc', null] }); }).toThrow(RangeError);
	expect(function () { createState({ frame: 'maul', starter: 'machine-gun' }); }).toThrow(RangeError);
	const state = createState({ frame: 'warden' }); state.spawnIn = 3600;
	state.loadout = [createMount('laser'), createMount('machine-gun'), createMount('autocannon'), { ...createMount('stream-rockets'), slot: 5 }, { ...createMount('machine-gun'), slot: 1 }];
	step(state, { ...idle, fire: [true, true, true, true] }, 1 / 60);
	expect(state.beam).toBeUndefined();
	expect(state.shots.map(function (shot) { return shot.kind; })).toEqual(['bullet']);
	expect(state.loadout.map(function (mount) { return mount.firing; })).toEqual([false, true, false, false, false]);
});

// Protect exact burst counts, release completion and guided follow-up rounds.
test('all launcher varieties fire their advertised count once per trigger cycle', function () {
	for (const weapon of WEAPONS.filter(function (candidate) { return candidate.family === 'launcher'; })) {
		const state = createState({ frame: 'maul', starter: weapon.id }); state.spawnIn = 3600;
		const enemy = target(state, state.player.x + 400, state.player.y - 400);
		step(state, { ...idle, aim: enemy, fire: [true, false, false, false] }, 1 / 60);
		expect(state.stats.shotsFired).toBe(weapon.kind === 'rocket' || weapon.stream ? 1 : weapon.projectiles);
		advance(state, 0.6, { ...idle, aim: enemy });
		expect(state.stats.shotsFired).toBe(weapon.projectiles);
		expect(state.loadout[0]?.rocketVolley).toBeUndefined();
		if (weapon.kind === 'missile') expect(state.shots.every(function (shot) { return shot.target === enemy.id; })).toBe(true);
	}
});
