import { expect, test } from 'bun:test';
import { getWeapon, weaponIdForTier } from '../src/arsenal';
import { acceptContract, abandonContract, canAcceptContract, createCampaign, getContracts, parseCampaign, settleContract, travelTo, type Campaign } from '../src/campaign';
import { advanceDays, buyFrame, buyWeapon, getOwnedMech } from '../src/company';
import { frameWeight, loadedMounts } from '../src/combat-resources';
import { PLAYABLE_FRAMES } from '../src/frames';
import { isFrameLoadout } from '../src/hardpoints';
import { getFrameOffer } from '../src/market';
import { companyRank, MISSION_TIERS, REPUTATION_RANKS, unlockedMissionTier } from '../src/reputation';
import { createMissionState } from '../src/simulation';
import { visibleTouchContacts } from '../src/touch-controls';
import { generateMissionMap, isPriorityTarget, missionHostileCount, missionSpawn } from '../src/missions';

const ranked = function (rank: number): Campaign {
	return { ...createCampaign(317), companyReputation: REPUTATION_RANKS[rank - 1] ?? 0, credits: 1_000_000, reputation: { freeholds: 100, combine: 100, accord: 100 }, boardReputation: { freeholds: 100, combine: 100, accord: 100 } };
};
test('company milestones gate contract acceptance and both purchase paths, independently of money and faction favor', function () {
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
			const id = weaponIdForTier('laser', milestone.weaponTier);
			expect(buyWeapon(campaign, id) === campaign).toBe(!unlocked);
			for (const frame of PLAYABLE_FRAMES) {
				const offer = getFrameOffer(campaign, frame.id);
				expect(offer.loadout.every(function (weapon) { return getWeapon(weapon).tier <= unlockedMissionTier(campaign).weaponTier; })).toBe(true);
			}
		}
	}
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
		if (frame.id === 'kestrel') continue;
		const purchased = buyFrame(campaign, frame.id);
		expect(getOwnedMech(purchased, frame.id)?.loadout).toEqual(offer.loadout);
		expect(getOwnedMech(purchased, frame.id)?.reserves).toEqual(offer.reserves);
		expect(purchased.credits).toBe(campaign.credits - offer.price);
		for (const id of new Set(offer.loadout)) expect(purchased.inventory[id] - campaign.inventory[id]).toBe(offer.loadout.filter(function (weapon) { return weapon === id; }).length);
		expect(parseCampaign(JSON.stringify(purchased))).toEqual(purchased);
	}
	expect(packages.size).toBeGreaterThan(40);
});
test('mission tiers produce larger forces and tougher structures without granting catalog commanders inflated integrity', function () {
	let previousObjective = 0;
	for (const [index, level] of MISSION_TIERS.entries()) {
		const company = ranked(level.rank);
		const contract = getContracts(company).find(function (entry) { return entry.tier === level.tier && entry.kind === 'demolition'; });
		if (!contract) throw new Error('Missing tiered contract');
		const state = createMissionState(contract); const assassination = createMissionState({ ...contract, kind: 'assassination' });
		// Compare tiers on the same contract seed because their artillery ranges overlap.
		const lowerTier = MISSION_TIERS[index - 1];
		if (lowerTier) expect(state.enemies.length).toBeGreaterThan(missionHostileCount({ ...contract, tier: lowerTier.tier }));
		expect(state.mission?.structure?.hp ?? 0).toBeGreaterThan(previousObjective);
		const commander = assassination.enemies.find(function (enemy) { return enemy.id === assassination.mission?.targetId; });
		expect(commander?.hp).toBe(100);
		expect(PLAYABLE_FRAMES.some(function (frame) { return frame.id === commander?.catalog?.frameId; })).toBe(true);
		if (!commander) throw new Error('Missing priority target');
		expect(isPriorityTarget(assassination, commander)).toBe(true);
		expect(Boolean(commander.commander)).toBe(level.tier >= 4);
		expect(visibleTouchContacts(assassination, function () { return { x: 100, y: 100 }; }, 400, 400, []).find(function (contact) { return contact.id === commander.id; })?.label).toBe('PRIORITY TARGET');
		expect(state.enemies.every(function (enemy) { return enemy.loadout?.every(function (mount) { return getWeapon(mount.weapon).tier === level.weaponTier; }); })).toBe(true);
		expect(state.enemies.filter(function (enemy) { return enemy.kind !== 'artillery'; })).toHaveLength(level.patrol - (level.tier >= 4 ? 2 : 1));
		expect(assassination.enemies).toHaveLength(level.patrol);
		const restored = parseCampaign(JSON.stringify(acceptContract(company, contract.id))).active;
		if (!restored) throw new Error('Missing saved contract');
		const map = generateMissionMap(restored);
		const surveyed = Array.from({ length: missionHostileCount(restored) }, function (_, i) { return missionSpawn(restored, map, i); });
		expect(surveyed.map(function ({ kind, x, y }) { return { kind, x, y }; })).toEqual(
			state.enemies.map(function ({ kind, x, y }) { return { kind, x, y }; }));
		if (level.tier === 1) expect(state.enemies.every(function (enemy) { return enemy.kind === 'scout' || enemy.kind === 'helicopter' || enemy.kind === 'artillery'; })).toBe(true);
		if (level.tier >= 4) expect(state.enemies.some(function (enemy) { return enemy.kind === 'siege'; })).toBe(true);
		previousObjective = state.mission?.structure?.hp ?? 0;
	}
});
