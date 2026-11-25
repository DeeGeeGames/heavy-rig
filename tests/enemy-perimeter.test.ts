import { expect, test } from 'bun:test';
import { advancePerimeterEntry, planPerimeterEntry } from '../src/enemy-perimeter';
import { terrainPathClear, type FieldTerrain } from '../src/field-terrain';
import { ARENA, combatTargets, createState, spawningStep } from '../src/simulation';
import { visibleTouchContacts } from '../src/touch-controls';

test('an incoming vehicle becomes a combat and cockpit target as it crosses the surveyed field boundary', function () {
	const state = createState();
	state.spawned = 2; state.spawnIn = 0;
	spawningStep(state, 2.1);
	const vehicle = state.enemies[0];
	if (!vehicle?.entry) throw new Error('Expected the incoming helicopter');
	const contacts = function () {
		return visibleTouchContacts(state, function () { return { x: 400, y: 300 }; }, 800, 600, []);
	};
	expect(combatTargets(state)).toHaveLength(0);
	expect(contacts()).toHaveLength(0);
	// Retain its ingress order. It can be acquired as soon as its center is on
	// the surveyed surface, before its ordinary flight tactics take over.
	for (let tick = 0; tick < 300 && combatTargets(state).length === 0; tick++) advancePerimeterEntry(vehicle, vehicle.entry, 100, 1 / 60);
	expect(vehicle.x).toBeGreaterThanOrEqual(0); expect(vehicle.x).toBeLessThanOrEqual(ARENA.width);
	expect(vehicle.y).toBeGreaterThanOrEqual(0); expect(vehicle.y).toBeLessThanOrEqual(ARENA.height);
	expect(Math.hypot(vehicle.x - vehicle.entry.x, vehicle.y - vehicle.entry.y)).toBeGreaterThan(30);
	expect(combatTargets(state).map(function (target) { return target.id; })).toEqual([vehicle.id]);
	expect(contacts().map(function (contact) { return contact.id; })).toEqual([vehicle.id]);
});

test('vehicles can cross a blocked or camped perimeter without jumping to the field clamp', function () {
	const field = { width: 2400, height: 1600 };
	const relay = { x: 1200, y: 800 };
	const terrain: FieldTerrain = { roads: [], obstacles: [{ kind: 'shed', x: 2390, y: 800, width: 200, depth: 250, height: 190 }] };
	for (const kind of ['tank', 'helicopter', 'vtol'] as const) {
		const approach = { x: 2000, y: 800, kind };
		const lane = planPerimeterEntry(approach, relay, field, terrain, relay);
		if (!lane) throw new Error('Expected an open crossing around the shed');
		expect(lane.start.x).toBeGreaterThan(field.width);
		expect(terrainPathClear(terrain, lane.start, lane.end, 35)).toBe(true);
		const alternate = planPerimeterEntry(approach, relay, field, terrain, lane.end);
		if (!alternate) throw new Error('Expected an open alternate crossing');
		expect(Math.hypot(alternate.start.x - lane.end.x, alternate.start.y - lane.end.y)).toBeGreaterThan(1000);
		expect(terrainPathClear(terrain, alternate.start, alternate.end, 35)).toBe(true);
		expect(planPerimeterEntry(approach, relay, field, terrain, lane.end)).toEqual(alternate);
		const unit = { ...lane.start };
		expect(advancePerimeterEntry(unit, lane.end, 40, 0.25)).toBe(false);
		expect(Math.hypot(unit.x - lane.start.x, unit.y - lane.start.y)).toBeCloseTo(10);
		expect(unit.x).toBeGreaterThan(field.width);
		expect(advancePerimeterEntry(unit, lane.end, 40, 100)).toBe(true);
		expect(unit).toEqual(lane.end);
		expect(unit.x).toBeLessThan(field.width - 35);
		expect(unit.x).toBeGreaterThan(35);
		expect(unit.y).toBeLessThan(field.height - 35);
		expect(unit.y).toBeGreaterThan(35);
	}
});

test('a sealed perimeter defers a vehicle instead of routing it through terrain', function () {
	const span = 1800;
	const field = { width: span, height: span };
	const center = { x: span / 2, y: span / 2 };
	const terrain: FieldTerrain = {
		roads: [],
		obstacles: [0, span].flatMap(function (edge) {
			return [
				{ x: edge, y: center.y, width: 60, depth: span, kind: 'outcrop' as const, height: 160 },
				{ x: center.x, y: edge, width: span, depth: 60, kind: 'outcrop' as const, height: 160 },
			];
		}),
	};
	expect(planPerimeterEntry({ x: 1500, y: 800, kind: 'tank' }, center, field, terrain, center)).toBeUndefined();
});
