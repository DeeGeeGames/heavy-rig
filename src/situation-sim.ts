import { contractCopy } from './campaign';
import type { Contract, MissionKind, PlanetId } from './campaign-types';
import type { FrameId } from './frames';
import type { Difficulty } from './operation';
import { getPilot, type RECRUIT_IDS } from './pilots';
import type { MissionTier } from './reputation';
import { stockPackage } from './hardpoints';
import { createMissionState, type SquadmateOptions } from './simulation';

export interface SituationSetup {
	kind: MissionKind;
	planetId: PlanetId;
	tier: MissionTier;
	frame: FrameId;
	wing: readonly { pilotId: typeof RECRUIT_IDS[number] | null; frame: FrameId }[];
}

export const createSituationMission = function (setup: SituationSetup, seed: number, difficulty: Difficulty) {
	const { title, briefing } = contractCopy(setup.kind, setup.tier);
	const contract: Contract = {
		id: 'situation-sim', seed, planetId: setup.planetId, kind: setup.kind, tier: setup.tier,
		employer: 'freeholds', opponent: 'combine', title, briefing, reward: 0, favor: 0, hostility: 0, requiredReputation: 0,
		...(setup.kind === 'defend' ? { fieldLayout: 'extended-defense' } : {}),
	};
	const squadmates = setup.wing.flatMap(function ({ pilotId, frame }): SquadmateOptions[] {
		if (!pilotId) return [];
		const { callsign, specialty } = getPilot(pilotId);
		if (specialty === 'commander') return [];
		const equipment = stockPackage(frame);
		return [{ pilotId, callsign, specialty, frameId: frame, integrity: 100, ...equipment }];
	});
	return createMissionState(contract, { difficulty, frame: setup.frame, squadmates });
};
