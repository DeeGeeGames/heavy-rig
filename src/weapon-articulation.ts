import { Group, Matrix4, Vector3, type Object3D } from 'three';
import { weaponDirection, weaponPivot, type SpatialPoint, type WeaponRig, type WeaponBody } from './weapon-rig';

export interface WeaponAssembly { readonly part: Group; readonly muzzle: Object3D }

// Weapon gimbals are stabilized independently of decorative torso suspension.
// Their pivots and neutral muzzle positions come from the simulation's rig.
export const articulateWeapons = function (root: Group, assemblies: readonly WeaponAssembly[], rigs: readonly WeaponRig[]) {
	root.updateMatrixWorld(true);
	const inverse = new Matrix4().copy(root.matrixWorld).invert();
	const gimbals = assemblies.map(function (assembly, slot) {
		const rig = rigs[slot]; if (!rig) throw new RangeError(`Missing weapon rig for assembly ${slot}`);
		const current = new Vector3().setFromMatrixPosition(assembly.muzzle.matrixWorld).applyMatrix4(inverse);
		const pivot = new Group(); pivot.name = `weapon-gimbal-${slot}`; root.add(pivot);
		pivot.position.set(rig.pivot.x, rig.pivot.elevation, rig.pivot.y); pivot.updateMatrixWorld(true);
		pivot.attach(assembly.part);
		// Align the physical assembly with its authoritative neutral muzzle.
		assembly.part.position.add(new Vector3(rig.muzzle.x - current.x, rig.muzzle.elevation - current.y, rig.muzzle.y - current.z));
		return { pivot, rig };
	});
	return function (body: WeaponBody, heading: number, target?: SpatialPoint) {
		for (const { pivot, rig } of gimbals) {
			const at = weaponPivot(rig, body, heading); const direction = weaponDirection(rig, body, heading, target);
			pivot.position.set(at.x - body.x, at.elevation, at.y - body.y);
			pivot.rotation.order = 'YXZ'; pivot.rotation.set(0, -Math.atan2(direction.y, direction.x), Math.atan2(direction.elevation, Math.hypot(direction.x, direction.y)), 'YXZ');
		}
	};
};
