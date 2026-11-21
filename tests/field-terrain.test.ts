import { expect, test } from 'bun:test';
import { createFieldTrial } from '../src/field-trial';
import { moveOnTerrain, terrainPathClear, terrainShotFraction, terrainWaypoint, type FieldTerrain } from '../src/field-terrain';
import { CAPTURE_RADIUS, EXTRACTION_RADIUS } from '../src/missions';
import { distance } from '../src/simulation';

test('generated approaches remain wide enough for rigs and every actor deploys on accessible ground', function () {
	const first = createFieldTrial(283191706);
	expect(createFieldTrial(283191706).mission?.map).toEqual(first.mission?.map);
	const layouts = new Set<string>();
	for (let index = 0; index < 96; index++) {
		const state = createFieldTrial(Math.imul(index, 0x9e3779b1) >>> 0); const map = state.mission?.map;
		if (!map?.terrain) throw new Error('Missing trial terrain');
		const terrain = map.terrain;
		layouts.add(JSON.stringify(terrain.obstacles));
		for (const [i, a] of terrain.obstacles.entries()) for (const b of terrain.obstacles.slice(i + 1)) {
			expect(Math.abs(a.x - b.x) > (a.width + b.width) / 2 || Math.abs(a.y - b.y) > (a.depth + b.depth) / 2).toBe(true);
		}
		for (const start of [state.player, ...state.squadmates, ...state.enemies]) expect(terrainPathClear(terrain, start, start, 30)).toBe(true);
		expect(terrainPathClear(terrain, map.objective, map.objective, CAPTURE_RADIUS)).toBe(true);
		expect(terrainPathClear(terrain, map.extraction, map.extraction, EXTRACTION_RADIUS)).toBe(true);
		expect(terrain.roads.length).toBeGreaterThanOrEqual(2);
		for (const road of terrain.roads) {
			expect(road[0]).toEqual(map.drop); expect(road.at(-1)).toEqual(map.objective);
			for (const [i, point] of road.entries()) {
				const previous = road[i - 1];
				if (previous) expect(terrainPathClear(terrain, previous, point, 35)).toBe(true);
			}
		}
		let at = map.objective;
		for (let tick = 0; tick < 250 && distance(at, map.extraction) > 1; tick++) {
			const next = terrainWaypoint(terrain, at, map.extraction, 27);
			const scale = Math.min(1, 20 / Math.max(.001, distance(at, next)));
			at = moveOnTerrain(terrain, at, { x: at.x + (next.x - at.x) * scale, y: at.y + (next.y - at.y) * scale }, 27);
			if (at.x < 35 || at.x > map.width - 35 || at.y < 35 || at.y > map.height - 35) throw new Error('Routed outside the mission boundary');
		}
		expect(distance(at, map.extraction)).toBeLessThan(1);
	}
	expect(layouts.size).toBe(96);
});

test('a rig slides along a fissure and stops against a second bank without tunnelling', function () {
	const terrain: FieldTerrain = { roads: [], obstacles: [
		{ kind: 'fissure', x: 100, y: 100, width: 30, depth: 180, height: 0 },
		{ kind: 'fissure', x: 40, y: 155, width: 120, depth: 20, height: 0 },
	] };
	const slide = moveOnTerrain(terrain, { x: 0, y: 30 }, { x: 300, y: 100 }, 10);
	expect(slide.x).toBeCloseTo(75, 2); expect(slide.y).toBeCloseTo(100);
	const corner = moveOnTerrain(terrain, { x: 0, y: 30 }, { x: 300, y: 260 }, 10);
	expect(corner.x).toBeCloseTo(75, 2); expect(corner.y).toBeCloseTo(135, 2);
	expect(terrainShotFraction(terrain, { x: 0, y: 30, elevation: 10 }, { x: 300, y: 100, elevation: 1 })).toBeUndefined();
});
