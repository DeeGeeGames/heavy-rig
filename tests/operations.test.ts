import { expect, test } from 'bun:test';
import { abandonContract, assignOperationSlot, commitOperations, createCampaign, getContracts, parseCampaign, recoverInterruptedDeployment, removeOperation, reviewOperations, settleContract, stageOperation, type Campaign } from '../src/campaign';
import { buyFrame, checkpointDeployment, getOwnedMech, queueRepair } from '../src/company';
import { getPilotStats, hirePilot } from '../src/pilots';

const roundTrip = function (campaign: Campaign): Campaign { return parseCampaign(JSON.stringify(campaign)); };

test('a saved mixed day settles the same crew sortie after extraction or interruption and advances work once', function () {
	const company = hirePilot(buyFrame(buyFrame({ ...createCampaign(317, 'career'), credits: 30_000 }, 'kestrel-b'), 'kestrel-c'), 'flint');
	const ready = queueRepair({ ...company, fleet: company.fleet.map(function (rig) { return rig.frameId === 'kestrel-c' ? { ...rig, integrity: 82 } : rig; }) }, 'kestrel-c');
	const [live, crew] = getContracts(ready);
	if (!live || !crew) throw new Error('Missing local contracts');
	const staged = stageOperation(stageOperation(ready, live.id), crew.id);
	expect(staged.reputation).toEqual(ready.reputation);
	expect(removeOperation(staged, crew.id).reputation).toEqual(ready.reputation);
	const conflict = assignOperationSlot(staged, crew.id, 0, { pilotId: 'flint', frameId: 'kestrel' });
	expect(reviewOperations(conflict).issues.some(function (issue) { return issue.includes('assigned to another sortie'); })).toBe(true);
	expect(commitOperations(conflict)).toBe(conflict);

	const planned = roundTrip(assignOperationSlot(conflict, crew.id, 0, { pilotId: 'flint', frameId: 'kestrel-b' }));
	const committed = commitOperations(planned);
	expect(committed.active?.id).toBe(live.id);
	expect(committed.deployed?.frameId).toBe('kestrel');
	expect(committed.day).toBe(ready.day);
	expect(committed.reputation[live.opponent]).toBe(ready.reputation[live.opponent] - live.hostility - (crew.opponent === live.opponent ? crew.hostility : 0));
	const interrupted = roundTrip(checkpointDeployment(committed, 74, 1));
	expect(interrupted.deployed?.integrity).toBe(74);

	const won = settleContract(interrupted, true);
	const aborted = recoverInterruptedDeployment(interrupted);
	expect(aborted.lastOperationDay?.[0]?.aborted).toBe(true);
	expect(won.lastOperationDay?.[0]?.won).toBe(true);
	expect(aborted.lastOperationDay?.[1]?.contract.id).toBe(crew.id);
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
	expect(getPilotStats(saved, 'flint').wins).toBe(Number(saved.lastOperationDay?.find(function (report) { return report.contract.id === first.id; })?.won));
	expect(saved.preferredLineup?.[0]).toEqual({ pilotId: 'flint', frameId: 'kestrel' });
});
