import { Quaternion, Vector3, type Group, type Object3D } from 'three';
import type { FieldTerrain } from './field-terrain';
import { captureRigSurfaces } from './rig-collapse-geometry';
import { RIG_FOLD_SECONDS, RIG_LEG_RELEASE_SECONDS } from './rig-defeat-timing';
import type { Point } from './simulation';
import { groundHeight } from './terrain-elevation';

export interface CollapseSite extends Point { heading: number; side: -1 | 1; terrain?: FieldTerrain | undefined }
export interface FallenRigPose {
	labelHeight: number;
	shadow: Point & { heading: number; length: number; width: number };
}
export interface CollapseAnatomy {
	pelvis: Object3D;
	torso: Object3D;
	legs: readonly { thigh: Object3D; shin: Object3D; foot: Object3D }[];
	guns: readonly { pivot: Object3D; muzzle?: Object3D }[];
	pods: readonly Object3D[];
}

const up = new Vector3(0, 1, 0);
const unit = function (value: number) { return Math.max(0, Math.min(1, value)); };
const ease = function (time: number, start: number, end: number) {
	const u = unit((time - start) / (end - start));
	return u * u * (3 - 2 * u);
};

// World-space rotations measured from the last live pose let the chest, pods,
// guns and legs each retain their own inertia, including a traversed turret.
const captureJoint = function (node: Object3D, origin: Vector3) {
	const parent = node.parent;
	if (!parent) throw new Error('Missing parent for collapse joint ' + node.name);
	const at = node.getWorldPosition(new Vector3()).sub(origin);
	const base = node.getWorldQuaternion(new Quaternion()), local = node.quaternion.clone();
	const parentRotation = new Quaternion();
	return {
		node, at,
		turn: function (delta: Quaternion) {
			node.quaternion.copy(parent.getWorldQuaternion(parentRotation).invert()).multiply(delta).multiply(base);
		},
		restore: function () { node.quaternion.copy(local); },
	};
};
type Joint = ReturnType<typeof captureJoint>;

const prepareLeg = function (
	thigh: Joint, shin: Joint, foot: Joint, sole: readonly Vector3[], hipCenter: Vector3, stance: number,
	forward: Vector3, across: Vector3, side: number, loose: boolean, origin: Vector3, floor: (point: Vector3) => number,
) {
	const upper = shin.at.clone().sub(thigh.at), lower = foot.at.clone().sub(shin.at);
	const upperLength = upper.length(), lowerLength = lower.length();
	const axis = foot.at.clone().sub(thigh.at).normalize();
	const restPole = upper.clone().addScaledVector(axis, -upper.dot(axis));
	if (restPole.lengthSq() < 1e-12) restPole.copy(forward);
	restPole.normalize(); upper.normalize(); lower.normalize();
	const foldedPole = across.clone().multiplyScalar(side * (loose ? .88 : .46))
		.addScaledVector(forward, .16).addScaledVector(up, loose ? .60 : .76).normalize();
	const skidOffset = forward.clone().multiplyScalar(-stance * .34).addScaledVector(across, side * stance * .20);
	const hip = new Vector3(), ankle = new Vector3(), knee = new Vector3(), pole = new Vector3(), v = new Vector3();
	const angle = new Quaternion(), yaw = new Quaternion(), footTilt = new Quaternion();
	return function (t: number, recoil: number) {
		if (t === 0) { thigh.restore(); shin.restore(); foot.restore(); return; }
		thigh.node.getWorldPosition(hip).sub(origin);
		const skid = loose ? ease(t, .40, .94) : 0;
		ankle.copy(foot.at).addScaledVector(skidOffset, skid);
		footTilt.setFromAxisAngle(across, (loose ? .18 : .34) * ease(t, .40, .88) - .04 * recoil);
		footTilt.premultiply(yaw.setFromAxisAngle(up, -side * .23 * skid));
		let clearance = Infinity;
		for (const p of sole) {
			v.copy(p).applyQuaternion(footTilt).add(ankle);
			clearance = Math.min(clearance, v.y - floor(v));
		}
		if (Number.isFinite(clearance)) ankle.y -= clearance * ease(t, .02, .22);

		axis.subVectors(ankle, hip);
		const distance = Math.max(1e-6, axis.length());
		axis.divideScalar(distance);
		pole.copy(restPole).lerp(foldedPole, ease(t, .34, .81));
		pole.addScaledVector(axis, -axis.dot(pole));
		if (pole.lengthSq() < 1e-12) pole.subVectors(thigh.at, hipCenter).addScaledVector(axis, -axis.dot(pole));
		pole.normalize();
		const along = Math.max(-upperLength, Math.min(upperLength, (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance)));
		knee.copy(hip).addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
		thigh.turn(angle.setFromUnitVectors(upper, v.subVectors(knee, hip).normalize()));
		shin.turn(angle.setFromUnitVectors(lower, v.subVectors(ankle, knee).normalize()));
		foot.turn(footTilt);
	};
};

const prepareGun = function (joint: Joint, surface: readonly Vector3[], lateral: Vector3, side: number, leading: boolean, origin: Vector3, floor: (point: Vector3) => number) {
	const lag = leading ? 0 : .105;
	const pivot = new Vector3(), point = new Vector3(), yaw = new Quaternion(), angle = new Quaternion();
	const swingTo = function (pitch: number) { return angle.setFromAxisAngle(lateral, -pitch).premultiply(yaw); };
	const clears = function (pitch: number) {
		swingTo(pitch);
		for (const v of surface) {
			point.copy(v).applyQuaternion(angle).add(pivot);
			if (point.y < floor(point) - .02) return false;
		}
		return true;
	};
	return function (hitTime: number, t: number) {
		joint.node.getWorldPosition(pivot).sub(origin);
		let swing = 1.20 * ease(hitTime, lag, .43 + lag) - (leading ? .82 : .70) * ease(t, .54 + lag, 1 + lag);
		const spread = .12 * ease(hitTime, lag, .38 + lag) + (leading ? .28 : .10) * ease(t, .42, .95);
		yaw.setFromAxisAngle(up, -side * spread);
		if (!clears(swing)) {
			let low = -.85, high = swing;
			for (let i = 0; i < 13; i++) {
				const mid = (low + high) / 2;
				if (clears(mid)) low = mid; else high = mid;
			}
			swing = low;
		}
		joint.turn(swingTo(swing));
	};
};

export const startRigCollapse = function (root: Group, site: CollapseSite, anatomy: CollapseAnatomy) {
	root.updateWorldMatrix(true, true);
	const origin = root.getWorldPosition(new Vector3());
	const baseGround = groundHeight(site.terrain, site), mapPoint = { x: site.x, y: site.y };
	const floor = site.terrain?.elevation ? function (point: Vector3) {
		mapPoint.x = site.x + point.x; mapPoint.y = site.y + point.z;
		return groundHeight(site.terrain, mapPoint) - baseGround;
	} : function () { return 0; };
	const pelvis = captureJoint(anatomy.pelvis, origin), torso = captureJoint(anatomy.torso, origin);
	const pelvisParent = anatomy.pelvis.parent;
	if (!pelvisParent) throw new Error('Missing pelvis parent');
	const restPosition = anatomy.pelvis.position.clone();
	const hullForward = new Vector3(Math.cos(site.heading), 0, Math.sin(site.heading));
	const gunJoints = anatomy.guns.map(function ({ pivot, muzzle }) {
		const joint = captureJoint(pivot, origin);
		const forward = muzzle ? muzzle.getWorldPosition(new Vector3()).sub(origin).sub(joint.at) : hullForward.clone();
		forward.y = 0;
		if (forward.lengthSq() < 1e-12) forward.copy(hullForward);
		forward.normalize();
		return { joint, forward, lateral: new Vector3(-forward.z, 0, forward.x) };
	});
	const forward = gunJoints[0]?.forward ?? hullForward;
	const across = new Vector3(-forward.z, 0, forward.x);
	const sideOf = function (part: Joint, center: Vector3, lateral: Vector3) {
		return Math.sign((part.at.x - center.x) * lateral.x + (part.at.z - center.z) * lateral.z);
	};
	const pods = anatomy.pods.map(function (node) {
		const joint = captureJoint(node, origin), side = sideOf(joint, torso.at, across);
		return { joint, side, lag: side === site.side ? 0 : .07 };
	});
	const joints = new Set<Object3D>([anatomy.pelvis, anatomy.torso, ...anatomy.pods, ...anatomy.guns.map(function (gun) { return gun.pivot; })]);
	const hipCenter = new Vector3(), ankleCenter = new Vector3();
	const legs = anatomy.legs.map(function (leg) {
		const thigh = captureJoint(leg.thigh, origin), shin = captureJoint(leg.shin, origin), foot = captureJoint(leg.foot, origin);
		joints.add(thigh.node).add(shin.node).add(foot.node);
		hipCenter.add(thigh.at); ankleCenter.add(foot.at);
		return { thigh, shin, foot };
	});
	if (legs.length) { hipCenter.divideScalar(legs.length); ankleCenter.divideScalar(legs.length); }
	else hipCenter.copy(pelvis.at);
	const stance = hipCenter.y - ankleCenter.y;
	const travel = forward.clone().multiplyScalar(-stance * .68).addScaledVector(across, site.side * stance * .24);
	const { vertices, interiors, offsetsFromPivot, finishes } = captureRigSurfaces(root, joints, Boolean(site.terrain?.elevation));
	const highestGround = Math.max(0, site.terrain?.elevation?.maxHeight ?? 0) - baseGround;
	const supportBones = new Set([anatomy.pelvis, anatomy.torso, ...anatomy.pods]);
	const bodySurfaces = [...vertices].filter(function ([part]) { return supportBones.has(part); });
	const hullAcross = new Vector3(-hullForward.z, 0, hullForward.x);
	const poseLegs = legs.map(function ({ thigh, shin, foot }) {
		const side = sideOf(thigh, hipCenter, across) || sideOf(thigh, hipCenter, hullAcross);
		return prepareLeg(thigh, shin, foot, offsetsFromPivot(foot.node), hipCenter, stance, forward, across, side, side === site.side, origin, floor);
	});
	const poseGuns = gunJoints.map(function ({ joint, lateral }) {
		const side = sideOf(joint, torso.at, lateral);
		return prepareGun(joint, offsetsFromPivot(joint.node), lateral, side, side === site.side, origin, floor);
	});
	const offset = new Vector3(), position = new Vector3();
	const rotation = new Quaternion(), roll = new Quaternion(), yaw = new Quaternion();
	const movePelvis = function (at: Vector3) {
		pelvis.node.position.copy(pelvisParent.worldToLocal(position.copy(at).add(origin)));
	};
	const pose: FallenRigPose = { labelHeight: 0, shadow: { x: site.x, y: site.y, heading: Math.atan2(forward.z, forward.x), length: 35, width: 35 } };
	let previous = -1;
	return function (elapsed: number) {
		const hitTime = Math.min(RIG_LEG_RELEASE_SECONDS + RIG_FOLD_SECONDS, Math.max(0, elapsed));
		if (hitTime === previous) return pose;
		previous = hitTime;
		root.getWorldPosition(origin);
		const t = Math.max(0, hitTime - RIG_LEG_RELEASE_SECONDS);
		const upperGive = ease(hitTime, .03, .32), give = ease(t, 0, .32);
		const impact = .80;
		const fall = unit((t - .16) / (impact - .16)) ** 1.65;
		const ring = unit((t - impact) / .40);
		const recoil = Math.sin(Math.PI * ring) * (1 - ring) ** 2;
		const down = .22 * give + .78 * fall - .045 * recoil;
		const drift = .08 * give + .77 * ease(t, .16, .82) + .15 * ease(t, .76, 1.07);
		const rock = .24 * give - .12 * ease(t, .34, .67) + .21 * ease(t, .54, .82) - .21 * ease(t, .68, .90) - .10 * recoil;
		if (t === 0) {
			pelvis.node.position.copy(restPosition); pelvis.restore();
		} else {
			rotation.setFromAxisAngle(across, .43 * drift).premultiply(roll.setFromAxisAngle(forward, site.side * rock));
			offset.copy(pelvis.at).sub(hipCenter).applyQuaternion(rotation).add(hipCenter).addScaledVector(travel, drift);
			offset.y -= stance * .92 * down;
			movePelvis(offset);
			pelvis.turn(rotation);
		}

		const pitch = -.09 * upperGive + .37 * ease(t, .17, .53) + .99 * ease(t, .39, .85) - .09 * recoil;
		const list = site.side * (.17 * upperGive + .17 * ease(t, .32, .74) - .17 * ease(t, .70, 1.02) - .09 * recoil);
		torso.turn(rotation.setFromAxisAngle(across, pitch).premultiply(roll.setFromAxisAngle(forward, list)).premultiply(yaw.setFromAxisAngle(up, -site.side * .14 * drift)));
		for (const pod of pods) {
			const cradle = pitch * .52 - .17 * ease(t, .55 + pod.lag, .98 + pod.lag) - .08 * recoil;
			pod.joint.turn(rotation.setFromAxisAngle(across, cradle).premultiply(roll.setFromAxisAngle(forward, list + pod.side * (.10 * upperGive - .05 * recoil))));
		}
		if (t > 0) {
			// Back armor and the low shoulder take the load after the hip drop.
			// Solve the legs afterwards so the supporting foot stays planted.
			let clearance = Infinity;
			for (const [part, points] of bodySurfaces) {
				part.updateWorldMatrix(true, false);
				for (const p of points) {
					offset.copy(p).applyMatrix4(part.matrixWorld).sub(origin);
					clearance = Math.min(clearance, offset.y - floor(offset));
				}
			}
			if (Number.isFinite(clearance)) {
				pelvis.node.getWorldPosition(offset).sub(origin);
				offset.y -= Math.min(0, clearance) + Math.max(0, clearance) * ease(t, .78, .97);
				movePelvis(offset);
			}
		}
		for (const leg of poseLegs) leg(t, recoil);
		for (const gun of poseGuns) gun(hitTime, t);
		root.updateWorldMatrix(true, true);

		let minAlong = Infinity, maxAlong = -Infinity, minAcross = Infinity, maxAcross = -Infinity, clearance = Infinity;
		pose.labelHeight = 0;
		for (const [part, points] of vertices) for (const p of points) {
			offset.copy(p).applyMatrix4(part.matrixWorld).sub(origin);
			const along = offset.dot(forward), lateral = offset.dot(across);
			minAlong = Math.min(minAlong, along); maxAlong = Math.max(maxAlong, along);
			minAcross = Math.min(minAcross, lateral); maxAcross = Math.max(maxAcross, lateral);
			pose.labelHeight = Math.max(pose.labelHeight, offset.y - (offset.x + offset.z) * .5);
			clearance = Math.min(clearance, offset.y - floor(offset));
		}
		// A ridge between terrain triangles can reach armor inside its convex
		// hull. Use the remaining actual vertices for that last contact check.
		if (t > 0) for (const [part, points] of interiors) for (const p of points) {
			offset.copy(p).applyMatrix4(part.matrixWorld).sub(origin);
			if (offset.y < highestGround) clearance = Math.min(clearance, offset.y - floor(offset));
		}
		if (Number.isFinite(clearance)) {
			// Long shin plates, low barrels and other chassis shapes can meet
			// the terrain before the back. Settle on that actual contact.
			if (t > 0 && clearance < -.021) {
				pelvis.node.getWorldPosition(offset).sub(origin); offset.y -= clearance;
				movePelvis(offset); root.updateWorldMatrix(true, true); pose.labelHeight -= clearance;
			}
			const weight = ease(t, .10, .70);
			offset.copy(forward).multiplyScalar((minAlong + maxAlong) * .5).addScaledVector(across, (minAcross + maxAcross) * .5);
			pose.shadow.x = site.x + offset.x * weight; pose.shadow.y = site.y + offset.z * weight;
			pose.shadow.length = 35 * (1 - weight) + (maxAlong - minAlong) * .48 * weight;
			pose.shadow.width = 35 * (1 - weight) + (maxAcross - minAcross) * .44 * weight;
		}
		const power = ease(hitTime, .02, .38);
		for (const { material, color, glow } of finishes) {
			material.color.copy(color).multiplyScalar(1 - .17 * power);
			material.emissiveIntensity = glow * (1 - power);
		}
		return pose;
	};
};
