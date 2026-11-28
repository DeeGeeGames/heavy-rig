import type { AuthoredPoseContext } from './authored-pose';
import { getFrame, type FrameId } from './frames';
import { FRAME_RIGS } from './frame-rig';
import { getHardpoints } from './hardpoints';
import { getMechAssetBinding } from './mech-asset-registry';
import type { PresetEnemyKind, Point } from './simulation';
import { snapMechHeading } from './torso-arc';
import { emplacementWeaponRig } from './artillery-emplacement-rig';

export interface SpatialPoint extends Point { elevation: number }
export type MountDirections = ReadonlyMap<number, Readonly<SpatialPoint>>;
export interface WeaponTraverse { readonly heading: number; readonly yaw: number; readonly down: number; readonly up: number }
export interface WeaponBody extends Point {
	angle?: number; hullAngle?: number;
	/** World height of the rig's feet. Model-space articulation defaults to zero. */
	groundElevation?: number;
	/** Rise per horizontal metre for free fire across uneven ground. */
	aimSlope?: number;
}
export interface WeaponRig {
	readonly muzzle: SpatialPoint;
	readonly pivot: SpatialPoint;
	readonly tubes: readonly SpatialPoint[];
	readonly hullMounted?: boolean;
	readonly fixedPitch?: number;
	readonly mechTorsoMounted?: boolean;
}

const mount = function (x: number, elevation: number, y: number, tubes: readonly SpatialPoint[] = []): WeaponRig {
	return { muzzle: { x, y, elevation }, pivot: { x: x - 20, y, elevation }, tubes };
};
const compactTubes = [-1, 1].map(function (side) { return { x: 0, y: side * 3.7, elevation: 0 }; });
const shoulderTubes = [0, 1].flatMap(function (row) { return [-1, 0, 1].map(function (column) { return { x: 0, y: column * 7.1, elevation: row * 8.6 }; }); });
const rackTubes = function (rows: number, width: number): readonly SpatialPoint[] {
	return [-1, 0, 1].flatMap(function (column) { return Array.from({ length: rows }, function (_, row) { return { x: 0, y: column * width / 3.4, elevation: row * 8 }; }); });
};
// Offsets are shared by procedural meshes and simulation when an authored
// cartridge is unavailable. Their order defines physical firing exit indices.
export const fallbackIndexedExits = function (frame: FrameId, slot: number): readonly SpatialPoint[] | undefined {
	if (frame === 'harrow-b' && slot === 0) return [-12, 0, 12].map(function (y) { return { x: 0, y, elevation: 0 }; });
	if (frame === 'bastion-b' && slot === 1) return [-3.7, 3.7].flatMap(function (y) {
		return [-3.5, 3.5].map(function (elevation) { return { x: 0, y, elevation }; });
	});
	if (frame === 'morrow-saturation') return rackTubes(2, 22);
	if (frame === 'morrow' || frame === 'morrow-pursuer') return [-6.5, 6.5].flatMap(function (y) {
		return (frame === 'morrow' ? [0, 8] : [0]).map(function (elevation) { return { x: 0, y, elevation }; });
	});
	return undefined;
};
const scaleMechRig = function (rig: WeaponRig, size: number, rise = 0): WeaponRig {
	const scale = function (point: SpatialPoint): SpatialPoint { return { x: point.x * size, y: point.y * size, elevation: (point.elevation + rise) * size }; };
	return { mechTorsoMounted: true, muzzle: scale(rig.muzzle), pivot: scale(rig.pivot), tubes: rig.tubes.map(function (point) { return { x: point.x * size, y: point.y * size, elevation: point.elevation * size }; }) };
};
const playerRigs = new Map<FrameId, readonly WeaponRig[]>();
export const getPlayerWeaponRig = function (frame: FrameId): readonly WeaponRig[] {
	const authored = getMechAssetBinding(frame); if (authored) return authored.weaponRigs;
	const cached = playerRigs.get(frame); if (cached) return cached;
	const definition = getFrame(frame);
	const rigs = getHardpoints(frame).map(function (hardpoint, slot): WeaponRig {
		const side = slot % 2 === 0 ? -1 : 1;
		const family = hardpoint.family;
		switch (definition.chassisId) {
			case 'warden': return slot < 2 ? mount(42.2, 55.5, side * 34) : family === 'launcher' ? mount(2.8, 78.2, side * 34, shoulderTubes) : mount(10.2, 82.5, side * 34);
			case 'kestrel': return family === 'ballistic' ? mount(37.2, 59, side * 20) : family === 'energy' ? mount(37.2, 59, side * 20) : mount(34.3, 59, side * 20, compactTubes);
			case 'maul': return slot < 2
				? family === 'launcher' ? mount(25.8, 46, side * 41, rackTubes(2, 19)) : mount(family === 'ballistic' ? 41.1 : 33.2, 52, side * 41)
				: family === 'launcher' ? mount(15.3, 91, side * 22, compactTubes) : mount(family === 'ballistic' ? 23.7 : 19.2, 91, side * 22);
			case 'longbow': return slot === 0 ? mount(71.2, 72, -27) : family === 'energy' ? mount(31.2, 65, 27) : mount(28.3, 65, 27, compactTubes);
			case 'morrow': return family === 'launcher' ? mount(-1.2, 73, side * 36, fallbackIndexedExits(frame, slot) ?? rackTubes(4, 22)) : mount(6.2, 87, side * 36);
			case 'harrow':
			case 'specter':
			case 'bastion': {
				const mortar = definition.chassisId === 'harrow' && slot === 0;
				const z = mortar ? 0 : side * (definition.chassisId === 'specter' ? 19 : 29);
				const height = mortar ? 91 : 65;
				const exits = fallbackIndexedExits(frame, slot);
				return family === 'launcher' ? mount(25.3, height, z, exits ?? compactTubes) : mount(family === 'energy' ? 36.2 : mortar ? 46.7 : 34.7, height, z, exits);
			}
			case 'rook': return slot === 2 ? mount(3.3, 104, 0, compactTubes) : mount(family === 'ballistic' ? 48.2 : 47.2, 53, side * 29);
		}
	});
	const result = rigs.map(function (rig) { return scaleMechRig(rig, definition.size, FRAME_RIGS[frame].torsoRise ?? 0); });
	playerRigs.set(frame, result); return result;
};
export const getEnemyWeaponRig = function (kind: PresetEnemyKind, commander = false): readonly WeaponRig[] {
	if (kind === 'artillery') return [emplacementWeaponRig];
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
	return rigs.map(function (rig) { return scaleMechRig(rig, size); });
};
const forwardDirection = function (heading: number, slope = 0): SpatialPoint {
	const length = Math.hypot(1, slope);
	return { x: Math.cos(heading) / length, y: Math.sin(heading) / length, elevation: slope / length };
};
export const getFiringDirection = function (origin: SpatialPoint, heading: number, target?: SpatialPoint): SpatialPoint {
	if (!target) return forwardDirection(heading);
	const dx = target.x - origin.x; const dy = target.y - origin.y; const dz = target.elevation - origin.elevation;
	const length = Math.hypot(dx, dy, dz);
	return length > 0.000001 ? { x: dx / length, y: dy / length, elevation: dz / length } : { x: Math.cos(heading), y: Math.sin(heading), elevation: 0 };
};
const mountHeading = function (rig: WeaponRig, heading: number) {
	return rig.mechTorsoMounted ? snapMechHeading(heading) : heading;
};
export const weaponPivot = function (rig: WeaponRig, body: WeaponBody, heading: number): SpatialPoint {
	const bearing = rig.hullMounted ? body.hullAngle ?? body.angle ?? heading : mountHeading(rig, heading);
	return { x: body.x + Math.cos(bearing) * rig.pivot.x - Math.sin(bearing) * rig.pivot.y, y: body.y + Math.sin(bearing) * rig.pivot.x + Math.cos(bearing) * rig.pivot.y, elevation: (body.groundElevation ?? 0) + rig.pivot.elevation };
};
export const weaponDirection = function (rig: WeaponRig, body: WeaponBody, heading: number, target?: SpatialPoint): SpatialPoint {
	if (rig.fixedPitch !== undefined) return forwardDirection(heading, Math.tan(rig.fixedPitch));
	if (!target) return forwardDirection(mountHeading(rig, heading), body.aimSlope);
	return convergeWeapon(weaponPivot(rig, body, heading), mountOffset(rig), heading, target);
};
export const convergeWeapon = function (pivot: SpatialPoint, offset: SpatialPoint, heading: number, target: SpatialPoint): SpatialPoint {
	// Gimbals converge toward targets ahead, without swiveling backward through the chassis.
	const forward = (target.x - pivot.x) * Math.cos(heading) + (target.y - pivot.y) * Math.sin(heading);
	const adjustment = Math.max(0, 1 - forward);
	const ahead = { x: target.x + Math.cos(heading) * adjustment, y: target.y + Math.sin(heading) * adjustment, elevation: target.elevation };
	const baseline = getFiringDirection(pivot, heading, ahead);
	const { y: lateral, elevation: vertical, x: barrelLength } = offset;
	if (lateral === 0 && vertical === 0) return baseline;
	const dx = ahead.x - pivot.x; const dy = ahead.y - pivot.y; const dz = ahead.elevation - pivot.elevation;
	const horizontalSquared = dx * dx + dy * dy - lateral * lateral;
	const alongSquared = horizontalSquared + dz * dz - vertical * vertical;
	// Offset hinges need the barrel axis, rather than the pivot-to-target line,
	// to converge. Targets inside the transverse offset or behind the muzzle
	// have no forward solution; retain the stable ahead-facing fallback there.
	if (horizontalSquared <= 0 || alongSquared <= barrelLength * barrelLength) return baseline;
	const horizontal = Math.sqrt(horizontalSquared); const along = Math.sqrt(alongSquared);
	const yaw = Math.atan2(dy, dx) - Math.atan2(lateral, horizontal);
	const pitch = Math.atan2(dz, horizontal) - Math.atan2(vertical, along);
	const direction = { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(yaw) * Math.cos(pitch), elevation: Math.sin(pitch) };
	return direction.x * Math.cos(heading) + direction.y * Math.sin(heading) > 0 ? direction : baseline;
};
export const mountOffset = function (rig: WeaponRig): SpatialPoint {
	return { x: rig.muzzle.x - rig.pivot.x, y: rig.muzzle.y - rig.pivot.y, elevation: rig.muzzle.elevation - rig.pivot.elevation };
};
export const rigMuzzle = function (rig: WeaponRig, body: WeaponBody, heading: number, tubeIndex?: number, target?: SpatialPoint): SpatialPoint {
	return rigMuzzleAlong(rig, body, heading, weaponDirection(rig, body, heading, target), tubeIndex);
};
const rigMuzzleAlong = function (rig: WeaponRig, body: WeaponBody, heading: number, direction: Readonly<SpatialPoint>, tubeIndex?: number): SpatialPoint {
	const pivot = weaponPivot(rig, body, heading);
	const tube = tubeIndex === undefined || rig.tubes.length === 0 ? undefined : rig.tubes[((Math.floor(tubeIndex) % rig.tubes.length) + rig.tubes.length) % rig.tubes.length];
	const offset = mountOffset(rig);
	return weaponExitAlong(pivot, tube ? { x: offset.x + tube.x, y: offset.y + tube.y, elevation: offset.elevation + tube.elevation } : offset, direction);
};
export const weaponExitAlong = function (pivot: SpatialPoint, offset: SpatialPoint, direction: Readonly<SpatialPoint>): SpatialPoint {
	const yaw = Math.atan2(direction.y, direction.x); const horizontal = Math.hypot(direction.x, direction.y);
	const { x: forward, y: lateral, elevation: vertical } = offset;
	return {
		x: pivot.x + direction.x * forward - Math.sin(yaw) * lateral - Math.cos(yaw) * direction.elevation * vertical,
		y: pivot.y + direction.y * forward + Math.cos(yaw) * lateral - Math.sin(yaw) * direction.elevation * vertical,
		elevation: pivot.elevation + direction.elevation * forward + horizontal * vertical,
	};
};
export const limitWeaponTraverse = function (direction: SpatialPoint, limit: WeaponTraverse): SpatialPoint {
	const pitch = Math.atan2(direction.elevation, Math.hypot(direction.x, direction.y));
	const relative = Math.atan2(direction.y, direction.x) - limit.heading;
	const yaw = Math.atan2(Math.sin(relative), Math.cos(relative));
	if (Math.abs(yaw) <= limit.yaw && pitch >= -limit.down && pitch <= limit.up) return direction;
	const bearing = limit.heading + Math.max(-limit.yaw, Math.min(limit.yaw, yaw));
	const elevation = Math.max(-limit.down, Math.min(limit.up, pitch));
	return { x: Math.cos(bearing) * Math.cos(elevation), y: Math.sin(bearing) * Math.cos(elevation), elevation: Math.sin(elevation) };
};
export const getPlayerMuzzle = function (frame: FrameId, slot: number, body: WeaponBody, heading: number, tubeIndex?: number, target?: SpatialPoint, context?: AuthoredPoseContext): SpatialPoint {
	const binding = getMechAssetBinding(frame);
	if (binding?.muzzle) {
		const muzzle = binding.muzzle(body, heading, slot, tubeIndex, context);
		return { ...muzzle, elevation: (body.groundElevation ?? 0) + muzzle.elevation };
	}
	const rig = getPlayerWeaponRig(frame)[slot]; if (!rig) throw new RangeError(`Missing weapon rig ${frame}/${slot}`);
	return rigMuzzle(rig, body, heading, tubeIndex, target);
};
export const getEnemyMuzzle = function (kind: PresetEnemyKind, commander: boolean, slot: number, body: WeaponBody, heading: number, tubeIndex?: number, target?: SpatialPoint): SpatialPoint {
	const rig = getEnemyWeaponRig(kind, commander)[slot]; if (!rig) throw new RangeError(`Missing enemy weapon rig ${kind}/${slot}`);
	return rigMuzzle(rig, body, heading, tubeIndex, target);
};

// Fixed authored mounts share torso motion; projectiles still converge through
// gameplay aim. Procedural gimbals retain their existing direction solver.
export const getPlayerFiringDirection = function (frame: FrameId, slot: number, body: WeaponBody, heading: number, origin: SpatialPoint, target?: SpatialPoint): SpatialPoint {
	if (getMechAssetBinding(frame)?.muzzle) {
		if (!target) return forwardDirection(heading, body.aimSlope);
		const forward = (target.x - origin.x) * Math.cos(heading) + (target.y - origin.y) * Math.sin(heading);
		const adjustment = Math.max(0, 1 - forward);
		return getFiringDirection(origin, heading, { x: target.x + Math.cos(heading) * adjustment, y: target.y + Math.sin(heading) * adjustment, elevation: target.elevation });
	}
	const rig = getPlayerWeaponRig(frame)[slot];
	if (!rig) throw new RangeError(`Missing weapon rig ${frame}/${slot}`);
	// Untracked shots follow the pilot's aim between visual sectors. Tracked gimbals converge on the target.
	return target ? weaponDirection(rig, body, heading, target) : forwardDirection(heading, body.aimSlope);
};
