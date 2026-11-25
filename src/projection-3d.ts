import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { FieldTerrain } from './field-terrain';
import { groundContact, groundHeight } from './terrain-elevation';
import type { Point, CombatStateView } from './simulation';

export const viewScale = function (width: number, height: number) { return Math.max(0.6, Math.min(1.25, width / 1100, height / 740)); };

// Three uses (ground X, elevation, ground Y). This basis reproduces the
// existing Canvas projection, including its elevation and 52% ground anchor.
export const alignCamera = function (camera: OrthographicCamera, width: number, height: number, state: CombatStateView, zoom = 1, focus: Point & { elevation?: number } = state.player) {
	const scale = viewScale(width, height) * Math.sqrt(3 / 2) * zoom;
	camera.left = -width / (2 * scale); camera.right = width / (2 * scale);
	camera.top = height * 0.52 / scale; camera.bottom = -height * 0.48 / scale;
	// Pull back along the view axis when the foreground would cross the eye.
	// The lower screen edge must leave room above the ground for aircraft.
	const terrain = state.mission?.map.terrain;
	const focusHeight = focus.elevation ?? groundHeight(terrain, focus);
	const highestGround = terrain?.elevation?.maxHeight ?? 0, lowestGround = terrain?.elevation?.minHeight ?? 0;
	const eyeHeight = Math.max(1000, 220 + highestGround - focusHeight - camera.bottom * Math.sqrt(2 / 3));
	const focusDepth = eyeHeight * Math.sqrt(3);
	camera.far = Math.max(6000, focusDepth + camera.top * Math.SQRT2 + 220 + (focusHeight - lowestGround) * Math.sqrt(3));
	camera.position.set(focus.x + eyeHeight, focusHeight + eyeHeight, focus.y + eyeHeight);
	camera.lookAt(focus.x, focusHeight, focus.y);
	camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
	return (eyeHeight - 1000) * Math.sqrt(3);
};

export const toScreen = function (point: Point, camera: OrthographicCamera, width: number, height: number, elevation = 0): Point {
	const at = new Vector3(point.x, elevation, point.y).project(camera);
	return { x: (at.x + 1) * width / 2, y: (1 - at.y) * height / 2 };
};

export const toGround = function (point: Point, camera: OrthographicCamera, width: number, height: number, terrain?: FieldTerrain): Point | undefined {
	if (width <= 0 || height <= 0) return undefined;
	const ray = new Raycaster(); ray.setFromCamera(new Vector2(point.x / width * 2 - 1, 1 - point.y / height * 2), camera);
	if (terrain?.elevation) {
		const { origin, direction } = ray.ray;
		if (direction.y >= 0) return undefined;
		// Only the slice of the ray spanning the map's elevations can touch terrain.
		const top = Math.max(0, (Math.max(0, terrain.elevation.maxHeight) + 1 - origin.y) / direction.y);
		const bottom = (Math.min(0, terrain.elevation.minHeight) - 1 - origin.y) / direction.y;
		if (bottom < top) return undefined;
		const from = ray.ray.at(top, new Vector3()), to = ray.ray.at(bottom, new Vector3());
		const hit = groundContact(terrain, { x: from.x, y: from.z, elevation: from.y }, { x: to.x, y: to.z, elevation: to.y });
		if (!hit) return undefined;
		const at = from.lerp(to, hit.fraction);
		return { x: at.x, y: at.z };
	}
	const at = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
	return at ? { x: at.x, y: at.z } : undefined;
};
