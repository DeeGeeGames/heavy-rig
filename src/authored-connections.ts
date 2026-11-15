import { Matrix4, Mesh, Object3D, Vector3 } from 'three';

const specifications = [
	{ id: 'left_gun', owner: 'rig_mount_left-gun' },
	{ id: 'right_gun', owner: 'rig_mount_right-gun' },
	{ id: 'left_shoulder', owner: 'rig_mount_left-shoulder bank' },
	{ id: 'right_shoulder', owner: 'rig_mount_right-shoulder bank' },
] as const;

export interface AuthoredConnectionEvidence {
	readonly id: string;
	readonly bodyAnchor: readonly number[];
	readonly mountAnchor: readonly number[];
	readonly lengthNative: number;
	readonly extensionRatio: number;
	readonly bodyEndpointError: number;
	readonly mountEndpointError: number;
	readonly sleeveOverlapNative: number;
	readonly bodyEndCoverageNative: number;
	readonly mountEndCoverageNative: number;
	readonly collarRadiusNative: number;
	readonly meshChildren: number;
}

const matches = function (root: Object3D, name: string): Object3D[] {
	const found: Object3D[] = [];
	root.traverse(function (node) { if (node.name === name || node.userData['name'] === name) found.push(node); });
	return found;
};
const named = function (root: Object3D, name: string): Object3D {
	const found = matches(root, name); const node = found[0];
	if (!node || found.length !== 1) throw new Error(`Expected one authored connection node ${name}`);
	return node;
};
const descendant = function (node: Object3D, owner: Object3D): boolean {
	for (let current: Object3D | null = node; current; current = current.parent) if (current === owner) return true;
	return false;
};
const text = function (value: unknown, field: string): string {
	if (typeof value !== 'string' || !value) throw new Error(`Missing authored connection ${field}`);
	return value;
};
const positive = function (value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid authored connection ${field}`);
	return value;
};

// Controls are empty parents. Their mesh children's quantization/decode
// transforms stay intact while a solid neck spans the independently moving ends.
export const prepareAuthoredConnections = function (scene: Object3D) {
	const present = specifications.map(function (spec) { return matches(scene, `joint_${spec.id}`); });
	if (present.every(function (nodes) { return nodes.length === 0; })) return { update: function () {}, audit: function (): readonly AuthoredConnectionEvidence[] { return []; } };
	const torso = named(scene, 'rig_torso');
	const y = new Vector3(0, 1, 0); const a = new Vector3(); const b = new Vector3(); const localA = new Vector3(); const localB = new Vector3();
	const direction = new Vector3(); const inverse = new Matrix4(); const vertex = new Vector3(); const relative = new Matrix4();
	const links = specifications.map(function (spec) {
		const control = named(scene, `joint_${spec.id}`);
		if (control instanceof Mesh) throw new Error(`Authored connection ${spec.id} needs an empty control parent`);
		const bodyAnchor = named(scene, text(control.userData['bodyAnchor'], 'bodyAnchor'));
		const mountAnchor = named(scene, text(control.userData['mountAnchor'], 'mountAnchor'));
		const owner = named(scene, spec.owner);
		if (!descendant(bodyAnchor, torso) || descendant(bodyAnchor, owner) || !descendant(mountAnchor, owner) || descendant(bodyAnchor, control) || descendant(mountAnchor, control)) throw new Error(`Wrong rigid ownership for authored connection ${spec.id}`);
		const parent = control.parent;
		if (!parent || !descendant(control, torso) || descendant(control, owner)) throw new Error(`Wrong control ownership for authored connection ${spec.id}`);
		const axis: unknown = control.userData['axis'];
		if (!Array.isArray(axis) || axis.length !== 3 || axis[0] !== 0 || axis[1] !== 1 || axis[2] !== 0) throw new Error(`Unsupported authored connection axis ${spec.id}`);
		const baseLength = positive(control.userData['baseLengthNative'], 'baseLengthNative');
		const overlap = positive(control.userData['sleeveOverlapFraction'], 'sleeveOverlapFraction');
		if (overlap >= 1) throw new Error(`Invalid authored connection overlap ${spec.id}`);
		const radius = positive(control.userData['radiusNative'], 'radiusNative');
		const collarRadius = positive(control.userData['collarRadiusNative'], 'collarRadiusNative');
		if (collarRadius < radius) throw new Error(`Authored connection collar is thinner than its neck ${spec.id}`);
		const minimum = new Vector3(Infinity, Infinity, Infinity); const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
		const meshes: Mesh[] = [];
		inverse.copy(control.matrixWorld).invert();
		control.traverse(function (node) {
			if (!(node instanceof Mesh)) return;
			meshes.push(node); relative.multiplyMatrices(inverse, node.matrixWorld);
			const positions = node.geometry.getAttribute('position');
			for (let index = 0; index < positions.count; index++) { vertex.fromBufferAttribute(positions, index).applyMatrix4(relative); minimum.min(vertex); maximum.max(vertex); }
		});
		const tolerance = Math.max(1e-6, baseLength * 1e-3);
		if (meshes.length === 0 || minimum.y > tolerance || maximum.y < baseLength - tolerance || Math.min(maximum.x, -minimum.x, maximum.z, -minimum.z) < collarRadius * 0.7) throw new Error(`Authored connection geometry does not span its endpoints/collars ${spec.id}`);
		return { id: spec.id, control, parent, bodyAnchor, mountAnchor, baseLength, overlap, collarRadius, minimum, maximum, meshes: meshes.length, radialScale: { x: control.scale.x, z: control.scale.z } };
	});
	const update = function () {
		for (const link of links) {
			a.setFromMatrixPosition(link.bodyAnchor.matrixWorld); b.setFromMatrixPosition(link.mountAnchor.matrixWorld);
			inverse.copy(link.parent.matrixWorld).invert(); localA.copy(a).applyMatrix4(inverse); localB.copy(b).applyMatrix4(inverse);
			direction.subVectors(localB, localA); const length = direction.length();
			if (!Number.isFinite(length)) throw new Error(`Non-finite authored connection ${link.id}`);
			link.control.position.copy(localA);
			if (length > 1e-9) link.control.quaternion.setFromUnitVectors(y, direction.multiplyScalar(1 / length));
			link.control.scale.set(link.radialScale.x, Math.max(length, 1e-9) / link.baseLength, link.radialScale.z);
			link.control.updateWorldMatrix(false, true);
		}
	};
	const audit = function (): readonly AuthoredConnectionEvidence[] {
		return links.map(function (link) {
			a.setFromMatrixPosition(link.bodyAnchor.matrixWorld); b.setFromMatrixPosition(link.mountAnchor.matrixWorld);
			const body = a.toArray(); const mount = b.toArray();
			const bodyError = localA.set(0, 0, 0).applyMatrix4(link.control.matrixWorld).distanceTo(a);
			const mountError = localB.set(0, link.baseLength, 0).applyMatrix4(link.control.matrixWorld).distanceTo(b);
			const ratio = link.control.scale.y;
			return { id: link.id, bodyAnchor: body, mountAnchor: mount, lengthNative: link.baseLength * ratio, extensionRatio: ratio, bodyEndpointError: bodyError, mountEndpointError: mountError, sleeveOverlapNative: link.overlap * link.baseLength * ratio, bodyEndCoverageNative: -link.minimum.y * ratio, mountEndCoverageNative: (link.maximum.y - link.baseLength) * ratio, collarRadiusNative: link.collarRadius, meshChildren: link.meshes };
		});
	};
	return { update, audit };
};
