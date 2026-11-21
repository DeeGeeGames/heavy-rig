import type { Contract } from './campaign-types';
import { defaultReserves } from './combat-resources';
import { createStarterLoadout } from './hardpoints';
import { createMissionState, type State } from './simulation';

export const createFieldTrial = function (seed: number): State {
	const contract: Contract = {
		id: 'field-trial-cinder-recovery', seed: seed >>> 0, planetId: 'cinder', kind: 'recovery', employer: 'accord', opponent: 'combine',
		title: 'Cinder field trial', briefing: 'Recover the courier recorder and return to pickup.', tier: 1, requiredReputation: 0,
		reward: 0, favor: 0, hostility: 0,
	};
	const loadout = createStarterLoadout('kestrel');
	return createMissionState(contract, { frame: 'warden-c', difficulty: 'story',
		squadmates: [{ pilotId: 'kite', callsign: 'Kite', specialty: 'skirmisher', frameId: 'kestrel', integrity: 100, loadout, reserves: defaultReserves(loadout) }] });
};
