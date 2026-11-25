import { expect, test } from 'bun:test';
import { Matrix4, OrthographicCamera, Vector3 } from 'three';
import { alignCamera } from '../src/projection-3d';
import { createState } from '../src/simulation';
import { battlefieldInkCells, inkGrid, setInkClipTransform } from '../src/solid-ink-grid';

test('battlefield ink matches a two-metre terrain texel from wide view to close zoom', function () {
	const camera = new OrthographicCamera();
	const state = createState();
	const start = new Vector3(state.player.x, 50.875, state.player.y);
	for (const [width, height] of [[1440, 900], [390, 844]] as const) {
		for (const zoom of [0.35, 0.64, 1, 1.55, 2.5]) {
			alignCamera(camera, width, height, state, zoom);
			// Compare to the screen projection of a terrain texel measured along
			// the camera's fixed horizontal axis, not to a preset screen size.
			const end = new Vector3(2, 0, 0).applyQuaternion(camera.quaternion).add(start);
			const terrainPitch = (end.project(camera).x - start.clone().project(camera).x) * width / 2;
			const grid = inkGrid({ width, height, ...battlefieldInkCells(camera, width, zoom), anchorX: 0, anchorY: 0, maxTextureSize: 8192 });
			if (!grid) throw new Error('Missing battlefield ink grid');
			expect(width / grid.x.span).toBeCloseTo(terrainPitch, 8);
			expect(height / grid.y.span).toBeCloseTo(terrainPitch, 8);
		}
	}
});

test('camera look-ahead, zoom and shake preserve the tracked mech grid and display depth', function () {
	const width = 1100, height = 740;
	const state = createState();
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
	const projections = [0.79, 1, 1.15].map(function (zoom, index) {
		state.player.x += 13.35;
		state.player.y -= 8.75;
		alignCamera(camera, width, height, state, zoom, { x: state.player.x + index * 45, y: state.player.y - index * 21 });
		camera.setViewOffset(width, height, 1.23 * index, -2.88 * index, width, height);
		const anchor = new Vector3(state.player.x, 50.875, state.player.y).project(camera);
		const armor = new Vector3(state.player.x + 10.3, 77.2, state.player.y - 16.7).project(camera);
		const grid = inkGrid({
			width, height, ...battlefieldInkCells(camera, width, zoom),
			anchorX: (anchor.x + 1) * width / 2, anchorY: (anchor.y + 1) * height / 2, maxTextureSize: 8192,
		});
		if (!grid) throw new Error('Missing ink grid');
		const crop = setInkClipTransform(new Matrix4(), grid);
		const rasterAnchor = anchor.applyMatrix4(crop);
		const rasterArmor = armor.clone().applyMatrix4(crop);
		const x = (rasterAnchor.x + 1) * grid.x.active / 2, y = (rasterAnchor.y + 1) * grid.y.active / 2;
		expect(x).toBeCloseTo(Math.round(x), 8);
		expect(y).toBeCloseTo(Math.round(y), 8);
		expect(rasterArmor.z).toBeCloseTo(armor.z, 12);
		// Sampling the repaired texture at the native point must read the
		// exact cell rasterized there, even when the active viewport shrinks.
		expect(((armor.x + 1) * grid.x.span / 2 + grid.x.offset) / grid.x.capacity)
			.toBeCloseTo((rasterArmor.x + 1) * grid.x.active / (2 * grid.x.capacity), 12);
		expect(((armor.y + 1) * grid.y.span / 2 + grid.y.offset) / grid.y.capacity)
			.toBeCloseTo((rasterArmor.y + 1) * grid.y.active / (2 * grid.y.capacity), 12);
		return {
			x: (rasterArmor.x - rasterAnchor.x) * grid.x.active / 2,
			y: (rasterArmor.y - rasterAnchor.y) * grid.y.active / 2,
			capacity: [grid.x.capacity, grid.y.capacity],
			activeWidth: grid.x.active,
		};
	});
	const [first, middle, last] = projections;
	if (!first || !middle || !last) throw new Error('Missing projection samples');
	for (const frame of [middle, last]) {
		expect(frame.x).toBeCloseTo(first.x, 8);
		expect(frame.y).toBeCloseTo(first.y, 8);
		expect(frame.capacity).toEqual(first.capacity);
	}
	expect(last.activeWidth).toBeLessThan(first.activeWidth);
});

test('large viewports bound wide-view allocation without coarsening a closer view that fits', function () {
	const width = 7680, height = 4320, maxTextureSize = 4096;
	const camera = new OrthographicCamera();
	const state = createState();
	alignCamera(camera, width, height, state, 0.5);
	const farCells = battlefieldInkCells(camera, width, 0.5);
	alignCamera(camera, width, height, state, 2.5);
	const nearCells = battlefieldInkCells(camera, width, 2.5);
	const options = { width, height, anchorX: 143.02, anchorY: 919.95, maxTextureSize };
	const far = inkGrid({ ...options, ...farCells });
	const near = inkGrid({ ...options, ...nearCells });
	if (!far || !near) throw new Error('Large viewport needs a bounded grid');
	for (const axis of [far.x, far.y]) {
		expect(axis.capacity * 2).toBeLessThanOrEqual(maxTextureSize);
		expect(axis.active).toBeLessThanOrEqual(axis.capacity);
	}
	expect(far.x.capacity * far.y.capacity).toBeLessThanOrEqual(1_600_000);
	expect([near.x.capacity, near.y.capacity]).toEqual([far.x.capacity, far.y.capacity]);
	expect(width / far.x.span).toBeGreaterThan(farCells.cell);
	expect(width / near.x.span).toBeCloseTo(nearCells.cell, 8);
	expect(inkGrid({ ...options, ...farCells, width: Infinity })).toBeUndefined();
});
