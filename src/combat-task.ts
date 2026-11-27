import { PICKUP_BOARD_AT, PICKUP_LIFT_AT } from './launch-surface';
import { missionObjective } from './missions';
import { distance, type CombatStateView } from './simulation';

interface CombatTask {
	title: string;
	detail: string;
}

interface TaskContext {
	pickupTime: number | undefined;
	escapeGuide: string | undefined;
	drill: { progress: string; title: string; instruction: string } | undefined;
	practice: boolean;
}

export const combatTask = function (state: CombatStateView, { pickupTime, escapeGuide, drill, practice }: TaskContext): CombatTask {
	if (pickupTime !== undefined) {
		const detail = pickupTime < PICKUP_BOARD_AT ? 'Dropship inbound' : pickupTime < PICKUP_LIFT_AT ? 'Squad boarding' : 'Dropship departing';
		return { title: 'Extraction', detail };
	}
	if (escapeGuide !== undefined) {
		const mission = state.mission;
		const title = mission && mission.extractTime > 0 ? `Evacuation in ${Math.ceil(3 - mission.extractTime)}s` : `Reach evacuation · ${Math.round(distance(state.player, mission?.map.extraction ?? state.player))} m`;
		return { title, detail: mission && mission.extractTime > 0 ? 'Hold position' : escapeGuide };
	}
	if (drill) return { title: `Drill ${drill.progress} · ${drill.title}`, detail: drill.instruction };
	if (practice) return { title: 'Practice range', detail: 'Pause to change loadout' };
	const [title, ...detail] = missionObjective(state).split(' · ');
	return { title: title ?? 'Protect Relay 09', detail: detail.join(' · ') };
};
