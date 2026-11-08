import { expect, test } from 'bun:test';
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { FRAME_RIGS } from '../src/frame-rig';
import { FRAMES, type FrameId } from '../src/frames';
import { advanceGait, createGait, mechScale, type WalkerGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import type { EnemyKind } from '../src/simulation';

type Model = ReturnType<typeof createMech>;
interface Face { part: Mesh; index: number; normal: Vector3; corners: Vector3[]; bounds: Box3 }

// Clip one rendered triangle against the other in their shared plane. Touching
// edges and interpenetrating volumes are valid; shared face area is the risk.
const overlapFace = function (a: Face, b: Face): Vector3[] {
	const [first, second, third] = b.corners;
	if (!first || !second || !third) return [];
	const winding = Math.sign(second.clone().sub(first).cross(third.clone().sub(second)).dot(b.normal));
	let polygon = a.corners;
	for (const [index, start] of b.corners.entries()) {
		const end = b.corners[(index + 1) % b.corners.length];
		if (!end) return [];
		const inward = b.normal.clone().cross(end.clone().sub(start)).multiplyScalar(winding);
		const input = polygon; polygon = [];
		for (const [edge, p] of input.entries()) {
			const q = input[(edge + 1) % input.length];
			if (!q) continue;
			const dp = inward.dot(p.clone().sub(start)); const dq = inward.dot(q.clone().sub(start));
			if (dp >= 0) polygon.push(p);
			if ((dp >= 0) !== (dq >= 0)) polygon.push(p.clone().lerp(q, dp / (dp - dq)));
		}
	}
	return polygon;
};

const faceArea = function (polygon: readonly Vector3[]): number {
	const first = polygon[0];
	if (!first) return 0;
	let area = 0;
	for (let index = 1; index < polygon.length - 1; index++) {
		const a = polygon[index]; const b = polygon[index + 1];
		if (a && b) area += a.clone().sub(first).cross(b.clone().sub(first)).length() / 2;
	}
	return area;
};

const modelFaces = function (model: Model): Face[] {
	const parts: Mesh[] = [];
	model.root.traverse(function (object) {
		if (object instanceof Mesh && object.visible) parts.push(object);
	});
	return parts.flatMap(function (part) {
		const positions = part.geometry.getAttribute('position'); const indices = part.geometry.index;
		return Array.from({ length: (indices?.count ?? positions.count) / 3 }, function (_, index) {
			const corners = [0, 1, 2].map(function (corner) { return new Vector3().fromBufferAttribute(positions, indices ? indices.getX(index * 3 + corner) : index * 3 + corner).applyMatrix4(part.matrixWorld); });
			const [a, b, c] = corners;
			if (!a || !b || !c) throw new Error('Missing rendered triangle vertices');
			return { part, index, corners, normal: b.clone().sub(a).cross(c.clone().sub(a)).normalize(), bounds: new Box3().setFromPoints(corners).expandByScalar(0.001) };
		});
	});
};

const exposedOverlaps = function (model: Model): string[] {
	const faces = modelFaces(model); const ray = new Raycaster(); const failures: string[] = [];
	// Partition by normal to keep this full-geometry check practical. Flat
	// authored surfaces share normals, including triangles baked into one mesh.
	const planes = new Map<string, Face[]>();
	for (const face of faces) {
		const key = face.normal.toArray().map(function (value) { return Math.round(value * 10000); }).join(',');
		const group = planes.get(key);
		if (group) group.push(face); else planes.set(key, [face]);
	}
	expect(faces.length).toBeGreaterThan(100);
	for (const plane of planes.values()) for (const [index, a] of plane.entries()) {
		const planePoint = a.corners[0];
		if (!planePoint) continue;
		for (const b of plane.slice(index + 1)) {
			if (!a.bounds.intersectsBox(b.bounds) || a.normal.dot(b.normal) < 1 - 1e-8) continue;
			if (b.corners.some(function (p) { return Math.abs(a.normal.dot(p.clone().sub(planePoint))) > 0.001; })) continue;
			const overlap = overlapFace(a, b);
			if (faceArea(overlap) < 0.01) continue;
			const center = overlap.reduce(function (sum, p) { return sum.add(p); }, new Vector3()).divideScalar(overlap.length);
			const samples = [center, ...overlap.map(function (p) { return p.clone().lerp(center, 0.1); })];
			const exposed = samples.some(function (sample) {
				ray.set(sample.clone().addScaledVector(a.normal, 1000), a.normal.clone().negate());
				const hit = ray.intersectObject(model.root).find(function (value) { return value.object instanceof Mesh && value.object.visible; });
				return hit !== undefined && Math.abs(hit.distance - 1000) < 0.005;
			});
			if (!exposed) continue;
			const describe = function (face: Face) {
				return `${face.part.parent?.name}/${face.part.name}/triangle-${face.index}`;
			};
			failures.push(`${describe(a)} overlaps ${describe(b)} near ${center.toArray().map(function (value) { return value.toFixed(2); }).join(',')}`);
		}
	}
	return failures;
};

interface Configuration { name: string; frame: FrameId; kind?: EnemyKind; commander?: boolean; size: number; stride: number }
const configurations: readonly Configuration[] = [
	...FRAMES.map(function (frame) { return { name: frame.id, frame: frame.id, size: frame.size, stride: frame.stride }; }),
	...(['scout', 'striker', 'siege'] as const).map(function (kind) { return { name: kind, frame: 'warden' as const, kind, size: mechScale(kind), stride: 1 }; }),
	{ name: 'commander', frame: 'warden', kind: 'siege', commander: true, size: mechScale('siege'), stride: 1 },
];

for (const config of configurations) test(`${config.name} has no exposed coplanar surfaces while standing, aiming, walking, or firing`, function () {
	const model = createMech(config.kind, config.commander, config.frame); const rig = FRAME_RIGS[config.frame];
	const verify = function (gait: WalkerGait, heading: number, recoil: number) {
		model.pose(gait, heading, { recoil, hit: 0, heat: 0, time: 0 });
		expect(exposedOverlaps(model)).toEqual([]);
	};
	try {
		for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
			for (const recoil of [0, 0.01, 0.4, 0.5, 1]) verify(createGait({ x: 0, y: 0, angle: 0 }, config.size, rig), heading, recoil);
		}
		let gait = createGait({ x: 0, y: 0, angle: 0 }, config.size, rig);
		for (let tick = 1; tick <= 120; tick++) {
			gait = advanceGait(gait, { x: tick * config.size, y: 0, angle: tick / 100 }, 1 / 60, config.size, config.stride, rig);
			if (tick % 20 === 0) verify(gait, -tick / 70, tick % 40 === 0 ? 0 : 0.8);
		}
	} finally { model.dispose(); }
});
