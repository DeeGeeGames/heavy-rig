import { BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Object3D } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

interface GeometrySupport { hull: readonly Vector3[]; interior: readonly Vector3[] }
const supports = new WeakMap<BufferGeometry, GeometrySupport>();
const procedural = new WeakSet<BufferGeometry>();
const proceduralShapes: { positions: Float32Array; support: GeometrySupport }[] = [];
const MAX_PROCEDURAL_SHAPES = 128;

// Each procedurally built rig owns fresh batched meshes. Their position data
// can still match exactly, independent of mesh names, loadout or paint.
export const registerProceduralRigGeometry = function (geometry: BufferGeometry) { procedural.add(geometry); };

const samePositions = function (a: Float32Array, b: Float32Array) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

// A geometry and its convex hull have the same lowest point at any rotation.
// Authored rig instances share geometry, so build that hull only once. Retain
// flat details directly: a quick hull needs a non-degenerate tetrahedron.
const supportPoints = function (geometry: BufferGeometry): GeometrySupport {
	const cached = supports.get(geometry);
	if (cached) return cached;
	const vertices = geometry.getAttribute('position');
	const positions = procedural.has(geometry) && vertices instanceof BufferAttribute && vertices.itemSize === 3
		&& !vertices.normalized && vertices.array instanceof Float32Array ? vertices.array : undefined;
	if (positions) {
		const match = proceduralShapes.find(function (shape) { return samePositions(shape.positions, positions); });
		if (match) { supports.set(geometry, match.support); return match.support; }
	}
	const unique = new Map<number, Map<number, Set<number>>>(), points: Vector3[] = [];
	for (let i = 0; vertices && i < vertices.count; i++) {
		const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
		let plane = unique.get(x);
		if (!plane) { plane = new Map(); unique.set(x, plane); }
		let line = plane.get(y);
		if (!line) { line = new Set(); plane.set(y, line); }
		if (!line.has(z)) { line.add(z); points.push(new Vector3(x, y, z)); }
	}
	let result: GeometrySupport = { hull: points, interior: [] };
	const [first, second] = points;
	if (first && second && points.length > 24) {
		const axis = second.clone().sub(first).normalize(), relative = new Vector3(), normal = new Vector3();
		const hasPlane = points.some(function (p) {
			return normal.crossVectors(axis, relative.subVectors(p, first)).lengthSq() > 1e-14;
		});
		normal.normalize();
		if (hasPlane && points.some(function (p) { return Math.abs(relative.subVectors(p, first).dot(normal)) > 1e-7; })) {
			const hull = new ConvexHull().setFromPoints(points);
			const corners = new Set<Vector3>();
			for (const face of hull.faces) {
				for (let i = 0; i < 3; i++) corners.add(face.getEdge(i).head().point);
			}
			result = { hull: [...corners], interior: points.filter(function (p) { return !corners.has(p); }) };
		}
	}
	if (positions) {
		if (proceduralShapes.length >= MAX_PROCEDURAL_SHAPES) proceduralShapes.shift();
		proceduralShapes.push({ positions: positions.slice(), support: result });
	}
	supports.set(geometry, result);
	return result;
};

export const captureRigSurfaces = function (root: Object3D, joints: ReadonlySet<Object3D>, hasRelief: boolean) {
	const vertices = new Map<Object3D, Vector3[]>(), materials = new Set<MeshStandardMaterial>();
	const interiors = new Map<Object3D, Vector3[]>();
	const relative = new Matrix4();
	root.traverseVisible(function (mesh) {
		if (!(mesh instanceof Mesh)) return;
		let joint: Object3D | null = mesh;
		while (joint && !joints.has(joint)) joint = joint.parent;
		if (!joint) return;
		relative.copy(joint.matrixWorld).invert().multiply(mesh.matrixWorld);
		const points = vertices.get(joint) ?? [];
		const support = supportPoints(mesh.geometry);
		for (const p of support.hull) points.push(p.clone().applyMatrix4(relative));
		vertices.set(joint, points);
		if (hasRelief && support.interior.length) {
			const inside = interiors.get(joint) ?? [];
			for (const p of support.interior) inside.push(p.clone().applyMatrix4(relative));
			interiors.set(joint, inside);
		}
		for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
			if (material instanceof MeshStandardMaterial) materials.add(material);
		}
	});
	const offsetsFromPivot = function (joint: Object3D) {
		const origin = joint.getWorldPosition(new Vector3());
		return (vertices.get(joint) ?? []).map(function (p) { return p.clone().applyMatrix4(joint.matrixWorld).sub(origin); });
	};
	const finishes = Array.from(materials, function (material) {
		return { material, color: material.color.clone(), glow: material.emissiveIntensity };
	});
	return { vertices, interiors, offsetsFromPivot, finishes };
};
