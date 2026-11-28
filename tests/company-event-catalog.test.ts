import { expect, test } from 'bun:test';
import { createCampaign, MAX_CREDITS, parseSavedCompany, travelTo, type Campaign } from '../src/campaign';
import { advanceDays, queueRepair } from '../src/company';
import { applyEventChoice, describeEvent, eventCandidates, type CompanyEventSpec } from '../src/company-event-catalog';
import { getRelationship } from '../src/pilot-relationships';
import { withRigs } from './company-fixture';

test('a risky survey protects the return fare even on a winning roll and charges only the quoted loss', function () {
	const quiet = { ...travelTo(createCampaign(317, 'career'), 'system-0'), credits: 500 };
	const survey = { kind: 'weather-window' } as const;
	const choices = describeEvent(quiet, survey).choices;
	expect(choices.find(function (option) { return option.id === 'record'; })?.enabled).toBe(false);
	expect(applyEventChoice(quiet, survey, 'record', 1)).toBeUndefined();
	expect(applyEventChoice(quiet, survey, 'scan', 1)?.campaign.credits).toBe(570);

	const funded = { ...quiet, credits: 560 };
	const success = applyEventChoice(funded, survey, 'record', 1);
	const failure = applyEventChoice(funded, survey, 'record', 1500);
	expect(success?.campaign.credits).toBe(745);
	expect(failure?.campaign.credits).toBe(500);
	expect(applyEventChoice(funded, survey, 'record', 1500)).toEqual(failure);
});

test('a shipboard invoice enters unpaid upkeep and is collected only from spendable funds', function () {
	const quiet = { ...travelTo(createCampaign(317, 'career'), 'system-0'), credits: 500 };
	const surge = { kind: 'solar-surge' } as const;
	expect(applyEventChoice(quiet, surge, 'pay', 1)).toBeUndefined();
	const charged = applyEventChoice(quiet, surge, 'invoice', 1)?.campaign;
	if (!charged) throw new Error('The supplier must accept the maintenance account');
	const restored = parseSavedCompany(JSON.parse(JSON.stringify(charged)));
	if (!restored) throw new Error('The outstanding invoice must survive a reload');
	expect(advanceDays(restored, 1)).toMatchObject({ credits: 500, upkeepOwed: 125 });
	const paid = advanceDays({ ...restored, credits: 700 }, 1);
	expect(paid).toMatchObject({ credits: 575, upkeepOwed: 0 });
	expect(advanceDays(paid, 1).credits).toBe(575);
	expect(applyEventChoice({ ...quiet, upkeepOwed: MAX_CREDITS - 40 }, surge, 'invoice', 1)?.campaign.upkeepOwed).toBe(MAX_CREDITS);
});

test('bracing a bay load at zero credits preserves an existing paid repair and leaves a deployable rig', function () {
	const starter = withRigs({ ...createCampaign(3, 'career'), credits: 20_000 }, 'warden');
	const worn = { ...starter, fleet: starter.fleet.map(function (mech) { return { ...mech, integrity: mech.frameId === 'kestrel' ? 50 : 6 }; }) };
	const repairing = { ...queueRepair(worn, 'kestrel'), credits: 0 };
	const braced = applyEventChoice(repairing, { kind: 'slipped-cradle' }, 'brace', 1)?.campaign;
	if (!braced) throw new Error('The free rig choice must resolve the incident');
	expect(braced.workOrders).toEqual(repairing.workOrders);
	expect(braced.fleet.map(function (mech) { return mech.integrity; })).toEqual([50, 1]);
	expect(parseSavedCompany(JSON.parse(JSON.stringify(braced)))).toEqual(braced);
	expect(eventCandidates(braced).some(function (spec) { return spec.kind === 'slipped-cradle'; })).toBe(false);
});

test('a penniless couple can progress from a first date to family retirement, or separate and work through the fallout', function () {
	const crew: Campaign = { ...createCampaign(11, 'career'), credits: 0, pilots: ['player', 'flint', 'kite'] };
	const choose = function (campaign: Campaign, kind: CompanyEventSpec['kind'], id: string): Campaign {
		const spec = eventCandidates(campaign, 11).find(function (event) { return event.kind === kind; });
		if (!spec) throw new Error(`Missing eligible ${kind}`);
		const result = applyEventChoice(campaign, spec, id, 42);
		if (!result) throw new Error(`Unable to choose ${id}`);
		return result.campaign;
	};
	const dating = choose(crew, 'shore-leave', 'tickets');
	const committed = choose(dating, 'shared-quarters', 'keys');
	expect(getRelationship(committed, 'flint', 'kite').romance).toBe('committed');
	const retired = choose(committed, 'last-watch', 'bell');
	expect(retired.pilots).toEqual(['player']);
	expect(getRelationship(retired, 'flint', 'kite').romance).toBe('retired');
	expect(eventCandidates(retired).every(function (spec) { return !spec.pair; })).toBe(true);
	expect(applyEventChoice(committed, { kind: 'last-watch', pair: ['flint', 'kite'] }, 'grant', 42)).toBeUndefined();
	const grant = choose({ ...committed, credits: 300 }, 'last-watch', 'grant');
	expect(grant.credits).toBe(150);
	expect(grant.pilots).toEqual(retired.pilots);
	expect(grant.relationships).toEqual(retired.relationships);
	const separate = choose(dating, 'separate-bunks', 'quarters');
	expect(getRelationship(separate, 'flint', 'kite')).toMatchObject({ romance: 'exes', affinity: -1 });
	const reconciled = choose(separate, 'old-channel', 'booth');
	expect(getRelationship(reconciled, 'flint', 'kite')).toMatchObject({ romance: 'exes', affinity: 0 });
});
