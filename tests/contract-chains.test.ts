import { expect, test } from 'bun:test';
import { abandonContract, acceptContract, canAcceptContract, createCampaign, getContracts, getTransmission, parseCampaign, settleContract, STARTING_CREDITS, travelTo, type Campaign } from '../src/campaign';
import type { MissionKind } from '../src/campaign-types';
import { advanceDays, beginDeployment, checkpointDeployment, getOwnedMech, queueRepair, repairDays } from '../src/company';
import { hirePilot } from '../src/pilots';

const roundTrip = function (campaign: Campaign) { return parseCampaign(JSON.stringify(campaign)); };
const opening = function () { return { ...createCampaign(317, 'campaign'), introComplete: true }; };
const offer = function (campaign: Campaign, kind: MissionKind) {
	const step = getTransmission(campaign)?.offers.find(function (entry) { return entry.contract.kind === kind; });
	if (!step) throw new Error(`Missing story offer: ${kind}`);
	return step;
};
const recover = function () {
	const campaign = travelTo(opening(), 'cinder');
	return settleContract(acceptContract(campaign, offer(campaign, 'recovery').contract.id), true);
};

test('only an explicitly started Campaign opens the chain after the escape, preserving unmarked v6 company state', function () {
	const starter = roundTrip(createCampaign(317, 'campaign'));
	const career = roundTrip(createCampaign(317, 'career'));
	expect(starter.mode).toBe('campaign');
	expect(starter.credits).toBe(750);
	expect(starter.introComplete).toBe(false);
	expect(getTransmission(starter)).toBeUndefined();
	expect(getTransmission({ ...starter, introComplete: true })?.offers).toHaveLength(1);
	expect(career.mode).toBe('career');
	expect(career.credits).toBe(starter.credits);
	expect(career.introComplete).toBe(true);
	expect(getTransmission(career)).toBeUndefined();
	for (const introComplete of [false, true]) {
		const legacy = { ...createCampaign(317), introComplete, credits: 5100 };
		const ordinary = getContracts(legacy)[0];
		if (!ordinary) throw new Error('Missing ordinary contract');
		const active = acceptContract(legacy, ordinary.id);
		expect(roundTrip(active)).toEqual(active);
		expect(getTransmission(roundTrip(active))).toBeUndefined();
	}
});

test('the opening offer survives ordinary contracts, front changes, transit and Engineering days', function () {
	const starter = opening();
	const recovery = offer(starter, 'recovery').contract;
	expect(canAcceptContract(starter, recovery)).toBe(false);
	expect(acceptContract(starter, recovery.id)).toBe(starter);
	const quiet = travelTo(starter, recovery.planetId);
	expect(getContracts(quiet)).toEqual([]);
	expect(canAcceptContract(quiet, recovery)).toBe(true);
	const ordinary = getContracts(starter)[0];
	if (!ordinary) throw new Error('Missing ordinary contract');
	const detour = settleContract(acceptContract(starter, ordinary.id), true);
	expect(detour.credits).toBe(starter.credits + ordinary.reward);
	expect(detour.story).toEqual(starter.story);
	expect(getContracts(detour).some(function (contract) { return contract.id === ordinary.id; })).toBe(false);
	const arrived = roundTrip(travelTo(advanceDays(travelTo(detour, 'borealis'), 91), recovery.planetId));
	expect(offer(arrived, 'recovery').contract).toEqual(recovery);
	expect(canAcceptContract(arrived, recovery)).toBe(true);
	const accepted = roundTrip(advanceDays(acceptContract(arrived, recovery.id), 4));
	expect(accepted.active).toEqual(recovery);
	expect(accepted.upkeepOwed).toBe(350);
	expect(travelTo(accepted, 'meridian')).toBe(accepted);
	const done = roundTrip(settleContract(accepted, true));
	expect(done.lastResult?.payout).toBe(recovery.reward);
	expect(done.credits).toBe(accepted.credits + recovery.reward - 350);
	expect(done.upkeepOwed).toBe(0);
	expect(acceptContract(done, recovery.id)).toBe(done);
	expect(getTransmission(done)?.offers.map(function ({ contract }) { return contract.kind; })).toEqual(['defend', 'demolition']);
});

test('choosing a branch commits on acceptance and pays out its distinct ending once', function () {
	const recovered = recover();
	const defense = offer(recovered, 'defend');
	const demolition = offer(recovered, 'demolition');
	expect(defense.contact).not.toBe(demolition.contact);
	expect(defense.success).not.toBe(demolition.success);
	expect(defense.contract.employer).not.toBe(demolition.contract.employer);
	for (const [chosen, other] of [[defense, demolition], [demolition, defense]] as const) {
		const accepted = roundTrip(acceptContract(recovered, chosen.contract.id));
		expect(accepted.active).toEqual(chosen.contract);
		expect(getTransmission(accepted)?.offers).toEqual([chosen]);
		const aborted = roundTrip(abandonContract(accepted));
		expect(aborted.credits).toBe(recovered.credits);
		expect(acceptContract(aborted, other.contract.id)).toBe(aborted);
		const departed = travelTo(aborted, 'meridian');
		const job = getContracts(departed)[0];
		if (!job) throw new Error('Missing ordinary contract');
		const detour = settleContract(acceptContract(departed, job.id), true);
		const returned = roundTrip(travelTo(detour, chosen.contract.planetId));
		expect(getTransmission(returned)?.offers).toEqual([chosen]);
		const completed = roundTrip(settleContract(acceptContract(returned, chosen.contract.id), true));
		expect(completed.credits).toBe(returned.credits + chosen.contract.reward);
		expect(completed.lastResult?.contract).toEqual(chosen.contract);
		expect(getTransmission(completed)?.last?.success).toBe(chosen.success);
		expect(getTransmission(completed)?.offers).toEqual([]);
		expect(settleContract(completed, true)).toBe(completed);
		expect(acceptContract(completed, chosen.contract.id)).toBe(completed);
		const laterJob = getContracts(completed)[0];
		if (!laterJob) throw new Error('Missing ordinary contract after chain');
		const later = roundTrip(settleContract(acceptContract(completed, laterJob.id), true));
		expect(later.lastResult?.contract).toEqual(laterJob);
		expect(getTransmission(later)?.last?.success).toBe(chosen.success);
	}
});

test('failure and explicit abort allow a wrecked starter to repair and retry at zero credits', function () {
	const arrived = travelTo(hirePilot(opening(), 'flint'), 'cinder');
	expect(arrived.credits).toBe(0);
	const recovery = offer(arrived, 'recovery').contract;
	const launched = beginDeployment(acceptContract(arrived, recovery.id));
	const wrecked = checkpointDeployment(launched, 0, 0);
	expect(getOwnedMech(roundTrip(wrecked))?.integrity).toBe(0);
	for (const failed of [settleContract(wrecked, false), abandonContract(wrecked)]) {
		expect(failed.credits).toBe(0);
		expect(failed.failed).toBe(1);
		expect(failed.active).toBeUndefined();
		expect(failed.deployed).toBeUndefined();
		expect(failed.lastResult?.payout).toBe(0);
		expect(offer(failed, 'recovery').contract).toEqual(recovery);
		const accepted = acceptContract(roundTrip(failed), recovery.id);
		expect(accepted.active).toEqual(recovery);
		expect(beginDeployment(accepted)).toBe(accepted);
		const repaired = roundTrip(advanceDays(roundTrip(queueRepair(accepted, accepted.selectedFrame)), repairDays(0)));
		expect(repaired.credits).toBe(0);
		expect(repaired.repairDebt).toBe(6000);
		expect(beginDeployment(repaired).deployed?.integrity).toBe(100);
		const cleared = roundTrip(settleContract(beginDeployment(repaired), true));
		expect(cleared.lastResult).toMatchObject({ payout: 1875, repairRepayment: 468 });
		expect(cleared.credits).toBe(1407);
		expect(cleared.repairDebt).toBe(5532);
		expect(settleContract(cleared, true)).toBe(cleared);
	}
});

test('a saved story transaction rejects a skipped step, a changed choice or altered terms', function () {
	const recovered = recover();
	const defense = offer(recovered, 'defend').contract;
	const demolition = offer(recovered, 'demolition').contract;
	const accepted = acceptContract(recovered, defense.id);
	const previousCopy = { ...accepted, active: { ...defense, title: 'Earlier title', briefing: 'Earlier briefing.' } };
	expect(roundTrip(previousCopy)).toEqual(accepted);
	const forged = [
		{ ...accepted, story: { ...accepted.story, committed: demolition.id } },
		{ ...accepted, active: { ...defense, reward: defense.reward + 100 } },
		{ ...recovered, story: { ...recovered.story, completed: [defense.id] } },
	];
	for (const save of forged) {
		const restored = parseCampaign(JSON.stringify(save));
		expect(restored.active).toBeUndefined();
		expect(restored.credits).toBe(STARTING_CREDITS);
		expect(getTransmission(restored)).toBeUndefined();
	}
});
