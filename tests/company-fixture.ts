import { describeEvent } from '../src/company-event-catalog';
import { resolveCompanyEvent } from '../src/company-events';
import type { WeaponId } from '../src/arsenal';
import type { Campaign } from '../src/campaign';
import type { FrameId } from '../src/frames';
import { stockPackage } from '../src/hardpoints';
import { getPilot, type RECRUIT_IDS } from '../src/pilots';

// Fixed veterans keep dispatch odds and legacy-save scenarios independent of local applicants.
export const withPilots = function (campaign: Campaign, ...pilots: readonly (typeof RECRUIT_IDS)[number][]): Campaign {
	const fees = pilots.reduce(function (sum, id) { return sum + getPilot(id).price; }, 0);
	return { ...campaign, pilots: [...campaign.pilots, ...pilots], credits: campaign.credits - fees };
};

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

export const answerDecision = function (campaign: Campaign) {
	const pending = campaign.events?.pending;
	if (!pending) return campaign;
	const choice = describeEvent(campaign, pending).choices.find(function (entry) { return entry.enabled; });
	if (!choice) throw new Error('No available response');
	return resolveCompanyEvent(campaign, campaign.day, choice.id);
};
