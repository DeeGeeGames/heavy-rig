import { Box3, Matrix4, Mesh, Plane, Quaternion, Vector3, type Object3D } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { advanceGait, createGait, footPose, type LegRig, type WalkerGait } from './gait';
import type { WeaponBody } from './weapon-rig';
import { advanceAuthoredRun, authoredRunFootPitch, WARDEN_RUN_PROFILE, type AuthoredGait, type AuthoredRunProfile } from './authored-run';
import { angleDelta } from './simulation';
import type { FieldTerrain } from './field-terrain';
import { groundHeight, groundNormal } from './terrain-elevation';

export interface AuthoredLegNodes {
	readonly index: 0 | 1;
	readonly thigh: Object3D;
	readonly shin: Object3D;
	readonly foot: Object3D;
}

export interface AuthoredLocomotionOptions {
	readonly walkStride: number;
	readonly walkExtension: number;
	readonly walkLiftScale?: number;
	readonly stableKneeBend?: boolean;
	readonly run: AuthoredRunProfile;
}
const wardenLocomotion: AuthoredLocomotionOptions = { walkStride: 0.5, walkExtension: 0.4, run: WARDEN_RUN_PROFILE };

// Measure neutral rigid assemblies once. Fixed-step sampling below only reads
// these private measurements, never a live render graph or animation mixer.
export const prepareAuthoredLocomotion = function (pelvis: Object3D, nodes: readonly AuthoredLegNodes[], scale: number, options: AuthoredLocomotionOptions = wardenLocomotion) {
	if (nodes.length !== 2) throw new Error('Authored locomotion requires two legs');
	const legs = nodes.map(function (leg) {
		if (leg.thigh.parent !== pelvis || leg.shin.parent !== leg.thigh || leg.foot.parent !== leg.shin) throw new Error('Invalid authored leg hierarchy');
		for (const joint of [pelvis, leg.thigh, leg.shin, leg.foot]) {
			if (joint.scale.distanceTo(new Vector3(1, 1, 1)) > 1e-6) throw new Error('Authored joints require unit local scale');
		}
		const hip = leg.thigh.getWorldPosition(new Vector3());
		const knee = leg.shin.getWorldPosition(new Vector3());
		const ankle = leg.foot.getWorldPosition(new Vector3());
		const upper = hip.distanceTo(knee); const lower = knee.distanceTo(ankle);
		if (![upper, lower].every(function (length) { return Number.isFinite(length) && length > 0; })) throw new Error('Invalid authored limb lengths');
		const inverse = leg.foot.matrixWorld.clone().invert(); const bounds = new Box3(); const point = new Vector3();
		leg.foot.traverse(function (part) {
			if (!(part instanceof Mesh)) return;
			const position = part.geometry.getAttribute('position');
			for (let index = 0; index < position.count; index++) bounds.expandByPoint(point.fromBufferAttribute(position, index).applyMatrix4(part.matrixWorld).applyMatrix4(inverse));
		});
		if (bounds.isEmpty()) throw new Error('Authored foot has no sole geometry');
		const corners = [bounds.min.x, bounds.max.x].flatMap(function (x) { return [bounds.min.y, bounds.max.y].flatMap(function (y) { return [bounds.min.z, bounds.max.z].map(function (z) { return new Vector3(x, y, z).multiplyScalar(scale); }); }); });
		const shinPoints: Vector3[] = []; const inverseShin = leg.shin.matrixWorld.clone().invert();
		leg.shin.traverse(function (part) {
			if (!(part instanceof Mesh)) return;
			let owner: Object3D | null = part;
			while (owner && owner !== leg.shin && owner !== leg.foot) owner = owner.parent;
			if (owner !== leg.shin) return;
			const position = part.geometry.getAttribute('position');
			for (let index = 0; index < position.count; index++) shinPoints.push(new Vector3().fromBufferAttribute(position, index).applyMatrix4(part.matrixWorld).applyMatrix4(inverseShin).multiplyScalar(scale));
		});
		// A convex hull preserves the lowest point for every rigid rotation while
		// keeping the per-step guard clearance check independent of mesh density.
		const hull = shinPoints.length >= 4 ? new ConvexHull().setFromPoints(shinPoints) : undefined;
		const guard = hull ? [...new Set(hull.faces.flatMap(function (face) { return [face.getEdge(0).head().point, face.getEdge(1).head().point, face.getEdge(2).head().point]; }))] : shinPoints;
		const neutralAxis = ankle.clone().sub(hip).normalize();
		const bendPole = knee.clone().sub(hip);
		// The bend offset keeps its anatomical side as the foot passes forward.
		// The full thigh vector can reverse when projected onto the moving axis.
		bendPole.addScaledVector(neutralAxis, -bendPole.dot(neutralAxis));
		if (options.stableKneeBend && bendPole.lengthSq() < 1e-10) throw new Error('Authored leg has no neutral knee bend direction');
		return {
			index: leg.index, hip, ankle, upper, lower, corners, guard,
			hipPosition: leg.thigh.position.clone(), upperVector: leg.shin.position.clone(), lowerVector: leg.foot.position.clone(),
			thighRotation: leg.thigh.quaternion.clone(), shinRotation: leg.shin.quaternion.clone(),
			footRotation: leg.foot.getWorldQuaternion(new Quaternion()),
			pole: options.stableKneeBend ? bendPole : knee.clone().sub(hip),
		};
	});
	const average = function (read: (leg: typeof legs[number]) => number) { return legs.reduce(function (sum, leg) { return sum + read(leg); }, 0) / legs.length; };
	const rig: LegRig = {
		hipHeight: average(function (leg) { return leg.hip.y; }), hipForward: average(function (leg) { return leg.hip.x; }),
		hipWidth: average(function (leg) { return Math.abs(leg.hip.z); }), upper: average(function (leg) { return leg.upper; }), lower: average(function (leg) { return leg.lower; }),
		footForward: average(function (leg) { return leg.ankle.x; }), footWidth: average(function (leg) { return Math.abs(leg.ankle.z); }), kneeDirection: 1,
	};
	const neutral = createGait({ x: 0, y: 0, angle: 0 }, 1, rig);
	const up = new Vector3(0, 1, 0);
	const target = function (gait: AuthoredGait, leg: typeof legs[number], hullAngle: number, terrain?: FieldTerrain) {
		const contact = gait.feet[leg.index]; const rest = neutral.feet[leg.index];
		const relative = contact.angle - hullAngle;
		const pitch = gait.running ? authoredRunFootPitch(gait, leg.index, options.run.footPitch) : gait.swing?.index === leg.index ? Math.max(-0.2, Math.min(0.2, footPose(gait, leg.index, 1, rig).pitch * 0.5)) : 0;
		const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -relative).multiply(leg.footRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitch));
		const dx = contact.x - gait.body.x; const dz = contact.y - gait.body.y;
		// Preserve source asymmetry without moving a supporting contact with the hull.
		const offset = new Vector3(leg.ankle.x - rest.x, 0, leg.ankle.z - rest.y).applyAxisAngle(new Vector3(0, 1, 0), -relative);
		const lift = gait.running ? contact.lift : contact.lift * (options.walkLiftScale ?? 1);
		const cos = Math.cos(hullAngle), sin = Math.sin(hullAngle);
		const position = new Vector3(dx * cos + dz * sin + offset.x, 0, -dx * sin + dz * cos + offset.z);
		let floor: Plane | undefined;
		if (terrain?.elevation) {
			const sole = { x: contact.x + cos * offset.x - sin * offset.z, y: contact.y + sin * offset.x + cos * offset.z };
			const normal = groundNormal(terrain, sole);
			const localNormal = new Vector3(normal.x * cos + normal.y * sin, normal.elevation, -normal.x * sin + normal.y * cos);
			position.y = groundHeight(terrain, sole) - groundHeight(terrain, gait.body);
			floor = new Plane().setFromNormalAndCoplanarPoint(localNormal, position);
			rotation.premultiply(new Quaternion().setFromUnitVectors(up, localNormal));
		}
		const support = Math.min(...leg.corners.map(function (corner) {
			const rotated = corner.clone().applyQuaternion(rotation);
			return floor ? floor.normal.dot(rotated) / floor.normal.y : rotated.y;
		}));
		position.y += lift - support;
		return { leg, position, rotation, floor };
	};
	const advance = function (previous: AuthoredGait | undefined, body: WeaponBody, dt: number): AuthoredGait {
		const actual = { x: body.x, y: body.y, angle: body.angle ?? 0 };
		if (!previous || Math.hypot(actual.x - previous.body.x, actual.y - previous.body.y) > 80 || dt <= 0 && (actual.x !== previous.body.x || actual.y !== previous.body.y || actual.angle !== previous.body.angle)) return createGait(actual, 1, rig);
		if (dt <= 0) return previous;
		const speed = ((actual.x - previous.body.x) * Math.cos(actual.angle) + (actual.y - previous.body.y) * Math.sin(actual.angle)) / dt;
		if (previous.running || speed >= options.run.enterSpeed) return advanceAuthoredRun(previous, actual, dt, rig, options.run);
		// Extend forward straights while retaining the tighter contact envelope for
		// reverse and steering, where the ankle guards need more frequent steps.
		const turn = Math.abs(angleDelta(previous.body.angle, actual.angle)) / dt;
		const stride = options.walkStride + options.walkExtension * Math.min(1, Math.max(0, speed / 30)) * Math.max(0, 1 - turn / 0.6);
		return advanceGait(previous, actual, dt, 1, stride, rig);
	};
	const footTargets = function (gait: WalkerGait, hullAngle: number, terrain?: FieldTerrain) {
		return legs.map(function (leg) { return target(gait, leg, hullAngle, terrain); });
	};
	const solveTargets = function (feet: ReturnType<typeof footTargets>, pelvisMatrix: Matrix4) {
		const pelvisRotation = new Quaternion().setFromRotationMatrix(pelvisMatrix.clone().extractRotation(pelvisMatrix));
		return feet.map(function (foot) {
			const { leg } = foot;
			const hip = leg.hipPosition.clone().applyMatrix4(pelvisMatrix);
			const delta = foot.position.clone().sub(hip); const distance = delta.length();
			const axis = delta.clone().normalize(); const pole = leg.pole.clone().addScaledVector(axis, -leg.pole.dot(axis));
			if (pole.lengthSq() < 1e-10) pole.set(1, 0, 0).addScaledVector(axis, -axis.x);
			if (pole.lengthSq() < 1e-10) pole.set(0, 0, 1).addScaledVector(axis, -axis.z);
			const along = Math.max(-leg.upper, Math.min(leg.upper, (leg.upper ** 2 - leg.lower ** 2 + distance ** 2) / (2 * Math.max(distance, 1e-8))));
			const knee = hip.clone().addScaledVector(axis, along).addScaledVector(pole.normalize(), Math.sqrt(Math.max(0, leg.upper ** 2 - along ** 2)));
			const upperReference = pelvisRotation.clone().multiply(leg.thighRotation);
			const lowerReference = upperReference.clone().multiply(leg.shinRotation);
			const upper = new Quaternion().setFromUnitVectors(leg.upperVector.clone().applyQuaternion(upperReference).normalize(), knee.clone().sub(hip).normalize()).multiply(upperReference);
			const lower = new Quaternion().setFromUnitVectors(leg.lowerVector.clone().applyQuaternion(lowerReference).normalize(), foot.position.clone().sub(knee).normalize()).multiply(lowerReference);
			return { index: leg.index, knee, lower, thigh: pelvisRotation.clone().invert().multiply(upper), shin: upper.clone().invert().multiply(lower), foot: lower.clone().invert().multiply(foot.rotation) };
		});
	};
	const solve = function (gait: WalkerGait, pelvisMatrix: Matrix4, hullAngle: number, terrain?: FieldTerrain) {
		return solveTargets(footTargets(gait, hullAngle, terrain), pelvisMatrix);
	};
	const pelvisDrop = function (gait: WalkerGait, pelvisMatrix: Matrix4, hullAngle: number, terrain?: FieldTerrain): number {
		const feet = footTargets(gait, hullAngle, terrain);
		const reachDrop = feet.reduce(function (drop, { leg, position: ankle }) {
			const hip = leg.hipPosition.clone().applyMatrix4(pelvisMatrix);
			const reach = Math.sqrt(leg.upper ** 2 + leg.lower ** 2 + 2 * leg.upper * leg.lower * Math.cos(Math.PI / 6));
			const horizontal = (ankle.x - hip.x) ** 2 + (ankle.z - hip.z) ** 2;
			return Math.min(drop, ankle.y + Math.sqrt(Math.max(0, reach ** 2 - horizontal)) - hip.y);
		}, 0);
		const clearsGuards = function (drop: number) {
			const matrix = pelvisMatrix.clone(); matrix.elements[13] = (matrix.elements[13] ?? 0) + drop;
			return solveTargets(feet, matrix).every(function (pose) {
				const foot = feet[pose.index]; if (!foot) throw new Error('Missing guard geometry');
				return foot.leg.guard.every(function (point) {
					const vertex = point.clone().applyQuaternion(pose.lower).add(pose.knee);
					return (foot.floor?.distanceToPoint(vertex) ?? vertex.y) >= -1e-6;
				});
			});
		};
		if (clearsGuards(reachDrop)) return reachDrop / scale;
		// Lower the shared pelvis without shifting either planted shoe. Refine the
		// first clear pose to avoid visible half-unit steps in body height.
		let high = reachDrop;
		for (let low = reachDrop - 0.5; low >= reachDrop - 12; low -= 0.5) {
			if (!clearsGuards(low)) { high = low; continue; }
			let clear = low;
			for (let iteration = 0; iteration < 6; iteration++) {
				const middle = (clear + high) / 2;
				if (clearsGuards(middle)) clear = middle; else high = middle;
			}
			return clear / scale;
		}
		// Clearance is best effort for this motion preview. Keep planted shoes and
		// fixed-length legs when no guard-clear pose fits the bounded search.
		return reachDrop / scale;
	};
	return { advance, pelvisDrop, solve };
};
