import type { Campaign } from './campaign';
import type { PlanetId } from './campaign-types';
import { localApplicants, readRegistration, registeredPilot, type LocalPilotId } from './local-pilots';
import { retiredPilots } from './pilot-relationships';
import type { RigId } from './rigs';

export interface PilotAssignment {
	readonly pilotId: PilotId | null;
	readonly frameId: RigId | null;
}

export interface Pilot {
	readonly id: PilotId;
	readonly name: string;
	readonly callsign: string;
	readonly home?: PlanetId;
	readonly gender: 'female' | 'male' | 'unspecified';
	readonly specialty: 'commander' | 'marksman' | 'skirmisher';
	readonly leadership: number;
	readonly price: number;
	readonly description: string;
}

const pilots = {
	player: { name: 'Company Commander', callsign: 'Commander', gender: 'unspecified', specialty: 'commander', leadership: 3, price: 0, description: 'You play the mission assigned to the Commander.' },
	flint: { name: 'Mara Venn', callsign: 'Flint', home: 'meridian', gender: 'female', specialty: 'marksman', leadership: 4, price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	kite: { name: 'Ivo Serrat', callsign: 'Kite', home: 'cinder', gender: 'male', specialty: 'skirmisher', leadership: 2, price: 500, description: 'Moves more readily while engaging targets.' },
	glass: { name: 'Nia Fen', callsign: 'Glass', home: 'borealis', gender: 'female', specialty: 'marksman', leadership: 1, price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	talon: { name: 'Ro Ash', callsign: 'Talon', home: 'brackwater', gender: 'male', specialty: 'skirmisher', leadership: 3, price: 500, description: 'Moves more readily while engaging targets.' },
	brace: { name: 'Emil Arden', callsign: 'Brace', home: 'elderholt', gender: 'male', specialty: 'marksman', leadership: 3, price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	switch: { name: 'Ada Noll', callsign: 'Switch', home: 'galeward', gender: 'female', specialty: 'skirmisher', leadership: 5, price: 500, description: 'Moves more readily while engaging targets.' },
} as const;

type NamedPilotId = keyof typeof pilots;
export type PilotId = NamedPilotId | LocalPilotId;
// The authored pilots remain the simulator roster and retain their identity in old saves.
export const RECRUIT_IDS = ['flint', 'kite', 'glass', 'talon', 'brace', 'switch'] as const satisfies readonly PilotId[];
export const SQUAD_SIZE = 4;
const isNamedPilot = function (value: unknown): value is NamedPilotId {
	return typeof value === 'string' && Object.hasOwn(pilots, value);
};
export const isPilotId = function (value: unknown): value is PilotId {
	return isNamedPilot(value) || readRegistration(value) !== undefined;
};
export const isCompanyPilotId = function (value: unknown, seed: number): value is PilotId {
	return isNamedPilot(value) || readRegistration(value)?.seed === seed;
};

export const getPilot = function (id: PilotId): Pilot {
	if (isNamedPilot(id)) return { id, ...pilots[id] };
	const registration = readRegistration(id);
	if (!registration) throw new RangeError(`Unknown pilot: ${id}`);
	return registeredPilot(registration);
};

export const MAX_PILOT_WINS = 1_000_000;
const PILOT_MILESTONES = [3, 6] as const;
export type PilotExperienceBonus = 0 | 1 | 2;
export const pilotExperienceMultiplier = function (bonus: PilotExperienceBonus = 0): number {
	return 1 + bonus * .06;
};
const SKILLS = {
	commander: { gunnery: 3, maneuver: 3 },
	marksman: { gunnery: 4, maneuver: 2 },
	skirmisher: { gunnery: 2, maneuver: 4 },
} as const;

export const getPilotStats = function (campaign: Campaign, id: PilotId) {
	const pilot = getPilot(id);
	const wins = campaign.pilotWins?.[id] ?? 0;
	const [first, second] = PILOT_MILESTONES;
	const bonus: PilotExperienceBonus = wins >= second ? 2 : wins >= first ? 1 : 0;
	const nextMilestone = PILOT_MILESTONES.at(bonus);
	return {
		...SKILLS[pilot.specialty],
		leadership: pilot.leadership,
		wins,
		bonus,
		...(nextMilestone === undefined ? {} : { nextMilestone }),
	};
};

export const recordPilotWins = function (campaign: Campaign, pilotIds: readonly PilotId[]): Partial<Record<PilotId, number>> {
	const wins = { ...campaign.pilotWins };
	for (const id of new Set(pilotIds)) {
		if (id !== 'player') wins[id] = Math.min(MAX_PILOT_WINS, (wins[id] ?? 0) + 1);
	}
	return wins;
};

export const getRecruitOffers = function (campaign: Campaign): readonly Pilot[] {
	const retired = retiredPilots(campaign);
	const veterans = RECRUIT_IDS.filter(function (id) {
		return campaign.pilotWins?.[id] !== undefined && pilots[id].home === campaign.planetId && !retired.has(id);
	});
	return [...veterans, ...localApplicants(campaign.seed, campaign.planetId, retired)]
		.filter(function (id) { return !campaign.pilots.includes(id); }).map(getPilot);
};

export const hirePilot = function (campaign: Campaign, id: PilotId): Campaign {
	const offer = getRecruitOffers(campaign).find(function (pilot) { return pilot.id === id; });
	if (campaign.deployed || !offer || offer.price > campaign.credits) return campaign;
	return { ...campaign, credits: campaign.credits - offer.price, pilots: [...campaign.pilots, id] };
};

export const dismissPilot = function (campaign: Campaign, id: PilotId): Campaign {
	if (campaign.deployed || id === 'player' || !campaign.pilots.includes(id)) return campaign;
	const release = function (lineup: readonly PilotAssignment[]) {
		return lineup.map(function (slot) { return slot.pilotId === id ? { pilotId: null, frameId: null } : slot; });
	};
	return {
		...campaign, pilots: campaign.pilots.filter(function (pilotId) { return pilotId !== id; }),
		lineup: release(campaign.lineup),
		// A service record lets an authored veteran from an older save return home, even without a win.
		...(isNamedPilot(id) && campaign.pilotWins?.[id] === undefined ? { pilotWins: { ...campaign.pilotWins, [id]: 0 } } : {}),
		...(campaign.preferredLineup ? { preferredLineup: release(campaign.preferredLineup) } : {}),
		...(campaign.operations ? { operations: campaign.operations.map(function (operation) {
			return { ...operation, lineup: release(operation.lineup), leaderId: operation.leaderId === id ? undefined : operation.leaderId };
		}) } : {}),
	};
};
