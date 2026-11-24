import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Vector3, type MeshStandardMaterial } from 'three';
import { createLowPolyParts } from './low-poly-parts';

type HullStation = readonly [along: number, centerY: number, halfHeight: number, halfBeam: number];
type XYZ = readonly [x: number, y: number, z: number];

// Ship armor uses the same flat vertex paint and rigid-part batching as the surface vehicles.
export const createShipParts = function (steel: string) {
	const parts = createLowPolyParts({ steel, accent: '#b44a40', trim: '#c3cdcf', glass: '#acd9d8' });
	const unitBox = parts.own(new BoxGeometry(1, 1, 1));
	const box = function (parent: Group, name: string, material: MeshStandardMaterial, x: number, y: number, z: number, width: number, height: number, length: number) {
		const mesh = parts.mesh(parent, name, unitBox, material, x, y, z);
		mesh.scale.set(width, height, length);
		return mesh;
	};
	const hull = function (parent: Group, name: string, material: MeshStandardMaterial, axis: 'x' | 'z', offset: number, stations: readonly HullStation[]) {
		const sections = stations.map(function ([x, y, height, width]) { return { x, y, height, width }; });
		const mesh = parts.housing(parent, name, sections, material);
		if (axis === 'x') mesh.position.z = offset;
		else { mesh.rotation.y = -Math.PI / 2; mesh.position.x = offset; }
		return mesh;
	};
	const beam = function (parent: Group, name: string, material: MeshStandardMaterial, a: XYZ, b: XYZ, width: number, depth: number) {
		const start = new Vector3(...a), end = new Vector3(...b);
		const midpoint = start.clone().lerp(end, 0.5);
		const axis = end.sub(start);
		const mesh = box(parent, name, material, midpoint.x, midpoint.y, midpoint.z, width, axis.length(), depth);
		mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize());
		return mesh;
	};
	// Wrap one painted sash around the roof chamfers and both side faces. Every
	// segment follows the plate underneath, including at game-camera grazing angles.
	const sash = function (parent: Group, name: string, material: MeshStandardMaterial, x: number, z: number, width: number, slant: number, section: ReadonlyArray<readonly [number, number]>) {
		const vertices: number[] = [];
		let previous: readonly [number, number] | undefined;
		for (const point of section) {
			if (previous) {
				const [ax, ay] = previous, [bx, by] = point;
				const az = slant * ax, bz = slant * bx;
				vertices.push(ax, ay, az + width, bx, by, bz + width, bx, by, bz, ax, ay, az + width, bx, by, bz, ax, ay, az);
			}
			previous = point;
		}
		const geometry = parts.own(new BufferGeometry());
		geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
		parts.mesh(parent, name, geometry, material, x, 0, z);
	};
	return { ...parts, box, hull, beam, sash };
};
