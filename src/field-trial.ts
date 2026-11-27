import type { Contract, MissionMap } from './campaign-types';
import { defaultReserves } from './combat-resources';
import { DEFENSE_PACING } from './defense-layout';
import type { TerrainObstacle } from './field-terrain';
import { createStarterLoadout } from './hardpoints';
import { generateElevation } from './mission-elevation';
import { missionDeploymentSlot } from './missions';
import { createMissionState, type State } from './simulation';

export const DEFENSE_TRIAL_SEED = 110026;

const createDefenseTrial = function (): State {
	const seed = DEFENSE_TRIAL_SEED;
	const contract: Contract = {
		// Reuse the legacy roster for the exact six-contact playtest the owner tried.
		id: `${seed}-0-galeward-defend-1`, seed, planetId: 'galeward', kind: 'defend', employer: 'accord', opponent: 'combine',
		title: 'Long approach', briefing: 'Reach the relay to start the defense. Hold it against incoming sections, then extract.',
		tier: 1, requiredReputation: 0, reward: 0, favor: 0, hostility: 0,
	};
	const drop = { x: 1040, y: 2450 }, objective = { x: 3310, y: 2450 }, extraction = { x: 2830, y: 3110 };
	const staging = [{ x: 5010, y: 2180 }, { x: 5080, y: 2980 }] as const;
	const obstacles: TerrainObstacle[] = [
		{ kind: 'turbine', x: 1500, y: 2160, width: 90, depth: 90, height: 176 },
		{ kind: 'turbine', x: 1870, y: 2070, width: 90, depth: 90, height: 176 },
		{ kind: 'outcrop', x: 2050, y: 2760, width: 255, depth: 170, height: 122 },
		{ kind: 'outcrop', x: 2535, y: 2095, width: 180, depth: 205, height: 105 },
		{ kind: 'shed', x: 2910, y: 2720, width: 142, depth: 100, height: 80 },
		{ kind: 'outcrop', x: 3690, y: 2900, width: 230, depth: 180, height: 122 },
		{ kind: 'turbine', x: 4160, y: 1860, width: 96, depth: 96, height: 176 },
		{ kind: 'turbine', x: 4650, y: 1760, width: 96, depth: 96, height: 176 },
	];
	const terrain = { obstacles, roads: [[drop, objective], [drop, { x: 1710, y: 2930 }, extraction, objective],
		[staging[0], objective], [staging[1], objective]] };
	const map: MissionMap = { seed, biome: 'steppe', width: 6000, height: 4800, drop, objective, extraction, sites: [objective],
		landmarks: [], terrain, defenseApproach: { ...DEFENSE_PACING, staging } };
	// Leave room behind each release point for the hull and a level ramp.
	const pads = staging.map(function (at) { return { x: at.x + 240, y: at.y, width: 660, depth: 600 }; });
	const elevation = generateElevation(map, obstacles, [drop, missionDeploymentSlot(map, 0)], [], pads);
	const loadout = createStarterLoadout('kestrel');
	return createMissionState(contract, { map: { ...map, terrain: { ...terrain, elevation } }, frame: 'warden-c', difficulty: 'story',
		squadmates: [{ pilotId: 'kite', callsign: 'Kite', specialty: 'skirmisher', frameId: 'kestrel', integrity: 100, loadout, reserves: defaultReserves(loadout) }] });
};

export const createFieldTrial = function (seed: number, defensePacing = false): State {
	if (defensePacing) return createDefenseTrial();
	const contract: Contract = {
		id: 'field-trial-cinder-recovery', seed: seed >>> 0, planetId: 'cinder', kind: 'recovery', employer: 'accord', opponent: 'combine',
		title: 'Cinder field trial', briefing: 'Recover the courier recorder and return to pickup.', tier: 1, requiredReputation: 0,
		reward: 0, favor: 0, hostility: 0,
	};
	const loadout = createStarterLoadout('kestrel');
	return createMissionState(contract, { frame: 'warden-c', difficulty: 'story',
		squadmates: [{ pilotId: 'kite', callsign: 'Kite', specialty: 'skirmisher', frameId: 'kestrel', integrity: 100, loadout, reserves: defaultReserves(loadout) }] });
};
