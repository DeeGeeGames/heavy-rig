import { expect, test } from 'bun:test';
import { Matrix4, OrthographicCamera, Vector3 } from 'three';
import { alignCamera, viewScale } from '../src/projection-3d';
import { createState } from '../src/simulation';
import { inkGrid, minimumInkZoom, selectInkCellSize, setInkClipTransform } from '../src/solid-ink-grid';

test('zoom hysteresis crosses both tier boundaries without oscillating under small reversals', function () {
	const zooms = [0.5, 0.83, 0.84, 0.83, 0.79, 0.78, 1.16, 1.15, 1.11, 1.10, 1.15, 1.16, 0.5];
	const sizes: number[] = [];
	let size = selectInkCellSize(1, 1.5);
	for (const zoom of zooms) {
		size = selectInkCellSize(zoom, size);
		sizes.push(size);
	}
	expect(sizes).toEqual([2, 2, 1.5, 1.5, 1.5, 2, 1, 1, 1, 1.5, 1.5, 1, 2]);
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
			width, height, cell: 1.5 * zoom, minimumCell: 1.5 * minimumInkZoom[1.5],
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

test('a large viewport has a bounded source allocation that stays fixed throughout its tier', function () {
	const width = 7680, height = 4320, maxTextureSize = 4096;
	const minimumCell = 2 * minimumInkZoom[2] * viewScale(width, height);
	const options = { width, height, minimumCell, anchorX: 143.02, anchorY: 919.95, maxTextureSize };
	const far = inkGrid({ ...options, cell: minimumCell });
	const near = inkGrid({ ...options, cell: 1.6 * minimumCell });
	if (!far || !near) throw new Error('Large viewport needs a bounded grid');
	for (const axis of [far.x, far.y]) {
		expect(axis.capacity * 2).toBeLessThanOrEqual(maxTextureSize);
		expect(axis.active).toBeLessThanOrEqual(axis.capacity);
	}
	expect(far.x.capacity * far.y.capacity).toBeLessThan(width * height / 10);
	expect([near.x.capacity, near.y.capacity]).toEqual([far.x.capacity, far.y.capacity]);
	expect(far.x.span / near.x.span).toBeCloseTo(1.6, 8);
	expect(inkGrid({ ...options, cell: minimumCell, width: Infinity })).toBeUndefined();
});
