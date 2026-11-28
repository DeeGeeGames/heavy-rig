import { expect, test } from 'bun:test';
import { assignOperationLead, assignOperationSlot, commitOperations, createCampaign, getContracts, parseSavedCompany, stageOperation } from '../src/campaign';
import { assignPilot, assignRig } from '../src/company';
import { forecastCrew, resolveCrew } from '../src/crew-resolution';
import { canStartRomance, changeRelationship, getRelationship, isPilotRelationships, pilotCoordination, retireCouple, retiredPilots } from '../src/pilot-relationships';
import { withRigs } from './company-fixture';

const roster = function () {
	return withRigs({ ...createCampaign(23, 'career'), pilots: ['player', 'flint', 'kite', 'glass'], pilotWins: { flint: 5, kite: 2 } }, 'warden', 'kestrel-b');
};

test('trust changes dispatch odds only when the pair flies together and preserves the posting dice', function () {
	const start = roster();
	const company = { ...start, fleet: start.fleet.map(function (rig) { return { ...rig, integrity: 65 }; }) };
	const [contract] = getContracts(company);
	if (!contract) throw new Error('Missing local posting');
	const duo = [{ pilotId: 'flint', frameId: 'kestrel' }, { pilotId: 'kite', frameId: 'warden' }] as const;
	const friends = changeRelationship(company, 'kite', 'flint', 2);
	const rivals = changeRelationship(company, 'flint', 'kite', -2);
	const baseline = forecastCrew(company, contract, duo, 'flint');
	const better = forecastCrew(friends, contract, duo, 'flint');
	const worse = forecastCrew(rivals, contract, duo, 'flint');
	expect(better.objectiveChance).toBeGreaterThan(baseline.objectiveChance);
	expect(better.extractionChance).toBeGreaterThan(baseline.extractionChance);
	expect(worse.objectiveChance).toBeLessThan(baseline.objectiveChance);
	expect(worse.extractionChance).toBeLessThan(baseline.extractionChance);
	const actual = resolveCrew(friends, contract, duo, 'flint');
	const troubled = resolveCrew(rivals, contract, [...duo].reverse(), 'flint');
	expect(actual.objective.chance).toBe(better.objectiveChance);
	expect(troubled.extraction.chance).toBe(worse.extractionChance);
	expect(troubled.objective.roll).toBe(actual.objective.roll);
	expect(troubled.extraction.roll).toBe(actual.extraction.roll);
	expect(resolveCrew(friends, contract, [duo[0]], 'flint')).toEqual(resolveCrew(rivals, contract, [duo[0]], 'flint'));

	const three = [...duo, { pilotId: 'glass', frameId: 'kestrel-b' }] as const;
	expect(pilotCoordination(changeRelationship(friends, 'flint', 'glass', 2), 'flint', three)).toBe(8);
	expect(pilotCoordination(changeRelationship(friends, 'flint', 'glass', -2), 'flint', three)).toBe(0);
});

test('a committed couple can retire together between sorties and leave their rigs, assignments and service records consistent', function () {
	const company = roster();
	expect(canStartRomance(company, 'flint', 'kite')).toBe(true);
	expect(canStartRomance(company, 'glass', 'flint')).toBe(false);
	expect(canStartRomance(company, 'player', 'kite')).toBe(false);
	const dating = changeRelationship(company, 'kite', 'flint', 1, 'dating');
	expect(canStartRomance(dating, 'glass', 'kite')).toBe(false);
	const split = changeRelationship(dating, 'flint', 'kite', -2, 'exes');
	expect(canStartRomance(split, 'glass', 'kite')).toBe(true);
	expect(getRelationship(split, 'kite', 'flint')).toMatchObject({ romance: 'exes', affinity: -1 });
	const committed = changeRelationship(dating, 'flint', 'kite', 1, 'committed');
	const [live, other] = getContracts(committed);
	if (!live || !other) throw new Error('Missing postings for two squads');
	const assigned = assignRig(assignPilot(committed, 1, 'flint'), 1, 'warden');
	const preferred = assignOperationSlot(assigned, undefined, 2, { pilotId: 'kite', frameId: 'kestrel-b' });
	const playerSortie = assignOperationSlot(stageOperation(preferred, live.id), live.id, 2, { pilotId: null, frameId: null });
	const staged = stageOperation(playerSortie, other.id);
	const planned = assignOperationLead(assignOperationSlot(staged, other.id, 0, { pilotId: 'kite', frameId: 'kestrel-b' }), other.id, 'kite');
	const deployed = commitOperations(planned);
	expect(deployed.deployed).toBeDefined();
	expect(retireCouple(deployed, 'flint', 'kite')).toBe(deployed);
	const retired = retireCouple(planned, 'flint', 'kite');
	const restored = parseSavedCompany(JSON.parse(JSON.stringify(retired)));
	if (!restored) throw new Error('Retired company could not reload');
	expect(restored.pilots).toEqual(['player', 'glass']);
	expect(retiredPilots(restored)).toEqual(new Set(['flint', 'kite']));
	expect(getRelationship(restored, 'flint', 'kite').romance).toBe('retired');
	expect(restored.pilotWins).toEqual(planned.pilotWins);
	expect(restored.fleet).toEqual(planned.fleet);
	const seats = [...restored.lineup, ...(restored.preferredLineup ?? []), ...(restored.operations?.flatMap(function (op) { return op.lineup; }) ?? [])];
	expect(seats.some(function (seat) { return seat.pilotId === 'flint' || seat.pilotId === 'kite'; })).toBe(false);
	expect(restored.operations?.every(function (op) { return op.leaderId === undefined; })).toBe(true);
	expect(parseSavedCompany({ ...retired, pilots: [...retired.pilots, 'flint'] })).toBeUndefined();
	expect(isPilotRelationships([...(retired.relationships ?? []), { a: 'brace', b: 'flint', romance: 'dating', affinity: 1 }])).toBe(false);
});
