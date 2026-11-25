import type { AuthoredGait } from './authored-run';
import { isVehicleKind } from './enemy-vehicles';
import type { FrameId } from './frames';
import type { Gaits } from './gait';
import type { CombatStateView, EnemyKind, Point } from './simulation';

const ticksPerSecond = 60;
const runPosesPerSecond = 8;
const samplesPerWalkStep = 4;
const windowLead = 24; // Open a sampling window 40% of a period before its nominal pose.
const airborne = function (gait: AuthoredGait) { return gait.feet[0].lift > 0 && gait.feet[1].lift > 0; };
const walkPhase = function (swing: NonNullable<AuthoredGait['swing']>) {
	return Math.min(samplesPerWalkStep - 1, Math.floor(swing.elapsed / swing.duration * samplesPerWalkStep + 1e-8));
};

// Advance on fixed steps. Walking samples three swing targets and the actual
// touchdown per step. The running exposure windows use their existing clock.
export const createContactCadence = function () {
	let clock = 0;
	let sampledWindow = 0;
	let heldTicks = 0;
	let held: AuthoredGait | undefined;
	let previous: AuthoredGait | undefined;
	let previousTime = 0;

	const reset = function () {
		clock = 0;
		sampledWindow = 0;
		heldTicks = 0;
		held = undefined;
		previous = undefined;
	};
	const advance = function (gait: AuthoredGait, time: number) {
		if (gait === previous && time === previousTime) return;
		const prior = previous;
		const elapsed = time - previousTime;
		previousTime = time;
		// The simulation resets both feet together on a teleport. A walking or
		// running step always preserves at least one previous foot until touchdown.
		const movedBothPlants = prior && !gait.swing && !gait.running && gait.feet.every(function (foot, index) {
			const old = prior.feet[index];
			return old && foot.lift === 0 && (old.x !== foot.x || old.y !== foot.y);
		});
		if (!prior || elapsed <= 0 || elapsed > 1.5 / ticksPerSecond || movedBothPlants) {
			previous = held = gait;
			const firstTick = time > 0 && time <= 1.5 / ticksPerSecond;
			clock = firstTick ? runPosesPerSecond : 0;
			sampledWindow = 0;
			heldTicks = firstTick ? 1 : 0;
			return;
		}
		previous = gait;
		clock += runPosesPerSecond;
		const window = Math.floor((clock + windowLead) / ticksPerSecond);
		if (!gait.running) {
			const swing = gait.swing;
			const priorPhase = prior.swing && prior.swing.from === swing?.from ? walkPhase(prior.swing) : 0;
			if (prior.running || !swing || walkPhase(swing) > priorPhase) held = gait;
			return;
		}
		if (!prior.running) {
			held = gait;
			sampledWindow = window;
			heldTicks = 0;
			return;
		}
		heldTicks++;
		if (window <= sampledWindow) return;

		const stepsLeft = Math.ceil(((window + 1) * ticksPerSecond - windowLead - clock) / runPosesPerSecond) - 1;
		const swings = gait.running.legs.map(function (leg) { return leg.swing; });
		const swingStep = gait.running.swingRate / ticksPerSecond;
		const landingDue = swings.some(function (swing) {
			return swing && Math.ceil((swing.duration - swing.elapsed) / swingStep - 1e-8) <= stepsLeft;
		});
		const atPeak = swings.some(function (swing) {
			return swing && swing.elapsed >= swing.duration / 2 && swing.elapsed - swingStep < swing.duration / 2;
		});
		const landed = gait.feet.some(function (foot, i) { return foot.lift === 0 && (prior.feet[i]?.lift ?? 0) > 0; });
		const tookOff = airborne(gait) && !airborne(prior);
		const poseDue = clock >= window * ticksPerSecond;
		const keyPose = landed || (!landingDue && (tookOff || atPeak || poseDue));
		if (stepsLeft === 0 || heldTicks >= 12 || (heldTicks >= 3 && keyPose)) {
			held = gait;
			sampledWindow = window;
			heldTicks = 0;
		}
	};
	const visualGait = function (gait: AuthoredGait): AuthoredGait {
		if (gait !== previous || !held || held === gait) return gait;
		const feet = gait.running ? held.feet : [
			gait.feet[0].lift === 0 ? gait.feet[0] : held.feet[0],
			gait.feet[1].lift === 0 ? gait.feet[1] : held.feet[1],
		] as const;
		return { ...held, feet, body: gait.body, motion: gait.motion };
	};
	return { advance, reset, visualGait };
};

// Weak keys follow the actors owned by the combat runtime across spawn, removal
// and scenario replacement. A pilot can also switch chassis on the same actor.
export const createMechCadences = function () {
	const histories = new WeakMap<Point, { kind: FrameId | EnemyKind; cadence: ReturnType<typeof createContactCadence> }>();
	const stepActor = function (actor: Point, kind: FrameId | EnemyKind, gait: AuthoredGait | undefined, time: number) {
		if (!gait) { histories.delete(actor); return; }
		let history = histories.get(actor);
		if (history?.kind !== kind) {
			history = { kind, cadence: createContactCadence() };
			histories.set(actor, history);
		}
		history.cadence.advance(gait, time);
	};
	const advance = function (state: CombatStateView, gaits: Gaits) {
		stepActor(state.player, state.frame, state.authoredPose?.gait ?? gaits.player, state.time);
		for (const mate of state.squadmates) {
			stepActor(mate, mate.frameId, mate.authoredPose?.gait ?? gaits.squadmates.get(mate.pilotId), state.time);
		}
		for (const enemy of state.enemies) {
			if (enemy.kind !== 'artillery' && !isVehicleKind(enemy.kind)) stepActor(enemy, enemy.kind, gaits.enemies.get(enemy.id), state.time);
		}
	};
	const visualGait = function (actor: Point, gait: AuthoredGait) {
		return histories.get(actor)?.cadence.visualGait(gait) ?? gait;
	};
	return { advance, visualGait };
};
