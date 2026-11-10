import type { ChassisId, FrameId } from './frames';

export interface LegRig {
	readonly hipHeight: number;
	readonly hipForward: number;
	readonly hipWidth: number;
	readonly upper: number;
	readonly lower: number;
	readonly kneeDirection: -1 | 1;
	readonly torsoRise?: number;
}
export const STANDARD_LEG_RIG: LegRig = { hipHeight: 48, hipForward: -2, hipWidth: 18, upper: 30, lower: 34, kneeDirection: -1 };

// Presentation anatomy, independent of frame balance and hitboxes.
const CHASSIS_RIGS: Readonly<Record<ChassisId, LegRig>> = {
	warden: STANDARD_LEG_RIG,
	kestrel: { hipHeight: 56, hipForward: -6, hipWidth: 16, upper: 30, lower: 40, kneeDirection: -1 },
	maul: { hipHeight: 78, hipForward: -2, hipWidth: 19, upper: 32, lower: 36, kneeDirection: 1, torsoRise: 22 },
	longbow: { hipHeight: 91, hipForward: -2, hipWidth: 16, upper: 38, lower: 43, kneeDirection: 1, torsoRise: 23 },
	morrow: { hipHeight: 43, hipForward: -5, hipWidth: 23, upper: 29, lower: 33, kneeDirection: -1 },
	rook: { hipHeight: 78, hipForward: 1, hipWidth: 17, upper: 32, lower: 35, kneeDirection: 1, torsoRise: 20 },
};

// Variant equipment changes the upper assembly, not the chassis leg geometry.
export const FRAME_RIGS: Readonly<Record<FrameId, LegRig>> = {
	warden: CHASSIS_RIGS.warden, 'warden-b': CHASSIS_RIGS.warden, 'warden-c': CHASSIS_RIGS.warden,
	kestrel: CHASSIS_RIGS.kestrel, 'kestrel-b': CHASSIS_RIGS.kestrel, 'kestrel-c': CHASSIS_RIGS.kestrel,
	maul: CHASSIS_RIGS.maul, 'maul-b': CHASSIS_RIGS.maul, 'maul-c': CHASSIS_RIGS.maul,
	longbow: CHASSIS_RIGS.longbow, 'longbow-b': CHASSIS_RIGS.longbow, 'longbow-c': CHASSIS_RIGS.longbow,
	morrow: CHASSIS_RIGS.morrow, 'morrow-b': CHASSIS_RIGS.morrow, 'morrow-c': CHASSIS_RIGS.morrow,
	rook: CHASSIS_RIGS.rook, 'rook-b': CHASSIS_RIGS.rook, 'rook-c': CHASSIS_RIGS.rook,
};
