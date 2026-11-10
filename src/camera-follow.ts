import type { Point } from './simulation';

export interface CameraObstruction { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
interface FollowInput {
	readonly width: number; readonly height: number;
	readonly velocity: Point; readonly maxSpeed: number; readonly turret: number;
	readonly pointer: Point | undefined;
}

// Screen fractions make the limits consistent through aspect ratio and zoom.
const screenDirection = function (direction: Point, width: number, height: number): Point {
	const x = (direction.x - direction.y) * Math.sqrt(3) / 2 / width;
	const y = (direction.x + direction.y) * 0.5 / height;
	const length = Math.hypot(x, y);
	return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
};

export const cameraLookAhead = function (input: FollowInput): Point {
	const { width, height, velocity, maxSpeed, turret, pointer } = input;
	if (width <= 0 || height <= 0) return { x: 0, y: 0 };
	const movement = screenDirection(velocity, width, height);
	const facing = screenDirection({ x: Math.cos(turret), y: Math.sin(turret) }, width, height);
	const speed = Math.min(1, Math.hypot(velocity.x, velocity.y) / Math.max(1, maxSpeed));
	// The centered ground anchor is independent of the current camera offset.
	const distance = pointer ? Math.hypot((pointer.x - width / 2) / (width / 2), (pointer.y - height * 0.52) / (height / 2)) : 0;
	const reach = Math.max(0, Math.min(1, (distance - 0.12) / 0.68));
	const aimLead = pointer ? 0.025 + 0.095 * reach * reach * (3 - 2 * reach) : 0.10;
	const x = movement.x * speed * 0.08 + facing.x * aimLead;
	const y = movement.y * speed * 0.08 + facing.y * aimLead;
	const limit = Math.max(1, Math.hypot(x, y) / 0.18);
	return { x: x / limit, y: y / limit };
};

export const smoothCameraOffset = function (current: Point, desired: Point, dt: number): Point {
	const blend = -Math.expm1(-Math.max(0, dt) / 0.25);
	return { x: current.x + (desired.x - current.x) * blend, y: current.y + (desired.y - current.y) * blend };
};

const interval = function (origin: number, travel: number, low: number, high: number): readonly [number, number] {
	if (travel === 0) return origin > low && origin < high ? [-Infinity, Infinity] : [Infinity, -Infinity];
	const a = (low - origin) / travel; const b = (high - origin) / travel;
	return [Math.min(a, b), Math.max(a, b)];
};

// Limit the entire path from center to offset so smoothing cannot cross a HUD
// panel. If a panel already covers the center, don't add drift toward that panel.
export const constrainCameraOffset = function (offset: Point, width: number, height: number, radius: Point, obstructions: readonly CameraObstruction[]): Point {
	let amount = 1;
	const origin = { x: width / 2, y: height * 0.52 };
	const travel = { x: -offset.x * width, y: -offset.y * height };
	if (travel.x !== 0) amount = Math.min(amount, Math.max(0, (travel.x > 0 ? width - radius.x - origin.x : origin.x - radius.x) / Math.abs(travel.x)));
	if (travel.y !== 0) amount = Math.min(amount, Math.max(0, (travel.y > 0 ? height - radius.y - origin.y : origin.y - radius.y) / Math.abs(travel.y)));
	for (const rect of obstructions) {
		const left = rect.left - radius.x; const right = rect.right + radius.x;
		const top = rect.top - radius.y; const bottom = rect.bottom + radius.y;
		if (origin.x > left && origin.x < right && origin.y > top && origin.y < bottom) {
			const towardX = travel.x * ((left + right) / 2 - origin.x);
			const towardY = travel.y * ((top + bottom) / 2 - origin.y);
			if (towardX + towardY > 0) amount = 0;
			continue;
		}
		const [enterX, exitX] = interval(origin.x, travel.x, left, right);
		const [enterY, exitY] = interval(origin.y, travel.y, top, bottom);
		const enter = Math.max(enterX, enterY, 0);
		const exit = Math.min(exitX, exitY);
		if (enter < exit && enter <= amount) amount = Math.max(0, enter - 0.01);
	}
	return { x: offset.x * amount, y: offset.y * amount };
};
