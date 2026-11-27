import { expect, test } from 'bun:test';
import { OrthographicCamera } from 'three';
import { cameraLookAhead, constrainCameraOffset, smoothCameraOffset, weaponCameraKick } from '../src/camera-follow';
import { alignCamera, toGround, toScreen } from '../src/projection-3d';
import { createState, type Effect } from '../src/simulation';

const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];

test('blast kick follows the pilot’s position, stays bounded across overlapping salvos, and settles', function () {
	const impact: Effect = { x: 100, y: 100, life: 0.75, size: 12, color: '#fff', feedback: {
		type: 'impact', family: 'rocket', surface: 'ground', heavy: true, time: 2, shooter: 1, direction: { x: 0, y: 0, elevation: -1 },
	} };
	const salvo = Array.from({ length: 18 }, function () { return impact; });
	const near = { x: 125, y: 75 };
	const single = weaponCameraKick([impact], near, 2);
	const peak = weaponCameraKick(salvo, near, 2);
	expect(single.x).toBeLessThan(0); expect(peak.x).toBeLessThan(single.x);
	expect(Math.abs(peak.x)).toBeLessThan(2 * Math.abs(single.x));
	expect(weaponCameraKick(salvo, { x: 75, y: 125 }, 2).x).toBeCloseTo(-peak.x);
	expect(weaponCameraKick(salvo, { x: 1100, y: 1100 }, 2)).toEqual({ x: 0, y: 0 });
	expect(weaponCameraKick(salvo, near, 3)).toEqual({ x: 0, y: 0 });
});

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
		expect(Math.hypot(reverse.x, reverse.y)).toBeCloseTo(0.02);
	}
});

test('aligned travel gets up to five extra points of lead, fading with speed and ground angle', function () {
	for (const viewport of viewports) {
		const base = { ...viewport, maxSpeed: 100, pointer: undefined };
		const headOn = -Math.PI / 4;
		const travel = Math.SQRT1_2 * base.maxSpeed;
		const lead = function (turret: number, fraction: number, pointer?: { x: number; y: number }) {
			const velocity = { x: travel * fraction, y: -travel * fraction };
			const moving = cameraLookAhead({ ...base, turret, velocity, pointer });
			const still = cameraLookAhead({ ...base, turret, velocity: { x: 0, y: 0 }, pointer });
			return moving.x - still.x;
		};
		expect(lead(headOn, 1)).toBeCloseTo(0.13, 8);
		expect(lead(headOn, 0.5)).toBeCloseTo(0.065, 8);
		expect(lead(headOn, 0)).toBe(0);
		const angled = lead(headOn + Math.PI / 8, 1);
		expect(angled).toBeGreaterThan(0.08);
		expect(angled).toBeLessThan(0.13);
		expect(lead(headOn + Math.PI / 4, 1)).toBeCloseTo(0.08, 8);
		expect(lead(headOn + Math.PI / 2, 1)).toBeCloseTo(0.08, 8);
		expect(lead(headOn, 1, { x: viewport.width, y: viewport.height * 0.52 })).toBeCloseTo(0.11, 8);
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
