import { expect, test } from 'bun:test';
import { getWeapon, weaponIdForTier } from '../src/arsenal';
import { acceptContract, abandonContract, canAcceptContract, canStageOperation, createCampaign, getContracts, getPlannedOperation, parseCampaign, removeOperation, reviewOperations, settleContract, stageOperation, travelTo, type Campaign } from '../src/campaign';
import type { Contract } from '../src/campaign-types';
import { advanceDays, buyFrame, buyWeapon, getOwnedMech, quoteRepair } from '../src/company';
import { frameWeight, loadedMounts } from '../src/combat-resources';
import { isFixedEmplacement } from '../src/combat-spatial';
import { PLAYABLE_FRAMES } from '../src/frames';
import { isFrameLoadout } from '../src/hardpoints';
import { getFrameOffer, getMarketFrames, getMarketWeapons } from '../src/market';
import { companyRank, MISSION_TIERS, REPUTATION_RANKS, unlockedMissionTier, weaponUnlockRank } from '../src/reputation';
import { createMissionState } from '../src/simulation';
import { visibleTouchContacts } from '../src/touch-controls';
import { generateMissionMap, isPriorityTarget, missionHostileCount, missionObjective, missionSpawn } from '../src/missions';

const ranked = function (rank: number): Campaign {
	return { ...createCampaign(317), companyReputation: REPUTATION_RANKS[rank - 1] ?? 0, credits: 1_000_000, reputation: { freeholds: 100, combine: 100, accord: 100 }, boardReputation: { freeholds: 100, combine: 100, accord: 100 } };
};
test('company milestones gate contract acceptance and market weapon grades independently of faction favor', function () {
	expect(MISSION_TIERS).toHaveLength(10);
	expect(([0, 1, 2, 3, 4, 5] as const).map(weaponUnlockRank)).toEqual([1, 3, 6, 9, 12, 15]);
	for (const milestone of MISSION_TIERS) {
		for (const rank of [milestone.rank, Math.max(1, milestone.rank - 1)]) {
			const campaign = ranked(rank); const unlocked = rank >= milestone.rank;
			expect(companyRank(campaign)).toBe(rank);
			const contracts = getContracts(campaign).filter(function (contract) { return contract.tier === milestone.tier; });
			expect(contracts).toHaveLength(7);
			for (const contract of contracts) {
				expect(canAcceptContract(campaign, contract)).toBe(unlocked);
				expect(acceptContract(campaign, contract.id) === campaign).toBe(!unlocked);
			}
			const [listing] = getMarketWeapons(campaign);
			if (!listing) throw new Error('Missing market weapon');
			const id = weaponIdForTier(listing.modelId, milestone.weaponTier);
			expect(buyWeapon(campaign, id) === campaign).toBe(listing.id !== id);
			for (const frame of PLAYABLE_FRAMES) {
				const offer = getFrameOffer(campaign, frame.id);
				expect(offer.loadout.every(function (weapon) { return getWeapon(weapon).tier <= unlockedMissionTier(campaign).weaponTier; })).toBe(true);
			}
		}
	}
});
test('six-tier v8 saves retain accepted and staged missions, payout, and opposition without duplicating postings', function () {
	const contract: Contract = {
		id: '317-0-meridian-assassination-2', seed: 962422262, planetId: 'meridian', kind: 'assassination', employer: 'accord', opponent: 'freeholds',
		title: 'Cut the command link', briefing: 'Signal Accord has identified a Frontier Freeholds commander coordinating the local offensive. Find and destroy the designated command frame. Supporting forces are optional targets. Leave the surface through the extraction zone.',
		reward: 3060, favor: 10, hostility: 8, tier: 2, requiredReputation: -15,
	};
	const state = { ...createCampaign(317, 'career'), companyReputation: 700, reputation: { freeholds: 50, combine: 50, accord: 50 }, boardReputation: { freeholds: 50, combine: 50, accord: 50 } };
	const current = getContracts(state).find(function (job) { return job.kind === 'assassination' && job.tier === 2; });
	if (!current) throw new Error('Missing new posting');
	const operation = stageOperation(state, current.id).operations?.[0];
	if (!operation) throw new Error('Missing staged operation');
	const staged = parseCampaign(JSON.stringify({ ...state, operations: [{ ...operation, contract }] }));
	expect(staged.operations?.[0]?.contract).toEqual(contract);
	expect(getPlannedOperation(staged, current.id)?.contract).toEqual(contract);
	expect(removeOperation(staged, current.id).operations).toEqual([]);
	expect(reviewOperations(staged).issues).toEqual([]);
	expect(canStageOperation(staged, current)).toBe(false);
	const accepted = parseCampaign(JSON.stringify({ ...state, active: contract, reputation: { ...state.reputation, freeholds: 42 } }));
	expect(accepted.active).toEqual(contract);
	if (!accepted.active) throw new Error('Saved contract was discarded');
	const deployed = createMissionState(accepted.active);
	expect(deployed.enemies.find(function (unit) { return unit.id === deployed.mission?.targetId; })?.catalog).toBeDefined();
	const won = settleContract(accepted, true);
	expect(won.lastResult).toMatchObject({ companyReputation: 90, payout: 3060, contract });
	expect(parseCampaign(JSON.stringify(won))).toEqual(won);
});
test('only a successful settlement grants company reputation, once, and the rank and active terms survive reload', function () {
	const campaign = createCampaign(317); const contract = getContracts(campaign)[0];
	if (!contract) throw new Error('Missing entry contract');
	const accepted = acceptContract(campaign, contract.id);
	for (const result of [abandonContract(accepted), settleContract(accepted, false)]) expect(result.companyReputation).toBe(0);
	const won = settleContract(parseCampaign(JSON.stringify(accepted)), true);
	expect(won.companyReputation).toBe(50);
	expect(won.lastResult?.companyReputation).toBe(50);
	expect(parseCampaign(JSON.stringify(won))).toEqual(won);
	expect(settleContract(won, true)).toBe(won);
	expect(advanceDays(won, 100).companyReputation).toBe(50);
	expect(travelTo(won, 'cinder').companyReputation).toBe(50);
	for (const value of [-1, 0.5, 1_000_000_001]) expect(parseCampaign(JSON.stringify({ ...won, companyReputation: value })).companyReputation).toBe(0);
});
test('every reputation rank retains faction-hostile recovery work', function () {
	for (const threshold of REPUTATION_RANKS) {
		const hostile = { ...createCampaign(317), companyReputation: threshold, reputation: { freeholds: -100, combine: -100, accord: -100 }, boardReputation: { freeholds: -100, combine: -100, accord: -100 } };
		const available = getContracts(hostile).filter(function (contract) { return canAcceptContract(hostile, contract); });
		expect(available).toHaveLength(7);
		expect(available.every(function (contract) { return contract.tier === 1; })).toBe(true);
	}
});
test('sale packages are complete, compatible, bounded in weight, reproducible, and transferred exactly including price and inventory', function () {
	const packages = new Set<string>();
	for (const rank of [1, 6, 15]) for (const seed of [1, 23, 317, 8192]) for (const frame of PLAYABLE_FRAMES) {
		const campaign = { ...ranked(rank), seed };
		const offer = getFrameOffer(campaign, frame.id);
		expect(offer).toEqual(getFrameOffer(parseCampaign(JSON.stringify(campaign)), frame.id));
		expect(offer).toEqual(getFrameOffer(advanceDays(campaign, 20), frame.id));
		expect(isFrameLoadout(frame.id, offer.loadout)).toBe(true);
		expect(offer.loadout.every(function (id) { const tier = getWeapon(id).tier; const ceiling = unlockedMissionTier(campaign).weaponTier; return tier <= ceiling && tier >= Math.max(0, ceiling - 1); })).toBe(true);
		const weight = frameWeight(frame.id, loadedMounts(offer.loadout, offer.reserves));
		expect(weight.total).toBeLessThanOrEqual(weight.recommended * 1.1 + .000001);
		packages.add(JSON.stringify(offer.loadout));
		if (frame.id === 'kestrel' || !getMarketFrames(campaign).some(function (item) { return item.id === frame.id; })) continue;
		const purchased = buyFrame(campaign, frame.id);
		expect(getOwnedMech(purchased, frame.id)?.integrity).toBe(offer.integrity);
		expect(offer.integrity).toBeGreaterThanOrEqual(30);
		expect(offer.integrity).toBeLessThanOrEqual(95);
		expect(quoteRepair(purchased, frame.id)?.cost).toBe(offer.restorationCost);
		expect(getOwnedMech(purchased, frame.id)?.loadout).toEqual(offer.loadout);
		expect(getOwnedMech(purchased, frame.id)?.reserves).toEqual(offer.reserves);
		expect(purchased.credits).toBe(campaign.credits - offer.price);
		for (const id of new Set(offer.loadout)) expect(purchased.inventory[id] - campaign.inventory[id]).toBe(offer.loadout.filter(function (weapon) { return weapon === id; }).length);
		expect(parseCampaign(JSON.stringify(purchased))).toEqual(purchased);
	}
	expect(packages.size).toBeGreaterThan(40);
});
test('market listings stay fixed until a jump or settlement and only listed price bands and models can be bought', function () {
	const listings = function (campaign: Campaign) {
		return {
			rigs: getMarketFrames(campaign).map(function (frame) { return getFrameOffer(campaign, frame.id); }),
			weapons: getMarketWeapons(campaign).map(function (weapon) { return weapon.id; }),
		};
	};
	const early = ranked(1); const stock = listings(early);
	const [job] = getContracts(early); const [weapon] = stock.weapons; const [rig] = stock.rigs;
	if (!job || !weapon || !rig) throw new Error('Missing starting posting');
	expect(listings(parseCampaign(JSON.stringify(early)))).toEqual(stock);
	expect(listings(advanceDays(early, 2))).toEqual(stock);
	expect(listings(buyFrame(buyWeapon(early, weapon), rig.frameId))).toEqual(stock);
	const jumped = listings(travelTo(early, 'cinder'));
	const settled = listings(settleContract(acceptContract(early, job.id), true));
	for (const restock of [jumped, settled]) {
		expect(restock.rigs.map(function (offer) { return offer.frameId; })).not.toEqual(stock.rigs.map(function (offer) { return offer.frameId; }));
		expect(restock.weapons).not.toEqual(stock.weapons);
	}
	for (const [rank, floor, ceiling] of [[1, 0, 11400], [3, 11400, 12600], [6, 12600, 13800], [9, 13800, 17500]] as const) {
		const campaign = ranked(rank);
		const rigs = getMarketFrames(campaign);
		const weapons = getMarketWeapons(campaign);
		expect(rigs).toHaveLength(rank === 1 ? 4 : 6);
		expect(new Set(rigs.map(function (item) { return item.id; })).size).toBe(rigs.length);
		expect(Math.max(...rigs.map(function (item) { return item.price; }))).toBeGreaterThan(floor);
		expect(rigs.every(function (item) { return item.price <= ceiling; })).toBe(true);
		expect(rigs.some(function (item) { return item.price <= 11400; })).toBe(true);
		expect(weapons).toHaveLength(8);
		expect(new Set(weapons.map(function (item) { return item.id; })).size).toBe(8);
		expect(new Set(weapons.map(function (item) { return item.family; })).size).toBe(3);
		for (const frame of PLAYABLE_FRAMES.filter(function (item) { return !rigs.includes(item); })) expect(buyFrame(campaign, frame.id)).toBe(campaign);
		for (const item of getMarketWeapons({ ...campaign, seed: campaign.seed + 1 })) if (!weapons.includes(item)) expect(buyWeapon(campaign, item.id)).toBe(campaign);
	}
});
test('mission tiers increase pressure and replace marked vehicles with rigs at tier 3 without inflating rig integrity', function () {
	let previousObjective = 0;
	for (const [index, level] of MISSION_TIERS.entries()) {
		const company = ranked(level.rank);
		const contract = getContracts(company).find(function (entry) { return entry.tier === level.tier && entry.kind === 'demolition'; });
		if (!contract) throw new Error('Missing tiered contract');
		const state = createMissionState(contract); const assassination = createMissionState({ ...contract, kind: 'assassination' });
		// Compare tiers on the same contract seed because their artillery ranges overlap.
		const lowerTier = MISSION_TIERS[index - 1];
		if (lowerTier) expect(state.enemies.length).toBeGreaterThanOrEqual(missionHostileCount({ ...contract, tier: lowerTier.tier }));
		expect(state.mission?.structure?.hp ?? 0).toBeGreaterThan(previousObjective);
		const commander = assassination.enemies.find(function (enemy) { return enemy.id === assassination.mission?.targetId; });
		if (!commander) throw new Error('Missing priority target');
		if (level.tier < 3) {
			expect(commander.kind).toBe(level.tier === 1 ? 'helicopter' : 'tank');
			expect(assassination.enemies.every(function (unit) { return unit.kind === 'helicopter' || unit.kind === 'tank'; })).toBe(true);
			expect(missionObjective(assassination)).toContain('command vehicle');
		} else {
			expect(commander.hp).toBe(100);
			expect(PLAYABLE_FRAMES.some(function (frame) { return frame.id === commander.catalog?.frameId; })).toBe(true);
		}
		expect(isPriorityTarget(assassination, commander)).toBe(true);
		expect(Boolean(commander.commander)).toBe(level.tier >= 7);
		expect(visibleTouchContacts(assassination, function () { return { x: 100, y: 100 }; }, 400, 400, []).find(function (contact) { return contact.id === commander.id; })?.label).toBe('PRIORITY TARGET');
		expect(state.enemies.every(function (enemy) { return enemy.loadout?.every(function (mount) { return getWeapon(mount.weapon).tier === level.weaponTier; }); })).toBe(true);
		const mobile = state.enemies.filter(function (enemy) { return !isFixedEmplacement(enemy.kind); });
		expect(mobile).toHaveLength(level.patrol - (level.tier >= 7 ? 2 : 1));
		expect(assassination.enemies).toHaveLength(level.patrol);
		const restored = parseCampaign(JSON.stringify(acceptContract(company, contract.id))).active;
		if (!restored) throw new Error('Missing saved contract');
		const map = generateMissionMap(restored);
		const surveyed = Array.from({ length: missionHostileCount(restored) }, function (_, i) { return missionSpawn(restored, map, i); });
		expect(surveyed.map(function ({ kind, x, y }) { return { kind, x, y }; })).toEqual(
			state.enemies.map(function ({ kind, x, y }) { return { kind, x, y }; }));
		if (level.tier < 3) expect(mobile.every(function (enemy) { return enemy.kind === 'helicopter' || enemy.kind === 'tank'; })).toBe(true);
		if (level.tier >= 7) expect(state.enemies.some(function (enemy) { return enemy.kind === 'siege'; })).toBe(true);
		previousObjective = state.mission?.structure?.hp ?? 0;
	}
});
