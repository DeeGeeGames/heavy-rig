import { createMount, getWeapon, isReserve, type WeaponId, type WeaponMount } from './arsenal';
import { getFrame, type FrameId } from './frames';

export interface ReactorState { heat: number; overheated: boolean }
export const HEAT_LOCK = 100;
export const HEAT_RECOVERY = 35;
export const defaultReserves = function (loadout: readonly (WeaponId | null)[]): number[] {
	return loadout.map(function (weapon) { return weapon === null ? 0 : getWeapon(weapon).ammunition?.defaultLoad ?? 0; });
};
export const isReserveLoadout = function (loadout: readonly (WeaponId | null)[], value: unknown): value is readonly number[] {
	return Array.isArray(value) && value.length === loadout.length && Array.from(value).every(function (rounds: unknown, slot) {
		const weapon = loadout[slot];
		return weapon === null ? rounds === 0 : weapon !== undefined && isReserve(weapon, rounds);
	});
};
export const loadedMounts = function (loadout: readonly (WeaponId | null)[], reserves: readonly number[] = defaultReserves(loadout)): WeaponMount[] {
	if (!isReserveLoadout(loadout, reserves)) throw new RangeError('Invalid ammunition loadout');
	return loadout.flatMap(function (weapon, slot) { return weapon === null ? [] : [{ ...createMount(weapon, reserves[slot]), slot }]; });
};
// At half the recommendation: +7.5%; at 150%: -50%. Never immobilize a unit.
export const weightSpeedModifier = function (weight: number, recommended: number): number {
	if (!Number.isFinite(weight) || weight < 0 || !Number.isFinite(recommended) || recommended <= 0) throw new RangeError('Invalid operating weight');
	const ratio = weight / recommended;
	return ratio <= 1 ? 1 + Math.min(0.15, (1 - ratio) * 0.15) : Math.max(0.35, 1 / (1 + (ratio - 1) * 2));
};
export const weightMetrics = function (base: number, recommended: number, mounts: readonly WeaponMount[]) {
	if (!Number.isFinite(base) || base <= 0) throw new RangeError('Invalid chassis mass');
	let hardware = 0; let ammunition = 0;
	for (const mount of mounts) {
		const weapon = getWeapon(mount.weapon);
		if (!isReserve(mount.weapon, mount.rounds)) throw new RangeError('Invalid remaining ammunition');
		hardware += weapon.mass; ammunition += (weapon.ammunition?.mass ?? 0) * mount.rounds;
	}
	const total = base + hardware + ammunition;
	return { base, hardware, ammunition, total, recommended, modifier: weightSpeedModifier(total, recommended) };
};
export const frameWeight = function (frameId: FrameId, mounts: readonly WeaponMount[]) {
	const frame = getFrame(frameId);
	const metrics = weightMetrics(frame.mass, frame.recommendedMass, mounts);
	return { ...metrics, speed: frame.speed * metrics.modifier };
};
export const usableMount = function (mount: WeaponMount): boolean { return getWeapon(mount.weapon).ammunition === null || mount.rounds > 0; };
export const coolReactor = function (reactor: ReactorState, cooling: number, dt: number) {
	reactor.heat = Math.max(0, reactor.heat - cooling * dt);
	if (reactor.overheated && reactor.heat <= HEAT_RECOVERY) reactor.overheated = false;
};
// Charge one emitted round, or the beam's active seconds. Lock immediately so
// another mount or a delayed volley cannot slip through in the same fixed tick.
export const consumeFire = function (mount: WeaponMount, reactor: ReactorState, beamSeconds = 0): boolean {
	if (!Number.isFinite(beamSeconds) || beamSeconds < 0) throw new RangeError('Invalid firing duration');
	if (reactor.heat >= HEAT_LOCK) reactor.overheated = true;
	if (reactor.overheated || !usableMount(mount)) return false;
	const weapon = getWeapon(mount.weapon);
	if (weapon.ammunition) mount.rounds--;
	reactor.heat = Math.min(HEAT_LOCK, reactor.heat + (weapon.kind === 'laser' ? weapon.heat * beamSeconds : weapon.heat / weapon.projectiles));
	if (reactor.heat >= HEAT_LOCK) reactor.overheated = true;
	return true;
};
