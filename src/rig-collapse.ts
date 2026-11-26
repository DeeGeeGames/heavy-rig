import { Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Object3D } from 'three';
import type { FieldTerrain } from './field-terrain';
import { RIG_COLLAPSE_SECONDS, type Point } from './simulation';
import { groundHeight, groundNormal } from './terrain-elevation';

export interface CollapseSite extends Point { heading: number; side: -1 | 1; terrain?: FieldTerrain | undefined }
export interface FallenRigPose {
	labelHeight: number;
	shadow: Point & { heading: number; length: number; width: number };
}
interface Joint { pivot: Object3D; parts: readonly Object3D[] }
interface Leg { hip: Joint; knee: Joint; foot: Object3D }

// Use real vertices for ground contact. A rotated gun or shin can be far
// inside its bounding-box corners, leaving the entire wreck perched in air.
const supports = new WeakMap<BufferGeometry, Vector3[]>();
const supportAxes = [
	[1, 0, 0], [0, 1, 0], [0, 0, 1],
	[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1],
	[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
] as const;
const supportPoints = function (geometry: BufferGeometry) {
	const cached = supports.get(geometry);
	if (cached) return cached;
	const vertices = geometry.getAttribute('position');
	if (!vertices || vertices.count === 0) return [];
	const indices = new Set<number>();
	for (const [x, y, z] of supportAxes) {
		let low = Infinity, high = -Infinity, first = 0, last = 0;
		for (let i = 0; i < vertices.count; i++) {
			const dot = x * vertices.getX(i) + y * vertices.getY(i) + z * vertices.getZ(i);
			if (dot < low) { low = dot; first = i; }
			if (dot > high) { high = dot; last = i; }
		}
		indices.add(first); indices.add(last);
	}
	const points = Array.from(indices, function (index) { return new Vector3().fromBufferAttribute(vertices, index); });
	supports.set(geometry, points);
	return points;
};

// Articulate the last displayed pose, including a raised foot or a traversed
// turret. The ECS still positions the outer root at the original combat site.
export const startRigCollapse = function (root: Group, site: CollapseSite, torso: Joint, legs: readonly Leg[]) {
	const body = new Group(); body.name = 'fallen-rig';
	body.add(...root.children.slice()); root.add(body);
	const hinge = function (parent: Group, joint: Joint) {
		const pivot = new Group();
		pivot.position.copy(parent.worldToLocal(joint.pivot.getWorldPosition(new Vector3())));
		parent.add(pivot);
		for (const part of joint.parts) pivot.attach(part);
		return pivot;
	};
	const forward = new Vector3(Math.cos(site.heading), 0, Math.sin(site.heading));
	const across = new Vector3(-forward.z, 0, forward.x);
	const upper = hinge(body, torso);
	const offset = new Vector3();
	const joints = legs.map(function (leg) {
		const hip = hinge(body, leg.hip);
		const ankle = body.worldToLocal(leg.foot.getWorldPosition(new Vector3()));
		const knee = hinge(hip, leg.knee);
		const kneeOffset = offset.copy(ankle).sub(hip.position).multiplyScalar(-0.5).add(knee.position);
		return { hip, knee, bend: kneeOffset.dot(forward) < 0 ? -1 : 1, leading: hip.position.dot(across) * site.side >= 0 };
	});
	const pivot = joints.find(function (leg) { return leg.leading; })?.hip.position.clone() ?? new Vector3();
	pivot.y = 0;
	// Bias the shoulder roll across the isometric view so a fall away from
	// the camera still shows the torso coming down beside the feet.
	const screenRight = new Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2);
	const fallDirection = across.clone().multiplyScalar(site.side);
	fallDirection.addScaledVector(screenRight, fallDirection.dot(screenRight) >= 0 ? 0.9 : -0.9).normalize();
	const rollAxis = new Vector3(fallDirection.z, 0, -fallDirection.x);
	const normal = groundNormal(site.terrain, site);
	const slope = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(normal.x, normal.elevation, normal.y));
	const tilt = new Quaternion(), inverse = new Matrix4(), relative = new Matrix4();
	const ground = groundHeight(site.terrain, site), at = { x: 0, y: 0 };
	const contacts: { mesh: Mesh; points: Vector3[] }[] = [];
	const materials = new Set<MeshStandardMaterial>();
	body.traverseVisible(function (part) {
		if (!(part instanceof Mesh)) return;
		contacts.push({ mesh: part, points: supportPoints(part.geometry) });
		for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
			if (material instanceof MeshStandardMaterial) materials.add(material);
		}
	});
	const finishes = Array.from(materials, function (material) { return { material, color: material.color.clone(), glow: material.emissiveIntensity }; });
	const unit = function (value: number) { return Math.min(1, Math.max(0, value)); };
	const smooth = function (value: number) { const t = unit(value); return t * t * (3 - 2 * t); };
	let previous = -1;
	const pose: FallenRigPose = { labelHeight: 0, shadow: { x: site.x, y: site.y, heading: Math.atan2(fallDirection.z, fallDirection.x), length: 35, width: 35 } };
	return function (elapsed: number) {
		const time = Math.min(RIG_COLLAPSE_SECONDS, Math.max(0, elapsed));
		if (time === previous) return pose;
		previous = time;
		const buckle = smooth(time / 0.38), tip = unit((time - 0.12) / 0.74) ** 1.85;
		const settle = unit((time - 0.86) / (RIG_COLLAPSE_SECONDS - 0.86));
		const rebound = Math.sin(Math.PI * settle) * (1 - settle);
		for (const { hip, knee, bend, leading } of joints) {
			const fold = leading ? buckle : smooth((time - 0.10) / 0.48);
			hip.quaternion.setFromAxisAngle(across, bend * fold * (leading ? 0.54 : 0.32));
			knee.quaternion.setFromAxisAngle(across, -bend * fold * (leading ? 1.08 : 0.68));
		}
		upper.quaternion.setFromAxisAngle(across, -0.20 * buckle - 0.06 * rebound);
		upper.rotateOnWorldAxis(forward, site.side * (0.12 * buckle - 0.08 * rebound));
		body.quaternion.setFromAxisAngle(rollAxis, 0.13 * buckle + 1.42 * tip - 0.16 * rebound);
		body.quaternion.premultiply(tilt.identity().slerp(slope, tip));
		body.position.copy(pivot).sub(offset.copy(pivot).applyQuaternion(body.quaternion)); body.position.y = 0;
		body.updateWorldMatrix(true, true);
		inverse.copy(root.matrixWorld).invert();
		let support = -Infinity;
		let near = Infinity, far = -Infinity, left = Infinity, right = -Infinity;
		pose.labelHeight = 0;
		for (const { mesh, points } of contacts) {
			relative.multiplyMatrices(inverse, mesh.matrixWorld);
			for (const point of points) {
				offset.copy(point).applyMatrix4(relative);
				at.x = site.x + offset.x; at.y = site.y + offset.z;
				support = Math.max(support, groundHeight(site.terrain, at) - ground - offset.y);
				pose.labelHeight = Math.max(pose.labelHeight, offset.y - (offset.x + offset.z) * 0.5);
				const along = offset.dot(fallDirection), lateral = offset.dot(rollAxis);
				near = Math.min(near, along); far = Math.max(far, along);
				left = Math.min(left, lateral); right = Math.max(right, lateral);
			}
		}
		if (Number.isFinite(support)) {
			body.position.y = support * smooth(time / 0.14);
			const center = offset.copy(fallDirection).multiplyScalar((near + far) / 2).addScaledVector(rollAxis, (left + right) / 2);
			pose.shadow.x = site.x + center.x * buckle; pose.shadow.y = site.y + center.z * buckle;
			pose.shadow.length = 35 * (1 - buckle) + (far - near) * 0.50 * buckle;
			pose.shadow.width = 35 * (1 - buckle) + (right - left) * 0.42 * buckle;
		}
		pose.labelHeight += body.position.y;
		const powerLoss = smooth(time / 0.32);
		for (const { material, color, glow } of finishes) {
			material.emissiveIntensity = glow * (1 - powerLoss);
			material.color.copy(color).multiplyScalar(1 - 0.30 * powerLoss);
		}
		return pose;
	};
};
