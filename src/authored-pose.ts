import { InterpolateDiscrete, InterpolateLinear, Matrix4, Quaternion, Vector3, type AnimationClip, type KeyframeTrack, type Object3D } from 'three';
import type { WeaponBody } from './weapon-rig';

export const authoredClipNames = ['walk', 'run', 'backward'] as const;
export type AuthoredMotionName = typeof authoredClipNames[number];
export interface AuthoredClipState { readonly name: AuthoredMotionName; readonly time: number; readonly weight: number; readonly timeScale: number }
// Plain simulation data. No renderer objects or mutable render-state cache.
export interface AuthoredPoseContext {
	readonly time: number;
	readonly body: { readonly x: number; readonly y: number; readonly angle: number };
	readonly selected: AuthoredMotionName | 'idle';
	readonly clips: readonly AuthoredClipState[];
}
export interface AuthoredMotion { readonly name: AuthoredMotionName; readonly clip: AnimationClip; readonly nominalSpeed: number }
export interface AuthoredTransform { readonly name: string; readonly position: Vector3; readonly quaternion: Quaternion; readonly scale: Vector3 }

export const advanceAuthoredPose = function (motions: readonly AuthoredMotion[], previous: AuthoredPoseContext | undefined, body: WeaponBody, time: number): AuthoredPoseContext {
	const angle = body.angle ?? 0;
	const dt = previous && time >= previous.time ? Math.min(time - previous.time, 0.1) : 0;
	const valid = previous && time >= previous.time ? previous : undefined;
	const signedSpeed = valid && dt > 0 ? ((body.x - valid.body.x) * Math.cos(angle) + (body.y - valid.body.y) * Math.sin(angle)) / dt : 0;
	const turning = valid && dt > 0 ? Math.abs(Math.atan2(Math.sin(angle - valid.body.angle), Math.cos(angle - valid.body.angle))) / dt * 24 : 0;
	const speed = Math.max(Math.abs(signedSpeed), turning);
	const walk = motions.find(function (motion) { return motion.name === 'walk'; });
	const run = motions.find(function (motion) { return motion.name === 'run'; });
	if (!walk || !run) throw new Error('Missing authored motion timing');
	const selected = speed < 0.5 ? 'idle' : signedSpeed < -0.5 ? 'backward' : speed > (walk.nominalSpeed + run.nominalSpeed) / 2 ? 'run' : 'walk';
	return { time, body: { x: body.x, y: body.y, angle }, selected, clips: motions.map(function (motion) {
		const before = valid?.clips.find(function (entry) { return entry.name === motion.name; });
		const desired = motion.name === selected ? 1 : 0;
		let weight = (before?.weight ?? 0) + (desired - (before?.weight ?? 0)) * (1 - Math.exp(-dt * 18));
		if (Math.abs(weight - desired) < 0.0001) weight = desired;
		const timeScale = Math.max(0.25, Math.min(3, speed / motion.nominalSpeed));
		return { name: motion.name, time: ((before?.time ?? 0) + dt * timeScale) % motion.clip.duration, weight, timeScale };
	}) };
};

const prepareTrack = function (source: KeyframeTrack) {
	const track = source.clone(); const result = new Float32Array(track.getValueSize());
	const interpolation = track.getInterpolation();
	if (interpolation !== InterpolateDiscrete && interpolation !== InterpolateLinear) throw new Error(`Unsupported authored interpolation ${track.name}`);
	const interpolant = interpolation === InterpolateDiscrete ? track.InterpolantFactoryMethodDiscrete(result) : track.InterpolantFactoryMethodLinear(result);
	return { name: track.name, sample: function (time: number) { interpolant.evaluate(time); return result; } };
};

// Capture immutable source curves and rest transforms once. Sampling never reads
// a render graph: the same numeric upper-body pose drives visuals and combat.
export const prepareAuthoredTorsoSampler = function (torso: Object3D, motions: readonly AuthoredMotion[], basis: Matrix4) {
	const chain: Object3D[] = []; let current: Object3D | null = torso;
	while (current) { chain.unshift(current); current = current.parent; }
	const rests = chain.map(function (node) {
		const original: unknown = node.userData['name'];
		return { name: node.name, originalName: typeof original === 'string' ? original : node.name, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
	});
	const clips = motions.map(function (motion) { return { name: motion.name, tracks: motion.clip.tracks.map(function (track) { return prepareTrack(track); }) }; });
	const sample = function (context: AuthoredPoseContext | undefined): AuthoredTransform[] {
		return rests.map(function (rest) {
			const position = rest.position.clone(); const quaternion = rest.quaternion.clone(); const scale = rest.scale.clone();
			for (const property of ['position', 'quaternion', 'scale'] as const) {
				let total = 0; const vector = new Vector3(); const rotation = new Quaternion();
				for (const clip of clips) {
					const state = context?.clips.find(function (entry) { return entry.name === clip.name; });
					if (!state || state.weight <= 0) continue;
					const track = clip.tracks.find(function (candidate) { return candidate.name === `${rest.name}.${property}` || candidate.name === `${rest.originalName}.${property}`; });
					if (!track) continue;
					const value = track.sample(state.time); const nextTotal = total + state.weight;
					if (property === 'quaternion') {
						const next = new Quaternion().fromArray(value);
						if (total === 0) rotation.copy(next); else rotation.slerp(next, state.weight / nextTotal);
					} else vector.addScaledVector(new Vector3().fromArray(value), state.weight);
					total = nextTotal;
				}
				if (total <= 0) continue;
				if (property === 'quaternion') quaternion.copy(rotation).slerp(rest.quaternion, Math.max(0, 1 - total));
				else {
					if (total > 1) vector.divideScalar(total);
					else vector.addScaledVector(rest[property], 1 - total);
					(property === 'position' ? position : scale).copy(vector);
				}
			}
			return { name: rest.name, position, quaternion, scale };
		});
	};
	const matrix = function (context: AuthoredPoseContext | undefined, angle: number, heading: number): Matrix4 {
		const result = new Matrix4().makeRotationY(-angle).multiply(basis);
		const transforms = sample(context);
		for (const [index, transform] of transforms.entries()) {
			const rotation = transform.quaternion.clone();
			if (index === transforms.length - 1) rotation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle - heading));
			result.multiply(new Matrix4().compose(transform.position, rotation, transform.scale));
		}
		return result;
	};
	return { sample, matrix };
};
