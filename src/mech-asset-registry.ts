import type { Group, Vector3 } from 'three';
import type { FrameId } from './frames';
import type { WalkerGait } from './gait';
import { getHardpoints } from './hardpoints';
import type { MechFeedback } from './mech-3d';
import type { AuthoredPoseContext } from './authored-pose';
import type { SpatialPoint, WeaponBody, WeaponRig } from './weapon-rig';
import type { MechFinish } from './mech-skin';

export interface MechAssetModel {
	readonly root: Group;
	readonly rocketMuzzles: readonly (readonly Vector3[])[];
	readonly muzzles: readonly Vector3[];
	readonly exhaust: Vector3 | undefined;
	readonly labelHeight: number;
	pose: (gait: WalkerGait, heading: number, feedback?: MechFeedback) => void;
	dispose: () => void;
}

export interface MechAssetBinding {
	readonly create: (skin?: MechFinish) => MechAssetModel;
	readonly weaponRigs: readonly WeaponRig[];
	readonly advancePose?: (previous: AuthoredPoseContext | undefined, body: WeaponBody, time: number) => AuthoredPoseContext;
	readonly muzzle?: (body: WeaponBody, heading: number, slot: number, tubeIndex: number | undefined, context: AuthoredPoseContext | undefined) => SpatialPoint;
}

// A single optional binding changes rendering and combat origins together.
// Install before creating presentation models; ordinary frames keep their defaults.
const bindings = new Map<FrameId, MechAssetBinding>();

export const getMechAssetBinding = function (frame: FrameId): MechAssetBinding | undefined {
	return bindings.get(frame);
};

export const installMechAssetBinding = function (frame: FrameId, binding: MechAssetBinding): () => void {
	if (bindings.has(frame)) throw new Error(`An authored asset is already installed for ${frame}`);
	const mounts = getHardpoints(frame);
	if (binding.weaponRigs.length !== mounts.length) throw new Error(`Wrong authored weapon count for ${frame}`);
	for (const [slot, rig] of binding.weaponRigs.entries()) {
		if ([rig.muzzle, rig.pivot, ...rig.tubes].some(function (point) { return ![point.x, point.y, point.elevation].every(Number.isFinite); })) throw new Error(`Invalid authored weapon rig ${slot}`);
		if (mounts[slot]?.family !== 'launcher' && rig.tubes.length > 0) throw new Error(`Authored tube mapping on non-launcher ${slot}`);
	}
	bindings.set(frame, binding);
	let disposed = false;
	return function () {
		if (disposed) return;
		disposed = true;
		if (bindings.get(frame) === binding) bindings.delete(frame);
	};
};
