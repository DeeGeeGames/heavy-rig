import { expect, test } from 'bun:test';
import { zoomForController } from '../src/shared/camera-zoom';

test('controller zoom steps through the intermediate and widest views before wrapping', function () {
	const intermediate = zoomForController(1);
	const widest = zoomForController(intermediate);
	expect(intermediate).toBe(0.6);
	expect(widest).toBe(0.35);
	expect(zoomForController(widest)).toBe(1);
});

test('controller zoom steps to the next wider preset after mouse or touch zoom', function () {
	expect(zoomForController(1.3)).toBe(1);
	expect(zoomForController(0.8)).toBe(0.6);
	expect(zoomForController(0.5)).toBe(0.35);
});
