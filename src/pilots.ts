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
	readonly price: number;
	readonly description: string;
}

const pilots = {
	player: { name: 'Company Commander', callsign: 'Commander', specialty: 'commander', price: 0, description: 'Your pilot on every sortie.' },
	flint: { name: 'Mara Venn', callsign: 'Flint', specialty: 'marksman', price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	kite: { name: 'Ivo Serrat', callsign: 'Kite', specialty: 'skirmisher', price: 500, description: 'Moves more readily while engaging targets.' },
	glass: { name: 'Nia Fen', callsign: 'Glass', specialty: 'marksman', price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	talon: { name: 'Ro Ash', callsign: 'Talon', specialty: 'skirmisher', price: 500, description: 'Moves more readily while engaging targets.' },
	brace: { name: 'Emil Arden', callsign: 'Brace', specialty: 'marksman', price: 500, description: 'Tracks targets carefully and takes steadier shots.' },
	switch: { name: 'Ada Noll', callsign: 'Switch', specialty: 'skirmisher', price: 500, description: 'Moves more readily while engaging targets.' },
} as const;

export type PilotId = keyof typeof pilots;
export const RECRUIT_IDS = ['flint', 'kite', 'glass', 'talon', 'brace', 'switch'] as const satisfies readonly PilotId[];
export const SQUAD_SIZE = 4;
export const isPilotId = function (value: unknown): value is PilotId {
	return typeof value === 'string' && Object.hasOwn(pilots, value);
};

export const getPilot = function (id: PilotId): Pilot { return { id, ...pilots[id] }; };

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
	return {
		...campaign, pilots: campaign.pilots.filter(function (pilotId) { return pilotId !== id; }),
		lineup: campaign.lineup.map(function (slot) { return slot.pilotId === id ? { pilotId: null, frameId: null } : slot; }),
	};
};
