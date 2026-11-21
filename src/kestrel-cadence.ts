import type { AuthoredPoseContext } from './authored-pose';
import { KESTREL_RUN_PROFILE, runSwingRate, type AuthoredGait } from './authored-run';

const ticksPerSecond = 60;
const windowLead = 24; // Open a sampling window 40% of a period before its nominal pose.
const airborne = function (gait: AuthoredGait) { return gait.feet[0].lift > 0 && gait.feet[1].lift > 0; };

// Called on fixed steps. Each exposure window gets one pose, preferably on a landing.
// A swing's remaining duration is known even while a pilot is changing its destination.
export const createKestrelCadence = function () {
	let clock = 0;
	let sampledWindow = 0;
	let heldTicks = 0;
	let held: AuthoredGait | undefined;
	let previous: AuthoredPoseContext | undefined;

	const reset = function () {
		clock = 0;
		sampledWindow = 0;
		heldTicks = 0;
		held = undefined;
		previous = undefined;
	};
	const advance = function (pose: AuthoredPoseContext | undefined, speed: number) {
		const gait = pose?.gait;
		if (!pose || !gait) { reset(); return; }
		if (pose === previous) return;
		const prior = previous?.gait;
		if (!previous || !prior || pose.time <= previous.time || pose.time - previous.time > 1.5 / ticksPerSecond) {
			reset();
			previous = pose;
			held = gait;
			// A fresh live scenario first reports the pose at the end of tick one.
			if (pose.time > 0 && pose.time <= 1.5 / ticksPerSecond) {
				clock = gait.running ? 12 : 8;
				heldTicks = 1;
			}
			return;
		}
		previous = pose;
		const rate = gait.running ? 12 : 8;
		clock += rate;
		heldTicks++;
		const window = Math.floor((clock + windowLead) / ticksPerSecond);
		if (window <= sampledWindow) return;

		const stepsLeft = Math.ceil(((window + 1) * ticksPerSecond - windowLead - clock) / rate) - 1;
		const swings = gait.running ? gait.running.legs.map(function (leg) { return leg.swing; }) : [gait.swing];
		const swingStep = (gait.running ? runSwingRate(speed, gait.running.stopping, KESTREL_RUN_PROFILE) : 1) / ticksPerSecond;
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
		if (stepsLeft === 0 || heldTicks >= (gait.running ? 8 : 12) || (heldTicks >= 3 && keyPose)) {
			held = gait;
			sampledWindow = window;
			heldTicks = 0;
		}
	};
	const visualPose = function (pose: AuthoredPoseContext | undefined) {
		if (!pose?.gait || pose !== previous || !held || held === pose.gait) return pose;
		// Live pelvis and upper-body motion preserve the weapon sockets. The leg solver
		// uses the sampled feet in world space, including the sampled swing's ankle pitch.
		return { ...pose, gait: { ...held, body: pose.gait.body, motion: pose.gait.motion } };
	};
	return { advance, reset, visualPose };
};
