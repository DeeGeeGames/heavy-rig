import type { WeaponId } from '../src/arsenal';
import type { Campaign } from '../src/campaign';
import type { FrameId } from '../src/frames';
import { stockPackage } from '../src/hardpoints';

// Workshop and sortie scenarios should not depend on a dealer's random assortment.
export const withWeapons = function (campaign: Campaign, ...weapons: readonly WeaponId[]): Campaign {
	const inventory = { ...campaign.inventory };
	for (const weapon of weapons) inventory[weapon]++;
	return { ...campaign, inventory };
};
export const withRigs = function (campaign: Campaign, ...frames: readonly FrameId[]): Campaign {
	return frames.reduce(function (company, frameId) {
		const rig = { frameId, integrity: 100, ...stockPackage(frameId) };
		return { ...withWeapons(company, ...rig.loadout), fleet: [...company.fleet, rig] };
	}, campaign);
};
