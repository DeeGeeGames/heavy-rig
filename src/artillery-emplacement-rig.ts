import type { Point } from './simulation';
import type { SpatialPoint, WeaponRig } from './weapon-rig';

export const EMPLACEMENT_PIVOT_HEIGHT = 40;
export const EMPLACEMENT_BARREL_LENGTH = 80;
export const EMPLACEMENT_PITCH = 46 * Math.PI / 180;

export const emplacementWeaponRig: WeaponRig = {
	pivot: { x: 0, y: 0, elevation: EMPLACEMENT_PIVOT_HEIGHT },
	muzzle: { x: EMPLACEMENT_BARREL_LENGTH, y: 0, elevation: EMPLACEMENT_PIVOT_HEIGHT },
	tubes: [],
	fixedPitch: EMPLACEMENT_PITCH,
};

export const emplacementLaunch = function (position: Point, heading: number, groundElevation: number) {
	const horizontal = Math.cos(EMPLACEMENT_PITCH);
	const direction: SpatialPoint = { x: Math.cos(heading) * horizontal, y: Math.sin(heading) * horizontal, elevation: Math.sin(EMPLACEMENT_PITCH) };
	const origin: SpatialPoint = {
		x: position.x + EMPLACEMENT_BARREL_LENGTH * direction.x,
		y: position.y + EMPLACEMENT_BARREL_LENGTH * direction.y,
		elevation: groundElevation + EMPLACEMENT_PIVOT_HEIGHT + EMPLACEMENT_BARREL_LENGTH * direction.elevation,
	};
	return { origin, direction };
};
