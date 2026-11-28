import { createWeaponRecord, getWeaponTier, type WeaponId, type WeaponModelId } from './arsenal';

const MODEL_PRICES: Readonly<Record<WeaponModelId, number>> = {
	'machine-gun': 500, autocannon: 750, laser: 800, 'stream-rockets': 850,
	'stream-rockets-4': 1700, 'stream-rockets-6': 2550, 'stream-missiles-4': 2000, 'stream-missiles-6': 3000,
	'cluster-rockets-4': 2400, 'cluster-rockets-6': 3600, 'cluster-missiles-4': 2800, 'cluster-missiles-6': 4200,
	'stream-missiles': 1000, 'cluster-rockets': 1200, 'cluster-missiles': 1400, ppc: 1500,
};
export const WEAPON_PRICES: Readonly<Record<WeaponId, number>> = createWeaponRecord(function (weapon) {
	return Math.round(MODEL_PRICES[weapon.modelId] * getWeaponTier(weapon.tier).price);
});
export const hullRepairCost = function (chassisPrice: number, integrity: number): number {
	return Math.ceil(integrity === 0 ? chassisPrice * .75 : chassisPrice * (100 - integrity) / 200);
};
