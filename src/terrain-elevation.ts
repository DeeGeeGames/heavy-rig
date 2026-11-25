import type { FieldTerrain } from './field-terrain';
import type { Point } from './simulation';
import type { SpatialPoint } from './weapon-rig';

/** Mission metres, with one row of heights per y coordinate. Every cell is
 * split along its (low x, low y) to (high x, high y) diagonal. */
export interface TerrainElevation {
	readonly xs: readonly number[];
	readonly ys: readonly number[];
	readonly heights: Float32Array;
	readonly minHeight: number;
	readonly maxHeight: number;
}
type Surface = Pick<FieldTerrain, 'elevation'> | undefined;
interface Cell {
	x: number; y: number; width: number; depth: number;
	a: number; b: number; c: number; d: number;
}

// Pick the cell on the direction of travel when starting exactly on an edge.
const cellIndex = function (axis: readonly number[], value: number, direction = 1) {
	let lo = 0, hi = axis.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >>> 1, at = axis[mid] ?? 0;
		if (value > at || (value === at && direction >= 0)) lo = mid; else hi = mid;
	}
	return lo;
};

// Generated fields level these vertices during construction. A supplied field
// can host the same foundation wherever its existing support is already level.
export const hasLevelFoundation = function (terrain: Surface, at: Point, radius: number) {
	const grid = terrain?.elevation;
	if (!grid) return true;
	const left = cellIndex(grid.xs, at.x - radius), right = cellIndex(grid.xs, at.x + radius, -1) + 1;
	const top = cellIndex(grid.ys, at.y - radius), bottom = cellIndex(grid.ys, at.y + radius, -1) + 1;
	const base = grid.heights[top * grid.xs.length + left];
	if (base === undefined) return false;
	for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
		const height = grid.heights[row * grid.xs.length + col];
		if (height === undefined || Math.abs(height - base) > .01) return false;
	}
	return true;
};
const cellAt = function (grid: TerrainElevation, col: number, row: number): Cell {
	const x = grid.xs[col] ?? 0, y = grid.ys[row] ?? 0;
	const nx = grid.xs.length, i = row * nx + col;
	return { x, y, width: (grid.xs[col + 1] ?? x + 1) - x, depth: (grid.ys[row + 1] ?? y + 1) - y,
		a: grid.heights[i] ?? 0, b: grid.heights[i + 1] ?? 0, c: grid.heights[i + nx] ?? 0, d: grid.heights[i + nx + 1] ?? 0 };
};
const gradient = function (cell: Cell, xSide: boolean): Point {
	return xSide ? { x: (cell.b - cell.a) / cell.width, y: (cell.d - cell.b) / cell.depth }
		: { x: (cell.d - cell.c) / cell.width, y: (cell.c - cell.a) / cell.depth };
};
const unitNormal = function (gx: number, gy: number): SpatialPoint {
	const length = Math.hypot(gx, gy, 1);
	return { x: -gx / length, y: -gy / length, elevation: 1 / length };
};
const surfaceCell = function (terrain: Surface, point: Point) {
	const grid = terrain?.elevation;
	if (!grid || point.x < (grid.xs[0] ?? 0) || point.y < (grid.ys[0] ?? 0)
		|| point.x > (grid.xs.at(-1) ?? 0) || point.y > (grid.ys.at(-1) ?? 0)) return undefined;
	return cellAt(grid, cellIndex(grid.xs, point.x), cellIndex(grid.ys, point.y));
};
export const groundHeight = function (terrain: Surface, point: Point): number {
	const cell = surfaceCell(terrain, point);
	if (!cell) return 0;
	const u = (point.x - cell.x) / cell.width, v = (point.y - cell.y) / cell.depth;
	return u >= v ? cell.a + u * (cell.b - cell.a) + v * (cell.d - cell.b)
		: cell.a + u * (cell.d - cell.c) + v * (cell.c - cell.a);
};
/** The grade between the pilot and the reticle keeps parallel free fire at
 * muzzle height above the ground at the cursor, uphill or downhill. */
export const groundAimSlope = function (terrain: Surface, from: Point, aim: Point, fromHeight: number): number {
	const distance = Math.hypot(aim.x - from.x, aim.y - from.y);
	return distance > 0.000001 ? (groundHeight(terrain, aim) - fromHeight) / distance : 0;
};
export const groundNormal = function (terrain: Surface, point: Point): SpatialPoint {
	const cell = surfaceCell(terrain, point);
	if (!cell) return { x: 0, y: 0, elevation: 1 };
	const g = gradient(cell, (point.x - cell.x) / cell.width >= (point.y - cell.y) / cell.depth);
	return unitNormal(g.x, g.y);
};

interface GroundHit { fraction: number; normal: SpatialPoint }
const epsilon = 1e-8;
const crossing = function (start: number, end: number, clearance: number, change: number): number | undefined {
	if (clearance < -epsilon) return start;
	if (change >= 0 || clearance + (end - start) * change > epsilon) return undefined;
	return Math.max(start, Math.min(end, start - clearance / change));
};
const clipAxis = function (start: number, change: number, low: number, high: number): readonly [number, number] {
	if (change === 0) return start < low || start > high ? [Infinity, -Infinity] : [-Infinity, Infinity];
	return change > 0 ? [(low - start) / change, (high - start) / change] : [(high - start) / change, (low - start) / change];
};
/** Walk just the triangles crossed by the segment. Heights are linear on each
 * triangle, so a distant crest cannot be missed between two clear endpoints. */
export const groundContact = function (terrain: Surface, from: SpatialPoint, to: SpatialPoint): GroundHit | undefined {
	const grid = terrain?.elevation;
	if (Math.min(from.elevation, to.elevation) > Math.max(0, grid?.maxHeight ?? 0)) return undefined;
	const dx = to.x - from.x, dy = to.y - from.y, dz = to.elevation - from.elevation;
	const flat = function (start: number, end: number): GroundHit | undefined {
		const fraction = crossing(start, end, from.elevation + start * dz, dz);
		return fraction === undefined ? undefined : { fraction, normal: { x: 0, y: 0, elevation: 1 } };
	};
	if (!grid) return flat(0, 1);
	const xSpan = clipAxis(from.x, dx, grid.xs[0] ?? 0, grid.xs.at(-1) ?? 0);
	const ySpan = clipAxis(from.y, dy, grid.ys[0] ?? 0, grid.ys.at(-1) ?? 0);
	const entry = Math.max(0, xSpan[0], ySpan[0]), exit = Math.min(1, xSpan[1], ySpan[1]);
	if (entry > exit) return flat(0, 1);
	if (entry > 0) { const hit = flat(0, entry); if (hit) return hit; }
	let col = cellIndex(grid.xs, from.x + dx * entry, dx), row = cellIndex(grid.ys, from.y + dy * entry, dy);
	let start = entry;
	while (start < exit && col >= 0 && row >= 0 && col < grid.xs.length - 1 && row < grid.ys.length - 1) {
		const cell = cellAt(grid, col, row);
		const xEdge = dx === 0 ? Infinity : (cell.x + (dx > 0 ? cell.width : 0) - from.x) / dx;
		const yEdge = dy === 0 ? Infinity : (cell.y + (dy > 0 ? cell.depth : 0) - from.y) / dy;
		const end = Math.min(exit, xEdge, yEdge);
		const side = (from.x - cell.x) / cell.width - (from.y - cell.y) / cell.depth;
		const sideChange = dx / cell.width - dy / cell.depth;
		const diagonal = sideChange === 0 ? Infinity : -side / sideChange;
		const trace = function (a: number, b: number): GroundHit | undefined {
			const g = gradient(cell, side + sideChange * (a + b) / 2 >= 0);
			const clearance = from.elevation + dz * a - cell.a - (from.x + dx * a - cell.x) * g.x - (from.y + dy * a - cell.y) * g.y;
			const fraction = crossing(a, b, clearance, dz - dx * g.x - dy * g.y);
			return fraction === undefined ? undefined : { fraction, normal: unitNormal(g.x, g.y) };
		};
		if (end > start) {
			const hit = diagonal > start && diagonal < end ? trace(start, diagonal) ?? trace(diagonal, end) : trace(start, end);
			if (hit) return hit;
		}
		if (end >= exit) break;
		if (xEdge <= yEdge) col += Math.sign(dx);
		if (yEdge <= xEdge) row += Math.sign(dy);
		start = end;
	}
	return exit < 1 ? flat(exit, 1) : undefined;
};
