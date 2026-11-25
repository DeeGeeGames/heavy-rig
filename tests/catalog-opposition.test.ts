import { expect, test } from 'bun:test';
import { getWeapon } from '../src/arsenal';
import type { Contract, MissionMap } from '../src/campaign-types';
import { frameWeight } from '../src/combat-resources';
import { PLAYABLE_FRAMES, rigIntegrityDamage, type FrameId } from '../src/frames';
import { createStarterLoadout, stockPackage } from '../src/hardpoints';
import { missionStructures } from '../src/missions';
import { createMissionState, enemiesStep, enemyWeight, MISSILE_LOCK_SECONDS, projectilesStep, step, weaponsStep, type Controls, type Point, type State } from '../src/simulation';

const contract: Contract = { id: 'catalog-fixture', seed: 0, planetId: 'meridian', kind: 'clearance', tier: 2,
	employer: 'freeholds', opponent: 'combine', title: 'Field test', briefing: '', reward: 100, favor: 1, hostility: 1, requiredReputation: 0 };
const map: MissionMap = { seed: 0, biome: 'badlands', width: 4000, height: 2600, drop: { x: 2200, y: 1300 },
	objective: { x: 1800, y: 1300 }, extraction: { x: 1000, y: 1300 }, sites: [], landmarks: [] };
const dt = 1 / 60;
const idle: Controls = { drive: 0, turn: 0, stop: false, coolant: false, aim: map.objective, fire: [false, false, false, false] };

const duel = function (frame: FrameId, separation: number) {
	for (let seed = 0; seed < 128; seed++) {
		const state = createMissionState({ ...contract, seed }, { frame, map });
		const enemy = state.enemies.find(function (candidate) { return candidate.catalog?.frameId === frame; });
		if (!enemy || !enemy.loadout) continue;
		enemy.x = state.player.x - separation; enemy.y = state.player.y;
		enemy.angle = 0; enemy.hullAngle = 0; enemy.cooldown = 0; enemy.stationary = true; enemy.engaged = true;
		state.enemies = [enemy];
		return { state, enemy, stock: enemy.loadout };
	}
	throw new Error(`No matching catalog hostiles for ${frame}`);
};

test('a stock enemy rig shares its player counterpart’s weight, PPC behavior, and vulnerability', function () {
	const { state, enemy, stock } = duel('warden-b', 400);
	expect(stock.map(function (mount) { return getWeapon(mount.weapon).modelId; })).toEqual(createStarterLoadout(state.frame).map(function (id) { return getWeapon(id).modelId; }));
	expect(enemyWeight(enemy)).toEqual(frameWeight(state.frame, stock));
	const ppc = stock.find(function (mount) { return getWeapon(mount.weapon).kind === 'ppc'; });
	if (!ppc) throw new Error('Missing stock PPC');
	enemy.loadout = [{ ...ppc }]; state.loadout = [{ ...ppc }];
	enemiesStep(state, dt);
	const hostile = state.shots[0];
	expect(hostile).toMatchObject({ owner: enemy.id, weapon: ppc.weapon, kind: 'ppc', hitIds: [] });
	state.player.angle = Math.PI; state.player.turret = Math.PI;
	weaponsStep(state, { ...idle, aim: enemy, targetId: enemy.id, fire: [false, false, false, true] }, dt);
	const friendly = state.shots.find(function (shot) { return shot.owner === undefined; });
	expect(friendly?.damage).toBe(hostile?.damage);
	expect(friendly?.life).toBe(hostile?.life);
	expect(Math.hypot(friendly?.vx ?? 0, friendly?.vy ?? 0, friendly?.vElevation ?? 0)).toBeCloseTo(getWeapon(ppc.weapon).speed);
	projectilesStep(state, 0.5);
	expect(state.player.hp).toBeGreaterThan(80);
	expect(state.player.hp).toBeLessThan(100);
	expect(enemy.hp).toBeCloseTo(state.player.hp);
});

test('catalog missiles must acquire lock and can hit past the old enemy firing range', function () {
	const { state, enemy, stock } = duel('warden', 1200);
	enemy.loadout = stock.filter(function (mount) { return getWeapon(mount.weapon).kind === 'missile'; });
	for (let tick = 1; tick < MISSILE_LOCK_SECONDS / dt; tick++) enemiesStep(state, dt);
	expect(state.shots).toHaveLength(0);
	enemiesStep(state, dt);
	const shot = state.shots[0];
	if (!shot?.weapon) throw new Error('Catalog rig never launched its missile');
	expect(shot).toMatchObject({ owner: enemy.id, kind: 'missile', target: 0 });
	projectilesStep(state, 1.5);
	expect(state.player.hp).toBeCloseTo(100 - rigIntegrityDamage(state.frame, getWeapon(shot.weapon).damage));
	expect(enemy.hp).toBe(100);
});

const timeUnderFire = function (state: State, targetId: number, target: Point & { hp: number }) {
	const start = state.time;
	const input: Controls = { ...idle, aim: target, targetId, fire: [true, true, true, true] };
	while (target.hp > 0 && state.time - start < 60 && state.outcome === 'playing') step(state, input, dt);
	expect(target.hp).toBeLessThanOrEqual(0);
	return state.time - start;
};

test('a stock Warden needs repeated volleys to disable a full-health campaign Warden', function () {
	const { state, enemy } = duel('warden', 400);
	enemy.cooldown = 3600;
	const seconds = timeUnderFire(state, enemy.id, enemy);
	expect(seconds).toBeGreaterThan(10);
	expect(seconds).toBeLessThan(30);
});

test('a solo stock Kestrel can clear a Frontier roster on one ammunition load', function () {
	const state = createMissionState({ ...contract, seed: 11 }, { frame: 'kestrel', map });
	// Present the generated contacts one at a time in the same firing lane.
	// Keep the pilot's ammo, heat and weapon cooldowns between engagements.
	const roster = state.enemies;
	for (const enemy of roster) {
		state.enemies = [enemy];
		Object.assign(enemy, { ...map.objective, angle: 0, hullAngle: 0, stationary: true, cooldown: Infinity });
		timeUnderFire(state, enemy.id, enemy);
	}
	expect(state.mission?.stage).toBe('extract');
	expect(state.loadout.every(function (mount) { return mount.rounds > 100; })).toBe(true);
});

test('demolition and raid targets withstand a squad opening volley and fall faster under focused fire', function () {
	const field = { ...map, sites: [map.objective, { x: 150, y: 150 }, { x: 150, y: 2450 }] };
	const wing = ['flint', 'glass', 'brace'].map(function (pilotId) {
		return { pilotId, callsign: pilotId, specialty: 'marksman' as const, frameId: 'warden' as const, integrity: 100, ...stockPackage('warden') };
	});
	for (const kind of ['demolition', 'raid'] as const) {
		const engage = function (withWing: boolean) {
			const state = createMissionState({ ...contract, kind, tier: 3 }, { frame: 'warden', map: field, squadmates: withWing ? wing : [] });
			state.enemies = [];
			const target = missionStructures(state.mission)[0];
			if (!target) throw new Error('Missing objective');
			return timeUnderFire(state, target.id, target.body);
		};
		const solo = engage(false);
		const squad = engage(true);
		expect(solo).toBeGreaterThan(kind === 'demolition' ? 15 : 9);
		expect(solo).toBeLessThan(40);
		expect(squad).toBeGreaterThan(kind === 'demolition' ? 4 : 2);
		expect(squad).toBeLessThan(solo * .5);
	}
});

test('the complete playable roster is eligible without using the deployed frame', function () {
	const discovered = new Set<FrameId>();
	const signature = function (state: ReturnType<typeof createMissionState>) {
		return state.enemies.map(function (enemy) { return enemy.catalog?.frameId ?? enemy.kind; });
	};
	for (let seed = 0; seed < 64; seed++) {
		const legendary = { ...contract, seed, tier: 6 as const };
		const state = createMissionState(legendary, { frame: 'kestrel', map });
		expect(signature(state)).toEqual(signature(createMissionState(legendary, { frame: 'maul-c', map })));
		for (const enemy of state.enemies) if (enemy.catalog) discovered.add(enemy.catalog.frameId);
	}
	expect(discovered).toEqual(new Set(PLAYABLE_FRAMES.map(function (frame) { return frame.id; })));
});

test('a catalog PPC cannot one-shot an untouched defense relay', function () {
	const { enemy, stock } = duel('warden-b', 400);
	const state = createMissionState({ ...contract, kind: 'defend' }, { frame: 'warden', map });
	state.player.x = 3200; enemy.x = 1400; enemy.y = map.objective.y;
	enemy.loadout = stock.filter(function (mount) { return getWeapon(mount.weapon).kind === 'ppc'; });
	state.enemies = [enemy];
	enemiesStep(state, dt);
	expect(state.shots[0]?.kind).toBe('ppc');
	projectilesStep(state, 0.5);
	expect(state.relay).toBeLessThan(100);
	expect(state.relay).toBeGreaterThan(50);
	expect(state.player.hp).toBe(100);
});
