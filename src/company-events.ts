import type { Campaign } from './campaign';
import { applyEventChoice, describeEvent, eventCandidates, isCompanyEventSpec, isEventKind, type CompanyEventSpec } from './company-event-catalog';
import { mixSeed, randomSource } from './universe';

interface DecisionRecord {
	readonly day: number;
	readonly kind: CompanyEventSpec['kind'];
	readonly title: string;
	readonly choice: string;
	readonly outcome: string;
}

export interface CompanyEventState {
	readonly nextDay: number;
	readonly pending?: CompanyEventSpec;
	readonly last?: DecisionRecord;
}

const eventSeed = function (seed: number, day: number) { return mixSeed(mixSeed(seed, 0x57415443), day); };
const nextEventDay = function (seed: number, day: number, first: boolean) {
	const roll = randomSource(mixSeed(eventSeed(seed, day), 1))();
	return day + (first ? 4 + Math.floor(roll * 4) : 6 + Math.floor(roll * 7));
};

// An action finishes its calendar work first. A long repair wait brings one
// decision to the ship, and accepted contracts retain their crew until settlement.
export const scheduleCompanyEvent = function (previousDay: number, campaign: Campaign): Campaign {
	if (campaign.day <= previousDay || !campaign.introComplete || campaign.deployed || campaign.events?.pending) return campaign;
	const events = campaign.events ?? { nextDay: nextEventDay(campaign.seed, previousDay, true) };
	if (campaign.day < events.nextDay || campaign.active || campaign.committedCrew) {
		return campaign.events ? campaign : { ...campaign, events };
	}
	const seed = eventSeed(campaign.seed, campaign.day);
	const candidates = eventCandidates(campaign, seed).filter(function (event) {
		return events.last ? event.kind !== events.last.kind : !event.pair;
	});
	const selected = candidates[Math.floor(randomSource(mixSeed(seed, 2))() * candidates.length)];
	return selected ? { ...campaign, events: { ...events, pending: selected } } : { ...campaign, events };
};

export const resolveCompanyEvent = function (campaign: Campaign, day: number, choiceId: string): Campaign {
	const pending = campaign.events?.pending;
	if (!pending || day !== campaign.day) return campaign;
	const { title, choices } = describeEvent(campaign, pending);
	const choice = choices.find(function (entry) { return entry.id === choiceId && entry.enabled; });
	if (!choice) return campaign;
	const result = applyEventChoice(campaign, pending, choice.id, mixSeed(eventSeed(campaign.seed, day), 3));
	if (!result) return campaign;
	const last = { day, kind: pending.kind, title, choice: choice.label, outcome: result.outcome };
	return { ...result.campaign, events: { nextDay: nextEventDay(campaign.seed, day, false), last } };
};

const object = function (value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); };
const label = function (value: unknown, limit: number) { return typeof value === 'string' && value.length > 0 && value.length <= limit; };
export const isCompanyEventState = function (value: unknown, day: number): value is CompanyEventState {
	if (!object(value)) return false;
	const next = value['nextDay'];
	if (typeof next !== 'number' || !Number.isInteger(next) || next < 2 || next > day + 12) return false;
	const pending = value['pending'];
	if (pending !== undefined && (next > day || !isCompanyEventSpec(pending))) return false;
	const last = value['last'];
	return last === undefined || object(last) && typeof last['day'] === 'number' && Number.isInteger(last['day'])
		&& last['day'] >= 1 && last['day'] <= day && last['day'] < next && isEventKind(last['kind'])
		&& label(last['title'], 160) && label(last['choice'], 160) && label(last['outcome'], 1200);
};
