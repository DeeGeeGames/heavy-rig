import { withPilots, withRigs, withWeapons } from './company-fixture';
import { expect, test } from 'bun:test';
import { createCampaign, getContracts, parseCampaign } from '../src/campaign';
import { advanceDays, getOwnedMech, queueRefit } from '../src/company';
import { forecastCrew, resolveCrew } from '../src/crew-resolution';
import type { PilotAssignment } from '../src/pilots';

test('a Tempest with zero ammunition contributes to the preview and the actual demolition check', function () {
	const hired = withPilots(withRigs({ ...createCampaign(2, 'career'), credits: 40_000 }, 'warden-b'), 'flint');
	const company = withWeapons(hired, 'machine-gun', 'ppc');
	const lineup = [{ pilotId: 'flint', frameId: 'warden-b' }] as const;
	const demolition = function (shoulder: 'ppc' | null) {
		const loadout = [null, 'machine-gun', null, shoulder] as const;
		const ready = advanceDays(queueRefit(company, 'warden-b', loadout), 4);
		const rig = getOwnedMech(ready, 'warden-b');
		expect(rig?.loadout).toEqual(loadout);
		expect(rig?.reserves[3]).toBe(0);
		const posting = getContracts(ready).find(function (item) { return item.kind === 'demolition' && item.tier === 1; });
		if (!posting) throw new Error('Missing demolition posting');
		const forecast = forecastCrew(ready, posting, lineup, 'flint');
		const { objective } = resolveCrew(ready, posting, lineup, 'flint');
		expect(objective.chance).toBe(forecast.objectiveChance);
		return objective;
	};
	const empty = demolition(null);
	const armed = demolition('ppc');
	expect(armed.roll).toBe(empty.roll);
	expect(armed.chance).toBeGreaterThan(empty.chance);
});

test('a posting keeps its dice across reload, waiting, and lineup edits while readiness changes the odds', function () {
	const company = withPilots(withRigs({ ...createCampaign(23), credits: 20_000 }, 'warden'), 'flint', 'kite');
	const posting = getContracts(company).find(function (contract) { return contract.kind === 'defend' && contract.tier === 1; });
	if (!posting) throw new Error('Defense fixture requires a local posting');
	const lineup = [{ pilotId: 'flint', frameId: 'warden' }, { pilotId: 'kite', frameId: 'kestrel' }] as const satisfies readonly PilotAssignment[];
	const comparison = forecastCrew(company, posting, lineup, 'flint');
	const planned = resolveCrew(company, posting, lineup, 'flint');
	const reloaded = parseCampaign(JSON.stringify(company));
	expect(resolveCrew({ ...reloaded, day: reloaded.day + 1 }, posting, [...lineup].reverse(), 'flint')).toEqual(planned);
	expect(planned.objective.chance).toBe(comparison.objectiveChance);
	expect(planned.extraction.chance).toBe(comparison.extractionChance);

	const damaged = { ...reloaded, fleet: reloaded.fleet.map(function (rig) { return { ...rig, integrity: 20 }; }) };
	const weakened = resolveCrew(damaged, posting, lineup, 'flint');
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

test('changing only field lead changes extraction odds without rerolling the posting or changing the objective', function () {
	const company = withPilots(withRigs({ ...createCampaign(23), credits: 20_000 }, 'warden'), 'flint', 'kite');
	const worn = { ...company, fleet: company.fleet.map(function (rig) { return { ...rig, integrity: 60 }; }) };
	const posting = getContracts(worn).find(function (contract) { return contract.kind === 'defend' && contract.tier === 1; });
	if (!posting) throw new Error('Missing defense posting');
	const lineup = [{ pilotId: 'flint', frameId: 'warden' }, { pilotId: 'kite', frameId: 'kestrel' }] as const satisfies readonly PilotAssignment[];
	const flint = forecastCrew(worn, posting, lineup, 'flint');
	const kite = forecastCrew(worn, posting, lineup, 'kite');
	expect(flint.baseExtractionChance).toBe(kite.baseExtractionChance);
	expect(flint.extractionChance).toBe(flint.baseExtractionChance + 9);
	expect(kite.extractionChance).toBe(kite.baseExtractionChance + 3);
	const flintResult = resolveCrew(worn, posting, lineup, 'flint');
	const kiteResult = resolveCrew(worn, posting, lineup, 'kite');
	expect(flintResult.objective).toEqual(kiteResult.objective);
	expect(flintResult.extraction.roll).toBe(kiteResult.extraction.roll);
	expect(flintResult.extraction.chance).toBe(flint.extractionChance);
	expect(kiteResult.extraction.chance).toBe(kite.extractionChance);
});
