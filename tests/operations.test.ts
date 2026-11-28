import { withPilots, withRigs } from './company-fixture';
import { expect, test } from 'bun:test';
import { abandonContract, acceptContract, assignOperationLead, assignOperationSlot, commitOperations, createCampaign, forecastArrival, getContracts, parseCampaign, removeOperation, reviewOperations, settleContract, stageOperation, travelTo, type Campaign } from '../src/campaign';
import { advanceDays, checkpointDeployment, getOwnedMech, queueRepair } from '../src/company';
import { dismissPilot, getPilotStats } from '../src/pilots';
import { isArmoredReserveRaid } from '../src/strategic-impact';
import { getSystemIntel } from '../src/universe';

const roundTrip = function (campaign: Campaign): Campaign { return parseCampaign(JSON.stringify(campaign)); };

test('a local plan locks travel while the remote board still forecasts the actual arrival', function () {
	const company = createCampaign(317, 'career');
	const [local] = getContracts(company);
	if (!local) throw new Error('Missing local posting');
	const staged = stageOperation(company, local.id);
	const destination = 'system-4';
	expect(travelTo(staged, destination)).toBe(staged);
	const advertised = getContracts(forecastArrival(staged, destination));
	const arrival = travelTo(removeOperation(staged, local.id), destination);
	expect(arrival.planetId).toBe(destination);
	expect(advertised).toEqual(getContracts(arrival));
	expect(advertised.some(function (job) { return job.tier === 1 && isArmoredReserveRaid(job); })).toBe(true);
});

test('an expired staged defense remains in Operations when the local board goes quiet', function () {
	const company = advanceDays(travelTo(createCampaign(317, 'career'), 'system-28'), 2);
	const defense = getContracts(company).find(function (job) { return job.kind === 'defend' && job.tier === 1; });
	if (!defense) throw new Error('Missing defense at Redoubt Crossing');
	const staged = stageOperation(company, defense.id);
	expect(reviewOperations(staged).entries[0]?.postingAvailable).toBe(true);
	const quiet = roundTrip(advanceDays(staged, 1));
	expect(getContracts(quiet)).toBeEmpty();
	expect(reviewOperations(quiet).entries[0]).toMatchObject({ postingAvailable: false, operation: { contract: defense } });
	expect(commitOperations(quiet)).toBe(quiet);
});

test('a crew sortie that reopens the front suppresses an intermediate closure in the day debrief', function () {
	const start = { ...createCampaign(0, 'career'), credits: 25_000, planetId: 'system-6' as const };
	const company = withPilots(withRigs(start, 'kestrel-b'), 'flint');
	const board = getContracts(company);
	const defense = board.find(function (job) { return job.kind === 'defend' && job.tier === 1; });
	const strike = board.find(function (job) { return job.kind === 'assassination' && job.tier === 1; });
	if (!defense || !strike) throw new Error('Missing opposing contracts');
	const alone = settleContract(acceptContract(company, defense.id), true);
	expect(alone.lastResult?.front?.wentQuiet).toBe(true);
	const staged = stageOperation(stageOperation(company, defense.id), strike.id);
	const paired = assignOperationSlot(staged, strike.id, 0, { pilotId: 'flint', frameId: 'kestrel-b' });
	const returned = roundTrip(settleContract(commitOperations(paired), true));
	expect(getSystemIntel(returned, start.planetId)).toEqual(getSystemIntel(start, start.planetId));
	expect(returned.lastOperationDay?.map(function (report) { return [report.won, report.front, report.territory?.employerDelta]; })).toEqual([
		[true, undefined, 4], [true, undefined, 4],
	]);
});

test('a successful crew raid disrupts the same local opponent for one later player-led tank defense', function () {
	const start = createCampaign(4, 'career');
	const opening = getContracts(start).find(function (job) { return job.kind === 'raid' && job.tier === 1; });
	if (!opening) throw new Error('Missing opening raid');
	const returned = settleContract(acceptContract(start, opening.id), true);
	const company = assignOperationSlot(withPilots(returned, 'flint'), undefined, 0, { pilotId: 'flint', frameId: 'kestrel' });
	const raid = getContracts(company).find(function (job) { return job.tier === 1 && isArmoredReserveRaid(job); });
	if (!raid) throw new Error('Missing reserve raid');
	const staged = roundTrip(stageOperation(company, raid.id));
	expect(staged.operations?.[0]?.contract).toEqual(raid);
	expect(abandonContract(acceptContract(company, raid.id)).universe.disruptedReserves).toBeUndefined();
	const earned = roundTrip(commitOperations(staged));
	const reserves = [{ planetId: raid.planetId, factionId: raid.opponent }];
	expect(earned.universe.disruptedReserves).toEqual(reserves);
	const alreadyDisrupted = { ...company, universe: { ...company.universe, disruptedReserves: reserves } };
	expect(getContracts(alreadyDisrupted).some(isArmoredReserveRaid)).toBe(false);
	expect(earned.lastResult?.territory).toEqual({ employerDelta: 3, opponentDelta: -3 });
	expect(earned.lastResult?.front).toEqual({ ownerBefore: raid.opponent, ownerAfter: raid.employer, wentQuiet: false });
	expect(earned.lastResult?.crew?.extraction.passed).toBe(true);
	expect(settleContract(earned, true)).toBe(earned);
	const local = getContracts(earned).filter(function (job) { return job.kind === 'defend'; });
	const defense = local.find(function (job) { return job.tier === 2; });
	if (!defense?.delayedTanks) throw new Error('Expected a tagged tier-two defense');
	expect(defense.opponent).toBe(raid.opponent);
	expect(local.filter(function (job) { return job.tier === 1 || job.tier === 3; }).every(function (job) { return !job.delayedTanks; })).toBe(true);
	const elsewhere = getContracts(earned, 'system-5').find(function (job) { return job.kind === 'defend' && job.tier === 2; });
	expect(elsewhere?.opponent).toBe(raid.opponent);
	expect(elsewhere?.delayedTanks).toBeUndefined();
	const planned = roundTrip(stageOperation(earned, defense.id));
	expect(removeOperation(planned, defense.id).universe.disruptedReserves).toEqual(reserves);
	expect(commitOperations(planned).universe.disruptedReserves).toEqual(reserves); // Flint still leads.
	const live = roundTrip(commitOperations(assignOperationSlot(planned, defense.id, 0, { pilotId: 'player', frameId: 'kestrel' })));
	expect(live.active).toEqual(defense);
	expect(live.universe.disruptedReserves).toEqual([]);
	const after = roundTrip(abandonContract(live));
	expect(after.lastResult?.contract).toEqual(defense);
	expect(after.universe.disruptedReserves).toEqual([]);
	expect(abandonContract(after)).toBe(after);
});

test('a legacy staged defense retains its layout through review, mixed-day commitment, and save restoration', function () {
	const company = withPilots(withRigs({ ...createCampaign(317, 'career'), credits: 25_000 }, 'kestrel-b'), 'kite');
	const [crew, live] = getContracts(company);
	if (!crew || crew.kind !== 'defend' || !live) throw new Error('Missing local defense and live contracts');
	const staged = assignOperationSlot(stageOperation(stageOperation(company, live.id), crew.id), crew.id, 0, { pilotId: 'kite', frameId: 'kestrel-b' });
	const oldDefense = { ...crew };
	delete oldDefense.fieldLayout;
	delete oldDefense.strategy;
	const saved = roundTrip({ ...staged, operations: staged.operations?.map(function (operation) {
		return operation.contract.id === crew.id ? { ...operation, contract: oldDefense } : operation;
	}) });
	expect(getContracts(saved).find(function (contract) { return contract.id === crew.id; })).toEqual(oldDefense);
	expect(reviewOperations(saved).issues).toHaveLength(0);
	const committed = roundTrip(commitOperations(saved));
	expect(committed.active?.id).toBe(live.id);
	expect(committed.committedCrew?.[0]?.contract).toEqual(oldDefense);
	const restagedOffer = getContracts(removeOperation(saved, crew.id)).find(function (contract) { return contract.id === crew.id; });
	expect(restagedOffer?.fieldLayout).toBe('extended-defense');
});

test('a saved mixed day settles the same crew sortie after extraction or explicit abort and advances work and upkeep once', function () {
	const rigs = withRigs({ ...createCampaign(318, 'career'), day: 30, credits: 60_000 }, 'kestrel-b', 'kestrel-c', 'warden');
	const company = withPilots(rigs, 'flint', 'kite');
	const ready = queueRepair({ ...company, fleet: company.fleet.map(function (rig) { return rig.frameId === 'kestrel-c' ? { ...rig, integrity: 82 } : rig; }) }, 'kestrel-c');
	const [live, crew] = getContracts(ready);
	if (!live || !crew) throw new Error('Missing local contracts');
	const staged = stageOperation(stageOperation(ready, live.id), crew.id);
	expect(staged.reputation).toEqual(ready.reputation);
	expect(removeOperation(staged, crew.id).reputation).toEqual(ready.reputation);
	const conflict = assignOperationSlot(staged, crew.id, 0, { pilotId: 'flint', frameId: 'kestrel' });
	expect(reviewOperations(conflict).issues.some(function (issue) { return issue.includes('assigned to another sortie'); })).toBe(true);
	expect(commitOperations(conflict)).toBe(conflict);

	const paired = assignOperationSlot(assignOperationSlot(conflict, crew.id, 0, { pilotId: 'flint', frameId: 'kestrel-b' }), crew.id, 1, { pilotId: 'kite', frameId: 'warden' });
	const planned = roundTrip(assignOperationLead(paired, crew.id, 'kite'));
	expect(reviewOperations(planned).entries[1]?.leaderId).toBe('kite');
	expect(reviewOperations(dismissPilot(planned, 'kite')).entries[1]?.leaderId).toBe('flint');
	expect(reviewOperations(assignOperationSlot(planned, crew.id, 1, { pilotId: 'kite', frameId: null })).entries[1]?.leaderId).toBe('flint');
	const committed = commitOperations(planned);
	expect(committed.active?.id).toBe(live.id);
	expect(committed.deployed?.frameId).toBe('kestrel');
	expect(committed.day).toBe(ready.day);
	expect(committed.reputation[live.opponent]).toBe(ready.reputation[live.opponent] - live.hostility - (crew.opponent === live.opponent ? crew.hostility : 0));
	const restarted = roundTrip(committed);
	expect(restarted.committedCrew?.[0]?.resolution.leaderId).toBe('kite');
	const damaged = checkpointDeployment(restarted, 74, 1);
	const won = settleContract(damaged, true);
	const aborted = abandonContract(damaged);
	expect(aborted.lastOperationDay?.[0]?.aborted).toBe(true);
	expect(won.lastOperationDay?.[0]?.won).toBe(true);
	const liveFee = Math.round(live.reward / 4);
	expect(won.lastOperationDay?.[0]?.payout).toBe(live.reward + liveFee);
	expect(won.lastOperationDay?.[0]?.fieldLead).toEqual({ pilotId: 'player', fee: liveFee });
	expect(aborted.lastOperationDay?.[0]?.fieldLead).toEqual({ pilotId: 'player', fee: 0 });
	expect(aborted.lastOperationDay?.[1]?.contract.id).toBe(crew.id);
	const crewReport = won.lastOperationDay?.[1];
	if (!crewReport?.won) throw new Error('Mixed-day fixture should include a successful crew sortie');
	expect(crewReport.payout).toBe(crew.reward);
	expect(crewReport.fieldLead).toEqual({ pilotId: 'kite', fee: Math.round(crew.reward / 4) });
	expect(aborted.lastOperationDay?.[1]?.fieldLead).toEqual(crewReport.fieldLead);
	expect(aborted.lastOperationDay?.[1]?.crew).toEqual(won.lastOperationDay?.[1]?.crew);
	expect(aborted.lastOperationDay?.[1]?.squad).toEqual(won.lastOperationDay?.[1]?.squad);
	for (const result of [won, aborted]) {
		expect(result.lastOperationDay).toHaveLength(2);
		expect(getOwnedMech(result, 'kestrel')?.integrity).toBe(74);
		expect(getOwnedMech(result, 'kestrel-c')?.integrity).toBe(100);
		expect(result.day).toBe(ready.day + 1);
		expect(result.workOrders).toHaveLength(0);
		const saved = roundTrip(result);
		expect(saved.lastOperationDay).toEqual(result.lastOperationDay);
		// Three Kestrels, a Warden, and two hired pilots share one 4,500 CR bill.
		expect(saved.credits).toBe(ready.credits + (result.lastOperationDay?.reduce(function (total, report) { return total + report.payout; }, 0) ?? 0) - 4500);
		expect(abandonContract(saved)).toBe(saved);
	}
	const legacy = roundTrip({ ...restarted, committedCrew: restarted.committedCrew?.map(function ({ contract, resolution: { objective, extraction, squad } }) {
		return { contract, resolution: { objective, extraction, squad } };
	}) });
	const legacyReport = settleContract(legacy, true).lastOperationDay?.[1];
	expect(legacyReport?.crew).toEqual(crewReport.crew);
	expect(legacyReport?.payout).toBe(crewReport.payout);
	expect(legacyReport?.fieldLead).toBeUndefined();
});

test('a crew-only day saves every result and keeps the commander benched for the next plan', function () {
	const company = withPilots(withRigs({ ...createCampaign(317, 'career'), credits: 25_000 }, 'kestrel-b'), 'flint', 'kite');
	const [first, second] = getContracts(company);
	if (!first || !second) throw new Error('Missing local contracts');
	const lineup = assignOperationSlot(company, undefined, 0, { pilotId: 'flint', frameId: 'kestrel' });
	const staged = assignOperationSlot(stageOperation(stageOperation(lineup, first.id), second.id), second.id, 0, { pilotId: 'kite', frameId: 'kestrel-b' });
	const saved = roundTrip(commitOperations(staged));
	expect(saved.active).toBeUndefined();
	expect(saved.deployed).toBeUndefined();
	expect(saved.day).toBe(company.day + 1);
	expect(saved.boardRevision).toBe(company.boardRevision + 1);
	expect(saved.completed + saved.failed).toBe(2);
	expect(saved.lastOperationDay).toHaveLength(2);
	expect(saved.lastOperationDay?.every(function (report) { return report.crew && report.payout === (report.won ? report.contract.reward : 0); })).toBe(true);
	expect(saved.lastOperationDay?.every(function (report) { return report.fieldLead?.fee === (report.won ? Math.round(report.contract.reward / 4) : 0); })).toBe(true);
	expect(getPilotStats(saved, 'flint').wins).toBe(Number(saved.lastOperationDay?.find(function (report) { return report.contract.id === first.id; })?.won));
	expect(saved.preferredLineup?.[0]).toEqual({ pilotId: 'flint', frameId: 'kestrel' });
});
