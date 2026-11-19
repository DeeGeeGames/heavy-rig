import { expect, test } from 'bun:test';
import type { Contract } from '../src/campaign-types';
import { angleDelta, createMissionState, distance, enemiesStep, ENEMY_STATS, projectilesStep, type State, type Unit } from '../src/simulation';
import { TORSO_LIMIT } from '../src/torso-arc';

const contract: Contract = { id: 'tactics-clearance', seed: 123, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Test', briefing: 'Test', reward: 1000, favor: 8, hostility: 5, tier: 1, requiredReputation: 0 };
const unit = function (id: number, kind: 'scout' | 'striker', x: number, y: number): Unit {
	return { id, kind, x, y, angle: 0, cooldown: 0, hp: ENEMY_STATS[kind].hp, maxHp: ENEMY_STATS[kind].hp, heavy: false };
};
const scenario = function (): State {
	const state = createMissionState(contract);
	state.player.x = 900; state.player.y = 600; state.spawnIn = 3600; state.nextId = 20;
	state.enemies = [unit(1, 'scout', 400, 570), unit(2, 'striker', 420, 600), unit(3, 'scout', 400, 630)];
	return state;
};

test('a squad limits final advances to one unit while every member reaches a firing position', function () {
	const state = scenario();
	const moving = new Set<number>(); const firing = new Set<number>();
	for (let tick = 0; tick < 3600; tick++) {
		enemiesStep(state, 1 / 60);
		const advancing = state.enemies.filter(function (enemy) { return enemy.tactics?.phase === 'advance' && distance(enemy, state.player) <= ENEMY_STATS[enemy.kind].range + 160; });
		expect(advancing.length).toBeLessThanOrEqual(1);
		for (const enemy of advancing) moving.add(enemy.id);
		for (const enemy of state.enemies) expect(Math.abs(angleDelta(enemy.hullAngle ?? enemy.angle, enemy.angle))).toBeLessThanOrEqual(TORSO_LIMIT + 1e-9);
		for (const shot of state.shots) if (shot.owner !== undefined) firing.add(shot.owner);
		state.shots = [];
	}
	expect([...moving].sort()).toEqual([1, 2, 3]); expect([...firing].sort()).toEqual([1, 2, 3]);
	for (const enemy of state.enemies) {
		expect(distance(enemy, state.player)).toBeGreaterThan(ENEMY_STATS[enemy.kind].range * 0.55);
		expect(distance(enemy, state.player)).toBeLessThan(ENEMY_STATS[enemy.kind].range);
	}
});

test('an advance keeps its chosen destination when the player retreats, then stops to recover or fire', function () {
	const state = scenario(); const enemy = unit(1, 'scout', 500, 600); state.enemies = [enemy];
	enemiesStep(state, 1 / 60);
	expect(enemy.tactics?.phase).toBe('advance');
	const destination = enemy.tactics?.destination;
	state.player.x += 100; state.player.y += 40;
	enemiesStep(state, 1 / 60);
	expect(enemy.tactics?.destination).toEqual(destination);
	for (let tick = 0; tick < 180 && enemy.tactics?.phase === 'advance'; tick++) enemiesStep(state, 1 / 60);
	expect(enemy.tactics?.phase).not.toBe('advance');
	const stopped = { x: enemy.x, y: enemy.y };
	for (let tick = 0; tick < 60; tick++) { state.player.x += 1; enemiesStep(state, 1 / 60); }
	expect(distance(enemy, stopped)).toBe(0);
});

test('a close player causes one short withdrawal, followed by a firing opportunity instead of endless flight', function () {
	const state = scenario(); const enemy = unit(1, 'scout', 650, 600); state.enemies = [enemy];
	enemiesStep(state, 1 / 60);
	const start = { x: enemy.x, y: enemy.y };
	let firedAfterWithdrawal = false;
	for (let tick = 0; tick < 300; tick++) {
		state.player.x = enemy.x + 100; state.player.y = enemy.y;
		enemiesStep(state, 1 / 60);
		if (tick > 130 && state.shots.some(function (shot) { return shot.owner === enemy.id; })) firedAfterWithdrawal = true;
		state.shots = [];
	}
	expect(distance(enemy, start)).toBeGreaterThan(20);
	expect(distance(enemy, start)).toBeLessThanOrEqual(70);
	expect(firedAfterWithdrawal).toBe(true);
});

test('real incoming damage interrupts an advance without repeatedly extending recovery', function () {
	const state = scenario(); const enemy = unit(1, 'scout', 500, 600); state.enemies = [enemy];
	enemiesStep(state, 1 / 60);
	state.shots = [{ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 1, kind: 'cannon', damage: 60, target: undefined }];
	projectilesStep(state, 1 / 60); enemiesStep(state, 1 / 60);
	expect(enemy.hp).toBe(enemy.maxHp - 60); expect(enemy.tactics?.phase).toBe('recover');
	const destination = enemy.tactics?.destination;
	for (let tick = 0; tick < 90; tick++) {
		enemy.hp -= 0.1; enemiesStep(state, 1 / 60);
		expect(enemy.tactics?.destination).toEqual(destination);
	}
	expect(enemy.tactics?.remaining).toBeLessThan(0.6);
	for (let tick = 0; tick < 40; tick++) enemiesStep(state, 1 / 60);
	expect(enemy.tactics?.phase).toBe('engage');
});

test('an overheated attacker stops closing while cooling and resumes fighting after the lock clears', function () {
	const state = scenario(); const enemy = unit(1, 'scout', 500, 600); state.enemies = [enemy];
	enemiesStep(state, 1 / 60); enemy.reactor = { heat: 100, overheated: true };
	const start = { x: enemy.x, y: enemy.y };
	for (let tick = 0; tick < 120; tick++) enemiesStep(state, 1 / 60);
	expect(distance(enemy, start)).toBe(0); expect(enemy.tactics?.phase).toBe('recover');
	for (let tick = 0; tick < 600; tick++) enemiesStep(state, 1 / 60);
	expect(enemy.reactor.overheated).toBe(false);
	expect(state.shots.some(function (shot) { return shot.owner === enemy.id; })).toBe(true);
});

test('settled enemies still withdraw from incoming damage after multiple ordinary recovery cycles', function () {
	const state = scenario(); const enemy = unit(1, 'scout', 650, 600); state.enemies = [enemy];
	for (let tick = 0; tick < 900; tick++) enemiesStep(state, 1 / 60);
	for (let tick = 0; tick < 180 && enemy.tactics?.phase !== 'engage'; tick++) enemiesStep(state, 1 / 60);
	state.shots = [{ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 1, kind: 'cannon', damage: 60, target: undefined }];
	projectilesStep(state, 1 / 60); enemiesStep(state, 1 / 60);
	expect(enemy.tactics?.phase).toBe('recover');
	if (!enemy.tactics) throw new Error('Missing tactical state');
	expect(distance(enemy, enemy.tactics.destination)).toBeGreaterThan(20);
});

test('clustered Recovery scouts make space and return fire during their damage response', function () {
	const state = createMissionState({ ...contract, kind: 'recovery' });
	state.player.x = 900; state.player.y = 600;
	state.enemies = [unit(1, 'scout', 700, 574), unit(2, 'scout', 700, 600), unit(3, 'scout', 700, 626)];
	for (const enemy of state.enemies) enemy.cooldown = 0.1;
	enemiesStep(state, 1 / 60);
	for (const enemy of state.enemies) enemy.hp -= enemy.maxHp * 0.1;
	const firedWhileMoving = new Set<number>();
	for (let tick = 0; tick < 120; tick++) {
		enemiesStep(state, 1 / 60);
		for (const enemy of state.enemies) {
			if (enemy.tactics?.phase === 'recover' && distance(enemy, enemy.tactics.destination) > 12 && state.shots.some(function (shot) { return shot.owner === enemy.id; })) firedWhileMoving.add(enemy.id);
		}
		state.shots = [];
	}
	expect(firedWhileMoving.size).toBeGreaterThan(0);
	for (const enemy of state.enemies) {
		for (const other of state.enemies) if (other.id !== enemy.id) expect(distance(enemy, other)).toBeGreaterThanOrEqual(80);
	}
});

test('two squads cannot reserve the same firing position', function () {
	const state = scenario();
	const first = unit(1, 'scout', 500, 530);
	const second = unit(3, 'scout', 510, 700);
	state.enemies = [first, unit(2, 'scout', 420, 480), second, unit(4, 'scout', 420, 790)];
	state.enemies.forEach(function (enemy, index) {
		enemy.squad = { id: index < 2 ? 1 : 3, slot: index % 2 === 0 ? 'center' : 'left', target: 'player', bearing: Math.PI, reconsiderIn: 3 };
	});
	enemiesStep(state, 1 / 60);
	expect(first.tactics?.phase).toBe('advance');
	expect(second.tactics?.phase).toBe('advance');
	if (!first.tactics || !second.tactics) throw new Error('Missing firing plans');
	expect(distance(first.tactics.destination, second.tactics.destination)).toBeGreaterThanOrEqual(80);
});

test('tactical allocation gives identical outcomes when the enemy collection order changes', function () {
	const forward = scenario(); const reverse = scenario(); reverse.enemies.reverse();
	for (let tick = 0; tick < 900; tick++) { enemiesStep(forward, 1 / 60); enemiesStep(reverse, 1 / 60); }
	expect([...reverse.enemies].sort(function (a, b) { return a.id - b.id; })).toEqual(forward.enemies);
});
