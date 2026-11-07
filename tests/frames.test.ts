import { describe, expect, test } from 'bun:test';
import { FRAMES, type FrameId } from '../src/frames';
import { createState, getEnemyDefense, step, type Controls, type State } from '../src/simulation';

const idle: Controls = { drive: 0, stop: false, turn: 0, aim: { x: 900, y: 200 }, fire: [false, false, false, false], coolant: false };
const run = function (state: State, seconds: number, input = idle) {
	for (let tick = 0; tick < seconds * 60; tick++) step(state, input, 1 / 60);
};
const isolated = function (frame: FrameId) {
	const state = createState({ frame }); state.spawnIn = 3600;
	return state;
};
describe('Heavy Rig frame combat', function () {
	for (const frame of FRAMES) {
		test(`${frame.name} escapes siege artillery from neutral after reaction time`, function () {
			const state = isolated(frame.id);
			state.enemies.push({ id: 1, x: 850, y: 800, hp: 125, maxHp: 125, angle: Math.atan2(-20, 50), cooldown: 0, heavy: true, kind: 'siege' });
			step(state, idle, 1 / 60);
			expect(state.strikes).toHaveLength(2);
			run(state, 0.3);
			run(state, 3.3, { ...idle, drive: 1 });
			expect(state.player.hp).toBe(100); expect(state.strikes).toHaveLength(0);
		});

		test(`${frame.name} escapes both Crown patterns in eight headings after reaction time`, function () {
			for (const enraged of [false, true]) for (let direction = 0; direction < 8; direction++) {
				const state = isolated(frame.id); state.player.y = 600; state.player.angle = direction * Math.PI / 4;
				state.enemies.push({ id: 1, x: 400, y: 600, hp: enraged ? 200 : 420, maxHp: 420, angle: 0, cooldown: 0, heavy: true, kind: 'siege', commander: true });
				step(state, idle, 1 / 60);
				const enemy = state.enemies[0]; if (!enemy) throw new Error('Missing commander');
				expect(getEnemyDefense(state, enemy).enraged).toBe(enraged);
				run(state, 0.3);
				run(state, 4.7, { ...idle, drive: 1 });
				expect({ enraged, direction, integrity: state.player.hp }).toEqual({ enraged, direction, integrity: 100 });
				expect(state.strikes).toHaveLength(0); expect(getEnemyDefense(state, enemy).exposed).toBe(true);
			}
		});
	}

	test('skirmisher mobility, brawler protection and precision cooling change actual combat', function () {
		const warden = isolated('warden'); const kestrel = isolated('kestrel'); const maul = isolated('maul'); const longbow = isolated('longbow');
		for (const state of [warden, kestrel, maul, longbow]) {
			state.player.heat = 80;
			state.shots.push({ x: state.player.x, y: state.player.y, vx: 0, vy: 0, life: 1, kind: 'enemy', target: undefined, damage: 20 });
			run(state, 2, { ...idle, drive: 1, turn: 0.2 });
		}
		expect(kestrel.player.speed).toBeGreaterThan(warden.player.speed);
		expect(kestrel.player.angle).toBeGreaterThan(warden.player.angle);
		expect(maul.player.angle).toBeLessThan(warden.player.angle);
		expect(maul.player.hp).toBeGreaterThan(warden.player.hp);
		expect(kestrel.player.hp).toBeLessThan(warden.player.hp);
		expect(longbow.player.heat).toBeLessThan(warden.player.heat);
		expect(kestrel.player.heat).toBeGreaterThan(warden.player.heat);
		const acceleratedSpeed = kestrel.player.speed;
		run(kestrel, 0.5); expect(kestrel.player.speed).toBeGreaterThan(acceleratedSpeed);
		run(kestrel, 4, { ...idle, stop: true }); expect(kestrel.player.throttle).toBe(0); expect(Math.abs(kestrel.player.speed)).toBeLessThan(0.1);
	});
});
