import { expect, test } from 'bun:test';
import { abandonContract, assignOperationLead, assignOperationSlot, commitOperations, createCampaign, getContracts, parseCampaign, recoverInterruptedDeployment, removeOperation, reviewOperations, settleContract, stageOperation, type Campaign } from '../src/campaign';
import { buyFrame, checkpointDeployment, getOwnedMech, queueRepair } from '../src/company';
import { dismissPilot, getPilotStats, hirePilot } from '../src/pilots';

const roundTrip = function (campaign: Campaign): Campaign { return parseCampaign(JSON.stringify(campaign)); };

test('a legacy staged defense retains its layout through review, mixed-day commitment, and save restoration', function () {
	const company = hirePilot(buyFrame({ ...createCampaign(317, 'career'), credits: 25_000 }, 'kestrel-b'), 'kite');
	const [crew, live] = getContracts(company);
	if (!crew || crew.kind !== 'defend' || !live) throw new Error('Missing local defense and live contracts');
	const staged = assignOperationSlot(stageOperation(stageOperation(company, live.id), crew.id), crew.id, 0, { pilotId: 'kite', frameId: 'kestrel-b' });
	const oldDefense = { ...crew };
	delete oldDefense.fieldLayout;
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

test('a saved mixed day settles the same crew sortie after extraction or interruption and advances work once', function () {
	const rigs = buyFrame(buyFrame(buyFrame({ ...createCampaign(318, 'career'), credits: 30_000 }, 'kestrel-b'), 'kestrel-c'), 'warden');
	const company = hirePilot(hirePilot(rigs, 'flint'), 'kite');
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
	const interrupted = roundTrip(checkpointDeployment(committed, 74, 1));
	expect(interrupted.deployed?.integrity).toBe(74);
	expect(interrupted.committedCrew?.[0]?.resolution.leaderId).toBe('kite');

	const won = settleContract(interrupted, true);
	const aborted = recoverInterruptedDeployment(interrupted);
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
		expect(saved.credits).toBe(ready.credits + (result.lastOperationDay?.reduce(function (total, report) { return total + report.payout; }, 0) ?? 0));
		expect(abandonContract(saved)).toBe(saved);
		expect(recoverInterruptedDeployment(saved)).toBe(saved);
	}
	const legacy = roundTrip({ ...interrupted, committedCrew: interrupted.committedCrew?.map(function ({ contract, resolution: { objective, extraction, squad } }) {
		return { contract, resolution: { objective, extraction, squad } };
	}) });
	const legacyReport = recoverInterruptedDeployment(legacy).lastOperationDay?.[1];
	expect(legacyReport?.crew).toEqual(crewReport.crew);
	expect(legacyReport?.payout).toBe(crewReport.payout);
	expect(legacyReport?.fieldLead).toBeUndefined();
});

test('a crew-only day saves every result and keeps the commander benched for the next plan', function () {
	const company = hirePilot(hirePilot(buyFrame({ ...createCampaign(317, 'career'), credits: 25_000 }, 'kestrel-b'), 'flint'), 'kite');
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
