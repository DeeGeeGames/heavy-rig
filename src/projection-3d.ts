import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Point, CombatStateView } from './simulation';

export const viewScale = function (width: number, height: number) { return Math.max(0.6, Math.min(1.25, width / 1100, height / 740)); };

// Three uses (ground X, elevation, ground Y). This basis reproduces the
// existing Canvas projection, including its elevation and 52% ground anchor.
export const alignCamera = function (camera: OrthographicCamera, width: number, height: number, state: CombatStateView, zoom = 1, focus: Point = state.player) {
	const scale = viewScale(width, height) * Math.sqrt(3 / 2) * zoom;
	camera.left = -width / (2 * scale); camera.right = width / (2 * scale);
	camera.top = height * 0.52 / scale; camera.bottom = -height * 0.48 / scale;
	// Pull back along the view axis when the foreground would cross the eye.
	// The lower screen edge must leave room above the ground for aircraft.
	const eyeHeight = Math.max(1000, 220 - camera.bottom * Math.sqrt(2 / 3));
	const focusDepth = eyeHeight * Math.sqrt(3);
	camera.far = Math.max(6000, focusDepth + camera.top * Math.SQRT2 + 220);
	camera.position.set(focus.x + eyeHeight, eyeHeight, focus.y + eyeHeight);
	camera.lookAt(focus.x, 0, focus.y);
	camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
	return (eyeHeight - 1000) * Math.sqrt(3);
};

export const toScreen = function (point: Point, camera: OrthographicCamera, width: number, height: number, elevation = 0): Point {
	const at = new Vector3(point.x, elevation, point.y).project(camera);
	return { x: (at.x + 1) * width / 2, y: (1 - at.y) * height / 2 };
};

export const toGround = function (point: Point, camera: OrthographicCamera, width: number, height: number): Point | undefined {
	if (width <= 0 || height <= 0) return undefined;
	const ray = new Raycaster(); ray.setFromCamera(new Vector2(point.x / width * 2 - 1, 1 - point.y / height * 2), camera);
	const at = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
	return at ? { x: at.x, y: at.z } : undefined;
};
