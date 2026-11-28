import type { Campaign } from './campaign';
import { dismissPilot, getPilot, isPilotId, pilotExperienceMultiplier, type PilotAssignment, type PilotExperienceBonus, type PilotId } from './pilots';

type Affinity = -2 | -1 | 0 | 1 | 2;
type Romance = 'none' | 'dating' | 'committed' | 'exes' | 'retired';
export interface PilotRelationship {
	readonly a: PilotId;
	readonly b: PilotId;
	readonly affinity: Affinity;
	readonly romance: Romance;
}

const TRUST = { [-2]: 'Rivalry', [-1]: 'Strained', 0: 'Professional', 1: 'Friendly', 2: 'Trusted' } as const;
const COORDINATION = { [-2]: -8, [-1]: -4, 0: 0, 1: 4, 2: 8 } as const;
export type PilotCoordination = typeof COORDINATION[Affinity];
export const trustLabel = function (affinity: Affinity): string { return TRUST[affinity]; };
export const trustCoordination = function (affinity: Affinity): PilotCoordination { return COORDINATION[affinity]; };

const boundAffinity = function (score: number): Affinity {
	if (score >= 2) return 2;
	if (score <= -2) return -2;
	return score === 1 || score === -1 ? score : 0;
};
const partnerOf = function ({ a, b }: PilotRelationship, id: PilotId): PilotId | undefined {
	return a === id ? b : b === id ? a : undefined;
};
const partnered = function (status: Romance): boolean {
	return status === 'dating' || status === 'committed' || status === 'retired';
};
const mixedPair = function (a: PilotId, b: PilotId): boolean {
	const first = getPilot(a).gender;
	const second = getPilot(b).gender;
	return first === 'male' && second === 'female' || first === 'female' && second === 'male';
};

export const retiredPilots = function (campaign: Campaign): ReadonlySet<PilotId> {
	const retired = new Set<PilotId>();
	for (const { a, b, romance } of campaign.relationships ?? []) {
		if (romance === 'retired') { retired.add(a); retired.add(b); }
	}
	return retired;
};

export const getRelationship = function (campaign: Campaign, first: PilotId, second: PilotId): PilotRelationship {
	if (first === second) throw new RangeError('A pilot relationship needs two different pilots');
	const a = first < second ? first : second;
	const b = first < second ? second : first;
	return campaign.relationships?.find(function (pair) { return pair.a === a && pair.b === b; }) ?? { a, b, affinity: 0, romance: 'none' };
};

export const canStartRomance = function (campaign: Campaign, a: PilotId, b: PilotId): boolean {
	return a !== b && campaign.pilots.includes(a) && campaign.pilots.includes(b) && mixedPair(a, b)
		&& !campaign.relationships?.some(function (pair) { return partnered(pair.romance) && (partnerOf(pair, a) !== undefined || partnerOf(pair, b) !== undefined); });
};

const recordRelationship = function (campaign: Campaign, next: PilotRelationship): Campaign {
	const others = campaign.relationships?.filter(function (pair) { return pair.a !== next.a || pair.b !== next.b; }) ?? [];
	return { ...campaign, relationships: [...others, next] };
};
export const changeRelationship = function (campaign: Campaign, a: PilotId, b: PilotId, delta: number, romance?: Romance): Campaign {
	if (a === b || campaign.deployed || campaign.committedCrew || !Number.isSafeInteger(delta) || !campaign.pilots.includes(a) || !campaign.pilots.includes(b)) return campaign;
	const previous = getRelationship(campaign, a, b);
	const next = romance ?? previous.romance;
	if (previous.romance === 'retired' || next === 'retired') return campaign;
	if (next !== previous.romance) {
		if (next === 'dating' && !canStartRomance(campaign, a, b)
			|| next === 'committed' && previous.romance !== 'dating'
			|| next === 'exes' && !partnered(previous.romance)
			|| next === 'none' && previous.romance !== 'exes') return campaign;
	}
	const affinity = boundAffinity(previous.affinity + delta);
	if (next === previous.romance && affinity === previous.affinity) return campaign;
	return recordRelationship(campaign, { ...previous, affinity, romance: next });
};

export const retireCouple = function (campaign: Campaign, a: PilotId, b: PilotId): Campaign {
	if (a === b || campaign.deployed || campaign.committedCrew || campaign.active || !campaign.pilots.includes(a) || !campaign.pilots.includes(b)) return campaign;
	const relationship = getRelationship(campaign, a, b);
	if (relationship.romance !== 'committed') return campaign;
	return recordRelationship(dismissPilot(dismissPilot(campaign, a), b), { ...relationship, romance: 'retired' });
};

const isRelationship = function (entry: unknown): entry is PilotRelationship {
	if (typeof entry !== 'object' || entry === null || !('a' in entry) || !('b' in entry) || !('affinity' in entry) || !('romance' in entry)) return false;
	const { a, b, affinity, romance } = entry;
	return isPilotId(a) && isPilotId(b) && a < b
		&& typeof affinity === 'number' && Object.hasOwn(TRUST, affinity)
		&& (romance === 'none' || (romance === 'dating' || romance === 'committed' || romance === 'exes' || romance === 'retired') && mixedPair(a, b));
};
export const isPilotRelationships = function (value: unknown): value is readonly PilotRelationship[] {
	if (!Array.isArray(value)) return false;
	const pairs = new Set<string>();
	const partners = new Set<PilotId>();
	for (const pair of value) {
		if (!isRelationship(pair)) return false;
		const key = JSON.stringify([pair.a, pair.b]);
		if (pairs.has(key)) return false;
		pairs.add(key);
		if (partnered(pair.romance)) {
			if (partners.has(pair.a) || partners.has(pair.b)) return false;
			partners.add(pair.a);
			partners.add(pair.b);
		}
	}
	return true;
};

/** Trust affects each hire alongside their assigned partners. Other sorties on the same day have their own lineup. */
export const pilotCoordination = function (campaign: Campaign, id: PilotId, lineup: readonly PilotAssignment[]): PilotCoordination {
	if (id === 'player' || !campaign.relationships?.length) return 0;
	const assigned = new Set(lineup.flatMap(function ({ pilotId, frameId }) { return pilotId && frameId ? [pilotId] : []; }));
	if (!assigned.has(id) || !campaign.pilots.includes(id)) return 0;
	const total = campaign.relationships.reduce(function (sum, pair) {
		const partner = partnerOf(pair, id);
		return partner !== undefined && assigned.has(partner) && campaign.pilots.includes(partner) ? sum + pair.affinity : sum;
	}, 0);
	return trustCoordination(boundAffinity(total));
};

export const pilotCombatMultiplier = function (experience?: PilotExperienceBonus, coordination: PilotCoordination = 0): number {
	return pilotExperienceMultiplier(experience) * (1 + coordination / 100);
};
