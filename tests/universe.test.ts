import { describe, expect, test } from 'bun:test';
import { acceptContract, createCampaign, getContracts, parseCampaign, settleContract, travelTo } from '../src/campaign';
import { advanceDays } from '../src/company';
import { applyMissionInfluence, FACTION_IDS, getPlanet, getSystemIntel, PLANETS, territoryScores } from '../src/universe';
import { generateMissionMap } from '../src/missions';

describe('territory campaign', function () {
	test('the seeded chart has faction interiors, conflict fronts, and unclaimed systems', function () {
		for (const seed of [0, 317, 0x7fffffff, 0xffffffff]) {
			const campaign = createCampaign(seed);
			expect(PLANETS.length).toBeGreaterThan(60);
			expect(new Set(PLANETS.map(function (world) { return world.id; })).size).toBe(PLANETS.length);
			const intel = PLANETS.map(function (world) { return getSystemIntel(campaign, world.id); });
			for (const id of FACTION_IDS) expect(intel.some(function (system) { return system.owner === id && !system.conflict; })).toBe(true);
			expect(intel.some(function (system) { return system.owner === undefined; })).toBe(true);
			expect(intel.some(function (system) { return system.conflict; })).toBe(true);
			expect(getSystemIntel(campaign, 'meridian').conflict).toBe(true);
			expect(intel).toEqual(PLANETS.map(function (world) { return getSystemIntel(createCampaign(seed), world.id); }));
		}
	});

	test('every posted contract uses local belligerents and the selected system biome', function () {
		for (const seed of [1, 317, 0xffffffff]) {
			const campaign = createCampaign(seed);
			for (const world of PLANETS) {
				const intel = getSystemIntel(campaign, world.id);
				const contracts = getContracts(campaign, world.id);
				expect(contracts.length).toBe(intel.conflict ? 4 : 0);
				for (const contract of contracts) {
					expect(contract.employer).not.toBe(contract.opponent);
					expect(intel.participants).toContain(contract.employer);
					expect(intel.participants).toContain(contract.opponent);
					expect(generateMissionMap(contract).biome).toBe(world.biome);
				}
			}
		}
	});

	test('wins can change control, losses help the opponent, and influence survives reload', function () {
		const campaign = createCampaign(317); const world = getPlanet('meridian');
		const contract = getContracts(campaign).find(function (entry) { return entry.employer !== getSystemIntel(campaign, 'meridian').owner; });
		if (!contract) throw new Error('Missing counteroffensive');
		const before = territoryScores(campaign, world.x, world.y);
		const accepted = acceptContract(campaign, contract.id);
		const won = settleContract(accepted, true); const lost = settleContract(accepted, false);
		expect(territoryScores(won, world.x, world.y)[contract.employer]).toBeGreaterThan(before[contract.employer]);
		expect(territoryScores(lost, world.x, world.y)[contract.opponent]).toBeGreaterThan(before[contract.opponent]);
		expect(parseCampaign(JSON.stringify(won))).toEqual(won);
		let universe = campaign.universe;
		for (let index = 0; index < 12; index++) universe = applyMissionInfluence(universe, world.id, contract.employer, contract.opponent, true);
		expect(getSystemIntel({ ...campaign, universe }, world.id).owner).toBe(contract.employer);
		expect(universe.influence).toHaveLength(2);
		expect(universe.influence.every(function (entry) { return Math.abs(entry.value) <= 18; })).toBe(true);
		expect(campaign.universe.influence).toEqual([]);
	});

	test('calendar movement updates live offers while accepted terms remain frozen', function () {
		const campaign = createCampaign(317); const later = advanceDays(campaign, 25);
		expect(territoryScores(later, 40, 48)).not.toEqual(territoryScores(campaign, 40, 48));
		for (const world of PLANETS) {
			const intel = getSystemIntel(later, world.id);
			expect(getContracts(later, world.id).length).toBe(intel.conflict ? 4 : 0);
		}
		const offer = getContracts(campaign)[0]; if (!offer) throw new Error('Missing offer');
		const accepted = advanceDays(acceptContract(campaign, offer.id), 30);
		expect(getContracts(accepted)).toContainEqual(offer);
		expect(parseCampaign(JSON.stringify(accepted))).toEqual(accepted);
		const remote = PLANETS.find(function (world) { return world.id.startsWith('system-'); });
		if (!remote) throw new Error('Missing generated world');
		const traveled = travelTo(campaign, remote.id);
		expect(parseCampaign(JSON.stringify(traveled))).toEqual(traveled);
	});

	test('older campaign versions and missing universe snapshots start a fresh company', function () {
		const campaign = createCampaign(41);
		const offer = getContracts(campaign)[0]; if (!offer) throw new Error('Missing offer');
		const accepted = acceptContract(campaign, offer.id);
		for (const invalid of [{ ...accepted, version: 3 }, { ...accepted, universe: undefined }]) {
			const restored = parseCampaign(JSON.stringify(invalid));
			expect(restored.version).toBe(4); expect(restored.active).toBeUndefined();
			expect(restored.completed).toBe(0); expect(restored.day).toBe(1);
		}
	});

	test('malformed influence and front snapshots cannot restore a partial campaign', function () {
		const campaign = createCampaign(317);
		for (const universe of [
			{ ...campaign.universe, boardDay: 2 }, { ...campaign.universe, boardVersion: 9 },
			{ ...campaign.universe, influence: [{ planetId: 'system-999', factionId: 'combine', value: 3 }] },
			{ ...campaign.universe, influence: [{ planetId: 'meridian', factionId: 'pirates', value: 3 }] },
			{ ...campaign.universe, influence: [{ planetId: 'meridian', factionId: 'combine', value: 19 }] },
			{ ...campaign.universe, influence: Array.from({ length: 2 }, function () { return { planetId: 'meridian', factionId: 'combine', value: 3 }; }) },
		]) expect(parseCampaign(JSON.stringify({ ...campaign, credits: 123, universe })).credits).toBe(0);
	});
});
