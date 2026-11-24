import { expect, test } from 'bun:test';
import { createCampaign, getContracts, parseCampaign } from '../src/campaign';
import { buyFrame } from '../src/company';
import { forecastCrew, resolveCrew } from '../src/crew-resolution';
import { hirePilot, type PilotAssignment } from '../src/pilots';

test('a posting keeps its dice across reload, waiting, and lineup edits while readiness changes the odds', function () {
	const company = hirePilot(hirePilot(buyFrame({ ...createCampaign(23), credits: 20_000 }, 'warden'), 'flint'), 'kite');
	const posting = getContracts(company).find(function (contract) { return contract.kind === 'defend' && contract.tier === 1; });
	if (!posting) throw new Error('Defense fixture requires a local posting');
	const lineup = [{ pilotId: 'flint', frameId: 'warden' }, { pilotId: 'kite', frameId: 'kestrel' }] as const satisfies readonly PilotAssignment[];
	const comparison = forecastCrew(company, posting, lineup);
	const planned = resolveCrew(company, posting, lineup);
	const reloaded = parseCampaign(JSON.stringify(company));
	expect(resolveCrew({ ...reloaded, day: reloaded.day + 1 }, posting, [...lineup].reverse())).toEqual(planned);
	expect(planned.objective.chance).toBe(comparison.objectiveChance);
	expect(planned.extraction.chance).toBe(comparison.extractionChance);

	const damaged = { ...reloaded, fleet: reloaded.fleet.map(function (rig) { return { ...rig, integrity: 20 }; }) };
	const weakened = resolveCrew(damaged, posting, lineup);
	expect(weakened.objective.roll).toBe(planned.objective.roll);
	expect(weakened.extraction.roll).toBe(planned.extraction.roll);
	expect(weakened.objective.chance).toBeLessThan(planned.objective.chance);
	expect(weakened.extraction.chance).toBeLessThan(planned.extraction.chance);
	for (const member of weakened.squad) {
		expect(member.startingIntegrity).toBe(20);
		expect(member.integrity).toBeGreaterThanOrEqual(0);
		expect(member.integrity).toBeLessThanOrEqual(member.startingIntegrity);
	}
});
