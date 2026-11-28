import { describe, expect, test } from 'bun:test';
import { abandonContract, acceptContract, canAcceptContract, createCampaign, getContracts, parseCampaign, settleContract, STARTING_CREDITS, travelTo, type Campaign } from '../src/campaign';
import type { Contract, MissionKind } from '../src/campaign-types';
import { getJumpRoute } from '../src/universe';
import { advanceDays, buyFrame } from '../src/company';
import { dismissPilot, hirePilot } from '../src/pilots';

const posted = function (campaign: Campaign, kind: MissionKind = 'defend'): Contract {
	const contract = getContracts(campaign).find(function (entry) { return entry.kind === kind; });
	if (!contract) throw new Error(`Missing ${kind} contract`);
	return contract;
};
const roundTrip = function (campaign: Campaign) { return parseCampaign(JSON.stringify(campaign)); };

describe('Heavy Rig campaign transactions and recovery', function () {
	test('monthly upkeep bills owned rigs and retained pilots only at crossed month boundaries', function () {
		const bought = buyFrame({ ...createCampaign(7), credits: 60_000 }, 'longbow-b');
		const staffed = hirePilot(hirePilot(bought, 'flint'), 'kite');
		const roster = dismissPilot(staffed, 'kite');
		expect(roster.fleet).toHaveLength(2);
		expect(roster.pilots).toEqual(['player', 'flint']);
		const beforeMonthEnd = advanceDays(roster, 29);
		expect(beforeMonthEnd.day).toBe(30);
		expect(beforeMonthEnd.credits).toBe(roster.credits);
		const afterTwoBills = roundTrip(advanceDays(beforeMonthEnd, 31));
		expect(afterTwoBills.day).toBe(61);
		// 40T Kestrel + 65T Longbow, excluding the variant's extra mount, plus one pilot.
		expect(afterTwoBills.credits).toBe(roster.credits - 2 * 2325);
		expect(advanceDays(afterTwoBills, 1).credits).toBe(afterTwoBills.credits);
	});

	test('a month-end jump can use the exact fare, with unpaid upkeep recovered from later work', function () {
		const fare = getJumpRoute('meridian', 'cinder').fare;
		const departure = { ...advanceDays(createCampaign(7), 29), credits: fare };
		const failedJump = { ...departure, credits: fare - 1 };
		expect(travelTo(failedJump, 'cinder')).toBe(failedJump);
		const arrival = roundTrip(travelTo(departure, 'cinder'));
		expect(arrival.planetId).toBe('cinder');
		expect(arrival.day).toBe(31);
		expect(arrival.credits).toBe(0);
		expect(arrival.upkeepOwed).toBe(600);
		const contract = posted(arrival);
		const settled = settleContract(acceptContract(arrival, contract.id), true);
		expect(settled.lastResult?.payout).toBe(contract.reward);
		expect(settled.credits).toBe(contract.reward - 600);
		expect(settled.upkeepOwed).toBe(0);
	});

	test('upkeep leaves an affordable exit fare intact when arriving somewhere with no work', function () {
		const origin = 'meridian';
		const destination = 'borealis';
		const fare = getJumpRoute(origin, destination).fare;
		const departure = { ...advanceDays(createCampaign(7), 29), credits: 2 * fare };
		const arrival = roundTrip(travelTo(departure, destination));
		expect(getContracts(arrival)).toHaveLength(0);
		expect(arrival.credits).toBe(fare);
		expect(arrival.upkeepOwed).toBe(600);
		const home = travelTo(arrival, origin);
		expect(home.planetId).toBe(origin);
		expect(home.credits).toBe(0);
	});

	test('boards are reproducible, contain each mission type, and advance after travel', function () {
		const campaign = createCampaign(317);
		const contracts = getContracts(campaign);
		expect(contracts).toEqual(getContracts(createCampaign(317)));
		expect(new Set(contracts.map(function (entry) { return entry.kind; }))).toEqual(new Set(['defend', 'demolition', 'assassination', 'clearance', 'raid', 'recovery', 'acquisition']));
		expect(contracts.every(function (entry) { return entry.employer !== entry.opponent && (canAcceptContract(campaign, entry) === (entry.tier === 1)); })).toBe(true);
		const otherWorld = getContracts(campaign, 'borealis');
		expect(otherWorld.every(function (contract) { return !canAcceptContract(campaign, contract); })).toBe(true);
		expect(travelTo(campaign, 'meridian')).toBe(campaign);
		const returned = travelTo(travelTo(campaign, 'borealis'), 'meridian');
		expect(returned.credits).toBe(campaign.credits - 2 * getJumpRoute('meridian', 'borealis').fare);
		expect(returned.day).toBe(3);
		expect(getContracts(returned).map(function (entry) { return entry.seed; })).not.toEqual(contracts.map(function (entry) { return entry.seed; }));
		expect(acceptContract(returned, posted(campaign).id)).toBe(returned);
		expect(roundTrip(returned)).toEqual(returned);
	});

	test('acceptance charges the opponent once, freezes postings, and locks travel until settlement', function () {
		const campaign = createCampaign(41);
		const before = JSON.stringify(campaign);
		const contract = posted(campaign);
		const accepted = acceptContract(campaign, contract.id);
		expect(accepted.active).toEqual(contract);
		expect(accepted.reputation[contract.opponent]).toBe(-contract.hostility);
		expect(accepted.reputation[contract.employer]).toBe(0);
		expect(accepted.credits).toBe(campaign.credits);
		expect(getContracts(accepted)).toEqual(getContracts(campaign));
		expect(JSON.stringify(campaign)).toBe(before);
		expect(acceptContract(accepted, contract.id)).toBe(accepted);
		expect(acceptContract(accepted, posted(campaign, 'clearance').id)).toBe(accepted);
		expect(travelTo(accepted, 'cinder')).toBe(accepted);
		const restored = roundTrip(accepted);
		expect(restored).toEqual(accepted);
		expect(acceptContract(restored, contract.id)).toBe(restored);
	});

	test('a successful extraction pays and grants favor exactly once, including across reload', function () {
		const campaign = createCampaign(7);
		const contract = posted(campaign, 'demolition');
		const accepted = roundTrip(acceptContract(campaign, contract.id));
		const settled = settleContract(accepted, true);
		expect(settled.active).toBeUndefined();
		expect(settled.reputation[contract.employer]).toBe(contract.favor);
		expect(settled.reputation[contract.opponent]).toBe(-contract.hostility);
		expect(settled.credits).toBe(campaign.credits + contract.reward);
		expect(settled.completed).toBe(1);
		expect(settled.failed).toBe(0);
		expect(settled.lastResult).toEqual({ contract, won: true, aborted: false, payout: contract.reward, favor: contract.favor, companyReputation: 50, day: 2 });
		const restored = roundTrip(settled);
		expect(restored).toEqual(settled);
		expect(settleContract(restored, true)).toBe(restored);
		expect(abandonContract(restored)).toBe(restored);
		expect(acceptContract(restored, contract.id)).toBe(restored);
		expect(getContracts(settled).some(function (entry) { return entry.id === contract.id; })).toBe(false);
	});

	test('failure and abandonment preserve the acceptance penalty without paying success rewards', function () {
		for (const abort of [false, true]) {
			const campaign = createCampaign(99);
			const contract = posted(campaign, 'assassination');
			const accepted = acceptContract(campaign, contract.id);
			const failed = abort ? abandonContract(accepted) : settleContract(accepted, false);
			expect(failed.active).toBeUndefined();
			expect(failed.credits).toBe(campaign.credits);
			expect(failed.reputation).toEqual(accepted.reputation);
			expect(failed.completed).toBe(0);
			expect(failed.failed).toBe(1);
			expect(failed.lastResult?.aborted).toBe(abort);
			expect(failed.lastResult?.payout).toBe(0);
			expect(failed.lastResult?.favor).toBe(0);
			expect(roundTrip(failed)).toEqual(failed);
			expect(travelTo(failed, 'borealis').planetId).toBe('borealis');
		}
	});

	test('reputation changes payout and gates high-tier work without removing recovery contracts', function () {
		const campaign = createCampaign(123);
		const hostile: Campaign = { ...campaign, day: 3, boardRevision: 2, completed: 2, companyReputation: 9200, reputation: { freeholds: -100, combine: -100, accord: -100 }, boardReputation: { freeholds: -100, combine: -100, accord: -100 } };
		const friendly: Campaign = { ...hostile, reputation: { freeholds: 100, combine: 100, accord: 100 }, boardReputation: { freeholds: 100, combine: 100, accord: 100 } };
		const offers = getContracts(hostile);
		expect(offers.filter(function (entry) { return canAcceptContract(hostile, entry); })).toHaveLength(7);
		for (const contract of offers.filter(function (entry) { return entry.tier > 1; })) expect(acceptContract(hostile, contract.id)).toBe(hostile);
		expect(getContracts(friendly).every(function (entry) { return canAcceptContract(friendly, entry); })).toBe(true);
		expect(posted(friendly).reward).toBeGreaterThan(posted(hostile).reward);
		const accepted = acceptContract(hostile, posted(hostile).id);
		expect(roundTrip(accepted)).toEqual(accepted);
		expect(accepted.reputation[posted(hostile).opponent]).toBe(-100);
		const alliedAccepted = acceptContract(friendly, posted(friendly).id);
		const alliedSettled = settleContract(alliedAccepted, true);
		expect(alliedSettled.reputation[posted(friendly).employer]).toBe(100);
		expect(alliedSettled.lastResult?.favor).toBe(0);
		expect(roundTrip(alliedSettled)).toEqual(alliedSettled);
	});

	test('corrupt storage cannot restore half-paid acceptance or fabricated contract rewards', function () {
		const campaign = createCampaign(123);
		const accepted = acceptContract(campaign, posted(campaign).id);
		const contract = accepted.active;
		if (!contract) throw new Error('Acceptance failed');
		const malformed: unknown[] = [
			undefined, [], null, { ...campaign, version: 1 }, { ...campaign, credits: -1 }, { ...campaign, completed: 0.5 },
			{ ...campaign, reputation: { freeholds: 0, combine: 0, accord: 101 } },
			{ ...accepted, reputation: campaign.reputation },
			{ ...accepted, active: { ...contract, reward: contract.reward + 100 } },
			{ ...accepted, active: { ...contract, seed: contract.seed + 1 } },
			{ ...accepted, active: { ...contract, planetId: 'cinder' } },
			{ ...accepted, active: { ...contract, opponent: contract.employer } },
			{ ...accepted, active: { ...contract, briefing: '<script>untrusted contract</script>' } },
			{ ...campaign, lastResult: { contract, won: false, aborted: true, payout: 100, favor: 0, day: 2 } },
		];
		for (const value of malformed) {
			const restored = parseCampaign(JSON.stringify(value) ?? null);
			expect(restored.active).toBeUndefined();
			expect(restored.credits).toBe(STARTING_CREDITS);
			expect(restored.reputation).toEqual({ freeholds: 0, combine: 0, accord: 0 });
			expect(restored.day).toBe(1);
		}
		expect(parseCampaign('{broken').active).toBeUndefined();
		expect(parseCampaign(null).planetId).toBe('meridian');
	});
});

test('an accepted v6 contract is discarded with the rest of the old company', async function () {
	const raw = await Bun.file(new URL('./fixtures/accepted-contract-v6.json', import.meta.url)).text();
	const restored = parseCampaign(raw);
	expect(restored.active).toBeUndefined();
	expect(restored.pilots).toEqual(['player']);
	expect(restored.credits).toBe(STARTING_CREDITS);
});

test('new mission contracts restore and settle their payment exactly once', function () {
	for (const kind of ['raid', 'recovery', 'acquisition'] as const) {
		const campaign = createCampaign(317); const offer = posted(campaign, kind);
		const accepted = roundTrip(acceptContract(campaign, offer.id));
		expect(accepted.active).toEqual(offer);
		const settled = roundTrip(settleContract(accepted, true));
		expect(settled.credits).toBe(campaign.credits + offer.reward); expect(settled.completed).toBe(1);
		expect(settleContract(settled, true)).toBe(settled);
	}
});

test('new defense postings use the extended layout but already accepted defense saves keep their original layout', function () {
	for (const boardVersion of [1, 2] as const) {
		const fresh = createCampaign(317);
		const campaign: Campaign = { ...fresh, universe: { ...fresh.universe, boardVersion } };
		const defense = posted(campaign);
		expect(defense.fieldLayout).toBe('extended-defense');
		expect(getContracts(campaign).filter(function (contract) { return contract.fieldLayout !== undefined && contract.kind !== 'defend'; })).toHaveLength(0);

		const accepted = acceptContract(campaign, defense.id);
		expect(roundTrip(accepted).active).toEqual(defense);
		const oldDefense = { ...defense };
		delete oldDefense.fieldLayout;
		const restored = roundTrip({ ...accepted, active: oldDefense });
		expect(restored.active).toEqual(oldDefense);
		expect(posted(restored)).toEqual(oldDefense);
		expect(settleContract(restored, true).lastResult?.contract).toEqual(oldDefense);

		// Tier 1 terms are the same across the six- and ten-tier boards.
		const sixTierDefense = { ...oldDefense, id: oldDefense.id.replace(/^mission:/, '') };
		const historical = roundTrip({ ...accepted, active: sixTierDefense });
		expect(historical.active).toEqual(sixTierDefense);
		expect(settleContract(historical, true).lastResult?.contract).toEqual(sixTierDefense);
	}
});

test('accepted acquisition saves preserve their current deadline and reject altered terms', function () {
	for (const boardVersion of [1, 2] as const) {
		const campaign = { ...createCampaign(317), credits: 12500 };
		campaign.universe = { ...campaign.universe, boardVersion };
		const accepted = acceptContract(campaign, posted(campaign, 'acquisition').id);
		const contract = accepted.active;
		if (!contract) throw new Error('Missing accepted acquisition');
		expect(roundTrip(accepted)).toEqual(accepted);
		const settled = settleContract(roundTrip(accepted), true);
		expect(settled.credits).toBe(campaign.credits + contract.reward);
		expect(settleContract(settled, true)).toBe(settled);
		for (const active of [{ ...contract, reward: contract.reward + 1 }, { ...contract, briefing: contract.briefing.replace('within 4 minutes.', 'within three minutes.') }]) {
			const rejected = roundTrip({ ...accepted, active });
			expect(rejected.active).toBeUndefined();
			expect(rejected.credits).toBe(STARTING_CREDITS);
		}
	}
});
