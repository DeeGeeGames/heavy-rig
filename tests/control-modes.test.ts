import { describe, expect, test } from 'bun:test';
import { createState, movementStep, step, type Controls } from '../src/simulation';
import { getFrame } from '../src/frames';
import { parseProfile } from '../src/profile';

const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 0 }, fire: [false, false, false, false], coolant: false };

describe('control modes', function () {
	test('new, old and invalid profiles default to Arcade while saved choices survive reload', function () {
		expect(parseProfile(null).settings.controlMode).toBe('arcade');
		for (const controlMode of [undefined, 'invalid', null]) expect(parseProfile(JSON.stringify({ settings: { controlMode } })).settings.controlMode).toBe('arcade');
		expect(parseProfile(JSON.stringify({ settings: { controlMode: 'simulation' } })).settings.controlMode).toBe('simulation');
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
	test('Arcade starts sideways on the first tick and coasts on that line when released mid-turn', function () {
		const state = createState(); const p = state.player;
		const start = { x: p.x, y: p.y };
		const right = { ...idle, heading: 0, throttleTarget: 0.5 };
		movementStep(state, right, 1 / 60);
		expect(p.x).toBeGreaterThan(start.x);
		expect(p.y).toBe(start.y);
		expect(p.angle).toBeLessThan(-Math.PI / 3);
		for (let tick = 0; tick < 20; tick++) movementStep(state, right, 1 / 60);
		const released = p.x; const speed = p.speed;
		for (let tick = 0; tick < 180; tick++) movementStep(state, { ...idle, throttleTarget: 0 }, 1 / 60);
		expect(p.x).toBeGreaterThan(released);
		expect(p.y).toBe(start.y);
		expect(p.speed).toBeLessThan(speed * 0.05);
	});
	test('reversing Arcade input brakes through zero on the same line before the legs finish turning', function () {
		const state = createState(); const p = state.player;
		p.angle = 0;
		const y = p.y;
		for (let tick = 0; tick < 240; tick++) movementStep(state, { ...idle, heading: 0, throttleTarget: 1 }, 1 / 60);
		const atFullSpeed = p.x; const fullSpeed = p.speed;
		const left = { ...idle, heading: Math.PI, throttleTarget: 1 };
		movementStep(state, left, 1 / 60);
		expect(p.x).toBeGreaterThan(atFullSpeed);
		expect(p.speed).toBeLessThan(fullSpeed);
		for (let tick = 0; tick < 40; tick++) movementStep(state, left, 1 / 60);
		const turning = p.x; const buildingSpeed = p.speed;
		movementStep(state, left, 1 / 60);
		expect(p.x).toBeLessThan(turning);
		expect(p.speed).toBeGreaterThan(buildingSpeed);
		expect(p.y).toBeCloseTo(y, 8);
		expect(Math.abs(p.angle)).toBeLessThan(Math.PI / 2);
	});
	test('switching from Simulation reverse into Arcade and back preserves the signed hull motion', function () {
		const state = createState(); const p = state.player;
		p.angle = 0; p.throttle = -1; p.speed = -40;
		const start = { x: p.x, y: p.y };
		movementStep(state, { ...idle, heading: Math.PI / 2, throttleTarget: 1 }, 1 / 60);
		expect(p.x).toBeLessThan(start.x);
		expect(p.y).toBeGreaterThan(start.y);
		const changed = { x: p.x, y: p.y };
		movementStep(state, { ...idle, stop: true }, 1 / 60);
		expect(p.speed).toBeLessThan(0);
		expect(p.x).toBeLessThan(changed.x);
		expect((p.y - changed.y) / (p.x - changed.x)).toBeCloseTo(Math.tan(p.angle), 8);
	});
	test('a neutral Arcade input during Simulation reverse cruise keeps the latched throttle in reverse', function () {
		const state = createState(); const p = state.player;
		p.angle = 0; p.throttle = -1; p.speed = -40;
		movementStep(state, { ...idle, throttleTarget: 0 }, 1 / 60);
		const x = p.x; const throttle = p.throttle;
		for (let tick = 0; tick < 90; tick++) movementStep(state, idle, 1 / 60);
		expect(p.throttle).toBe(throttle);
		expect(throttle).toBeLessThan(0);
		expect(p.speed).toBeLessThan(0);
		expect(p.x).toBeLessThan(x);
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
