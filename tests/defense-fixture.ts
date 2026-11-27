import type { PlanetId } from '../src/campaign-types';
import type { Difficulty } from '../src/operation';
import type { MissionTier } from '../src/reputation';
import { createMissionState } from '../src/simulation';

// These seeds were selected for particular flight paths and terrain slopes on
// the historical short field. Keep them independent of current board defaults.
export const archivedDefense = function (planetId: PlanetId, tier: MissionTier, seed: number, difficulty: Difficulty) {
	return createMissionState({ id: 'archived-defense-fixture', seed, planetId, kind: 'defend', tier,
		employer: 'freeholds', opponent: 'combine', title: 'Defense fixture', briefing: '', reward: 0, favor: 0, hostility: 0, requiredReputation: 0 },
	{ frame: 'warden', difficulty });
};
