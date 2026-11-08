import { describe, expect, test } from 'bun:test';
import { createState, step, type Controls } from '../src/simulation';
import { getFrame } from '../src/frames';
import { parseProfile } from '../src/profile';

const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 0 }, fire: [false, false, false, false], coolant: false };

describe('control modes', function () {
	test('old and invalid profiles default to Simulation while Arcade survives reload', function () {
		for (const controlMode of [undefined, 'invalid', null]) expect(parseProfile(JSON.stringify({ settings: { controlMode } })).settings.controlMode).toBe('simulation');
		expect(parseProfile(JSON.stringify({ settings: { controlMode: 'arcade' } })).settings.controlMode).toBe('arcade');
	});
	test('rate aiming holds on release and uses each chassis turret speed', function () {
		for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
			const state = createState({ frame }); const angle = state.player.turret;
			step(state, { ...idle, turretTurn: 0.5 }, 1 / 60);
			expect(state.player.turret - angle).toBeCloseTo(getFrame(frame).turretRate / 120);
			const released = state.player.turret;
			step(state, { ...idle, turretTurn: 0 }, 1 / 60);
			expect(state.player.turret).toBe(released);
			step(state, { ...idle, turretTurn: -1 }, 1 / 60);
			expect(state.player.turret - released).toBeCloseTo(-getFrame(frame).turretRate / 60);
		}
	});
	test('Arcade turns toward the shortest heading without exceeding chassis rotation limits', function () {
		for (const frame of ['warden', 'kestrel', 'maul', 'longbow', 'morrow'] as const) {
			const state = createState({ frame }); state.player.angle = Math.PI - 0.1;
			step(state, { ...idle, heading: -Math.PI + 0.1, throttleTarget: 1 }, 1 / 60);
			expect(state.player.angle - (Math.PI - 0.1)).toBeCloseTo(getFrame(frame).turnRate / 60);
			const heading = state.player.angle + 0.001;
			step(state, { ...idle, heading, throttleTarget: 1 }, 1 / 60);
			expect(state.player.angle).toBeCloseTo(heading);
		}
	});
	test('Arcade throttle ramps to demand, decays on release, and stop takes priority', function () {
		const state = createState();
		for (let tick = 0; tick < 100; tick++) step(state, { ...idle, throttleTarget: 0.5 }, 1 / 60);
		expect(state.player.throttle).toBe(0.5);
		step(state, { ...idle, throttleTarget: 0 }, 1 / 60);
		expect(state.player.throttle).toBeCloseTo(0.4875);
		for (let tick = 0; tick < 100; tick++) step(state, { ...idle, throttleTarget: 0 }, 1 / 60);
		expect(state.player.throttle).toBe(0);
		step(state, { ...idle, throttleTarget: 1, stop: true }, 1 / 60);
		expect(state.player.throttle).toBe(0);
	});
});
