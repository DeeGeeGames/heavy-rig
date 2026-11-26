import type { BufferGeometry } from 'three';
import type { FieldTerrain } from './field-terrain';
import { groundHeight } from './terrain-elevation';
import type { Point } from './simulation';

interface DecalPose extends Point { heading: number; scaleX: number; scaleZ: number; terrain: FieldTerrain }
const poses = new WeakMap<BufferGeometry, DecalPose>();

// Ground markings use their own flat XZ geometry. Adjust each vertex relative
// to the mesh origin, keeping the marking's existing clearance above the soil.
export const drapeGroundGeometry = function (geometry: BufferGeometry, terrain: FieldTerrain | undefined, origin: Point, heading = 0, scaleX = 1, scaleZ = scaleX) {
	const previous = poses.get(geometry);
	if (terrain?.elevation) {
		if (previous?.terrain === terrain && previous.x === origin.x && previous.y === origin.y && previous.heading === heading && previous.scaleX === scaleX && previous.scaleZ === scaleZ) return;
		poses.set(geometry, { x: origin.x, y: origin.y, heading, scaleX, scaleZ, terrain });
	} else {
		if (!previous) return;
		poses.delete(geometry);
	}
	const vertices = geometry.getAttribute('position');
	const base = groundHeight(terrain, origin);
	const cos = Math.cos(heading), sin = Math.sin(heading);
	const at = { x: 0, y: 0 };
	for (let i = 0; i < vertices.count; i++) {
		const x = vertices.getX(i) * scaleX, z = vertices.getZ(i) * scaleZ;
		at.x = origin.x + x * cos - z * sin;
		at.y = origin.y + x * sin + z * cos;
		vertices.setY(i, groundHeight(terrain, at) - base);
	}
	vertices.needsUpdate = true;
	geometry.computeBoundingSphere();
};
