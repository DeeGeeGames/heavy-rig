import type { WeaponDefinition, WeaponModelId } from './arsenal';
import type { WeaponRig } from './weapon-rig';

export const SILO_HEAD_HEIGHT = 48;
const pivot = { x: 0, y: 0, elevation: 38 };
const lengths: Readonly<Record<WeaponDefinition['kind'], number>> = {
	bullet: 34, cannon: 44, laser: 31, ppc: 39, missile: 24, rocket: 29,
};
const rigs = new Map<WeaponModelId, WeaponRig>();

// Lift waits for the doors to part. The carriage and sight disappear completely
// beneath the closed hatch and ease to a stop at firing height.
export const siloLiftOffset = function (deployment: number): number {
	const t = Math.max(0, Math.min(1, (deployment - .32) / .68));
	return -52 * (1 - t * t * (3 - 2 * t));
};

export const siloWeaponRig = function (weapon: WeaponDefinition): WeaponRig {
	const cached = rigs.get(weapon.modelId);
	if (cached) return cached;
	const count = weapon.family === 'launcher' ? weapon.projectiles : 0;
	const rows = count > 2 ? 2 : 1, columns = Math.ceil(count / rows);
	const tubes = Array.from({ length: count }, function (_, index) {
		return { x: 0, y: (index % columns - (columns - 1) / 2) * 8.5, elevation: (Math.floor(index / columns) - (rows - 1) / 2) * 8 };
	});
	const rig = { pivot, muzzle: { ...pivot, x: lengths[weapon.kind] }, tubes };
	rigs.set(weapon.modelId, rig);
	return rig;
};
