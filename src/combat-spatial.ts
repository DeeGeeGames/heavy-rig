import { getFrame, type FrameId } from './frames';
import type { EnemyKind, Point, Unit } from './simulation';
import type { SpatialPoint } from './weapon-rig';

export interface HitVolume extends SpatialPoint { radius: number; halfHeight: number }
const ENEMY_VOLUMES: Readonly<Record<EnemyKind, { elevation: number; halfHeight: number }>> = {
	scout: { elevation: 36, halfHeight: 36 }, striker: { elevation: 45, halfHeight: 45 }, siege: { elevation: 65, halfHeight: 65 },
	tank: { elevation: 30, halfHeight: 30 }, helicopter: { elevation: 112, halfHeight: 20 }, vtol: { elevation: 147, halfHeight: 22 },
};
export const enemyVolume = function (enemy: Unit): HitVolume { return { x: enemy.x, y: enemy.y, radius: 25, ...ENEMY_VOLUMES[enemy.kind] }; };
export const playerVolume = function (point: Point, frame: FrameId): HitVolume {
	const height = getFrame(frame).chassisId === 'longbow' ? 145 : getFrame(frame).chassisId === 'maul' || getFrame(frame).chassisId === 'rook' ? 125 : 90;
	return { ...point, elevation: height * getFrame(frame).size / 2, halfHeight: height * getFrame(frame).size / 2, radius: 27 };
};
export const facilityVolume = function (point: Point, radius: number): HitVolume { return { ...point, elevation: 75, halfHeight: 75, radius }; };
export const spatialDistance = function (a: SpatialPoint, b: SpatialPoint): number { return Math.hypot(a.x - b.x, a.y - b.y, a.elevation - b.elevation); };
// Swept ellipsoid intersection prevents fast rounds skipping thin targets.
export const hitVolumeFraction = function (from: SpatialPoint, to: SpatialPoint, target: HitVolume): number | undefined {
	const dx = (to.x - from.x) / target.radius; const dy = (to.y - from.y) / target.radius; const dz = (to.elevation - from.elevation) / target.halfHeight;
	const ox = (from.x - target.x) / target.radius; const oy = (from.y - target.y) / target.radius; const oz = (from.elevation - target.elevation) / target.halfHeight;
	const c = ox * ox + oy * oy + oz * oz - 1;
	if (c <= 0) return 0;
	const a = dx * dx + dy * dy + dz * dz;
	if (a === 0) return undefined;
	const b = ox * dx + oy * dy + oz * dz; const discriminant = b * b - a * c;
	if (discriminant < 0) return undefined;
	const entry = (-b - Math.sqrt(discriminant)) / a;
	return entry >= 0 && entry <= 1 ? entry : undefined;
};
export const pointAlong = function (from: SpatialPoint, to: SpatialPoint, fraction: number): SpatialPoint {
	return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction, elevation: from.elevation + (to.elevation - from.elevation) * fraction };
};
export const projectAim = function (body: Point, heading: number, target: SpatialPoint): SpatialPoint {
	const range = Math.hypot(target.x - body.x, target.y - body.y);
	return { x: body.x + Math.cos(heading) * range, y: body.y + Math.sin(heading) * range, elevation: target.elevation };
};
