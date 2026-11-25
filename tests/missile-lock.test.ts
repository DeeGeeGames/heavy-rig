import { expect, test } from 'bun:test';
import { createMount } from '../src/arsenal';
import { createState, coolingStep, weaponsStep, projectilesStep, missileTracking, missileLockLabel, type Controls, type Unit } from '../src/simulation';

const dt = 1 / 60;
const target = function (id: number, x: number, y: number): Unit { return { id, x, y, kind: 'striker', hp: 1000, maxHp: 1000, angle: 0, cooldown: 999, heavy: false }; };
const setup = function () {
	const state = createState({ frame: 'morrow' }); state.player.angle = 0; state.player.turret = 0;
	const first = target(101, state.player.x + 400, state.player.y); const second = target(102, state.player.x + 400, state.player.y + 150);
	state.enemies = [first, second];
	const controls: Controls = { drive: 0, turn: 0, stop: false, aim: first, targetId: first.id, fire: [false, false, false, false], coolant: false };
	return { state, first, second, controls };
};
const track = function (state: ReturnType<typeof createState>, controls: Controls, ticks: number) { for (let tick = 0; tick < ticks; tick++) weaponsStep(state, controls, dt); };

test('selected tracking gates spending, holds for grace, decays, and never transfers acquisition between targets', function () {
	const { state, first, second, controls } = setup();
	const supplies = JSON.stringify(state.loadout);
	track(state, { ...controls, fire: [true, false, false, false] }, 60);
	expect(state.shots).toHaveLength(0); expect(state.player.heat).toBe(0); expect(JSON.stringify(state.loadout)).toBe(supplies);
	expect(state.player.missileLock?.progress).toBeCloseTo(2 / 3);
	first.x = state.player.x - 400;
	track(state, controls, 18); expect(state.player.missileLock?.progress).toBeCloseTo(2 / 3);
	track(state, controls, 9); expect(state.player.missileLock?.progress).toBeCloseTo(2 / 3 - 0.1);
	expect(missileTracking(state, first.id)).toBe('OUT OF ARC');
	first.x = state.player.x + 400;
	track(state, controls, 60); expect(missileLockLabel(state, first.id)).toContain('LOCKED');
	track(state, { ...controls, targetId: second.id }, 1); expect(state.player.missileLock?.targetId).toBe(second.id); expect(state.player.missileLock?.progress).toBeCloseTo(1 / 90);
	track(state, controls, 1); expect(state.player.missileLock?.progress).toBeCloseTo(1 / 90);
});

test('visibility and range interrupt acquisition, reload stays independent, and launched guidance survives selection loss', function () {
	const { state, first, second, controls } = setup();
	const blocker = target(103, state.player.x + 200, state.player.y); state.enemies.push(blocker);
	track(state, controls, 90); expect(missileTracking(state, first.id)).toBe('BLOCKED'); expect(state.player.missileLock?.progress).toBe(0);
	blocker.y += 200;
	first.x += 2000; track(state, controls, 90); expect(missileTracking(state, first.id)).toBe('OUT OF RANGE'); expect(state.player.missileLock?.progress).toBe(0);
	first.x -= 2000;
	const mount = state.loadout[0]; if (!mount) throw new Error('Missing mount'); mount.cooldown = 2;
	track(state, controls, 90); expect(state.player.missileLock?.progress).toBeCloseTo(1); expect(mount.cooldown).toBe(2);
	weaponsStep(state, { ...controls, fire: [true, false, false, false] }, dt); expect(state.shots).toHaveLength(0);
	coolingStep(state, controls, 2); weaponsStep(state, { ...controls, fire: [true, false, false, false] }, dt);
	const missile = state.shots[0]; if (!missile) throw new Error('Missing locked missile'); expect(missile.target).toBe(first.id);
	track(state, { ...controls, targetId: second.id }, 1); track(state, { drive: 0, turn: 0, stop: false, aim: first, fire: [false, false, false, false], coolant: false }, 1);
	first.y += 180; const before = missile.vy; projectilesStep(state, 0.05);
	expect(missile.target).toBe(first.id); expect(missile.vy).toBeGreaterThan(before); expect(state.player.missileLock).toBeUndefined();
});

test.each([15, 30])('standard missiles lock and hit at 2,000 m on a %i° bearing while rockets fall short', function (degrees) {
	const bearing = degrees * Math.PI / 180;
	for (const [missile, rocket] of [['stream-missiles', 'stream-rockets'], ['cluster-missiles', 'cluster-rockets']] as const) {
		const state = createState({ frame: 'warden' });
		Object.assign(state.player, { x: 32, y: 80, angle: bearing, turret: bearing });
		state.loadout = [{ ...createMount(missile), slot: 2 }, { ...createMount(rocket), slot: 3 }];
		const contact = target(101, state.player.x + 2001 * Math.cos(bearing), state.player.y + 2001 * Math.sin(bearing));
		state.enemies = [contact];
		const controls: Controls = { drive: 0, turn: 0, stop: false, aim: contact, targetId: contact.id, fire: [false, false, false, false], coolant: false };
		expect(missileTracking(state, contact.id)).toBe('OUT OF RANGE');
		contact.x = state.player.x + 2000 * Math.cos(bearing);
		contact.y = state.player.y + 2000 * Math.sin(bearing);
		expect(missileTracking(state, contact.id)).toBe('TRACKING');
		weaponsStep(state, { ...controls, fire: [false, false, true, true] }, dt);
		expect(state.shots.map(function (shot) { return shot.kind; })).toEqual(['rocket']);
		const advance = function (ticks: number) {
			for (let tick = 0; tick < ticks; tick++) { weaponsStep(state, controls, dt); projectilesStep(state, dt); }
		};
		advance(90);
		expect(state.shots).toHaveLength(0); expect(contact.hp).toBe(contact.maxHp);
		expect(missileLockLabel(state, contact.id)).toContain('LOCKED');
		weaponsStep(state, { ...controls, fire: [false, false, true, false] }, dt);
		advance(120);
		expect(state.stats.shotsHit).toBe(2); expect(contact.hp).toBeLessThan(contact.maxHp);
	}
});
