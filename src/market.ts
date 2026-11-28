import { getWeapon, WEAPON_MODELS, WEAPON_TIERS, weaponIdForTier, type WeaponId } from './arsenal';
import type { Campaign } from './campaign';
import { hullRepairCost, WEAPON_PRICES } from './equipment-prices';
import { getFrame, PLAYABLE_FRAMES, type FrameId } from './frames';
import { createStarterLoadout, getHardpoints, stockReserve } from './hardpoints';
import { companyRank, unlockedMissionTier } from './reputation';
import { mixSeed, randomSource } from './universe';

// Group by undiscounted chassis price so condition and installed weapons never
// move a rig into an earlier band. The most expensive band opens at rank 9 of 15.
const RIG_BANDS = [
	{ rank: 1, maxPrice: 11_400 },
	{ rank: 3, maxPrice: 12_600 },
	{ rank: 6, maxPrice: 13_800 },
	{ rank: 9, maxPrice: Infinity },
] as const;
const marketRandom = function (campaign: Campaign, channel: string) {
	let seed = mixSeed(campaign.seed, campaign.boardRevision);
	for (const character of `${campaign.planetId}/${channel}`) seed = mixSeed(seed, character.charCodeAt(0));
	return randomSource(seed);
};
const pick = function <T>(pool: readonly T[], count: number, random: () => number): T[] {
	return pool.map(function (value) { return { value, roll: random() }; })
		.sort(function (left, right) { return left.roll - right.roll; })
		.slice(0, count).map(function ({ value }) { return value; });
};
export const getMarketFrames = function (campaign: Campaign) {
	const rank = companyRank(campaign);
	const active = RIG_BANDS.filter(function (band) { return band.rank <= rank; });
	const ceiling = active.at(-1)?.maxPrice ?? RIG_BANDS[0].maxPrice;
	const previous = active.at(-2)?.maxPrice;
	const random = marketRandom(campaign, 'rigs');
	const eligible = PLAYABLE_FRAMES.filter(function (frame) { return frame.price <= ceiling; });
	const featured = previous === undefined ? [] : [
		...pick(eligible.filter(function (frame) { return frame.price > previous; }), 2, random),
		...pick(eligible.filter(function (frame) { return frame.price <= RIG_BANDS[0].maxPrice; }), 1, random),
	];
	return [...featured, ...pick(eligible.filter(function (frame) { return !featured.includes(frame); }), (previous === undefined ? 4 : 6) - featured.length, random)]
		.sort(function (left, right) { return left.price - right.price; });
};
export const getMarketWeapons = function (campaign: Campaign) {
	const grade = unlockedMissionTier(campaign).weaponTier;
	const random = marketRandom(campaign, 'weapons');
	const featured = (['ballistic', 'energy', 'launcher'] as const).flatMap(function (family) {
		return pick(WEAPON_MODELS.filter(function (model) { return model.family === family; }), 1, random);
	});
	const stocked = new Set([...featured, ...pick(WEAPON_MODELS.filter(function (model) { return !featured.includes(model); }), 8 - featured.length, random)]);
	return WEAPON_MODELS.filter(function (model) { return stocked.has(model); })
		.map(function (model) { return getWeapon(weaponIdForTier(model.modelId, grade)); });
};

export interface FrameOffer {
	readonly frameId: FrameId;
	readonly integrity: number;
	readonly restorationCost: number;
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
	const random = randomSource(seed);
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
	const integrity = 30 + Math.floor(marketRandom(campaign, `hull/${frameId}`)() * 66);
	const restorationCost = hullRepairCost(frame.price, integrity);
	return { frameId, integrity, restorationCost, loadout, reserves: loadout.map(function (weapon, slot) { return stockReserve(frameId, slot, weapon); }), price: frame.price - restorationCost + Math.max(0, equipmentPrice - includedPrice) };
};
