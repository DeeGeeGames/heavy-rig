import type { Point } from './simulation';
import type { SpatialPoint } from './weapon-rig';
import { groundContact, groundHeight, type TerrainElevation } from './terrain-elevation';

/** Centred, axis-aligned footprints in mission metres. */
interface GroundFootprint extends Readonly<Point> {
	readonly width: number;
	readonly depth: number;
}
export interface ObstacleField {
	readonly obstacles: readonly GroundFootprint[];
}
export interface TerrainObstacle extends GroundFootprint {
	readonly kind: 'fissure' | 'channel' | 'shed' | 'tree' | 'turbine' | 'outcrop' | 'crystal';
	readonly height: number;
}

export interface FieldTerrain {
	readonly obstacles: readonly TerrainObstacle[];
	readonly roads: readonly (readonly Point[])[];
	readonly elevation?: TerrainElevation;
}

interface Bounds { left: number; right: number; top: number; bottom: number }
interface Contact { fraction: number; axis: 'x' | 'y' }
interface Corner { point: Point; index: number; distances: Float64Array }
interface Clearance { boxes: Bounds[]; corners?: Corner[] }
const clearanceCache = new WeakMap<ObstacleField, Map<number, Clearance>>();

const bounds = function (obstacle: GroundFootprint, radius: number): Bounds {
	return { left: obstacle.x - obstacle.width / 2 - radius, right: obstacle.x + obstacle.width / 2 + radius,
		top: obstacle.y - obstacle.depth / 2 - radius, bottom: obstacle.y + obstacle.depth / 2 + radius };
};
const clearanceFor = function (terrain: ObstacleField, radius: number): Clearance {
	let sizes = clearanceCache.get(terrain);
	if (!sizes) { sizes = new Map(); clearanceCache.set(terrain, sizes); }
	let clearance = sizes.get(radius);
	if (!clearance) {
		clearance = { boxes: terrain.obstacles.map(function (obstacle) { return bounds(obstacle, radius); }) };
		sizes.set(radius, clearance);
	}
	return clearance;
};
const distance = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
const inside = function (point: Point, box: Bounds) {
	return point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
};
const axisInterval = function (from: number, delta: number, low: number, high: number): readonly [number, number] | undefined {
	if (delta === 0) return from < low || from > high ? undefined : [-Infinity, Infinity];
	const t1 = (low - from) / delta; const t2 = (high - from) / delta;
	return t1 < t2 ? [t1, t2] : [t2, t1];
};
const contact = function (from: Point, to: Point, box: Bounds): Contact | undefined {
	const dx = to.x - from.x; const dy = to.y - from.y;
	// Travelling parallel to a wall or touching just its corner leaves the path open.
	if (dx === 0 && (from.x <= box.left || from.x >= box.right) || dy === 0 && (from.y <= box.top || from.y >= box.bottom)) return undefined;
	const x = axisInterval(from.x, dx, box.left, box.right);
	const y = axisInterval(from.y, dy, box.top, box.bottom);
	if (!x || !y) return undefined;
	const entry = Math.max(0, x[0], y[0]);
	if (entry >= 1 || entry >= Math.min(x[1], y[1])) return undefined;
	return { fraction: entry, axis: x[0] >= y[0] ? 'x' : 'y' };
};
const firstContact = function (from: Point, to: Point, boxes: readonly Bounds[]) {
	let first: Contact | undefined;
	for (const box of boxes) {
		const hit = contact(from, to, box);
		if (hit && (!first || hit.fraction < first.fraction)) first = hit;
	}
	return first;
};
const clear = function (from: Point, to: Point, boxes: readonly Bounds[]) {
	return !boxes.some(function (box) { return contact(from, to, box) !== undefined; });
};
// Placement checks arbitrary clearances once. Only moving bodies need the
// persistent per-radius navigation cache used by sweeps and waypoints.
export const terrainPointClear = function (terrain: ObstacleField, point: Point, radius: number): boolean {
	return terrain.obstacles.every(function (obstacle) { return !inside(point, bounds(obstacle, radius)); });
};
export const terrainPathClear = function (terrain: ObstacleField, from: Point, to: Point, radius: number): boolean {
	const { boxes } = clearanceFor(terrain, radius);
	return !boxes.some(function (box) { return inside(from, box) || inside(to, box); }) && clear(from, to, boxes);
};
const nearestFree = function (point: Point, boxes: readonly Bounds[]): Point {
	const containing = boxes.find(function (box) { return inside(point, box); });
	if (!containing) return point;
	// A formation slot or firing position can fall inside a building. Pick an
	// exterior face, including clearance, without sending the unit through it.
	const exits = [
		{ x: containing.left - 1, y: point.y }, { x: containing.right + 1, y: point.y },
		{ x: point.x, y: containing.top - 1 }, { x: point.x, y: containing.bottom + 1 },
	];
	return exits.filter(function (at) { return !boxes.some(function (box) { return inside(at, box); }); })
		.sort(function (a, b) { return distance(a, point) - distance(b, point); })[0] ?? point;
};

export const moveOnTerrain = function (terrain: ObstacleField, from: Point, to: Point, radius: number): Point {
	const { boxes } = clearanceFor(terrain, radius);
	const origin = nearestFree(from, boxes);
	let at = origin; let destination = origin === from ? to : { x: origin.x + to.x - from.x, y: origin.y + to.y - from.y };
	// On the first impact discard the blocked velocity component; a second
	// sweep stops the remaining slide at an adjoining wall.
	for (let axis = 0; axis < 2; axis++) {
		const hit = firstContact(at, destination, boxes);
		if (!hit) return destination;
		const dx = destination.x - at.x; const dy = destination.y - at.y;
		const f = Math.max(0, hit.fraction - .001 / Math.max(1, Math.hypot(dx, dy)));
		at = { x: at.x + dx * f, y: at.y + dy * f };
		destination = hit.axis === 'x' ? { x: at.x, y: destination.y } : { x: destination.x, y: at.y };
	}
	return at;
};

const navigationCorners = function (boxes: readonly Bounds[]): Corner[] {
	// Extra stand-off gives a turning rig room to round a corner before steering
	// to its next waypoint. Geometry is static throughout a sortie.
	const margin = 24;
	const points = boxes.flatMap(function (box) {
		return [box.left - margin, box.right + margin].flatMap(function (x) {
			return [box.top - margin, box.bottom + margin].map(function (y) { return { x, y }; });
		});
	}).filter(function (point) { return !boxes.some(function (box) { return inside(point, box); }); });
	const corners: Corner[] = points.map(function (point, index) {
		return { point, index, distances: new Float64Array(points.length).fill(Infinity) };
	});
	for (const a of corners) for (const b of corners) {
		if (clear(a.point, b.point, boxes)) a.distances[b.index] = distance(a.point, b.point);
	}
	// Only the first visible corner is needed per moving unit. Precompute the
	// all-pairs distances in contiguous rows once per rig clearance. Forest
	// groves have enough corners for hash lookups here to stall the first turn.
	for (const via of corners) for (const from of corners) {
		const firstLeg = from.distances[via.index] ?? Infinity;
		if (firstLeg === Infinity || firstLeg === 0) continue;
		for (let end = 0; end < corners.length; end++) {
			const through = firstLeg + (via.distances[end] ?? Infinity);
			if (through < (from.distances[end] ?? Infinity)) from.distances[end] = through;
		}
	}
	return corners;
};
export const terrainWaypoint = function (terrain: ObstacleField, from: Point, to: Point, radius: number): Point {
	const clearance = clearanceFor(terrain, radius);
	const goal = nearestFree(to, clearance.boxes);
	if (clear(from, goal, clearance.boxes)) return goal;
	const corners = clearance.corners ??= navigationCorners(clearance.boxes);
	const exits = corners.filter(function (corner) { return clear(corner.point, goal, clearance.boxes); })
		.map(function (corner) { return { corner, remaining: distance(corner.point, goal) }; });
	let best: Corner | undefined; let bestTotal = Infinity; let bestFirstLeg = 0;
	for (const entry of corners) {
		if (!clear(from, entry.point, clearance.boxes)) continue;
		const firstLeg = distance(from, entry.point);
		for (const { corner, remaining } of exits) {
			const between = entry.distances[corner.index] ?? Infinity;
			const total = firstLeg + between + remaining;
			// Prefer the farther directly visible corner on an equal-length path,
			// especially when the rig has already arrived at one of its corners.
			if (total < bestTotal - .01 || Math.abs(total - bestTotal) <= .01 && firstLeg > bestFirstLeg) {
				best = entry; bestTotal = total; bestFirstLeg = firstLeg;
			}
		}
	}
	return best?.point ?? from;
};

export const terrainShotContact = function (terrain: FieldTerrain, from: SpatialPoint, to: SpatialPoint) {
	let first: { fraction: number; obstacle: TerrainObstacle; normal: SpatialPoint } | undefined;
	for (const obstacle of terrain.obstacles) {
		if (obstacle.kind === 'fissure' || obstacle.kind === 'channel') continue;
		const box = bounds(obstacle, 0);
		const x = axisInterval(from.x, to.x - from.x, box.left, box.right);
		const y = axisInterval(from.y, to.y - from.y, box.top, box.bottom);
		if (!x || !y || Math.max(0, x[0], y[0]) > Math.min(1, x[1], y[1])) continue;
		const base = groundHeight(terrain, obstacle);
		const z = axisInterval(from.elevation, to.elevation - from.elevation, base, base + obstacle.height);
		if (!z) continue;
		const entry = Math.max(0, x[0], y[0], z[0]);
		if (entry > Math.min(1, x[1], y[1], z[1]) || first && entry >= first.fraction) continue;
		const normal = { x: 0, y: 0, elevation: 0 };
		const leading = Math.max(x[0], y[0], z[0]);
		if (leading === x[0]) normal.x = Math.sign(from.x - to.x);
		else if (leading === y[0]) normal.y = Math.sign(from.y - to.y);
		else normal.elevation = Math.sign(from.elevation - to.elevation);
		first = { fraction: entry, obstacle, normal };
	}
	return first;
};
export const terrainShotFraction = function (terrain: FieldTerrain, from: SpatialPoint, to: SpatialPoint): number | undefined {
	const ground = groundContact(terrain, from, to)?.fraction;
	const cover = terrainShotContact(terrain, from, to)?.fraction;
	return ground === undefined ? cover : cover === undefined ? ground : Math.min(ground, cover);
};
