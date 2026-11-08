import { CircleGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, RingGeometry, Vector3, type BufferGeometry } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { legJoints, STANDARD_LEG_RIG, type WalkerGait } from './gait';
import type { MechFeedback } from './mech-3d';

interface Section { x: number; y: number; height: number; width: number }
const CROSS_SECTION = [[-0.62, -1], [0.62, -1], [1, -0.62], [1, 0.62], [0.62, 1], [-0.62, 1], [-1, 0.62], [-1, -0.62]] as const;
const LEG_SECTION = [[-1, -0.65], [-0.65, -1], [0.65, -1], [1, -0.65], [1, 0.65], [0.65, 1], [-0.65, 1], [-1, 0.65]] as const;

// A presentation study. Nothing in the live frame factory selects this model.
// X is forward, Y is up, and Z is lateral, matching the existing mech adapter.
export const createLowPolyWarden = function () {
	const root = new Group(); root.name = 'warden-low-poly';
	const geometries = new Set<BufferGeometry>();
	const materials: MeshStandardMaterial[] = [];
	const surface = function (color: string, metalness = 0.25) {
		const value = new MeshStandardMaterial({ color, roughness: 0.73, metalness, flatShading: true });
		materials.push(value); return value;
	};
	const steel = surface('#738986'); const dark = surface('#253239'); const amber = surface('#d7ad61');
	const trim = surface('#c8cec0'); const recess = surface('#0c1920'); const piston = surface('#adb7b2', 0.75);
	const glass = surface('#9fe5e7'); glass.emissive.set('#9fe5e7'); glass.emissiveIntensity = 0.7;
	const flare = surface('#ffcd79'); flare.emissive.set('#ffac42'); flare.emissiveIntensity = 4;
	const own = function <T extends BufferGeometry>(value: T): T { geometries.add(value); return value; };
	const mesh = function (parent: Group, name: string, geometry: BufferGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0) {
		const part = new Mesh(geometry, material); part.name = name; part.position.set(x, y, z);
		part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
	};
	const group = function (parent: Group, name: string) { const value = new Group(); value.name = name; parent.add(value); return value; };
	// Clipped cross-sections make tapered, sloped housings, rather than boxes
	// with edge decoration. ConvexGeometry is Three's published hull utility.
	const housing = function (parent: Group, name: string, sections: readonly Section[], material: MeshStandardMaterial, z = 0) {
		const points = sections.flatMap(function (section) {
			return CROSS_SECTION.map(function ([vertical, lateral]) {
				return new Vector3(section.x, section.y + vertical * section.height, lateral * section.width);
			});
		});
		return mesh(parent, name, own(new ConvexGeometry(points)), material, 0, 0, z);
	};
	const cylinderGeometry = own(new CylinderGeometry(1, 1, 1, 8));
	const diskGeometry = own(new CircleGeometry(1, 8));
	const cylinder = function (parent: Group, name: string, radius: number, length: number, material: MeshStandardMaterial, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y') {
		const part = mesh(parent, name, cylinderGeometry, material, x, y, z);
		part.scale.set(radius, length, radius);
		if (axis === 'x') part.rotation.z = -Math.PI / 2;
		if (axis === 'z') part.rotation.x = Math.PI / 2;
		return part;
	};
	const aperture = function (parent: Group, name: string, x: number, y: number, z: number, radius: number, rim: number) {
		// The black floor is in front of the armor; the rim stands above it.
		// This avoids competing coplanar faces throughout rotation and recoil.
		const floor = mesh(parent, `${name}-recess`, diskGeometry, recess, x + 0.12, y, z);
		floor.rotation.y = Math.PI / 2; floor.scale.setScalar(radius);
		const lip = mesh(parent, `${name}-rim`, own(new RingGeometry(radius, radius + rim, 8)), dark, x + 0.65, y, z);
		lip.rotation.y = Math.PI / 2;
	};

	const pelvis = group(root, 'pelvis');
	cylinder(pelvis, 'waist-bearing', 18, 8, dark, -2, 46, 0);
	cylinder(pelvis, 'waist-race', 16.5, 2.5, amber, -2, 50.8, 0);
	housing(pelvis, 'hip-casting', [{ x: -13, y: 43, height: 5, width: 17 }, { x: 6, y: 43, height: 7, width: 21 }, { x: 15, y: 44, height: 3, width: 15 }], dark);
	const turret = group(root, 'turret');
	housing(turret, 'torso-shell', [
		{ x: -29, y: 63, height: 10, width: 17 }, { x: -12, y: 65, height: 14, width: 23 },
		{ x: 15, y: 63, height: 12, width: 21 }, { x: 35, y: 59.5, height: 7, width: 14 },
	], steel);
	housing(turret, 'canopy-brow', [
		{ x: -19, y: 78.3, height: 2.5, width: 16 }, { x: 7, y: 78.5, height: 3, width: 20 },
		{ x: 31.8, y: 72.7, height: 2, width: 16.2 },
	], trim);
	housing(turret, 'visor-socket', [{ x: 27, y: 70, height: 3.8, width: 16 }, { x: 33, y: 69.2, height: 2.7, width: 14.5 }], recess);
	housing(turret, 'cockpit-visor', [{ x: 33.15, y: 69.8, height: 1.25, width: 12.5 }, { x: 33.7, y: 69.65, height: 1.15, width: 12.4 }], glass);
	housing(turret, 'chin-intake', [{ x: 33.9, y: 58.4, height: 2.3, width: 9.8 }, { x: 35.6, y: 58.4, height: 2, width: 9.3 }], recess);
	housing(turret, 'reactor-pack', [{ x: -37, y: 63, height: 9, width: 13 }, { x: -25, y: 64, height: 12, width: 17 }], dark);
	for (const side of [-1, 1]) {
		housing(turret, 'cheek-inlay', [{ x: 8, y: 65.7, height: 1.3, width: 1 }, { x: 23, y: 63.8, height: 1.2, width: 1 }], amber, side * 21);
		for (let vent = 0; vent < 4; vent++) housing(turret, 'cooling-louver', [{ x: -37.7, y: 57 + vent * 4, height: 0.7, width: 5 }, { x: -36.7, y: 58 + vent * 4, height: 0.7, width: 5 }], trim, side * 7);
		const z = side * 34;
		housing(turret, 'pod-support', [{ x: -23, y: 66, height: 7, width: 6 }, { x: -7, y: 71, height: 10, width: 7 }], dark, z);
		housing(turret, 'missile-pod', [{ x: -29, y: 82, height: 8, width: 10 }, { x: -19, y: 83, height: 12, width: 13 }, { x: 2, y: 82.5, height: 10.5, width: 12 }], amber, z);
		housing(turret, 'pod-cap', [{ x: -27, y: 92.3, height: 1.4, width: 8 }, { x: -16, y: 95.6, height: 1.5, width: 11 }, { x: 1, y: 93.8, height: 1.2, width: 10.5 }], trim, z);
		for (const row of [-1, 1]) for (const column of [-1, 0, 1]) aperture(turret, 'launch-tube', 2.05, 82.5 + row * 4.3, z + column * 7.1, 2.5, 0.75);
		housing(turret, 'gun-cradle', [{ x: -24, y: 55, height: 5, width: 6 }, { x: -13, y: 56, height: 9, width: 10 }, { x: 6, y: 55.5, height: 6, width: 7 }], steel, z);
		housing(turret, 'gun-mantlet', [{ x: 3, y: 55.7, height: 6.4, width: 7.4 }, { x: 9, y: 55.5, height: 5.3, width: 5.5 }], trim, z);
	}
	cylinder(turret, 'antenna-base', 2, 4, dark, -20, 80, -16);
	cylinder(turret, 'antenna', 0.65, 19, dark, -20, 91, -16);
	cylinder(turret, 'antenna-tip', 1.2, 1.5, trim, -20, 101, -16);
	const guns = [-1, 1].map(function (side) {
		const slide = group(turret, side < 0 ? 'left-gun-slide' : 'right-gun-slide');
		const z = side * 34;
		cylinder(slide, 'octagonal-barrel', 3.3, 31, dark, 21, 55.5, z, 'x');
		cylinder(slide, 'barrel-collar', 4.4, 3.5, amber, 11, 55.5, z, 'x');
		housing(slide, 'muzzle-brake', [{ x: 33.5, y: 55.5, height: 4, width: 4.5 }, { x: 36, y: 55.5, height: 5.5, width: 5.5 }, { x: 43, y: 55.5, height: 4.8, width: 4.8 }], trim, z);
		aperture(slide, 'gun-bore', 43.05, 55.5, z, 3.1, 0.45);
		const flash = mesh(slide, 'muzzle-flash', own(new CylinderGeometry(0, 3, 13, 6)), flare, 50, 55.5, z);
		flash.rotation.z = -Math.PI / 2; flash.visible = false;
		return { slide, flash };
	});

	const armor = function (parent: Group, name: string, length: number, broad: boolean) {
		const part = group(parent, name);
		cylinder(part, 'load-bearing-strut', broad ? 3.3 : 3, length, dark, 0, 0, 0);
		const points = [
			{ y: length * 0.38, center: 0, depth: 5.5, width: 6 },
			{ y: length * 0.05, center: 2, depth: broad ? 8.5 : 7, width: broad ? 8 : 7.5 },
			{ y: -length * 0.38, center: 1, depth: 4.5, width: 5.3 },
		].flatMap(function (section) {
			return LEG_SECTION.map(function ([x, z]) {
				return new Vector3(section.center + x * section.depth, section.y, z * section.width);
			});
		});
		mesh(part, 'tapered-leg-armor', own(new ConvexGeometry(points)), steel);
		return part;
	};
	const legs = ([0, 1] as const).map(function (index) {
		const leg = group(root, index === 0 ? 'left-leg' : 'right-leg');
		const upper = armor(leg, 'upper-leg', STANDARD_LEG_RIG.upper, true);
		const lower = armor(leg, 'lower-leg', STANDARD_LEG_RIG.lower, false);
		const joint = function (name: string, radius: number, breadth: number) {
			const value = group(leg, name);
			cylinder(value, 'joint-hub', radius, breadth, dark, 0, 0, 0, 'z');
			for (const side of [-1, 1]) cylinder(value, 'joint-cap', radius * 0.75, 1.4, trim, 0, 0, side * (breadth / 2 + 0.6), 'z');
			return value;
		};
		const hip = joint('hip', 6.5, 18); const knee = joint('knee', 6.7, 19); const ankle = joint('ankle', 4.9, 15);
		const sleeve = cylinder(leg, 'hydraulic-sleeve', 2.6, 1, dark, 0, 0, 0);
		const rod = cylinder(leg, 'hydraulic-rod', 1.55, 1, piston, 0, 0, 0);
		const foot = group(leg, 'planted-foot');
		housing(foot, 'sole', [{ x: -16, y: 2.3, height: 2.3, width: 7 }, { x: -9, y: 3.3, height: 3.3, width: 10 }, { x: 15, y: 2.8, height: 2.8, width: 9 }], dark);
		housing(foot, 'instep', [{ x: -13, y: 6, height: 2.3, width: 6 }, { x: -4, y: 8.2, height: 5, width: 8 }, { x: 14, y: 4.7, height: 2.6, width: 8 }], steel);
		for (const side of [-1, 1]) housing(foot, 'split-toe', [{ x: 9, y: 3.5, height: 3.4, width: 4.2 }, { x: 21, y: 3.1, height: 3, width: 4.2 }, { x: 26, y: 1.8, height: 1.7, width: 3.7 }], trim, side * 5.3);
		return { index, upper, lower, hip, knee, ankle, sleeve, rod, foot };
	});

	// Bake each rigid assembly by material. Articulated groups keep their pivots;
	// common geometry utilities avoid a draw call for every individual tube.
	const rigidGroups: Group[] = [];
	root.traverse(function (object) { if (object instanceof Group) rigidGroups.push(object); });
	for (const assembly of rigidGroups) {
		for (const material of materials) {
			const members = assembly.children.filter(function (child): child is Mesh<BufferGeometry, MeshStandardMaterial> {
				return child instanceof Mesh && child.material === material && child.name !== 'muzzle-flash';
			});
			if (members.length < 2) continue;
			const copies = members.map(function (part) {
				part.updateMatrix(); const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
				geometry.deleteAttribute('uv'); geometry.applyMatrix4(part.matrix); return geometry;
			});
			const combined = mergeGeometries(copies);
			for (const copy of copies) copy.dispose();
			if (!combined) throw new Error(`Cannot batch Warden assembly ${assembly.name}`);
			mesh(assembly, `${assembly.name}-surfaces`, own(combined), material);
			for (const part of members) part.removeFromParent();
		}
	}
	for (const part of turret.children) part.position.y -= STANDARD_LEG_RIG.hipHeight;
	turret.rotation.order = 'YXZ';
	const axis = new Vector3(0, 1, 0); const start = new Vector3(); const end = new Vector3();
	const direction = new Vector3(); const forward = new Vector3(); const lateral = new Vector3(); const basis = new Matrix4();
	const orient = function (part: Group, from: Vector3, to: Vector3, heading: number) {
		direction.subVectors(from, to).normalize(); forward.set(Math.cos(heading), 0, Math.sin(heading));
		forward.addScaledVector(direction, -forward.dot(direction)).normalize(); lateral.crossVectors(forward, direction).normalize();
		basis.makeBasis(forward, direction, lateral); part.quaternion.setFromRotationMatrix(basis);
		part.position.copy(from).add(to).multiplyScalar(0.5);
	};
	const link = function (part: Mesh, from: Vector3, to: Vector3, radius: number) {
		direction.subVectors(to, from); const length = direction.length();
		part.position.copy(from).add(to).multiplyScalar(0.5); part.scale.set(radius, length, radius);
		part.quaternion.setFromUnitVectors(axis, direction.normalize());
	};
	let disposed = false;
	return {
		root,
		pose: function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			pelvis.rotation.y = -gait.body.angle; turret.rotation.y = -heading;
			const roll = gait.motion.roll; const pitch = gait.motion.pitch; const relative = gait.body.angle - heading;
			const sway = roll * 26;
			turret.position.set(-Math.sin(gait.body.angle) * sway, STANDARD_LEG_RIG.hipHeight + gait.motion.lift, Math.cos(gait.body.angle) * sway);
			turret.rotation.x = Math.cos(relative) * roll - Math.sin(relative) * pitch;
			turret.rotation.z = Math.sin(relative) * roll + Math.cos(relative) * pitch;
			const recoil = feedback?.recoil ?? 0;
			for (const gun of guns) { gun.slide.position.x = -recoil * 5; gun.flash.visible = recoil > 0.82; }
			for (const leg of legs) {
				const foot = gait.feet[leg.index]; const joints = legJoints(gait.body, foot, leg.index);
				const x = gait.body.x; const z = gait.body.y;
				start.set(joints.hip.x - x, joints.hip.z, joints.hip.y - z);
				end.set(joints.knee.x - x, joints.knee.z, joints.knee.y - z);
				orient(leg.upper, start, end, gait.body.angle); leg.hip.position.copy(start); leg.knee.position.copy(end);
				start.copy(end); end.set(joints.ankle.x - x, joints.ankle.z, joints.ankle.y - z);
				orient(leg.lower, start, end, gait.body.angle); leg.ankle.position.copy(end);
				for (const joint of [leg.hip, leg.knee, leg.ankle]) joint.rotation.y = -gait.body.angle;
				leg.foot.position.set(foot.x - x, foot.lift, foot.y - z); leg.foot.rotation.y = -foot.angle;
				const f = Math.cos(gait.body.angle); const s = Math.sin(gait.body.angle);
				start.set(joints.hip.x - x + f * 8, joints.hip.z - 4, joints.hip.y - z + s * 8);
				end.set(joints.knee.x - x + f * 8, joints.knee.z + 2, joints.knee.y - z + s * 8);
				link(leg.rod, start, end, 1.55);
				end.lerp(start, 0.42); link(leg.sleeve, start, end, 2.6);
			}
			root.updateMatrixWorld(true);
		},
		dispose: function () {
			if (disposed) return; disposed = true;
			for (const value of geometries) value.dispose();
			for (const value of materials) value.dispose();
			root.removeFromParent(); root.clear();
		},
	};
};
