import { Box3, Group, Matrix4, Mesh, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { getFrame, type FrameId } from './frames';
import { getWeapon, type WeaponMount } from './arsenal';
import { footPose, legJoints, mechScale, posedLegRig, STANDARD_LEG_RIG, type WalkerGait } from './gait';
import { FRAME_RIGS } from './frame-rig';
import { createLowPolyParts } from './low-poly-parts';
import { buildLowPolyChassis } from './low-poly-chassis';
import type { EnemyKind } from './simulation';
import { createEnemyVehicle, isVehicleKind } from './enemy-vehicles';

export interface MechFeedback { recoil: number; hit: number; heat: number; time: number }

// Recover the shot envelope from simulation-owned cooldowns, so firing freezes
// with combat and works for every equipped family, including purchased armaments.
export const weaponRecoil = function (loadout: readonly WeaponMount[]): number {
	return loadout.reduce(function (largest, mount) {
		const weapon = getWeapon(mount.weapon);
		if (weapon.kind === 'laser') return Math.max(largest, mount.firing ? 0.12 : 0);
		const duration = Math.min(0.22, weapon.interval * 0.8);
		const impulse = Math.max(0, (mount.cooldown - weapon.interval + duration) / duration);
		const weight = weapon.kind === 'bullet' ? 0.35 : weapon.kind === 'missile' ? 0.65 : 1;
		return Math.max(largest, Math.min(1, impulse) * weight);
	}, 0);
};

// Model anatomy is presentation data. The simulation and its collision sizes
// keep their existing contracts; every view uses this same production factory.
export const createMech = function (kind?: EnemyKind, commander = false, frame: FrameId = 'warden') {
	if (kind && isVehicleKind(kind)) return createEnemyVehicle(kind);
	const definition = getFrame(frame); const size = kind ? mechScale(kind) : definition.size;
	const rig = kind ? STANDARD_LEG_RIG : FRAME_RIGS[frame]; const suspension = kind ? 1 : definition.suspension;
	const root = new Group(); root.name = kind ? `${commander ? 'commander' : kind}-frame` : `${frame}-frame`;
	const anatomy = new Group(); anatomy.name = 'anatomy'; anatomy.scale.setScalar(size); root.add(anatomy);
	const enemyColors = { scout: '#9c6f4e', striker: '#8d5350', siege: '#6b5f60' };
	const frameColors = { warden: '#738986', kestrel: '#597a73', maul: '#896650', longbow: '#6b6b89', morrow: '#6a7961' };
	const parts = createLowPolyParts({ steel: commander ? '#772f2d' : kind ? enemyColors[kind] : frameColors[frame], accent: commander ? '#bdb6a0' : kind ? '#aa7454' : definition.color, trim: kind ? '#c3b6a0' : '#c8cec0', glass: kind ? '#ffae7e' : '#9fe5e7' });
	const { group, housing, cylinder, steel, dark, trim, accent, piston } = parts;
	const hull = group(anatomy, 'hull'); const turret = group(anatomy, 'turret');
	cylinder(hull, 'waist-bearing', rig.hipWidth, 8, dark, rig.hipForward, rig.hipHeight - 2, 0);
	cylinder(hull, 'waist-race', rig.hipWidth - 1.5, 2.5, accent, rig.hipForward, rig.hipHeight + 2.8, 0);
	housing(hull, 'hip-casting', [{ x: rig.hipForward - 11, y: rig.hipHeight - 5, height: 5, width: rig.hipWidth - 1 }, { x: rig.hipForward + 8, y: rig.hipHeight - 5, height: 7, width: rig.hipWidth + 3 }, { x: rig.hipForward + 17, y: rig.hipHeight - 4, height: 3, width: rig.hipWidth - 3 }], dark);
	const hardware = buildLowPolyChassis(parts, turret, frame, kind, commander);
	for (const part of turret.children) part.position.y -= rig.hipHeight - (rig.torsoRise ?? 0);
	turret.rotation.order = 'YXZ';
	const slender = !kind && (frame === 'kestrel' || frame === 'longbow');
	const broad = !kind && (frame === 'maul' || frame === 'morrow');
	const legArmor = function (parent: Group, name: string, length: number, upper: boolean) {
		const assembly = group(parent, name); const width = slender ? 4.7 : broad ? 8.5 : 7;
		cylinder(assembly, 'load-bearing-strut', slender ? 2.3 : 3.3, length, dark, 0, 0, 0);
		const cross = [[-1, -0.65], [-0.65, -1], [0.65, -1], [1, -0.65], [1, 0.65], [0.65, 1], [-0.65, 1], [-1, 0.65]] as const;
		const vertices = [{ y: length * 0.38, x: 0, depth: upper ? 5.5 : 4.5, width: width * 0.8 }, { y: length * 0.05, x: 2, depth: broad ? 9.5 : slender ? 5.5 : 8, width }, { y: -length * 0.38, x: 1, depth: 4, width: width * 0.65 }].flatMap(function (section) {
			return cross.map(function ([x, z]) { return new Vector3(section.x + x * section.depth, section.y, z * section.width); });
		});
		parts.mesh(assembly, 'tapered-leg-armor', parts.own(new ConvexGeometry(vertices)), steel);
		return assembly;
	};
	const legs = ([0, 1] as const).map(function (index) {
		const leg = group(anatomy, index === 0 ? 'left-leg' : 'right-leg');
		const upper = legArmor(leg, 'upper-leg', rig.upper, true); const lower = legArmor(leg, 'lower-leg', rig.lower, false);
		const joint = function (name: string, radius: number) {
			const value = group(leg, name); const breadth = slender ? 12 : broad ? 21 : 18;
			cylinder(value, 'joint-hub', radius, breadth, dark, 0, 0, 0, 'z');
			for (const side of [-1, 1]) cylinder(value, 'joint-cap', radius * 0.75, 1.4, trim, 0, 0, side * (breadth / 2 + 0.6), 'z');
			return value;
		};
		const hip = joint('hip', slender ? 5 : 6.5); const knee = joint('knee', slender ? 5 : broad ? 7.5 : 6.7); const ankle = joint('ankle', slender ? 3.9 : 4.9);
		const sleeve = group(leg, 'hydraulic-sleeve'); cylinder(sleeve, 'sleeve', 2.6, 1, dark, 0, 0, 0);
		const rod = group(leg, 'hydraulic-rod'); cylinder(rod, 'rod', 1.55, 1, piston, 0, 0, 0);
		const contact = group(leg, 'planted-foot'); const foot = group(contact, 'ankle-roll'); const width = broad ? 12 : slender ? 6 : 9;
		const articulated = rig.kneeDirection === -1;
		housing(foot, 'sole', [{ x: -16, y: 2.3, height: 2.3, width: width * 0.78 }, { x: -9, y: 3.3, height: 3.3, width: width + 1 }, { x: articulated ? 8 : 15, y: 2.8, height: 2.8, width }], dark);
		housing(foot, 'instep', [{ x: -13, y: 6, height: 2.3, width: width * 0.65 }, { x: -4, y: 8.2, height: 5, width: width * 0.88 }, { x: articulated ? 6 : 14, y: 4.7, height: 2.6, width: width * 0.88 }], steel);
		const toes = articulated ? group(foot, 'toe-hinge') : foot;
		if (articulated) toes.position.set(8, 3, 0);
		for (const side of [-1, 1]) housing(toes, 'split-toe', [{ x: 9 - toes.position.x, y: 3.5 - toes.position.y, height: 3.4, width: width * 0.46 }, { x: 21 - toes.position.x, y: 3.1 - toes.position.y, height: 3, width: width * 0.46 }, { x: 26 - toes.position.x, y: 1.8 - toes.position.y, height: 1.7, width: width * 0.4 }], trim, side * width * 0.59);
		if (articulated) cylinder(foot, 'toe-bearing', 2, width * 1.9, dark, 8, 3, 0, 'z');
		if (!kind && frame === 'kestrel') housing(foot, 'rear-talon', [{ x: -27, y: 1.5, height: 1.4, width: 2 }, { x: -12, y: 4, height: 3, width: 3 }], steel);
		return { index, upper, lower, hip, knee, ankle, sleeve, rod, contact, foot, toes };
	});
	parts.batch(anatomy);
	const bounds: { part: Mesh; corners: Vector3[] }[] = [];
	anatomy.traverse(function (object) {
		if (!(object instanceof Mesh)) return;
		object.geometry.computeBoundingBox(); const box: Box3 | null = object.geometry.boundingBox;
		if (!box) return;
		bounds.push({ part: object, corners: [box.min.x, box.max.x].flatMap(function (x) { return [box.min.y, box.max.y].flatMap(function (y) { return [box.min.z, box.max.z].map(function (z) { return new Vector3(x, y, z); }); }); }) });
	});
	const rocketTubes = hardware.muzzles.map(function (anchor) { return anchor.children.filter(function (child) { return child.name === 'rocket-tube'; }); });
	const rocketMuzzles = rocketTubes.map(function (tubes) { return tubes.map(function () { return new Vector3(); }); });
	const muzzles = hardware.muzzles.map(function () { return new Vector3(); }); const exhaust = new Vector3(); let labelHeight = 0;
	const axis = new Vector3(0, 1, 0); const start = new Vector3(); const end = new Vector3(); const direction = new Vector3();
	const forward = new Vector3(); const lateral = new Vector3(); const basis = new Matrix4(); const inverseRoot = new Matrix4(); const relative = new Matrix4(); const vertex = new Vector3();
	const orient = function (part: Group, from: Vector3, to: Vector3, heading: number) {
		direction.subVectors(from, to).normalize(); forward.set(Math.cos(heading), 0, Math.sin(heading)); forward.addScaledVector(direction, -forward.dot(direction)).normalize(); lateral.crossVectors(forward, direction).normalize();
		basis.makeBasis(forward, direction, lateral); part.quaternion.setFromRotationMatrix(basis); part.position.copy(from).add(to).multiplyScalar(0.5);
	};
	const link = function (part: Group, from: Vector3, to: Vector3) {
		direction.subVectors(to, from); part.position.copy(from).add(to).multiplyScalar(0.5); part.scale.y = direction.length(); part.quaternion.setFromUnitVectors(axis, direction.normalize());
	};
	let disposed = false;
	return {
		root,
		get rocketMuzzles(): readonly (readonly Vector3[])[] { return rocketMuzzles; },
		get muzzles(): readonly Vector3[] { return muzzles; },
		get exhaust(): Vector3 | undefined { return hardware.vents.length > 0 ? exhaust : undefined; },
		get labelHeight(): number { return labelHeight; },
		pose: function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			const poseRig = posedLegRig(gait, size, rig); const humanoid = rig.kneeDirection === 1;
			hull.rotation.y = -gait.body.angle; hull.position.y = poseRig.hipHeight - rig.hipHeight; turret.rotation.y = -heading;
			const roll = gait.motion.roll * (humanoid ? 0.28 : 1); const pitch = gait.motion.pitch * (humanoid ? 0.5 : 1);
			const sway = gait.motion.roll * (humanoid ? 6 : 26) * suspension; const relativeHeading = gait.body.angle - heading;
			turret.position.set(-Math.sin(gait.body.angle) * sway, humanoid ? poseRig.hipHeight : rig.hipHeight + gait.motion.lift * suspension, Math.cos(gait.body.angle) * sway);
			turret.rotation.x = (Math.cos(relativeHeading) * roll - Math.sin(relativeHeading) * pitch) * suspension;
			turret.rotation.z = (Math.sin(relativeHeading) * roll + Math.cos(relativeHeading) * pitch) * suspension;
			const recoil = feedback?.recoil ?? 0;
			for (const slide of hardware.slides) slide.position.x = -recoil * 5 * (kind ? 1 : definition.recoil);
			for (const shutter of hardware.shutters) shutter.part.position.y = shutter.y + recoil * 5;
			parts.solid.emissive.set('#ffae73'); parts.solid.emissiveIntensity = (feedback?.hit ?? 0) * 0.8;
			parts.glass.emissiveIntensity = 0.6 + (feedback?.heat ?? 0) / 170;
			for (const leg of legs) {
				const foot = footPose(gait, leg.index, size, rig, !kind && frame === 'kestrel' ? -27 : -16);
				const joints = legJoints(gait.body, foot, leg.index, size, poseRig, foot.pitch);
				const x = gait.body.x; const z = gait.body.y;
				start.set((joints.hip.x - x) / size, joints.hip.z / size, (joints.hip.y - z) / size);
				end.set((joints.knee.x - x) / size, joints.knee.z / size, (joints.knee.y - z) / size);
				orient(leg.upper, start, end, gait.body.angle); leg.hip.position.copy(start); leg.knee.position.copy(end);
				start.copy(end); end.set((joints.ankle.x - x) / size, joints.ankle.z / size, (joints.ankle.y - z) / size);
				orient(leg.lower, start, end, gait.body.angle); leg.ankle.position.copy(end);
				for (const joint of [leg.hip, leg.knee, leg.ankle]) joint.rotation.y = -gait.body.angle;
				const contact = gait.feet[leg.index];
				leg.contact.position.set((contact.x - x) / size, contact.lift / size, (contact.y - z) / size); leg.contact.rotation.y = -contact.angle;
				leg.foot.position.set(((foot.x - contact.x) * Math.cos(contact.angle) + (foot.y - contact.y) * Math.sin(contact.angle)) / size, (foot.lift - contact.lift) / size, 0);
				leg.foot.rotation.z = foot.pitch;
				if (leg.toes !== leg.foot) leg.toes.rotation.z = foot.toePitch;
				const f = Math.cos(gait.body.angle); const s = Math.sin(gait.body.angle);
				start.set((joints.hip.x - x) / size + f * 8, joints.hip.z / size - 4, (joints.hip.y - z) / size + s * 8);
				end.set((joints.knee.x - x) / size + f * 8, joints.knee.z / size + 2, (joints.knee.y - z) / size + s * 8);
				link(leg.rod, start, end); end.lerp(start, 0.42); link(leg.sleeve, start, end);
			}
			root.updateMatrixWorld(true); inverseRoot.copy(root.matrixWorld).invert();
			for (const [index, anchor] of hardware.muzzles.entries()) muzzles[index]?.setFromMatrixPosition(anchor.matrixWorld).applyMatrix4(inverseRoot);
			for (const [slot, tubes] of rocketTubes.entries()) for (const [index, tube] of tubes.entries()) rocketMuzzles[slot]?.[index]?.setFromMatrixPosition(tube.matrixWorld).applyMatrix4(inverseRoot);
			exhaust.set(0, 0, 0); for (const anchor of hardware.vents) exhaust.add(vertex.setFromMatrixPosition(anchor.matrixWorld).applyMatrix4(inverseRoot));
			if (hardware.vents.length > 0) exhaust.divideScalar(hardware.vents.length);
			labelHeight = 0;
			for (const bound of bounds) {
				relative.multiplyMatrices(inverseRoot, bound.part.matrixWorld);
				for (const corner of bound.corners) { vertex.copy(corner).applyMatrix4(relative); labelHeight = Math.max(labelHeight, vertex.y - (vertex.x + vertex.z) * 0.5); }
			}
		},
		dispose: function () { if (disposed) return; disposed = true; parts.dispose(); root.removeFromParent(); root.clear(); },
	};
};
