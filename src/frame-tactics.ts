import { getFrame, type FrameId } from './frames';
import { getWeaponTier, type WeaponDefinition } from './arsenal';
import type { SpatialPoint } from './weapon-rig';

export const HARROW_MIN_RANGE = 200;
export const HARROW_MAX_RANGE = 1250;
export const HARROW_BRACE_SECONDS = .8;
export const BASTION_PLATE_DAMAGE = .53;
export const BASTION_PLATE_HALF_ARC = 55 * Math.PI / 180;
export const SPECTER_SURVEY_RANGE = 1100;
export const SPECTER_JAM_RANGE = 300;
export const SPECTER_JAM_RATE = .65;
export const SPECTER_MARK_RANGE = 800;
export const SPECTER_MARK_SECONDS = .6;
export const SPECTER_MARK_DAMAGE = 1.2;

const bombard = { name: 'Bombard mortar', radius: 85, damage: 96, interval: 3.2, offsets: [0], delay: 1.4, stagger: 0, facility: 1 };
const barrage = { name: 'Barrage mortar', radius: 55, damage: 51, interval: 4.1, offsets: [-90, 0, 90], delay: 1.25, stagger: .28, facility: 1 };
const siege = { name: 'Siege mortar', radius: 45, damage: 125, interval: 4, offsets: [0], delay: 1.55, stagger: 0, facility: 2 };

export const mortarProfile = function (frame: FrameId, slot = 0) {
	if (slot !== 0) return undefined;
	return frame === 'harrow' ? bombard : frame === 'harrow-b' ? barrage : frame === 'harrow-c' ? siege : undefined;
};

export const mountInterval = function (frame: FrameId, slot: number, weapon: WeaponDefinition): number {
	const mortar = mortarProfile(frame, slot);
	if (mortar) return mortar.interval * getWeaponTier(weapon.tier).interval;
	return weapon.kind === 'missile' && frame === 'morrow-pursuer' ? weapon.interval * .65 : weapon.interval;
};

export const mortarInRange = function (range: number): boolean {
	return range >= HARROW_MIN_RANGE - 1e-9 && range <= HARROW_MAX_RANGE + 1e-9;
};

export const hasBastionPlate = function (frame: FrameId): boolean {
	return frame === 'bastion' || frame === 'bastion-b' || frame === 'bastion-c';
};

// The incoming vector points back along the actual beam or projectile segment.
// Steep top-down impacts and all splash deliberately bypass the directional plate.
export const incomingArmor = function (frame: FrameId, turret: number, incoming?: SpatialPoint): number {
	if (hasBastionPlate(frame) && incoming && Math.hypot(incoming.x, incoming.y) > Math.abs(incoming.elevation)) {
		const bearing = Math.atan2(incoming.y, incoming.x) - turret;
		if (Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing))) <= BASTION_PLATE_HALF_ARC + 1e-9) return BASTION_PLATE_DAMAGE;
	}
	return getFrame(frame).incomingDamage;
};
