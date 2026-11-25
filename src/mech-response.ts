import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { CombatStateView, Point } from './simulation';
import type { FeedbackActor, FeedbackFamily, WeaponCue } from './weapon-feedback';

const motion = {
	bullet: { stroke: 4.4, settle: 0.12, rock: 0.038, recovery: 0.12 },
	cannon: { stroke: 11, settle: 0.28, rock: 0.145, recovery: 0.42 },
	missile: { stroke: 2.2, settle: 0.14, rock: 0.105, recovery: 0.38 },
	rocket: { stroke: 3, settle: 0.15, rock: 0.125, recovery: 0.4 },
	artillery: { stroke: 11, settle: 0.28, rock: 0.145, recovery: 0.42 },
} satisfies Record<FeedbackFamily, { stroke: number; settle: number; rock: number; recovery: number }>;

const impulse = function (age: number, duration: number, attack: number): number {
	if (age < 0 || age >= duration) return 0;
	if (age < attack) return Math.sin(age / attack * Math.PI / 2);
	const progress = (age - attack) / (duration - attack);
	return (1 - progress) ** 2 * (1 + 0.3 * Math.sin(progress * Math.PI * 2));
};

interface MountStroke { time: number; distance: number; direction: Point }
export interface MechResponse {
	readonly mounts: ReadonlyMap<number, MountStroke>;
	readonly tiltX: number;
	readonly tiltZ: number;
	readonly compression: number;
	readonly pivotDrop: number;
	readonly flash: number;
	readonly lastImpact: number;
}

// Sample the live combat clock once for the whole scene. Re-rendering a paused
// frame or skipping several fixed steps produces the same pose at the same time.
export const sampleMechResponses = function (state: Pick<CombatStateView, 'time' | 'effects' | 'player' | 'enemies' | 'squadmates'>): ReadonlyMap<FeedbackActor, MechResponse> {
	const now = state.time;
	const newResponse = function () {
		return { mounts: new Map<number, MountStroke>(), tiltX: 0, tiltZ: 0, compression: 0, pivotDrop: 0, flash: 0, lastImpact: -Infinity, rockLimit: 0 };
	};
	const actors = new Map<FeedbackActor, ReturnType<typeof newResponse>>();
	const responseFor = function (id: FeedbackActor) {
		const previous = actors.get(id);
		if (previous) return previous;
		const response = newResponse();
		actors.set(id, response);
		return response;
	};
	let positions: Map<FeedbackActor, Point> | undefined;
	const rock = function (id: FeedbackActor, cue: WeaponCue, direction: Point, strength: number) {
		const response = responseFor(id);
		const age = now - cue.time;
		const profile = motion[cue.family];
		const light = cue.family === 'bullet';
		const peak = strength * profile.rock * (cue.heavy ? 1.4 : 1);
		const angle = peak * impulse(age, profile.recovery * (cue.heavy ? 1.32 : 1), light ? 0.013 : 0.035);
		response.tiltX += direction.y * angle;
		response.tiltZ -= direction.x * angle;
		response.compression += angle * 10;
		if (angle > 0) response.rockLimit = Math.max(response.rockLimit, peak * 1.6 * 10);
		response.lastImpact = Math.max(response.lastImpact, cue.time);
		response.flash = Math.max(response.flash, strength * (light ? 0.36 : 0.83) * Math.max(0, 1 - age / (light ? 0.055 : 0.115)));
	};
	for (const effect of state.effects) {
		const cue = effect.feedback;
		if (!cue || cue.time > now) continue;
		if (cue.type === 'fire') {
			const age = now - cue.time;
			const profile = motion[cue.family];
			const duration = profile.settle * (cue.heavy ? 1.18 : 1);
			if (age >= duration) continue;
			const mounts = responseFor(cue.shooter).mounts;
			if ((mounts.get(cue.slot)?.time ?? -Infinity) >= cue.time) continue;
			const distance = profile.stroke * (cue.heavy ? 1.4 : 1) * impulse(age, duration, cue.family === 'bullet' ? 0.016 : 0.026);
			mounts.set(cue.slot, { time: cue.time, distance, direction: cue.direction });
			continue;
		}
		if (cue.target !== undefined) rock(cue.target, cue, cue.direction, 1);
		if (!cue.affected?.length) continue;
		if (!positions) {
			positions = new Map<FeedbackActor, Point>([[0, state.player]]);
			for (const enemy of state.enemies) positions.set(enemy.id, enemy);
			for (const mate of state.squadmates) positions.set(mate.pilotId, mate);
		}
		for (const id of cue.affected) {
			const actor = positions.get(id);
			if (!actor || id === cue.target) continue;
			const x = actor.x - effect.x; const y = actor.y - effect.y;
			const distance = Math.hypot(x, y) || 1;
			rock(id, cue, { x: x / distance, y: y / distance }, 0.55);
		}
	}
	for (const response of actors.values()) {
		// Overlapping warheads share the suspension travel. Different firing
		// slots keep their own full stroke, even on a simultaneous broadside.
		if (response.compression > response.rockLimit) {
			const factor = response.rockLimit / response.compression;
			response.tiltX *= factor;
			response.tiltZ *= factor;
			response.compression = response.rockLimit;
		}
		let fireX = 0; let fireZ = 0; let travel = 0;
		for (const { distance, direction } of response.mounts.values()) {
			fireX -= direction.y * distance;
			fireZ += direction.x * distance;
			travel += distance;
		}
		const gain = travel > 18 ? 18 / travel : 1;
		response.tiltX += fireX * gain * 0.0059;
		response.tiltZ += fireZ * gain * 0.0059;
		const fireDip = travel * gain * 0.18;
		const impactDip = response.compression;
		response.compression = fireDip + impactDip;
		// Gun recoil pivots near the hip. A blow tips the same upper body
		// farther over its planted legs, around a lower point in the stance.
		if (response.compression > 0) response.pivotDrop = (11 * fireDip + 18 * impactDip) / response.compression;
	}
	return actors;
};

// Mount travel follows each mount's own posed barrel axis. Tilt is shared
// around the torso bearing, including separately stabilized procedural gimbals.
// Both are visual offsets layered after the authoritative exits are sampled.
export const createMechResponseRig = function (root: Object3D, torso: Object3D, assemblies: readonly Object3D[], independentGimbals = false) {
	const local = new Matrix4(); const basis = new Matrix4(); const offset = new Matrix4();
	const axis = new Vector3(); const center = new Vector3(); const scale = new Vector3();
	const inverse = new Matrix4();
	root.updateWorldMatrix(true, true);
	const mounts = assemblies.map(function (part) {
		const parent = part.parent;
		if (!parent) throw new Error('A weapon mount needs a parent');
		// One gameplay unit backwards, expressed in the neutral mount parent's
		// coordinates. Authored GLBs and procedural armor use different bases.
		basis.copy(parent.matrixWorld).invert().multiply(root.matrixWorld);
		const back = new Vector3(-1, 0, 0).applyMatrix4(basis).sub(center.setFromMatrixPosition(basis));
		return { part, parent, back, home: part.position.clone() };
	});
	const upper = [torso, ...(independentGimbals ? mounts.map(function (mount) { return mount.parent; }) : [])].map(function (part) {
		return { part, position: new Vector3(), rotation: new Quaternion() };
	});
	let active = false;
	return {
		restore: function () {
			if (!active) return;
			for (const mount of mounts) mount.part.position.copy(mount.home);
			for (const { part, position, rotation } of upper) { part.position.copy(position); part.quaternion.copy(rotation); }
			active = false;
		},
		apply: function (response: MechResponse | undefined) {
			if (!response || response.compression === 0) return;
			active = true;
			for (const [slot, stroke] of response.mounts) {
				const mount = mounts[slot];
				if (mount) mount.part.position.addScaledVector(mount.back, stroke.distance);
			}
			inverse.copy(root.matrixWorld).invert();
			center.setFromMatrixPosition(torso.matrixWorld).applyMatrix4(inverse);
			center.y -= response.pivotDrop;
			axis.set(response.tiltX, 0, response.tiltZ);
			const angle = axis.length();
			offset.makeRotationAxis(axis.normalize(), angle);
			axis.copy(center).applyMatrix4(offset).negate().add(center);
			axis.y -= response.compression;
			offset.setPosition(axis);
			for (const entry of upper) {
				const { part } = entry;
				const parent = part.parent;
				if (!parent) continue;
				entry.position.copy(part.position);
				entry.rotation.copy(part.quaternion);
				basis.multiplyMatrices(inverse, parent.matrixWorld);
				local.copy(basis).invert().multiply(offset).multiply(basis).multiply(part.matrix);
				local.decompose(part.position, part.quaternion, scale);
				part.updateMatrixWorld(true);
			}
		},
	};
};
