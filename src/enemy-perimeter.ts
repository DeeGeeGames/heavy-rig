import { ENEMY_RADIUS } from './combat-spatial';
import { terrainPathClear, type FieldTerrain } from './field-terrain';
import { sceneryFlightBounds } from './scenery-flight';
import { SILO_EXPOSED, type SiloTurret } from './silo-turret';
import type { EnemyKind, Point } from './simulation';

export interface PerimeterEntry { start: Point; end: Point }
interface Bounds { width: number; height: number }

export const isFieldContact = function (enemy: Point & { entry?: Point; silo?: SiloTurret }, bounds: Bounds): boolean {
	if (enemy.silo && enemy.silo.deployment < SILO_EXPOSED) return false;
	return !enemy.entry || enemy.x >= 0 && enemy.x <= bounds.width && enemy.y >= 0 && enemy.y <= bounds.height;
};

// Intersect an assault bearing with either the approach outside the battlefield
// (negative inset) or the line where ordinary, boundary-clamped movement resumes.
const perimeterPoint = function (origin: Point, dx: number, dy: number, bounds: Bounds, inset: number): Point {
	const tx = dx === 0 ? Infinity : ((dx > 0 ? bounds.width - inset : inset) - origin.x) / dx;
	const ty = dy === 0 ? Infinity : ((dy > 0 ? bounds.height - inset : inset) - origin.y) / dy;
	const travel = Math.min(tx, ty);
	return { x: origin.x + dx * travel, y: origin.y + dy * travel };
};

export const planPerimeterEntry = function (spawn: Point & { kind: EnemyKind }, objective: Point, bounds: Bounds, terrain: FieldTerrain | undefined, player: Point): PerimeterEntry | undefined {
	const inset = 70;
	const origin = {
		x: Math.max(inset, Math.min(bounds.width - inset, objective.x)),
		y: Math.max(inset, Math.min(bounds.height - inset, objective.y)),
	};
	const bearing = Math.atan2(spawn.y - objective.y, spawn.x - objective.x);
	const tank = spawn.kind === 'tank';
	const field = terrain && !tank ? { obstacles: terrain.obstacles.map(sceneryFlightBounds) } : terrain;
	const radius = tank ? ENEMY_RADIUS + 10 : 60; // Allow for tracks, wings and rotor tips.
	let best: PerimeterEntry | undefined;
	let bestStandOff = -Infinity;
	let bestDistance = Infinity;
	// Enter near the section's intended approach. Always following its exact
	// bearing could send a slow tank all the way across a rectangular field.
	for (let i = 0; i < 48; i++) {
		const angle = bearing + i * Math.PI / 24;
		const dx = Math.cos(angle), dy = Math.sin(angle);
		const start = perimeterPoint(origin, dx, dy, bounds, tank ? -112 : -220);
		const end = perimeterPoint(origin, dx, dy, bounds, inset);
		if (field && !terrainPathClear(field, start, end, radius)) continue;
		// Prefer the most distant open lane if the entire perimeter is close.
		// Beyond a normal camera span, the section's route takes priority.
		const standOff = Math.min(1050, Math.hypot(start.x - player.x, start.y - player.y));
		const toSection = Math.hypot(end.x - spawn.x, end.y - spawn.y);
		if (standOff > bestStandOff || standOff === bestStandOff && toSection < bestDistance) {
			best = { start, end };
			bestStandOff = standOff;
			bestDistance = toSection;
		}
	}
	return best;
};

export const advancePerimeterEntry = function (unit: Point, end: Point, speed: number, dt: number): boolean {
	const dx = end.x - unit.x, dy = end.y - unit.y;
	const remaining = Math.hypot(dx, dy);
	const travel = Math.max(0, speed * dt);
	if (remaining <= travel) {
		unit.x = end.x; unit.y = end.y;
		return true;
	}
	unit.x += dx / remaining * travel; unit.y += dy / remaining * travel;
	return false;
};
