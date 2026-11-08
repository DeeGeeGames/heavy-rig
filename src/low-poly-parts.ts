import { CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, RingGeometry, Vector3, type BufferGeometry } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Section { x: number; y: number; height: number; width: number }
export interface Palette { steel: string; accent: string; trim: string; glass: string }
const CROSS_SECTION = [[-0.62, -1], [0.62, -1], [1, -0.62], [1, 0.62], [0.62, 1], [-0.62, 1], [-1, 0.62], [-1, -0.62]] as const;

// Keep rigid surfaces together. Color is baked into vertices, leaving one
// structural draw per articulated assembly instead of one per armor detail.
export const createLowPolyParts = function (palette: Palette) {
	const geometries = new Set<BufferGeometry>();
	const surface = function (color: string) { return new MeshStandardMaterial({ color, roughness: 0.73, metalness: 0.25, flatShading: true }); };
	const steel = surface(palette.steel); const accent = surface(palette.accent); const dark = surface('#253239');
	const trim = surface(palette.trim); const recess = surface('#0c1920'); const piston = surface('#adb7b2');
	const glass = surface(palette.glass); glass.emissive.set(palette.glass); glass.emissiveIntensity = 0.7;
	const solid = surface('#ffffff'); solid.vertexColors = true;
	const materials = [steel, accent, dark, trim, recess, piston, glass, solid];
	const own = function <T extends BufferGeometry>(value: T): T { geometries.add(value); return value; };
	const mesh = function (parent: Group, name: string, geometry: BufferGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0) {
		const part = new Mesh(geometry, material); part.name = name; part.position.set(x, y, z);
		part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
	};
	const group = function (parent: Group, name: string) { const value = new Group(); value.name = name; parent.add(value); return value; };
	const housing = function (parent: Group, name: string, sections: readonly Section[], material: MeshStandardMaterial, z = 0) {
		const points = sections.flatMap(function (section) {
			return CROSS_SECTION.map(function ([vertical, lateral]) { return new Vector3(section.x, section.y + vertical * section.height, lateral * section.width); });
		});
		return mesh(parent, name, own(new ConvexGeometry(points)), material, 0, 0, z);
	};
	const cylinderGeometry = own(new CylinderGeometry(1, 1, 1, 8));
	const diskGeometry = own(new CircleGeometry(1, 8));
	const cylinder = function (parent: Group, name: string, radius: number, length: number, material: MeshStandardMaterial, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y') {
		const part = mesh(parent, name, cylinderGeometry, material, x, y, z); part.scale.set(radius, length, radius);
		if (axis === 'x') part.rotation.z = -Math.PI / 2;
		if (axis === 'z') part.rotation.x = Math.PI / 2;
		return part;
	};
	const aperture = function (parent: Group, name: string, x: number, y: number, z: number, radius: number, rim: number) {
		const floor = mesh(parent, name, diskGeometry, recess, x + 0.12, y, z); floor.rotation.y = Math.PI / 2; floor.scale.setScalar(radius);
		const lip = mesh(parent, `${name}-rim`, own(new RingGeometry(radius, radius + rim, 8)), dark, x + 0.65, y, z); lip.rotation.y = Math.PI / 2;
		return floor;
	};
	const batch = function (root: Group) {
		const assemblies: Group[] = [];
		root.traverse(function (object) { if (object instanceof Group) assemblies.push(object); });
		for (const assembly of assemblies) {
			for (const glowing of [false, true]) {
				const members = assembly.children.filter(function (part): part is Mesh<BufferGeometry, MeshStandardMaterial> { return part instanceof Mesh && part.material instanceof MeshStandardMaterial && (part.material === glass) === glowing; });
				if (members.length === 0) continue;
				const copies = members.map(function (part) {
					part.updateMatrix(); const copy = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone(); copy.deleteAttribute('uv'); copy.applyMatrix4(part.matrix);
					const colors = new Float32BufferAttribute(new Float32Array(copy.getAttribute('position').count * 3), 3); const color: Color = glowing ? new Color('#ffffff') : part.material.color;
					for (let index = 0; index < colors.count; index++) colors.setXYZ(index, color.r, color.g, color.b);
					copy.setAttribute('color', colors); return copy;
				});
				const combined = mergeGeometries(copies); for (const copy of copies) copy.dispose();
				if (!combined) throw new Error(`Cannot combine low-poly assembly ${assembly.name}`);
				mesh(assembly, glowing ? 'cockpit-visor' : `${assembly.name}-surfaces`, own(combined), glowing ? glass : solid);
				for (const part of members) part.removeFromParent();
			}
		}
		// Source hulls are construction data, not retained GPU allocations.
		const retained = new Set<BufferGeometry>(); root.traverse(function (object) { if (object instanceof Mesh) retained.add(object.geometry); });
		for (const geometry of geometries) if (!retained.has(geometry)) { geometry.dispose(); geometries.delete(geometry); }
	};
	return { steel, accent, dark, trim, recess, piston, glass, solid, own, mesh, group, housing, cylinder, aperture, batch,
		dispose: function () { for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); },
	};
};

export type LowPolyParts = ReturnType<typeof createLowPolyParts>;
