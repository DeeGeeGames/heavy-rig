import { getWeapon, WEAPON_TIERS, weaponIdForTier, type WeaponId } from './arsenal';
import type { Campaign } from './campaign';
import { WEAPON_PRICES } from './equipment-prices';
import { getFrame, type FrameId } from './frames';
import { createStarterLoadout, getHardpoints, stockReserve } from './hardpoints';
import { unlockedMissionTier } from './reputation';

export interface FrameOffer {
	readonly frameId: FrameId;
	readonly loadout: readonly WeaponId[];
	readonly reserves: readonly number[];
	readonly price: number;
}
const loadedMass = function (frame: FrameId, slot: number, id: WeaponId): number {
	const weapon = getWeapon(id);
	return weapon.mass + (weapon.ammunition ? weapon.ammunition.mass * stockReserve(frame, slot, id) : 0);
};
// A posting is stable across navigation, purchases, waiting and reload. A jump,
// settled contract or quality unlock changes the seed; no persisted stock is needed.
export const getFrameOffer = function (campaign: Campaign, frameId: FrameId): FrameOffer {
	const frame = getFrame(frameId); const ceiling = unlockedMissionTier(campaign).weaponTier;
	let seed = campaign.seed;
	for (const character of `${campaign.planetId}/${campaign.boardRevision}/${frameId}/${ceiling}`) seed = (Math.imul(seed, 31) + character.charCodeAt(0)) >>> 0;
	const random = function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
	const hardpoints = getHardpoints(frameId);
	let remainingMass = frame.recommendedMass * 1.1 - frame.mass;
	const loadout = hardpoints.map(function (hardpoint, slot) {
		const reservedMass = hardpoints.slice(slot + 1).reduce(function (sum, mount, index) { return sum + Math.min(...mount.weapons.map(function (id) { return loadedMass(frameId, slot + index + 1, id); })); }, 0);
		const candidates = hardpoint.weapons.filter(function (id) { return loadedMass(frameId, slot, id) + reservedMass <= remainingMass + 0.000001; });
		const model = candidates[Math.floor(random() * candidates.length)];
		if (!model) throw new RangeError(`No complete market loadout fits ${frameId}/${hardpoint.id}`);
		remainingMass -= loadedMass(frameId, slot, model);
		const tier = ceiling > 0 && random() < .3 ? WEAPON_TIERS.find(function (entry) { return entry.tier === ceiling - 1; })?.tier ?? 0 : ceiling;
		return weaponIdForTier(model, tier);
	});
	const equipmentPrice = loadout.reduce(function (sum, id) { return sum + WEAPON_PRICES[id]; }, 0);
	const includedPrice = createStarterLoadout(frameId).reduce(function (sum, id) { return sum + WEAPON_PRICES[id]; }, 0);
	return { frameId, loadout, reserves: loadout.map(function (weapon, slot) { return stockReserve(frameId, slot, weapon); }), price: frame.price + Math.max(0, equipmentPrice - includedPrice) };
};
