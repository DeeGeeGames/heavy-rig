import { getFrame, type FrameId } from './frames';
import type { FieldTerrain } from './field-terrain';
import { groundHeight } from './terrain-elevation';
import type { EnemyKind, Point, Unit } from './simulation';
import type { SpatialPoint } from './weapon-rig';

export interface HitVolume extends SpatialPoint { radius: number; halfHeight: number }
export const ENEMY_RADIUS = 25;
export const EMPLACEMENT_RADIUS = 47;
export const RIG_RADIUS = 27;
const ENEMY_VOLUMES: Readonly<Record<EnemyKind, { elevation: number; halfHeight: number }>> = {
	scout: { elevation: 36, halfHeight: 36 }, striker: { elevation: 45, halfHeight: 45 }, siege: { elevation: 65, halfHeight: 65 },
	tank: { elevation: 30, halfHeight: 30 }, artillery: { elevation: 36, halfHeight: 36 },
	helicopter: { elevation: 112, halfHeight: 20 }, vtol: { elevation: 147, halfHeight: 22 },
};
export const enemyRadius = function (enemy: Unit) {
	return enemy.kind === 'artillery' ? EMPLACEMENT_RADIUS : enemy.catalog ? RIG_RADIUS : ENEMY_RADIUS;
};
export const enemyVolume = function (enemy: Unit, terrain?: FieldTerrain): HitVolume {
	const point = { x: enemy.x, y: enemy.y };
	if (enemy.catalog) return playerVolume(point, enemy.catalog.frameId, terrain);
	const volume = ENEMY_VOLUMES[enemy.kind];
	return { ...point, radius: enemyRadius(enemy), halfHeight: volume.halfHeight, elevation: groundHeight(terrain, point) + volume.elevation };
};
export const playerVolume = function (point: Point, frame: FrameId, terrain?: FieldTerrain): HitVolume {
	const { chassisId, size } = getFrame(frame);
	const height = chassisId === 'longbow' ? 145 : chassisId === 'maul' || chassisId === 'rook' ? 125 : 90;
	const halfHeight = height * size / 2;
	return { x: point.x, y: point.y, elevation: groundHeight(terrain, point) + halfHeight, halfHeight, radius: RIG_RADIUS };
};
export const facilityVolume = function (point: Point, radius: number, terrain?: FieldTerrain): HitVolume {
	return { x: point.x, y: point.y, elevation: groundHeight(terrain, point) + 75, halfHeight: 75, radius };
};
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
