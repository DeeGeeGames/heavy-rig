import type { Campaign } from './campaign';
import type { RigId } from './rigs';

export interface PilotAssignment {
	readonly pilotId: PilotId | null;
	readonly frameId: RigId | null;
}

export interface Pilot {
	readonly id: PilotId;
	readonly name: string;
	readonly callsign: string;
	readonly specialty: 'commander' | 'marksman' | 'skirmisher';
	readonly leadership: number;
	readonly price: number;
	readonly description: string;
}

const pilots = {
	player: { name: 'Company Commander', callsign: 'Commander', specialty: 'commander', leadership: 3, price: 0, description: 'You play the mission assigned to the Commander.' },
	flint: { name: 'Mara Venn', callsign: 'Flint', specialty: 'marksman', leadership: 4, price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	kite: { name: 'Ivo Serrat', callsign: 'Kite', specialty: 'skirmisher', leadership: 2, price: 500, description: 'Moves more readily while engaging targets.' },
	glass: { name: 'Nia Fen', callsign: 'Glass', specialty: 'marksman', leadership: 1, price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	talon: { name: 'Ro Ash', callsign: 'Talon', specialty: 'skirmisher', leadership: 3, price: 500, description: 'Moves more readily while engaging targets.' },
	brace: { name: 'Emil Arden', callsign: 'Brace', specialty: 'marksman', leadership: 3, price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	switch: { name: 'Ada Noll', callsign: 'Switch', specialty: 'skirmisher', leadership: 5, price: 500, description: 'Moves more readily while engaging targets.' },
} as const;

export type PilotId = keyof typeof pilots;
export const RECRUIT_IDS = ['flint', 'kite', 'glass', 'talon', 'brace', 'switch'] as const satisfies readonly PilotId[];
export const SQUAD_SIZE = 4;
export const isPilotId = function (value: unknown): value is PilotId {
	return typeof value === 'string' && Object.hasOwn(pilots, value);
};

export const getPilot = function (id: PilotId): Pilot { return { id, ...pilots[id] }; };

export const MAX_PILOT_WINS = 1_000_000;
const PILOT_MILESTONES = [3, 6] as const;
const SKILLS = {
	commander: { gunnery: 3, maneuver: 3 },
	marksman: { gunnery: 4, maneuver: 2 },
	skirmisher: { gunnery: 2, maneuver: 4 },
} as const;

export const getPilotStats = function (campaign: Campaign, id: PilotId) {
	const wins = campaign.pilotWins?.[id] ?? 0;
	const nextMilestone = PILOT_MILESTONES.find(function (milestone) { return wins < milestone; });
	return {
		...SKILLS[pilots[id].specialty],
		leadership: pilots[id].leadership,
		wins,
		bonus: PILOT_MILESTONES.filter(function (milestone) { return wins >= milestone; }).length,
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
	return RECRUIT_IDS.filter(function (id) { return !campaign.pilots.includes(id); }).slice(0, 3).map(getPilot);
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
		...(campaign.preferredLineup ? { preferredLineup: release(campaign.preferredLineup) } : {}),
		...(campaign.operations ? { operations: campaign.operations.map(function (operation) {
			return { ...operation, lineup: release(operation.lineup), leaderId: operation.leaderId === id ? undefined : operation.leaderId };
		}) } : {}),
	};
};
