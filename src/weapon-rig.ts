import { getFrame, type FrameId } from './frames';
import { FRAME_RIGS } from './frame-rig';
import { getHardpoints } from './hardpoints';
import type { EnemyKind, Point } from './simulation';

export interface SpatialPoint extends Point { elevation: number }
export interface WeaponBody extends Point { angle?: number; hullAngle?: number }
export interface WeaponRig {
	readonly muzzle: SpatialPoint;
	readonly pivot: SpatialPoint;
	readonly tubes: readonly SpatialPoint[];
	readonly hullMounted?: boolean;
}

const mount = function (x: number, elevation: number, y: number, tubes: readonly SpatialPoint[] = []): WeaponRig {
	return { muzzle: { x, y, elevation }, pivot: { x: x - 20, y, elevation }, tubes };
};
const compactTubes = [-1, 1].map(function (side) { return { x: 0, y: side * 3.7, elevation: 0 }; });
const shoulderTubes = [0, 1].flatMap(function (row) { return [-1, 0, 1].map(function (column) { return { x: 0, y: column * 7.1, elevation: row * 8.6 }; }); });
const rackTubes = function (rows: number, width: number): readonly SpatialPoint[] {
	return [-1, 0, 1].flatMap(function (column) { return Array.from({ length: rows }, function (_, row) { return { x: 0, y: column * width / 3.4, elevation: row * 8 }; }); });
};
const scaleRig = function (rig: WeaponRig, size: number, rise = 0): WeaponRig {
	const scale = function (point: SpatialPoint): SpatialPoint { return { x: point.x * size, y: point.y * size, elevation: (point.elevation + rise) * size }; };
	return { muzzle: scale(rig.muzzle), pivot: scale(rig.pivot), tubes: rig.tubes.map(function (point) { return { x: point.x * size, y: point.y * size, elevation: point.elevation * size }; }) };
};
const playerRigs = new Map<FrameId, readonly WeaponRig[]>();
export const getPlayerWeaponRig = function (frame: FrameId): readonly WeaponRig[] {
	const cached = playerRigs.get(frame); if (cached) return cached;
	const definition = getFrame(frame);
	const rigs = getHardpoints(frame).map(function (hardpoint, slot): WeaponRig {
		const side = slot % 2 === 0 ? -1 : 1;
		const family = hardpoint.family;
		switch (definition.chassisId) {
			case 'warden': return slot < 2 ? mount(42.2, 55.5, side * 34) : family === 'launcher' ? mount(2.8, 78.2, side * 34, shoulderTubes) : mount(10.2, 82.5, side * 34);
			case 'kestrel': return family === 'ballistic' ? mount(37.2, 59, side * 20) : family === 'energy' ? mount(37.2, 59, side * 20) : mount(34.3, 59, side * 20, compactTubes);
			case 'maul': return family === 'launcher' ? mount(25.8, 46, side * 41, rackTubes(2, 19)) : mount(family === 'ballistic' ? 41.1 : 33.2, 52, side * 41);
			case 'longbow': return slot === 0 ? mount(71.2, 72, -27) : family === 'energy' ? mount(31.2, 65, 27) : mount(28.3, 65, 27, compactTubes);
			case 'morrow': return family === 'launcher' ? mount(-1.2, 73, side * 36, rackTubes(4, 22)) : mount(6.2, 87, side * 36);
			case 'rook': return slot === 2 ? mount(3.3, 104, 0, compactTubes) : mount(family === 'ballistic' ? 48.2 : 47.2, 53, side * 29);
		}
	});
	const result = rigs.map(function (rig) { return scaleRig(rig, definition.size, FRAME_RIGS[frame].torsoRise ?? 0); });
	playerRigs.set(frame, result); return result;
};
export const getEnemyWeaponRig = function (kind: EnemyKind, commander = false): readonly WeaponRig[] {
	if (kind === 'helicopter') return [{ ...mount(44, 84, 0), pivot: { x: 15, y: 0, elevation: 84 }, hullMounted: true }];
	if (kind === 'tank') return [mount(57, 36, 0)];
	if (kind === 'vtol') {
		const tubes = [-1, 1].flatMap(function (row) { return [-1, 1].map(function (column) { return { x: 0, y: column * 2.8, elevation: row * 2.8 }; }); });
		return [-1, 1].map(function (side) { return { ...mount(18, 127, side * 19, tubes), pivot: { x: 3, y: side * 19, elevation: 127 }, hullMounted: true }; });
	}
	const size = kind === 'scout' ? 0.8 : kind === 'siege' ? 1.15 : 1;
	const gunLength = kind === 'siege' ? 48 : kind === 'scout' ? 20 : 31;
	const rigs = [-1, 1].map(function (side) { return mount(26.7 + gunLength / 2, 55.5, side * 34); });
	if (kind !== 'scout') rigs.push(...[-1, 1].map(function (side) { return mount(2.8, 78.2, side * 34, shoulderTubes); }));
	if (kind === 'siege' || commander) rigs.push(mount(commander ? 33.2 : 39.7, commander ? 102 : 101, 0));
	return rigs.map(function (rig) { return scaleRig(rig, size); });
};
export const getFiringDirection = function (origin: SpatialPoint, heading: number, target?: SpatialPoint): SpatialPoint {
	if (!target) return { x: Math.cos(heading), y: Math.sin(heading), elevation: 0 };
	const dx = target.x - origin.x; const dy = target.y - origin.y; const dz = target.elevation - origin.elevation;
	const length = Math.hypot(dx, dy, dz);
	return length > 0.000001 ? { x: dx / length, y: dy / length, elevation: dz / length } : { x: Math.cos(heading), y: Math.sin(heading), elevation: 0 };
};
export const weaponPivot = function (rig: WeaponRig, body: WeaponBody, heading: number): SpatialPoint {
	const bearing = rig.hullMounted ? body.hullAngle ?? body.angle ?? heading : heading;
	return { x: body.x + Math.cos(bearing) * rig.pivot.x - Math.sin(bearing) * rig.pivot.y, y: body.y + Math.sin(bearing) * rig.pivot.x + Math.cos(bearing) * rig.pivot.y, elevation: rig.pivot.elevation };
};
export const weaponDirection = function (rig: WeaponRig, body: WeaponBody, heading: number, target?: SpatialPoint): SpatialPoint {
	const pivot = weaponPivot(rig, body, heading);
	if (!target) return getFiringDirection(pivot, heading);
	// Gimbals converge toward targets ahead, without swiveling backward through the chassis.
	const forward = (target.x - pivot.x) * Math.cos(heading) + (target.y - pivot.y) * Math.sin(heading);
	const adjustment = Math.max(0, 1 - forward);
	return getFiringDirection(pivot, heading, { x: target.x + Math.cos(heading) * adjustment, y: target.y + Math.sin(heading) * adjustment, elevation: target.elevation });
};
export const rigMuzzle = function (rig: WeaponRig, body: WeaponBody, heading: number, tubeIndex?: number, target?: SpatialPoint): SpatialPoint {
	const pivot = weaponPivot(rig, body, heading); const direction = weaponDirection(rig, body, heading, target);
	const yaw = Math.atan2(direction.y, direction.x); const horizontal = Math.hypot(direction.x, direction.y);
	const tube = tubeIndex === undefined || rig.tubes.length === 0 ? undefined : rig.tubes[((Math.floor(tubeIndex) % rig.tubes.length) + rig.tubes.length) % rig.tubes.length];
	const forward = rig.muzzle.x - rig.pivot.x + (tube?.x ?? 0); const lateral = tube?.y ?? 0; const vertical = tube?.elevation ?? 0;
	return {
		x: pivot.x + direction.x * forward - Math.sin(yaw) * lateral - Math.cos(yaw) * direction.elevation * vertical,
		y: pivot.y + direction.y * forward + Math.cos(yaw) * lateral - Math.sin(yaw) * direction.elevation * vertical,
		elevation: pivot.elevation + direction.elevation * forward + horizontal * vertical,
	};
};
export const getPlayerMuzzle = function (frame: FrameId, slot: number, body: WeaponBody, heading: number, tubeIndex?: number, target?: SpatialPoint): SpatialPoint {
	const rig = getPlayerWeaponRig(frame)[slot]; if (!rig) throw new RangeError(`Missing weapon rig ${frame}/${slot}`);
	return rigMuzzle(rig, body, heading, tubeIndex, target);
};
export const getEnemyMuzzle = function (kind: EnemyKind, commander: boolean, slot: number, body: WeaponBody, heading: number, tubeIndex?: number, target?: SpatialPoint): SpatialPoint {
	const rig = getEnemyWeaponRig(kind, commander)[slot]; if (!rig) throw new RangeError(`Missing enemy weapon rig ${kind}/${slot}`);
	return rigMuzzle(rig, body, heading, tubeIndex, target);
};
