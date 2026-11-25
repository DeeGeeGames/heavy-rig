import type { Group } from 'three';
import type { AuthoredPoseContext } from './authored-pose';
import { createDropshipShadow } from './dropship-shadow';
import { dropRigPose, dropShipPose, dropSurfaceHeight, type DropFlight, type DropPassenger } from './enemy-deployment';
import type { FieldTerrain } from './field-terrain';
import { FRAME_RIGS, STANDARD_LEG_RIG } from './frame-rig';
import { getFrame } from './frames';
import { advanceGait, createGait, mechScale, type Foot } from './gait';
import { createStarterLoadout } from './hardpoints';
import { createDropship } from './launch-ships';
import { createMech } from './mech-3d';
import { getMechAssetBinding } from './mech-asset-registry';
import { missionMechFinish, SKIN_PALETTES, type MechFinish } from './mech-skin';
import type { CombatStateView, Warning } from './simulation';
import { groundHeight } from './terrain-elevation';

const shipColors = function (finish: MechFinish) {
	if (typeof finish === 'object') return { steel: finish.primary, accent: finish.secondary };
	if (finish === 'original') return { steel: '#584e51', accent: '#df914e' };
	const palette = SKIN_PALETTES[finish];
	return { steel: palette.primary[1], accent: palette.secondary[1] };
};

const createFlightView = function (parent: Group, flight: DropFlight, finish: MechFinish) {
	const ship = createDropship(shipColors(finish));
	ship.root.rotation.y = Math.PI / 2 - flight.heading;
	const shadow = createDropshipShadow(ship.root.rotation.y);
	parent.add(ship.root, shadow.root);
	return {
		update: function (time: number, terrain: FieldTerrain | undefined) {
			const pose = dropShipPose(flight, time);
			if (pose.done) return false;
			ship.root.position.set(pose.x, pose.elevation, pose.y);
			ship.setRamp(pose.ramp, pose.ramp); ship.setThrust(pose.thrust);
			shadow.update(terrain, pose, Math.max(0, pose.elevation - groundHeight(terrain, pose)));
			return true;
		},
		dispose: function () { ship.root.removeFromParent(); ship.dispose(); shadow.dispose(); },
	};
};

const createPassengerView = function (parent: Group, warning: Warning, drop: DropPassenger, finish: MechFinish, time: number) {
	const frame = warning.frameId ? getFrame(warning.frameId) : undefined;
	const model = createMech(frame ? undefined : warning.kind, Boolean(warning.commander), frame?.id, finish);
	const size = frame?.size ?? mechScale(warning.kind);
	const rig = frame ? FRAME_RIGS[frame.id] : STANDARD_LEG_RIG;
	const advancePose = frame && getMechAssetBinding(frame.id)?.advancePose;
	const slots = frame && createStarterLoadout(frame.id).map(function (_, slot) { return slot; });
	const angle = drop.flight.heading;
	let previousTime = time;
	const initial = dropRigPose(drop, time);
	let gait = createGait({ x: initial.x, y: initial.y, angle }, size, rig);
	let authored: AuthoredPoseContext | undefined;
	parent.add(model.root);
	return {
		update: function (time: number, pose: ReturnType<typeof dropRigPose>) {
			// Integrate on the combat clock so two render frames spanning the same
			// footsteps show the same motion even when a display skips a tick.
			while (previousTime < time) {
				const at = Math.min(time, previousTime + 1 / 60);
				const sample = dropRigPose(drop, at);
				const body = { x: sample.x, y: sample.y, angle };
				if (sample.walking) {
					authored = advancePose?.(authored, body, at);
					gait = authored?.gait ?? advanceGait(gait, body, at - previousTime, size, frame?.stride ?? 1, rig);
				} else {
					authored = undefined;
					gait = createGait(body, size, rig);
				}
				previousTime = at;
			}
			const sole = function (foot: Foot) { return { ...foot, lift: foot.lift + dropSurfaceHeight(drop, foot) - pose.elevation }; };
			const legGait = { ...gait, feet: [sole(gait.feet[0]), sole(gait.feet[1])] as const };
			model.root.position.set(pose.x, pose.elevation, pose.y);
			model.pose(gait, angle, { time, recoil: 0, heat: 0, hit: 0, legGait,
				...(authored ? { authoredPose: authored } : {}), ...(slots ? { equippedSlots: slots } : {}) });
		},
		dispose: model.dispose,
	};
};

export const createEnemyDropshipViews = function (parent: Group) {
	const flights = new Map<DropFlight, ReturnType<typeof createFlightView>>();
	const passengers = new Map<Warning, ReturnType<typeof createPassengerView>>();
	let owner: CombatStateView | undefined;
	let previousTime = 0;
	const clear = function () {
		for (const view of passengers.values()) view.dispose();
		for (const view of flights.values()) view.dispose();
		passengers.clear(); flights.clear();
	};
	return {
		update: function (state: CombatStateView, warnings: readonly Warning[]) {
			if (owner !== state || state.time < previousTime) clear();
			owner = state; previousTime = state.time;
			for (const warning of warnings) {
				const drop = warning.drop;
				if (!drop) continue;
				const finish = missionMechFinish(state.mission?.contract);
				if (!flights.has(drop.flight)) flights.set(drop.flight, createFlightView(parent, drop.flight, finish));
				const pose = dropRigPose(drop, state.time);
				if (!pose.visible) continue;
				let view = passengers.get(warning);
				if (!view) {
					view = createPassengerView(parent, warning, drop, finish, state.time);
					passengers.set(warning, view);
				}
				view.update(state.time, pose);
			}
			for (const [warning, view] of passengers) {
				if (!warnings.includes(warning)) { view.dispose(); passengers.delete(warning); }
			}
			// The final passenger becomes a live combat entity as soon as it
			// clears the ramp. The departing hull finishes its own flight path.
			for (const [flight, view] of flights) {
				if (!view.update(state.time, state.mission?.map.terrain)) { view.dispose(); flights.delete(flight); }
			}
		},
		dispose: function () { clear(); owner = undefined; },
	};
};
