import { expect, test } from 'bun:test';
import { OrthographicCamera, Vector3 } from 'three';
import { createState } from '../src/simulation';
import { alignCamera, toGround, toScreen } from '../src/projection-3d';
import { createFieldTrial } from '../src/field-trial';
import type { FieldTerrain } from '../src/field-terrain';
import { groundHeight } from '../src/terrain-elevation';

test('zoom keeps the frame anchored and aiming accurate across viewports and camera positions', function () {
	for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
		if (!width || !height) throw new Error('Invalid test viewport');
		const state = createState();
		for (const location of [{ x: 900, y: 780 }, { x: 40, y: 1100 }]) {
			state.player.x = location.x; state.player.y = location.y;
			const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
			alignCamera(camera, width, height, state);
			const offsetPoint = { x: location.x + 100, y: location.y };
			const base = toScreen(offsetPoint, camera, width, height);
			for (const zoom of [0.5, 1, 2.5]) {
				alignCamera(camera, width, height, state, zoom);
				const anchor = toScreen(location, camera, width, height);
				expect(anchor.x).toBeCloseTo(width / 2, 8); expect(anchor.y).toBeCloseTo(height * 0.52, 8);
				const offset = toScreen(offsetPoint, camera, width, height);
				expect(offset.x - anchor.x).toBeCloseTo((base.x - anchor.x) * zoom, 8);
				for (const point of [{ x: 0, y: 0 }, { x: 1800, y: 1200 }, location]) {
					const result = toGround(toScreen(point, camera, width, height), camera, width, height);
					if (!result) throw new Error('Missing ground intersection');
					expect(result.x).toBeCloseTo(point.x, 8); expect(result.y).toBeCloseTo(point.y, 8);
				}
			}
		}
	}
});

test('picking follows the active shaken projection and ignores empty viewports', function () {
	const state = createState(); const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
	alignCamera(camera, 1440, 900, state, 2.5); camera.setViewOffset(1440, 900, -7, 4, 1440, 900);
	const point = { x: 980, y: 400 }; const screen = toScreen(point, camera, 1440, 900);
	const actual = toGround(screen, camera, 1440, 900); if (!actual) throw new Error('Missing ground intersection');
	expect(actual.x).toBeCloseTo(point.x, 8); expect(actual.y).toBeCloseTo(point.y, 8);
	expect(toGround(screen, camera, 0, 900)).toBeUndefined(); expect(toGround(screen, camera, 1440, 0)).toBeUndefined();
});

test('wide portrait views render and pick ground at both screen edges', function () {
	const state = createState();
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
	const width = 1024, height = 1366;
	alignCamera(camera, width, height, state, 0.35);
	for (const y of [1, height - 1]) {
		const ground = toGround({ x: width / 2, y }, camera, width, height);
		if (!ground) throw new Error('Visible ground fell behind the camera');
		const clip = new Vector3(ground.x, 0, ground.y).project(camera);
		expect(clip.z).toBeGreaterThan(-1); expect(clip.z).toBeLessThan(1);
		expect(toScreen(ground, camera, width, height).y).toBeCloseTo(y, 8);
	}
});

test('camera focus and cursor picking follow the visible hillside across zooms, including an occluded valley', function () {
	const terrain: FieldTerrain = { roads: [], obstacles: [], elevation: { xs: [0, 40, 60, 80, 200], ys: [0, 200],
		heights: new Float32Array([0, 0, 80, 0, 0, 0, 0, 80, 0, 0]), minHeight: 0, maxHeight: 80 } };
	const state = createFieldTrial(283191706);
	if (!state.mission) throw new Error('Missing field trial');
	state.mission.map = { ...state.mission.map, terrain };
	state.player.x = 65; state.player.y = 65;
	const camera = new OrthographicCamera();
	for (const [width, height, zoom] of [[390, 844, .35], [1440, 900, 2.5]] as const) {
		camera.clearViewOffset(); alignCamera(camera, width, height, state, zoom);
		const focus = toScreen(state.player, camera, width, height, groundHeight(terrain, state.player));
		expect(focus.x).toBeCloseTo(width / 2, 8); expect(focus.y).toBeCloseTo(height * .52, 8);
		camera.setViewOffset(width, height, -7, 3, width, height);
		// The valley floor at (40,40,0) is directly behind the near face at (72,72,32).
		const screen = toScreen({ x: 40, y: 40 }, camera, width, height);
		const near = toGround(screen, camera, width, height, terrain);
		expect(near?.x).toBeCloseTo(72, 8); expect(near?.y).toBeCloseTo(72, 8);
	}
});
