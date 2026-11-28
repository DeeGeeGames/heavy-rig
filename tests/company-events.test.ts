import { expect, test } from 'bun:test';
import { acceptContract, commitOperations, createCampaign, forecastArrival, getContracts, parseSavedCompany, settleContract, stageOperation, travelTo } from '../src/campaign';
import { advanceDays } from '../src/company';
import { describeEvent } from '../src/company-event-catalog';
import { resolveCompanyEvent } from '../src/company-events';
import { emptyCompanySlot, exportCompanyBackup, importCompanyBackup } from '../src/company-saves';
import { answerDecision } from './company-fixture';

test('a calendar decision survives backup and reload, blocks further orders, and spends or pays exactly once', function () {
	const prior = createCampaign(879, 'career');
	const posting = getContracts(prior)[0];
	if (!posting) throw new Error('Expected a local contract');
	const pending = advanceDays(stageOperation(prior, posting.id), 30);
	const backup = exportCompanyBackup({ ...emptyCompanySlot('career'), company: pending });
	const restored = backup ? importCompanyBackup(backup)?.company : undefined;
	if (!restored?.events?.pending) throw new Error('Missing saved decision');
	expect(pending.events?.pending).toEqual(restored.events.pending);
	expect(restored.operations).toEqual(pending.operations);
	expect(advanceDays(restored, 1)).toBe(restored);
	expect(commitOperations(restored)).toBe(restored);
	expect(resolveCompanyEvent(restored, restored.day, 'unknown-response')).toBe(restored);

	const choice = describeEvent(restored, restored.events.pending).choices.find(function (entry) { return entry.enabled; });
	if (!choice) throw new Error('Expected an affordable choice');
	const after = resolveCompanyEvent(restored, restored.day, choice.id);
	expect(after).toEqual(answerDecision(pending));
	expect(after.events?.last?.outcome).toBeTruthy();
	expect(after.events?.pending).toBeUndefined();
	expect(after.day).toBe(restored.day);
	expect(after.events?.nextDay).toBeGreaterThanOrEqual(after.day + 6);
	expect(after.events?.nextDay).toBeLessThanOrEqual(after.day + 12);
	expect(resolveCompanyEvent(after, restored.day, choice.id)).toBe(after);
	expect(parseSavedCompany(JSON.parse(JSON.stringify(after)))).toEqual(after);
});

test('old companies start with a grace period, route forecasts never roll events, and a due jump presents one decision on arrival', function () {
	const old = { ...createCampaign(21, 'career'), day: 482, credits: 60_000 };
	const first = advanceDays(old, 1);
	const due = first.events?.nextDay;
	if (!due) throw new Error('Missing calendar schedule');
	expect(due).toBeGreaterThanOrEqual(old.day + 4);
	expect(due).toBeLessThanOrEqual(old.day + 7);
	const departure = advanceDays(first, due - first.day - 1);
	expect(departure.events?.pending).toBeUndefined();
	expect(forecastArrival(departure, 'cinder').events?.pending).toBeUndefined();
	const arrival = travelTo(departure, 'cinder');
	expect(arrival.planetId).toBe('cinder');
	expect(arrival.events?.pending).toBeDefined();
	expect(travelTo(arrival, 'meridian')).toBe(arrival);
	expect(parseSavedCompany(JSON.parse(JSON.stringify(arrival)))).toEqual(arrival);
});

test('accepted contracts finish before an overdue decision is raised, and a long wait never builds a backlog', function () {
	const company = createCampaign(19, 'career');
	const posting = getContracts(company)[0];
	if (!posting) throw new Error('Expected a local contract');
	const active = advanceDays(acceptContract(company, posting.id), 60);
	expect(active.events?.pending).toBeUndefined();
	const returned = settleContract(active, true);
	expect(returned.lastResult?.won).toBe(true);
	expect(returned.events?.pending).toBeDefined();
	expect(parseSavedCompany(JSON.parse(JSON.stringify(returned)))).toEqual(returned);
	const resolved = answerDecision(returned);
	expect(advanceDays(resolved, 5).events?.pending).toBeUndefined();
	const later = advanceDays(resolved, 100);
	expect(later.events?.pending).toBeDefined();
	expect(later.events?.pending?.kind).not.toBe(returned.events?.pending?.kind);
	expect(advanceDays(answerDecision(later), 1).events?.pending).toBeUndefined();
});
