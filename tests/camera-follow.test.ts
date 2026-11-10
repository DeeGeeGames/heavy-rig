import { expect, test } from 'bun:test';
import { OrthographicCamera } from 'three';
import { cameraLookAhead, constrainCameraOffset, smoothCameraOffset } from '../src/camera-follow';
import { alignCamera, toGround, toScreen } from '../src/projection-3d';
import { createState } from '../src/simulation';

const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];

test('travel lead follows signed movement while retreating preserves a view toward the guns', function () {
	for (const viewport of viewports) {
		const base = { ...viewport, maxSpeed: 90, turret: 0, pointer: undefined };
		const still = cameraLookAhead({ ...base, velocity: { x: 0, y: 0 } });
		const forward = cameraLookAhead({ ...base, velocity: { x: 90, y: 0 } });
		const reverse = cameraLookAhead({ ...base, velocity: { x: -90, y: 0 } });
		expect(Math.hypot(forward.x, forward.y)).toBeGreaterThan(Math.hypot(still.x, still.y));
		expect(reverse.x).toBeGreaterThan(0); expect(reverse.y).toBeGreaterThan(0);
		const retreat = cameraLookAhead({ ...base, turret: Math.PI, velocity: { x: -90, y: 0 } });
		expect(retreat.x).toBeLessThan(0); expect(retreat.y).toBeLessThan(0);
		for (const offset of [forward, reverse, retreat]) expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(0.18000001);
	}
});

test('mouse lead grows from the centered reference and remains bounded far outside the viewport', function () {
	for (const viewport of viewports) {
		const base = { ...viewport, velocity: { x: 0, y: 0 }, maxSpeed: 90, turret: 0 };
		const center = { x: viewport.width / 2, y: viewport.height * 0.52 };
		const near = cameraLookAhead({ ...base, pointer: center });
		const far = cameraLookAhead({ ...base, pointer: { x: viewport.width, y: center.y } });
		const outside = cameraLookAhead({ ...base, pointer: { x: viewport.width * 10, y: center.y } });
		expect(Math.hypot(near.x, near.y)).toBeLessThan(Math.hypot(far.x, far.y));
		expect(outside).toEqual(far);
	}
});

test('offset easing freezes when paused and produces the same response at different frame rates', function () {
	const desired = { x: 0.15, y: -0.07 }; const start = { x: 0, y: 0 };
	const run = function (hz: number) {
		let offset = start;
		for (let index = 0; index < hz; index++) offset = smoothCameraOffset(offset, desired, 1 / hz);
		return offset;
	};
	const a = run(30); const b = run(144);
	expect(a.x).toBeCloseTo(b.x, 10); expect(a.y).toBeCloseTo(b.y, 10);
	expect(smoothCameraOffset(a, desired, 0)).toEqual(a);
	expect(smoothCameraOffset(a, desired, -1)).toEqual(a);
});

test('camera drift stops before HUD panels and permits movement away from them', function () {
	const panel = { left: 0, right: 400, top: 0, bottom: 900 };
	const radius = { x: 55, y: 100 };
	const offset = constrainCameraOffset({ x: 0.18, y: 0 }, 1000, 900, radius, [panel]);
	expect(500 - offset.x * 1000 - radius.x).toBeGreaterThan(panel.right);
	expect(constrainCameraOffset({ x: -0.18, y: 0 }, 1000, 900, radius, [panel])).toEqual({ x: -0.18, y: 0 });
	const bottom = { left: 0, right: 1000, top: 620, bottom: 900 };
	const downward = constrainCameraOffset({ x: 0, y: -0.18 }, 1000, 900, radius, [bottom]);
	expect(900 * (0.52 - downward.y) + radius.y).toBeLessThan(bottom.top);
});

test('shifted focus preserves ground picking through zoom, resize and screen shake', function () {
	const state = createState(); const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
	for (const { width, height } of viewports) for (const zoom of [0.5, 1, 2.5]) {
		alignCamera(camera, width, height, state, zoom, { x: state.player.x + 120, y: state.player.y - 40 });
		camera.setViewOffset(width, height, -7, 4, width, height);
		const playerScreen = toScreen(state.player, camera, width, height);
		expect(playerScreen.x).not.toBeCloseTo(width / 2);
		for (const point of [state.player, { x: 40, y: 1100 }, { x: 1700, y: 200 }]) {
			const picked = toGround(toScreen(point, camera, width, height), camera, width, height);
			if (!picked) throw new Error('Missing ground intersection');
			expect(picked.x).toBeCloseTo(point.x, 8); expect(picked.y).toBeCloseTo(point.y, 8);
		}
	}
});

// At maximum zoom the original 18% limit alone can clip the rig in a short view.
test('short landscape constrains drift to the rig clearance at maximum zoom', function () {
	const radius = { x: 85, y: 150 };
	for (const offset of [{ x: 0, y: 0.18 }, { x: 0, y: -0.18 }, { x: 0.12, y: 0.12 }]) {
		const limited = constrainCameraOffset(offset, 844, 390, radius, []);
		const ground = { x: 844 * (0.5 - limited.x), y: 390 * (0.52 - limited.y) };
		expect(ground.x - radius.x).toBeGreaterThanOrEqual(0);
		expect(ground.x + radius.x).toBeLessThanOrEqual(844);
		expect(ground.y - radius.y).toBeGreaterThanOrEqual(0);
		expect(ground.y + radius.y).toBeLessThanOrEqual(390);
	}
});
