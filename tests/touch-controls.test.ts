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
	targeting.cycle([contact(1, 100), contact(2, 150)]);
	expect(targeting.resolve([contact(1, 100), contact(2, 150)])?.id).toBe(1);
	targeting.cycle([contact(1, 100), contact(2, 150)]);
	expect(targeting.resolve([contact(1, 100), contact(2, 150)])?.id).toBe(2);
	targeting.select({ x: 350, y: 350 }, [contact(1, 100)]);
	expect(targeting.resolve([contact(1, 100)])).toBeUndefined();
	targeting.cycle([]);
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
	expect(drive.read().drive).toBe(1); expect(drive.read().turn).toBeGreaterThan(0);
	expect(drive.start(20)).toBe(false); drive.move(20, -1, 1); drive.release(20);
	expect(drive.read().drive).toBe(1); expect(drive.read().turn).toBeGreaterThan(0);
	drive.release(10); expect(drive.read()).toEqual({ drive: 0, turn: 0 });
	expect(drive.start(20)).toBe(true); drive.move(20, -1, 1); drive.reset();
	drive.move(20, 1, -1); expect(drive.read()).toEqual({ drive: 0, turn: 0 });
});
