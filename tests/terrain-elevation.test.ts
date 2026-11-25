import { expect, test } from 'bun:test';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createFieldTrial } from '../src/field-trial';
import { moveOnTerrain, terrainPathClear, type FieldTerrain } from '../src/field-terrain';
import { createCutGround, createFieldStructures } from '../src/field-terrain-3d';
import { generateMissionMap } from '../src/missions';
import { groundContact, groundHeight } from '../src/terrain-elevation';
import type { Point } from '../src/simulation';

test('a shot can strike a ridge inside a single terrain cell even when both endpoints clear it', function () {
	const terrain: FieldTerrain = { roads: [], obstacles: [],
		elevation: { xs: [0, 100], ys: [0, 100], heights: new Float32Array([0, 0, 0, 80]), minHeight: 0, maxHeight: 80 } };
	const from = { x: 0, y: 100, elevation: 10 }, to = { x: 100, y: 0, elevation: 10 };
	for (const [a, b] of [[from, to], [to, from]] as const) {
		expect(groundHeight(terrain, a)).toBe(0); expect(groundHeight(terrain, b)).toBe(0);
		const hit = groundContact(terrain, a, b);
		if (!hit) throw new Error('Missed the rising face of the ridge');
		expect(hit.fraction).toBeCloseTo(.125, 8);
		expect(hit.normal.elevation).toBeCloseTo(1 / Math.hypot(.8, 1), 8);
		expect(groundContact(terrain, { ...a, elevation: 45 }, { ...b, elevation: 45 })).toBeUndefined();
	}
	const touchdown = { x: 40, y: 65, elevation: 32 };
	expect(groundHeight(terrain, touchdown)).toBe(32);
	expect(groundContact(terrain, touchdown, { ...touchdown, elevation: 70 })).toBeUndefined();
	expect(groundContact(terrain, touchdown, { ...touchdown, elevation: -10 })?.fraction).toBe(0);
});

test('the fixed Cinder survey has a connected downhill, valley-floor and uphill route distinct from its sheer fissures', function () {
	const map = createFieldTrial(283191706).mission?.map;
	if (!map?.terrain) throw new Error('Cinder field missing');
	const terrain = map.terrain;
	const route = [{ x: 1887, y: 1330 }, { x: 1598, y: 1574 }, { x: 1442, y: 1405 }, { x: 1286, y: 1236 }, { x: 997, y: 1480 }] as const;
	const [start, , floor, , end] = route;
	expect(groundHeight(terrain, start) - groundHeight(terrain, floor)).toBeGreaterThan(80);
	expect(groundHeight(terrain, end) - groundHeight(terrain, floor)).toBeGreaterThan(80);
	for (const [i, p] of route.entries()) {
		const previous = route[i - 1];
		if (previous) {
			expect(terrainPathClear(terrain, previous, p, 32)).toBe(true);
			expect(moveOnTerrain(terrain, previous, p, 32)).toEqual(p);
		}
	}
	const cut = terrain.obstacles.find(function (o) { return o.kind === 'fissure'; });
	if (!cut) throw new Error('Cinder fissure missing');
	const rim = { x: cut.x + cut.width / 2, y: cut.y };
	expect(groundHeight(terrain, rim) - groundHeight(terrain, cut)).toBeGreaterThan(40);
	const material = new MeshBasicMaterial({ side: DoubleSide });
	const surface = new Mesh(createCutGround(map, terrain), material);
	surface.rotation.x = -Math.PI / 2; surface.position.set(map.width / 2, -.03, map.height / 2); surface.updateMatrixWorld();
	const field = createFieldStructures(terrain, map.seed, map.biome); field.root.updateMatrixWorld();
	const fissures = field.root.getObjectByName('basalt-fissures');
	if (!fissures) throw new Error('Rendered fissure missing');
	try {
		const probes: Point[] = [...route, { x: rim.x - 2.3, y: rim.y + 15.7 }, { x: rim.x + 3.4, y: rim.y + 15.7 }, cut, map.drop];
		for (const p of probes) {
			const x = p.x + .13, y = p.y + .27;
			const ray = new Raycaster(new Vector3(x, 500, y), new Vector3(0, -1, 0));
			const intersection = ray.intersectObjects([surface, fissures])[0];
			if (!intersection) throw new Error('Hole in the rendered field');
			const ground = groundHeight(terrain, { x, y });
			expect(intersection.point.y + .03).toBeCloseTo(ground, 3);
			const hit = groundContact(terrain, { x, y, elevation: 500 }, { x, y, elevation: -500 });
			if (!hit) throw new Error('Missing ground contact');
			expect(500 - hit.fraction * 1000).toBeCloseTo(ground, 6);
		}
	} finally { surface.geometry.dispose(); material.dispose(); field.dispose(); }
});

test('rigid foundations beside graded clearings stay level across their entire footprint', function () {
	const contract = createFieldTrial(24).mission?.contract;
	if (!contract) throw new Error('Missing field contract');
	for (const planetId of ['cinder', 'galeward'] as const) {
		const terrain = generateMissionMap({ ...contract, seed: 24, planetId, kind: 'raid' }).terrain;
		if (!terrain) throw new Error('Missing field terrain');
		const footings = terrain.obstacles.filter(function (obstacle) { return obstacle.kind === 'shed' || obstacle.kind === 'turbine'; });
		expect(footings.length).toBeGreaterThan(0);
		for (const o of footings) {
			const base = groundHeight(terrain, o);
			for (const u of [-.5, -.25, 0, .25, .5]) for (const v of [-.5, -.25, 0, .25, .5]) {
				expect(groundHeight(terrain, { x: o.x + u * o.width, y: o.y + v * o.depth })).toBeCloseTo(base, 4);
			}
		}
	}
});
