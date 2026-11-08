import { getFrame } from './frames';
import { FRAME_RIGS, STANDARD_LEG_RIG, type LegRig } from './frame-rig';
import { angleDelta, distance, type EnemyKind, type Point, type CombatStateView } from './simulation';
export { STANDARD_LEG_RIG, type LegRig } from './frame-rig';

interface Body extends Point { angle: number }
export interface Foot extends Point { lift: number; angle: number }
type FootIndex = 0 | 1;
interface Swing { index: FootIndex; from: Foot; elapsed: number; duration: number; launchPitch?: number; direction?: number }
export interface FootPose extends Foot { pitch: number; toePitch: number }
interface BodyMotion { lift: number; roll: number; pitch: number; impact: number }
export interface WalkerGait {
	body: Body;
	motion: BodyMotion;
	feet: readonly [Foot, Foot];
	swing: Swing | undefined;
	nextFoot: FootIndex;
	travelSpeed?: number;
}
export interface Gaits { player: WalkerGait; enemies: ReadonlyMap<number, WalkerGait>; time: number }
interface Joint extends Point { z: number }

const clamp = function (value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); };
const mix = function (from: number, to: number, t: number) { return from + (to - from) * t; };
const smooth = function (value: number) { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const humanoidStancePitch = function (gait: WalkerGait, foot: Foot, size: number, rig: LegRig) {
	const direction = clamp(-gait.motion.pitch / 0.02, -1, 1);
	const trailing = ((gait.body.x - foot.x) * Math.cos(foot.angle) + (gait.body.y - foot.y) * Math.sin(foot.angle)) / size + rig.hipForward + 5;
	return -direction * 0.16 * smooth((trailing * direction - 3) / 16);
};
const stancePitch = function (gait: WalkerGait, foot: Foot, size: number) {
	const direction = clamp(-gait.motion.pitch / 0.02, -1, 1);
	const trailing = ((gait.body.x - foot.x) * Math.cos(foot.angle) + (gait.body.y - foot.y) * Math.sin(foot.angle)) / size + 7;
	return -direction * 0.32 * smooth((trailing * direction - 4) / 18);
};
export const mechScale = function (kind: EnemyKind) { return kind === 'scout' ? 0.8 : kind === 'siege' ? 1.15 : 1; };
const restFoot = function (body: Body, index: FootIndex, size: number, rig: LegRig): Foot {
	const side = index === 0 ? -1 : 1;
	const forward = rig.kneeDirection === 1 ? rig.hipForward + 5 : 7;
	const width = rig.kneeDirection === 1 ? rig.hipWidth : 23;
	return {
		x: body.x + Math.cos(body.angle) * forward * size - Math.sin(body.angle) * side * width * size,
		y: body.y + Math.sin(body.angle) * forward * size + Math.cos(body.angle) * side * width * size,
		angle: body.angle, lift: 0,
	};
};
export const createGait = function (body: Body, size = 1, rig: LegRig = STANDARD_LEG_RIG): WalkerGait {
	return { body: { ...body }, motion: { lift: 0, roll: 0, pitch: 0, impact: 0 }, feet: [restFoot(body, 0, size, rig), restFoot(body, 1, size, rig)], swing: undefined, nextFoot: 0, ...(rig.kneeDirection === 1 ? { travelSpeed: 0 } : {}) };
};

const advanceBodyMotion = function (motion: BodyMotion, swing: Swing | undefined, forwardSpeed: number, dt: number): BodyMotion {
	const progress = swing ? swing.elapsed / swing.duration : 0;
	const weight = Math.sin(progress * Math.PI) ** 2;
	const supportSide = swing?.index === 0 ? 1 : -1;
	// Touchdown loads the suspension; its compression outlasts the foot swing.
	const impact = progress === 1 ? 1 : motion.impact * Math.exp(-dt * 14);
	const stride = clamp(forwardSpeed / 90, -1, 1);
	const response = 1 - Math.exp(-dt * 12);
	return {
		lift: mix(motion.lift, weight * 2.4 - impact * 4, response),
		roll: mix(motion.roll, supportSide * weight * 0.065, response),
		pitch: mix(motion.pitch, -stride * (0.035 + impact * 0.025), response),
		impact,
	};
};

// Presentation advances on simulation steps, never render frames. Stance feet
// retain their world position AND heading while the hull passes over them.
export const advanceGait = function (gait: WalkerGait, actualBody: Body, dt: number, size = 1, stride = 1, rig: LegRig = STANDARD_LEG_RIG): WalkerGait {
	if (dt <= 0) return gait;
	if (distance(gait.body, actualBody) > 80 * size) return createGait(actualBody, size, rig);
	// AI aim can change instantly on a target switch. Let the visible hull turn
	// through that change without rotating either planted foot with it.
	const body: Body = { x: actualBody.x, y: actualBody.y, angle: gait.body.angle + clamp(angleDelta(gait.body.angle, actualBody.angle), -dt * 2.5, dt * 2.5) };
	const dx = (body.x - gait.body.x) / dt; const dy = (body.y - gait.body.y) / dt;
	const forwardSpeed = (dx * Math.cos(body.angle) + dy * Math.sin(body.angle)) / size;
	const turn = angleDelta(gait.body.angle, body.angle) / dt;
	const travelSpeed = Math.hypot(dx, dy);
	const speed = travelSpeed + Math.abs(turn) * 23 * size;
	// Above walking pace, cover more ground per step instead of only raising
	// cadence. Scale by body size and cap the extension to keep limbs in reach.
	const stepStride = stride * clamp(travelSpeed / (60 * size), 1, 3);
	const humanoid = rig.kneeDirection === 1;
	const travel = humanoid ? { travelSpeed } : {};
	// Lift the first foot on the same tick as acceleration from rest. Requiring
	// rising speed prevents the lingering deceleration tail from restarting it.
	const previousSpeed = gait.travelSpeed ?? 0;
	const starting = humanoid && previousSpeed <= 0.1 && travelSpeed > previousSpeed + 0.001;
	const settling = humanoid && !starting && speed <= 0.1;
	const needsStep = function (index: FootIndex) {
		return distance(gait.feet[index], restFoot(body, index, size, rig)) > (settling ? 0.05 * size : 10 * size * stepStride)
			|| (settling && Math.abs(angleDelta(gait.feet[index].angle, body.angle)) > 0.005);
	};
	let swing = gait.swing;
	if (!swing && (starting || speed > 0.1 || settling)) {
		const preferred = gait.nextFoot;
		const other = preferred === 0 ? 1 : 0;
		const index = starting || needsStep(preferred) ? preferred : other;
		if (starting || needsStep(index)) {
			const from = gait.feet[index]; const rest = restFoot(body, index, size, rig);
			const direction = clamp(((rest.x - from.x) * Math.cos(from.angle) + (rest.y - from.y) * Math.sin(from.angle)) / (8 * size), -1, 1);
			swing = { index, from, elapsed: 0, duration: settling ? 0.24 : clamp(26 * size * stepStride / speed, 0.12 * stride, 0.65 * stride), launchPitch: humanoid ? humanoidStancePitch(gait, from, size, rig) : stancePitch(gait, from, size), direction };
		}
	}
	if (!swing) return { ...gait, ...travel, body, motion: advanceBodyMotion(gait.motion, undefined, forwardSpeed, dt) };
	const elapsed = Math.min(swing.duration, swing.elapsed + dt);
	const progress = elapsed / swing.duration;
	// Predict touchdown from actual translation and turning. Re-evaluating this
	// during swing lets reversing and braking redirect the airborne foot.
	const lead = swing.duration - elapsed + swing.duration * 0.4;
	const target = restFoot({ x: body.x + dx * lead, y: body.y + dy * lead, angle: body.angle + turn * lead }, swing.index, size, rig);
	const eased = progress * progress * (3 - 2 * progress);
	const foot: Foot = {
		x: mix(swing.from.x, target.x, eased), y: mix(swing.from.y, target.y, eased),
		angle: swing.from.angle + angleDelta(swing.from.angle, target.angle) * eased,
		lift: progress === 1 ? 0 : Math.sin(progress * Math.PI) ** 2 * (humanoid ? 6 : 10) * size,
	};
	return {
		...travel,
		body, motion: advanceBodyMotion(gait.motion, { ...swing, elapsed }, forwardSpeed, dt),
		feet: swing.index === 0 ? [foot, gait.feet[1]] : [gait.feet[0], foot],
		swing: progress === 1 ? undefined : { ...swing, elapsed },
		nextFoot: swing.index === 0 ? 1 : 0,
	};
};

// The gait's feet remain fixed ground contacts. Roll the shoe around its toe
// hinge at push-off or its heel on recovery, then solve the leg to that ankle.
// Keeping this derived from fixed-step state also freezes articulation on pause.
export const footPose = function (gait: WalkerGait, index: FootIndex, size = 1, rig: LegRig = STANDARD_LEG_RIG, heel = -16): FootPose {
	const foot = gait.feet[index];
	if (rig.kneeDirection === 1) {
		const swing = gait.swing?.index === index ? gait.swing : undefined;
		const progress = swing ? swing.elapsed / swing.duration : 0;
		const direction = swing?.direction ?? clamp(-gait.motion.pitch / 0.02, -1, 1);
		const pitch = swing
			? (swing.launchPitch ?? 0) * (1 - smooth(progress / 0.3))
				- direction * 0.17 * Math.sin(Math.PI * clamp(progress / 0.5, 0, 1))
				+ direction * 0.14 * Math.sin(Math.PI * clamp((progress - 0.4) / 0.6, 0, 1))
			: humanoidStancePitch(gait, foot, size, rig);
		const pivot = pitch < 0 ? 26 : -16;
		const forward = pivot * (1 - Math.cos(pitch)) * size;
		return { ...foot, x: foot.x + Math.cos(foot.angle) * forward, y: foot.y + Math.sin(foot.angle) * forward, lift: foot.lift - pivot * Math.sin(pitch) * size, pitch, toePitch: 0 };
	}
	const swing = gait.swing?.index === index ? gait.swing : undefined;
	const progress = swing ? swing.elapsed / swing.duration : 0;
	const direction = swing?.direction ?? 0;
	const pitch = swing
		? (swing.launchPitch ?? 0) * (1 - smooth(progress / 0.35))
			- direction * 0.36 * Math.sin(Math.PI * clamp(progress / 0.52, 0, 1))
			+ direction * 0.24 * Math.sin(Math.PI * clamp((progress - 0.36) / 0.64, 0, 1))
		: stancePitch(gait, foot, size);
	const curledToe = Math.max(0, -pitch) * (swing ? 1 - smooth((progress - 0.25) / 0.4) : 1)
		- direction * 0.12 * Math.sin(progress * Math.PI) ** 2;
	// Uncurl as clearance runs out, including a toe-first reverse landing.
	const toePitch = pitch < 0 ? Math.max(curledToe, -pitch - Math.atan(foot.lift / (18 * size))) : curledToe;
	const pivotX = pitch < 0 ? 8 : heel; const pivotY = pitch < 0 ? 3 : 0;
	const forward = (pivotX * (1 - Math.cos(pitch)) + pivotY * Math.sin(pitch)) * size;
	const lift = (pivotY * (1 - Math.cos(pitch)) - pivotX * Math.sin(pitch)) * size;
	return { ...foot, x: foot.x + Math.cos(foot.angle) * forward, y: foot.y + Math.sin(foot.angle) * forward, lift: foot.lift + lift, pitch, toePitch };
};

// Retain a 30-degree knee bend, with extra compression on touchdown. Solve the
// shared pelvis above the rolled ankles so neither fixed-length leg locks out.
export const posedLegRig = function (gait: WalkerGait, size: number, rig: LegRig): LegRig {
	if (rig.kneeDirection !== 1) return rig;
	const bend = (30 + gait.motion.impact * 7) * Math.PI / 180;
	const reach = Math.sqrt(rig.upper ** 2 + rig.lower ** 2 + 2 * rig.upper * rig.lower * Math.cos(bend)) * size;
	const hipHeight = ([0, 1] as const).reduce(function (height, index) {
		const foot = footPose(gait, index, size, rig);
		const side = index === 0 ? -1 : 1;
		const hipX = gait.body.x + Math.cos(gait.body.angle) * rig.hipForward * size - Math.sin(gait.body.angle) * side * rig.hipWidth * size;
		const hipY = gait.body.y + Math.sin(gait.body.angle) * rig.hipForward * size + Math.cos(gait.body.angle) * side * rig.hipWidth * size;
		const ankleForward = (-5 * Math.cos(foot.pitch) - 10 * Math.sin(foot.pitch)) * size;
		const dx = foot.x + Math.cos(foot.angle) * ankleForward - hipX;
		const dy = foot.y + Math.sin(foot.angle) * ankleForward - hipY;
		const ankleHeight = (10 * Math.cos(foot.pitch) - 5 * Math.sin(foot.pitch)) * size + foot.lift;
		return Math.min(height, (ankleHeight + Math.sqrt(Math.max(0, reach ** 2 - dx ** 2 - dy ** 2))) / size);
	}, rig.hipHeight - Math.max(0, gait.motion.lift) * 0.15);
	return { ...rig, hipHeight };
};

// Solve fixed-length limbs above the planted or swinging foot. Existing
// callers keep the original Warden anatomy unless they supply a frame rig.
export const legJoints = function (body: Body, foot: Foot, index: FootIndex, size = 1, rig: LegRig = STANDARD_LEG_RIG, pitch = 0) {
	const side = index === 0 ? -1 : 1;
	const hip: Joint = {
		x: body.x + Math.cos(body.angle) * rig.hipForward * size - Math.sin(body.angle) * side * rig.hipWidth * size,
		y: body.y + Math.sin(body.angle) * rig.hipForward * size + Math.cos(body.angle) * side * rig.hipWidth * size, z: rig.hipHeight * size,
	};
	const ankleForward = (-5 * Math.cos(pitch) - 10 * Math.sin(pitch)) * size;
	const ankle: Joint = { x: foot.x + Math.cos(foot.angle) * ankleForward, y: foot.y + Math.sin(foot.angle) * ankleForward, z: (10 * Math.cos(pitch) - 5 * Math.sin(pitch)) * size + foot.lift };
	const dx = ankle.x - hip.x; const dy = ankle.y - hip.y; const dz = ankle.z - hip.z;
	const length = Math.hypot(dx, dy, dz);
	const ux = dx / length; const uy = dy / length; const uz = dz / length;
	const dot = rig.kneeDirection * (Math.cos(body.angle) * ux + Math.sin(body.angle) * uy);
	const px = rig.kneeDirection * Math.cos(body.angle) - dot * ux; const py = rig.kneeDirection * Math.sin(body.angle) - dot * uy; const pz = -dot * uz;
	const poleLength = Math.hypot(px, py, pz);
	const upper = rig.upper * size; const lower = rig.lower * size;
	const along = clamp((upper ** 2 - lower ** 2 + length ** 2) / (2 * length), -upper, upper);
	const bend = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
	const knee: Joint = { x: hip.x + ux * along + px / poleLength * bend, y: hip.y + uy * along + py / poleLength * bend, z: hip.z + uz * along + pz / poleLength * bend };
	return { hip, knee, ankle };
};

export const createGaits = function (state: CombatStateView): Gaits {
	return { player: createGait(state.player, getFrame(state.frame).size, FRAME_RIGS[state.frame]), enemies: new Map(state.enemies.map(function (enemy) { return [enemy.id, createGait(enemy, mechScale(enemy.kind))]; })), time: state.time };
};
export const advanceGaits = function (gaits: Gaits, state: CombatStateView): Gaits {
	const dt = state.time - gaits.time;
	if (dt < 0) return createGaits(state);
	if (dt === 0) return gaits;
	return {
		player: advanceGait(gaits.player, state.player, dt, getFrame(state.frame).size, getFrame(state.frame).stride, FRAME_RIGS[state.frame]), time: state.time,
		enemies: new Map(state.enemies.map(function (enemy) {
			const size = mechScale(enemy.kind);
			return [enemy.id, advanceGait(gaits.enemies.get(enemy.id) ?? createGait(enemy, size), enemy, dt, size)];
		})),
	};
};
