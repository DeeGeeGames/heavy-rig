import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import type { Contract } from '../src/campaign-types';
import { createCombatRuntime } from '../src/combat-runtime';
import { createMissionState, createState, distance, enemiesStep, ENEMY_STATS, type State, type Unit } from '../src/simulation';

const clearance: Contract = { id: 'squad-clearance', seed: 123, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Test', briefing: 'Test', reward: 1000, favor: 8, hostility: 5, tier: 1, requiredReputation: 0 };

const unit = function (id: number, kind: Unit['kind'], x: number, y: number): Unit {
	const hp = ENEMY_STATS[kind].hp;
	return { id, kind, x, y, hp, maxHp: hp, angle: 0, heavy: kind === 'siege' || kind === 'tank', cooldown: 0 };
};
const scenario = function (): State {
	const state = createState(); state.spawnIn = 3600; state.nextId = 20;
	state.player.x = 900; state.player.y = 900;
	state.enemies = [unit(1, 'scout', 400, 900), unit(2, 'striker', 420, 930), unit(3, 'scout', 400, 960)];
	return state;
};

test('nearby scouts and strikers share a target, commit through aggro changes, and reconsider together', function () {
	const state = scenario(); enemiesStep(state, 1 / 60);
	expect(state.enemies.map(function (enemy) { return enemy.squad?.target; })).toEqual(['player', 'player', 'player']);
	state.player.x = 1700;
	for (let tick = 0; tick < 120; tick++) enemiesStep(state, 1 / 60);
	expect(state.enemies.every(function (enemy) { return enemy.squad?.target === 'player'; })).toBe(true);
	for (let tick = 0; tick < 61; tick++) enemiesStep(state, 1 / 60);
	expect(state.enemies.every(function (enemy) { return enemy.squad?.target === 'relay'; })).toBe(true);
});

test('flankers spread to opposite sides, keep aiming at the target, and fire from their positions', function () {
	const state = scenario(); state.player.y = 930;
	for (let tick = 0; tick < 900; tick++) enemiesStep(state, 1 / 60);
	const center = state.enemies[0]; const left = state.enemies[1]; const right = state.enemies[2];
	if (!center || !left || !right) throw new Error('Missing squad');
	expect(left.y).toBeGreaterThan(state.player.y + 60);
	expect(right.y).toBeLessThan(state.player.y - 60);
	expect(distance(center, state.player)).toBeLessThanOrEqual(ENEMY_STATS.scout.range);
	for (const enemy of state.enemies) {
		expect(distance(enemy, state.player)).toBeLessThan(ENEMY_STATS[enemy.kind].range + 15);
		expect(enemy.angle).toBeCloseTo(Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x), 2);
		expect(state.shots.some(function (shot) { return shot.owner === enemy.id; })).toBe(true);
	}
	expect(distance(left, right)).toBeGreaterThan(180);
});

test('squads stay small and local, preserve surviving slots, and release a lone survivor', function () {
	const state = scenario();
	state.enemies.push(unit(4, 'striker', 410, 940), unit(5, 'scout', 1700, 100));
	enemiesStep(state, 1 / 60);
	expect(state.enemies.filter(function (enemy) { return enemy.squad; })).toHaveLength(3);
	const first = state.enemies[0]; const second = state.enemies[1]; const third = state.enemies[2];
	if (!first || !second || !third) throw new Error('Missing squad');
	const original = second.squad;
	first.hp = 0; enemiesStep(state, 1 / 60);
	expect(second.squad?.slot).toBe(original?.slot); expect(second.squad?.id).toBe(original?.id);
	third.hp = 0; state.enemies = [first, second, third];
	const before = { x: second.x, y: second.y };
	enemiesStep(state, 1 / 60);
	expect(second.squad).toBeUndefined(); expect(second.hullAngle).toBeUndefined();
	expect(distance(second, before)).toBeGreaterThan(0);
});

test('inactive garrisons and specialist enemies stay outside squads', function () {
	const state = createMissionState(clearance);
	const p = state.player;
	state.enemies = [unit(1, 'scout', p.x + 700, p.y), unit(2, 'striker', p.x + 900, p.y), ...(['tank', 'siege', 'helicopter', 'vtol'] as const).map(function (kind, index) { return unit(index + 3, kind, p.x + 720, p.y); })];
	enemiesStep(state, 1 / 60);
	expect(state.enemies.every(function (enemy) { return !enemy.squad; })).toBe(true);
	const dormant = state.enemies[1]; if (!dormant) throw new Error('Missing garrison');
	expect(dormant.engaged).toBeUndefined(); expect(dormant.x).toBe(p.x + 900);
	dormant.hp--; enemiesStep(state, 1 / 60);
	expect(state.enemies.slice(0, 2).every(function (enemy) { return enemy.squad?.target === 'player'; })).toBe(true);
	expect(state.enemies.slice(2).every(function (enemy) { return !enemy.squad; })).toBe(true);
});

test('squad approaches at all map corners remain in bounds and reach firing range', function () {
	for (const x of [35, 1765]) for (const y of [35, 1165]) {
		const state = scenario(); state.player.x = x; state.player.y = y;
		state.enemies = [unit(1, 'scout', x < 900 ? 400 : 1400, y < 600 ? 300 : 900), unit(2, 'striker', x < 900 ? 420 : 1420, y < 600 ? 320 : 920)];
		for (let tick = 0; tick < 900; tick++) enemiesStep(state, 1 / 60);
		for (const enemy of state.enemies) {
			expect(enemy.x).toBeGreaterThanOrEqual(35); expect(enemy.x).toBeLessThanOrEqual(1765);
			expect(enemy.y).toBeGreaterThanOrEqual(35); expect(enemy.y).toBeLessThanOrEqual(1165);
			expect(distance(enemy, state.player)).toBeLessThan(ENEMY_STATS[enemy.kind].range + 15);
			expect(state.shots.some(function (shot) { return shot.owner === enemy.id; })).toBe(true);
		}
	}
});

test('ECS squad clocks freeze on pause, match plain simulation, and reset with mission replacement', async function () {
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize(); const expected = scenario(); const state = combat.attach(scenario()); combat.setEnabled(true);
		for (let tick = 0; tick < 30; tick++) { enemiesStep(expected, 1 / 60); world.update(1 / 60); }
		expect(state.enemies).toEqual(expected.enemies);
		const snapshot = JSON.stringify(state); combat.setEnabled(false);
		for (let tick = 0; tick < 180; tick++) world.update(1 / 60);
		expect(JSON.stringify(state)).toBe(snapshot);
		combat.setEnabled(true); world.update(1 / 60);
		expect(state.enemies[0]?.squad?.reconsiderIn).toBeLessThan(expected.enemies[0]?.squad?.reconsiderIn ?? 0);
		const next = combat.attach(createState());
		expect(next.enemies).toHaveLength(0); expect(world.getEntitiesWithQuery(['enemy'])).toHaveLength(0);
	} finally { await world.dispose(); }
});

test('a target moving into a corner cannot collapse established flank positions onto itself', function () {
	for (const x of [35, 1765]) for (const y of [35, 1165]) {
		const state = scenario();
		const mission = createMissionState(clearance).mission;
		if (!mission) throw new Error('Missing mission');
		state.mission = { ...mission, map: { ...mission.map, width: 1800, height: 1200 } };
		enemiesStep(state, 1 / 60);
		state.player.x = x; state.player.y = y;
		for (let tick = 0; tick < 3600; tick++) enemiesStep(state, 1 / 60);
		const flankers = state.enemies.filter(function (enemy) { return enemy.squad?.slot !== 'center'; });
		for (const enemy of flankers) {
			expect(distance(enemy, state.player)).toBeGreaterThan(100);
			expect(distance(enemy, state.player)).toBeLessThan(ENEMY_STATS[enemy.kind].range + 15);
		}
		const first = flankers[0]; const second = flankers[1];
		if (!first || !second) throw new Error('Missing flankers');
		expect(distance(first, second)).toBeGreaterThan(100);
	}
});
