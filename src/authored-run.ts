import { angleDelta } from './simulation';
import type { Foot, LegRig, WalkerGait } from './gait';

export const RUN_ENTER_SPEED = 50;
export const RUN_EXIT_SPEED = 42;
export interface AuthoredRunProfile {
	readonly cycleSeconds: number;
	readonly stanceFraction: number;
	readonly referenceSpeed: number;
	readonly enterSpeed: number;
	readonly exitSpeed: number;
	readonly swingLift: number;
	readonly bodyLift: number;
	readonly bodyRoll: number;
	readonly bodyPitch: number;
	readonly footPitch: number;
	readonly landingLead?: number;
}
export const WARDEN_RUN_PROFILE: AuthoredRunProfile = {
	cycleSeconds: 0.94, stanceFraction: 0.32, referenceSpeed: 90,
	enterSpeed: RUN_ENTER_SPEED, exitSpeed: RUN_EXIT_SPEED,
	swingLift: 8, bodyLift: 1.2, bodyRoll: 0.035, bodyPitch: 0.06, footPitch: 0.18,
};
export const KESTREL_RUN_PROFILE: AuthoredRunProfile = {
	cycleSeconds: 1.05, stanceFraction: 0.26, referenceSpeed: 85, enterSpeed: 40, exitSpeed: 32,
	swingLift: 11, bodyLift: 4.4, bodyRoll: 0.025, bodyPitch: 0.052, footPitch: 0.22,
};
export const runSwingRate = function (speed: number, stopping: boolean, profile: AuthoredRunProfile): number {
	return stopping ? 1.6 : Math.max(1, speed / profile.referenceSpeed);
};

interface Landing { readonly x: number; readonly y: number; readonly angle: number }
interface RunSwing { readonly from: Foot; readonly elapsed: number; readonly duration: number; readonly target?: Landing }
interface RunLeg { readonly swing: RunSwing | undefined; readonly swingPhase: boolean }
interface RunState { readonly phase: number; readonly legs: readonly [RunLeg, RunLeg]; readonly stopping: boolean }
export interface AuthoredGait extends WalkerGait { readonly running?: RunState }

const smooth = function (value: number) { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const phaseOf = function (phase: number, index: 0 | 1) { return (phase + index * 0.5) % 1; };
const beginRun = function (gait: WalkerGait, speed: number, rig: LegRig, profile: AuthoredRunProfile): RunState {
	const { cycleSeconds, stanceFraction } = profile;
	const support = gait.swing ? gait.swing.index === 0 ? 1 : 0 : gait.nextFoot === 0 ? 1 : 0;
	const foot = gait.feet[support];
	const ahead = (foot.x - gait.body.x) * Math.cos(gait.body.angle) + (foot.y - gait.body.y) * Math.sin(gait.body.angle) - (rig.footForward ?? rig.hipForward + 5);
	// A trailing walk contact is already near toe-off. Reusing its stance progress
	// prevents the run handoff from pinning it through another full support phase.
	const rate = Math.max(1, speed / profile.referenceSpeed);
	const progress = Math.max(0, Math.min(0.999, 0.5 - ahead / (speed * cycleSeconds * stanceFraction / rate)));
	const phase = (progress * stanceFraction + support * 0.5) % 1;
	const leg = function (index: 0 | 1): RunLeg {
		const local = phaseOf(phase, index); const swinging = local >= stanceFraction;
		return { swingPhase: swinging, swing: swinging ? { from: gait.feet[index], elapsed: 0, duration: (1 - local) * cycleSeconds } : undefined };
	};
	return { phase, legs: [leg(0), leg(1)], stopping: false };
};

// Each leg has a shorter stance than half a cycle. Their swings overlap, giving
// two genuine flight intervals while stance contacts remain fixed in the world.
export const advanceAuthoredRun = function (previous: AuthoredGait, actual: WalkerGait['body'], dt: number, rig: LegRig, profile: AuthoredRunProfile = WARDEN_RUN_PROFILE): AuthoredGait {
	const { cycleSeconds, stanceFraction } = profile;
	if (dt <= 0) return previous;
	const body = { ...actual, angle: previous.body.angle + Math.max(-dt * 2.5, Math.min(dt * 2.5, angleDelta(previous.body.angle, actual.angle))) };
	const dx = (body.x - previous.body.x) / dt; const dy = (body.y - previous.body.y) / dt;
	const speed = dx * Math.cos(body.angle) + dy * Math.sin(body.angle);
	const before = previous.running ?? beginRun(previous, speed, rig, profile);
	const stopping = speed < profile.exitSpeed || before.stopping && speed < profile.enterSpeed;
	const stance = stopping ? 0.6 : stanceFraction;
	// Finish the airborne step promptly under braking instead of leaving its
	// supporting partner stretched ahead of a reversing hull.
	// Cover higher ground speeds with cadence after extending the stride, so
	// planted contacts remain inside the measured legs' reach at 180 m/s.
	const rate = runSwingRate(speed, stopping, profile);
	const phase = (before.phase + dt * rate / cycleSeconds) % 1;
	const turn = angleDelta(previous.body.angle, body.angle) / dt;
	let landed = false;
	const advanceLeg = function (index: 0 | 1): { foot: Foot; leg: RunLeg } {
		const old = before.legs[index]; const local = phaseOf(phase, index); const swingPhase = local >= stance;
		const swing = old.swing ?? (!old.swingPhase && swingPhase ? { from: previous.feet[index], elapsed: 0, duration: (1 - local) * cycleSeconds } : undefined);
		if (!swing) return { foot: previous.feet[index], leg: { swing: undefined, swingPhase } };
		const elapsed = Math.min(swing.duration, swing.elapsed + dt * rate); const progress = elapsed / swing.duration;
		const lead = (swing.duration - elapsed + cycleSeconds * stance * (profile.landingLead ?? 0.5)) / rate;
		const heading = body.angle + turn * lead; const side = index === 0 ? -1 : 1;
		const forward = rig.footForward ?? rig.hipForward + 5; const width = rig.footWidth ?? rig.hipWidth;
		const desired = { x: body.x + dx * lead + Math.cos(heading) * forward - Math.sin(heading) * side * width, y: body.y + dy * lead + Math.sin(heading) * forward + Math.cos(heading) * side * width, angle: heading };
		const prior = swing.target ?? desired;
		// A blocked hull can lose its forward velocity in one tick. Retarget the
		// airborne foot gradually instead of snapping its whole remaining trajectory.
		const correction = Math.hypot(desired.x - prior.x, desired.y - prior.y);
		const response = Math.min(1, dt * 10, dt * 180 / Math.max(correction, 1e-8));
		const target = { x: prior.x + (desired.x - prior.x) * response, y: prior.y + (desired.y - prior.y) * response, angle: prior.angle + angleDelta(prior.angle, desired.angle) * response };
		const blend = smooth(progress);
		const arc = Math.sin(Math.PI * progress) * smooth(Math.min(progress, 1 - progress) / 0.12);
		const foot: Foot = {
			x: swing.from.x + (target.x - swing.from.x) * blend, y: swing.from.y + (target.y - swing.from.y) * blend,
			angle: swing.from.angle + angleDelta(swing.from.angle, target.angle) * blend,
			lift: progress === 1 ? 0 : swing.from.lift * (1 - blend) + arc * profile.swingLift,
		};
		if (progress === 1) landed = true;
		return { foot, leg: { swingPhase, swing: progress === 1 ? undefined : { ...swing, elapsed, target } } };
	};
	const left = advanceLeg(0); const right = advanceLeg(1);
	const impact = landed ? 1 : previous.motion.impact * Math.exp(-dt * 14);
	const halfPhase = phase * 2 % 1; const flight = (halfPhase - stanceFraction * 2) / (1 - stanceFraction * 2);
	const flightLift = !stopping && flight > 0 ? Math.sin(Math.PI * flight) ** 2 * profile.bodyLift : 0;
	const motion = { lift: (flightLift - impact * 0.8) / 0.3, roll: Math.sin(phase * Math.PI * 2) * profile.bodyRoll, pitch: -Math.min(1, Math.max(-1, speed / profile.referenceSpeed)) * profile.bodyPitch, impact };
	const gait: WalkerGait = { body, feet: [left.foot, right.foot], swing: undefined, nextFoot: phase < 0.5 ? 1 : 0, travelSpeed: Math.hypot(dx, dy), motion };
	if (stopping && !left.leg.swing && !right.leg.swing && left.foot.lift === 0 && right.foot.lift === 0) return gait;
	return { ...gait, running: { phase, legs: [left.leg, right.leg], stopping } };
};

export const authoredRunFootPitch = function (gait: AuthoredGait, index: 0 | 1, amplitude = 0.18): number {
	const swing = gait.running?.legs[index].swing;
	return swing ? -Math.sin(swing.elapsed / swing.duration * Math.PI * 2) * amplitude : 0;
};
