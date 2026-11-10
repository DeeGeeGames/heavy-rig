import { expect, test } from 'bun:test';
import { createTouchDrive, createTouchTargeting, visibleTouchContacts, type TouchContact } from '../src/touch-controls';
import { createMissionState, type Point } from '../src/simulation';
import { FACILITY_TARGET_ID } from '../src/missions';

const contact = function (id: number, x: number): TouchContact { return { id, point: { x, y: 100 }, screen: { x, y: 100 }, label: 'SCOUT' }; };

test('touch lock follows identity, clears on empty ground or contact loss, and never transfers silently', function () {
	const targeting = createTouchTargeting();
	targeting.select({ x: 100, y: 100 }, [contact(1, 100), contact(2, 150)]);
	expect(targeting.resolve([contact(1, 140), contact(2, 100)])?.point.x).toBe(140);
	expect(targeting.resolve([contact(2, 100)])).toBeUndefined();
	expect(targeting.resolve([contact(1, 100), contact(2, 150)])).toBeUndefined();
	targeting.cycle([contact(1, 100), contact(2, 150)], { x: 0, y: 100 });
	expect(targeting.resolve([contact(1, 100), contact(2, 150)])?.id).toBe(1);
	targeting.cycle([contact(1, 100), contact(2, 150)], { x: 0, y: 100 });
	expect(targeting.resolve([contact(1, 100), contact(2, 150)])?.id).toBe(2);
	targeting.select({ x: 350, y: 350 }, [contact(1, 100)]);
	expect(targeting.resolve([contact(1, 100)])).toBeUndefined();
	targeting.cycle([], { x: 0, y: 0 });
	expect(targeting.resolve([])).toBeUndefined();
});

test('touch acquisition excludes dead, offscreen and HUD-obscured contacts, and picks aircraft at their visible elevation', function () {
	const state = createMissionState({ id: 'touch-facility', seed: 123, planetId: 'meridian', kind: 'demolition', employer: 'freeholds', opponent: 'combine', title: 'Facility', briefing: '', reward: 100, favor: 1, hostility: 1, tier: 1, requiredReputation: 0 });
	state.enemies = [
		{ id: 1, x: 100, y: 200, angle: 0, hp: 100, maxHp: 100, cooldown: 1, heavy: false, kind: 'helicopter' },
		{ id: 2, x: 200, y: 200, angle: 0, hp: 0, maxHp: 100, cooldown: 1, heavy: false, kind: 'scout' },
		{ id: 3, x: 300, y: 200, angle: 0, hp: 100, maxHp: 100, cooldown: 1, heavy: false, kind: 'scout' },
		{ id: 4, x: 600, y: 200, angle: 0, hp: 100, maxHp: 100, cooldown: 1, heavy: false, kind: 'scout' },
	];
	const facility = state.mission?.structure;
	if (!facility) throw new Error('Expected demolition facility');
	facility.x = 400; facility.y = 200;
	const project = function (point: Point, elevation: number) { return { x: point.x, y: point.y - elevation }; };
	const obstructions = [{ left: 270, right: 330, top: 120, bottom: 200 }];
	const contacts = visibleTouchContacts(state, project, 500, 400, obstructions);
	expect(contacts.map(function (entry) { return entry.id; }).sort()).toEqual([FACILITY_TARGET_ID, 1].sort());
	expect(contacts.find(function (entry) { return entry.id === 1; })?.screen).toEqual({ x: 100, y: 88 });
	const targeting = createTouchTargeting(); targeting.select({ x: 400, y: 155 }, contacts);
	expect(targeting.resolve(contacts)?.id).toBe(FACILITY_TARGET_ID);
	facility.hp = 0;
	expect(targeting.resolve(visibleTouchContacts(state, project, 500, 400, obstructions))).toBeUndefined();
});

test('a second touch cannot take over or release the drive stick, and cancellation clears its demand', function () {
	const drive = createTouchDrive();
	expect(drive.start(10)).toBe(true); drive.move(10, .6, -1);
	expect(drive.read().drive).toBeGreaterThan(0); expect(drive.read().turn).toBeGreaterThan(0);
	expect(drive.start(20)).toBe(false); drive.move(20, -1, 1); drive.release(20);
	expect(drive.read().drive).toBeGreaterThan(0); expect(drive.read().turn).toBeGreaterThan(0);
	drive.release(10); expect(drive.read()).toEqual({ drive: 0, turn: 0 });
	expect(drive.start(20)).toBe(true); drive.move(20, -1, 1); drive.reset();
	drive.move(20, 1, -1); expect(drive.read()).toEqual({ drive: 0, turn: 0 });
});

test('touch stick preserves diagonal heading with a radial dead zone and proportional speed', function () {
	const stick = createTouchDrive(); stick.start(1);
	stick.move(1, .1, -.1); expect(stick.read()).toEqual({ drive: 0, turn: 0 });
	stick.move(1, .3, -.4);
	const half = stick.read();
	expect(Math.hypot(half.turn, half.drive)).toBeCloseTo((.5 - .18) / .82);
	expect(half.turn / half.drive).toBeCloseTo(.75);
	stick.move(1, 3, -4);
	const full = stick.read();
	expect(Math.hypot(full.turn, full.drive)).toBeCloseTo(1);
	expect(full.turn / full.drive).toBeCloseTo(.75);
	stick.move(1, 0, 1); expect(stick.read()).toEqual({ drive: -1, turn: 0 });
	stick.move(1, 0, 0); expect(stick.read()).toEqual({ drive: 0, turn: 0 });
});

// Distance ordering must ignore spawn IDs and screen projection, and refresh as contacts move.
test('nearest and next use current world distance with wraparound and stable ties', function () {
	const targeting = createTouchTargeting(); const origin = { x: 0, y: 100 };
	const contacts = [contact(1, 300), contact(9, 100), contact(3, 200)];
	targeting.nearest(contacts, origin); expect(targeting.resolve(contacts)?.id).toBe(9);
	targeting.cycle(contacts, origin); expect(targeting.resolve(contacts)?.id).toBe(3);
	targeting.cycle(contacts, origin); expect(targeting.resolve(contacts)?.id).toBe(1);
	targeting.cycle(contacts, origin); expect(targeting.resolve(contacts)?.id).toBe(9);
	const moved = [contact(1, 50), contact(9, 250), contact(3, 200)];
	targeting.cycle(moved, origin); expect(targeting.resolve(moved)?.id).toBe(1);
	targeting.cycle([contact(9, 100), contact(3, 100)], origin); expect(targeting.resolve(contacts)?.id).toBe(3);
	targeting.nearest([], origin); expect(targeting.resolve(contacts)).toBeUndefined();
});

test('cruise retains demand after release, supports adjustment, and stop prevents resuming stale movement', function () {
	const stick = createTouchDrive(); stick.start(1); stick.move(1, .6, -.8);
	stick.toggleCruise(); const held = stick.read(); stick.release(1); expect(stick.read()).toEqual(held);
	stick.release(2); expect(stick.read()).toEqual(held);
	stick.start(2); stick.move(2, -1, 0); stick.release(2); expect(stick.read().turn).toBe(-1); expect(stick.read().drive).toBeCloseTo(0);
	stick.stop(); expect(stick.read()).toEqual({ turn: 0, drive: 0 }); expect(stick.isCruising()).toBe(true);
	stick.move(2, 0, -1); expect(stick.read()).toEqual({ turn: 0, drive: 0 });
	stick.start(3); stick.move(3, 0, -1); stick.release(3); stick.toggleCruise(); expect(stick.read()).toEqual({ turn: 0, drive: 0 });
	stick.start(4); stick.move(4, 0, -1); stick.toggleCruise(); stick.reset();
	expect(stick.isCruising()).toBe(false); expect(stick.read()).toEqual({ turn: 0, drive: 0 });
});

test('only the owning pointer can cancel Cruise while driving', function () {
	const stick = createTouchDrive(); stick.start(1); stick.move(1, 0, -1); stick.toggleCruise();
	stick.cancel(2); expect(stick.isCruising()).toBe(true); expect(stick.read().drive).toBe(1);
	stick.cancel(1); expect(stick.isCruising()).toBe(false); expect(stick.read()).toEqual({ drive: 0, turn: 0 });
});
