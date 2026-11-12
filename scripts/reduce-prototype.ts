import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// Offline asset preparation only. Keep the approved master and animation intact.
const root = join(import.meta.dir, '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(join(root, 'public/models/heavy-prototype.glb'));
await MeshoptSimplifier.ready;
await document.transform(weld());
let triangles = 0;
for (const mesh of document.getRoot().listMeshes()) {
	for (const primitive of mesh.listPrimitives()) {
		const indices = primitive.getIndices(); const positions = primitive.getAttribute('POSITION'); const normals = primitive.getAttribute('NORMAL');
		const joints = primitive.getAttribute('JOINTS_0'); const weights = primitive.getAttribute('WEIGHTS_0');
		const indexArray = indices?.getArray(); const positionArray = positions?.getArray(); const normalArray = normals?.getArray();
		if (!indices || !indexArray || !(positionArray instanceof Float32Array) || !(normalArray instanceof Float32Array) || !joints || !weights) throw new Error(`Unsupported geometry: ${mesh.getName()}`);
		// Position/normal simplification is safe here because each primitive is rigid.
		// Reject a future deforming mesh instead of silently changing its skinning.
		let rigidJoint: number | undefined;
		for (let index = 0; index < weights.getCount(); index++) {
			const influence = weights.getElement(index, []); const joint = joints.getElement(index, []);
			const slot = influence.findIndex(function (value) { return value === 1; });
			if (slot < 0 || influence.some(function (value, i) { return i !== slot && value !== 0; }) || joint[slot] === undefined) throw new Error(`Non-rigid weights: ${mesh.getName()}`);
			if (rigidJoint === undefined) rigidJoint = joint[slot];
			if (joint[slot] !== rigidJoint) throw new Error(`Mixed bone influences: ${mesh.getName()}`);
		}
		const before = indices.getCount() / 3;
		// Keep small accent primitives; retain at least 60 triangles in larger ones.
		const target = before < 200 ? indices.getCount() : Math.max(180, Math.floor(indices.getCount() * 0.10 / 3) * 3);
		// Protect the chest launcher faces and their rims in source GLB bind space.
		// These repeated small tubes distort under permissive seam simplification.
		const locked = new Uint8Array(positionArray.length / 3);
		for (let index = 0; index < locked.length; index++) {
			const x = positionArray[index * 3]; const y = positionArray[index * 3 + 1]; const z = positionArray[index * 3 + 2];
			if (x === undefined || y === undefined || z === undefined) throw new Error('Incomplete position');
			const frontRack = Math.abs(x) >= 0.038 && Math.abs(x) <= 0.16 && y >= 0.60 && y <= 0.80 && z >= 0.12;
			const upperRack = Math.abs(x) >= 0.055 && Math.abs(x) <= 0.106 && y >= 0.753 && y <= 0.813 && z >= -0.030 && z <= 0.066;
			if (frontRack || upperRack) locked[index] = 1;
		}
		// Add a budget for restored detail so locked racks do not force extra
		// simplification of unrelated surfaces sharing the same material.
		let protectedTriangles = 0;
		for (let index = 0; index < indexArray.length; index += 3) {
			const a = indexArray[index]; const b = indexArray[index + 1]; const c = indexArray[index + 2];
			if (a !== undefined && b !== undefined && c !== undefined && locked[a] && locked[b] && locked[c]) protectedTriangles++;
		}
		const protectedTarget = Math.min(indices.getCount(), target + Math.ceil(protectedTriangles * 0.9) * 3);
		const [reduced] = MeshoptSimplifier.simplifyWithAttributes(
			new Uint32Array(indexArray), positionArray, 3, normalArray, 3,
			[0.1, 0.1, 0.1], locked, protectedTarget, 0.02, ['Permissive'],
		);
		primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(reduced)).setBuffer(indices.getBuffer()));
		compactPrimitive(primitive); triangles += reduced.length / 3;
	}
}
await document.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true, keepIndices: true }));
const output = join(root, 'public/models/heavy-prototype-reduced.glb');
await io.write(output, document);
console.log(`Reduced candidate: ${triangles.toLocaleString()} triangles, ${Bun.file(output).size.toLocaleString()} bytes`);
