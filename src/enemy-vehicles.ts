import { Box3, Group, Matrix4, Mesh, Object3D, TorusGeometry, Vector3 } from 'three';
import type { WalkerGait } from './gait';
import { createLowPolyParts } from './low-poly-parts';
import type { MechFeedback } from './mech-3d';
import { articulateWeapons } from './weapon-articulation';
import { getEnemyWeaponRig } from './weapon-rig';

export type VehicleKind = 'helicopter' | 'vtol' | 'tank';
export const isVehicleKind = function (kind: string): kind is VehicleKind {
	return kind === 'helicopter' || kind === 'vtol' || kind === 'tank';
};

// Vehicles share the mech view contract and combat weapon geometry. Cosmetic
// motion follows combat time so pausing freezes moving parts.
export const createEnemyVehicle = function (kind: VehicleKind) {
	const root = new Group(); root.name = `${kind}-vehicle`;
	const anatomy = new Group(); anatomy.name = 'anatomy'; root.add(anatomy);
	const colors = { helicopter: '#8b7054', vtol: '#736578', tank: '#77745b' };
	const parts = createLowPolyParts({ steel: colors[kind], accent: '#c48b56', trim: '#c3b6a0', glass: '#ffae7e' });
	const { group, housing, cylinder, steel, dark, trim, accent, glass, recess } = parts;
	const hull = group(anatomy, 'hull');
	const turret = group(anatomy, 'turret');
	const muzzles: Object3D[] = []; const vents: Object3D[] = [];
	const rotors: { part: Group; axis: 'y' | 'z'; rate: number }[] = [];
	const nacelles: Group[] = []; const wheels: Group[] = [];
	const recoilSleeves: Group[] = [];
	const anchor = function (parent: Object3D, name: string, x: number, y: number, z: number) {
		const value = new Object3D(); value.name = name; value.position.set(x, y, z); parent.add(value); return value;
	};
	const blade = function (parent: Group, length: number, width: number, angle: number) {
		const value = group(parent, 'rotor-blade'); value.rotation.y = angle;
		housing(value, 'blade', [{ x: -length, y: 0, height: 0.6, width }, { x: -7, y: 0, height: 1.1, width: width * 1.2 }, { x: length, y: 0, height: 0.6, width }], dark);
		for (const side of [-1, 1]) housing(value, 'blade-tip', [{ x: side * (length - 6), y: 0.2, height: 0.7, width: width + 0.2 }, { x: side * length, y: 0.2, height: 0.7, width: width + 0.2 }], trim);
	};
	const barrel = function (parent: Group, length: number, y: number, radius: number) {
		const slide = group(parent, 'weapon-slide');
		cylinder(slide, 'cannon-barrel', radius, length, dark, length / 2 + 8, y, 0, 'x');
		const sleeve = group(slide, 'recoil-sleeve'); recoilSleeves.push(sleeve);
		cylinder(sleeve, 'barrel-sleeve', radius * 1.5, length * 0.38, steel, 10 + length * 0.2, y, 0, 'x');
		cylinder(slide, 'muzzle-brake', radius * 1.6, 5, trim, length + 8, y, 0, 'x');
		parts.aperture(slide, 'cannon-aperture', length + 10.6, y, 0, radius * 0.8, 0.7);
		muzzles.push(anchor(slide, 'weapon-muzzle', length + 12, y, 0));
		return slide;
	};
	if (kind === 'helicopter') {
		housing(hull, 'fuselage', [{ x: -24, y: 0, height: 9, width: 9 }, { x: -6, y: 2, height: 14, width: 13 }, { x: 17, y: 0, height: 11, width: 10 }, { x: 30, y: -3, height: 5, width: 5 }], steel);
		housing(hull, 'cockpit', [{ x: 0, y: 10, height: 6, width: 10 }, { x: 14, y: 7, height: 7, width: 9 }, { x: 24, y: 1, height: 4, width: 5 }], glass);
		housing(hull, 'cockpit-spine', [{ x: -5, y: 15.5, height: 1.5, width: 1.3 }, { x: 13, y: 14.5, height: 1.5, width: 1.3 }, { x: 26, y: 4, height: 1.2, width: 1.3 }], trim);
		housing(hull, 'tail-boom', [{ x: -70, y: 9, height: 3.3, width: 2.5 }, { x: -50, y: 5, height: 4, width: 3.5 }, { x: -19, y: 2, height: 7, width: 7 }], steel);
		housing(hull, 'tail-fin', [{ x: -71, y: 18, height: 14, width: 1.5 }, { x: -61, y: 14, height: 10, width: 1.7 }, { x: -55, y: 6, height: 3, width: 2 }], accent);
		for (const side of [-1, 1]) {
			cylinder(hull, 'engine-casing', 6, 20, dark, -12, 12, side * 10, 'x');
			cylinder(hull, 'engine-exhaust', 4, 5, recess, -25, 12, side * 10, 'x');
			for (const x of [-12, 12]) cylinder(hull, 'skid-strut', 1.5, 13, trim, x, -16, side * 10);
			housing(hull, 'landing-skid', [{ x: -25, y: -24, height: 1.5, width: 1.5 }, { x: 19, y: -24, height: 1.5, width: 1.5 }, { x: 28, y: -21, height: 1.5, width: 1.5 }], dark, side * 12);
		}
		cylinder(hull, 'main-rotor-mast', 2.5, 18, trim, -8, 23, 0);
		const main = group(hull, 'main-rotor'); main.position.set(-8, 33, 0);
		blade(main, 55, 2, 0); blade(main, 55, 2, Math.PI / 2);
		cylinder(main, 'rotor-hub', 5.5, 4, accent, 0, 1, 0);
		rotors.push({ part: main, axis: 'y', rate: 31 });
		const tail = group(hull, 'tail-rotor'); tail.position.set(-66, 18, -5);
		cylinder(hull, 'tail-rotor-shaft', 2, 9, trim, -66, 18, -3, 'z');
		housing(tail, 'tail-blade-horizontal', [{ x: -12, y: 0, height: 1.4, width: 0.7 }, { x: 12, y: 0, height: 1.4, width: 0.7 }], dark);
		housing(tail, 'tail-blade-vertical', [{ x: -1.4, y: 0, height: 12, width: 0.7 }, { x: 1.4, y: 0, height: 12, width: 0.7 }], trim);
		rotors.push({ part: tail, axis: 'z', rate: 43 });
		turret.position.set(15, -12, 0);
		cylinder(turret, 'chin-gun-bearing', 5, 7, dark, 0, 0, 0);
		barrel(turret, 17, -4, 1.5);
	} else if (kind === 'vtol') {
		housing(hull, 'fuselage', [{ x: -30, y: 1, height: 8, width: 9 }, { x: -12, y: 1, height: 12, width: 13 }, { x: 16, y: 0, height: 9, width: 9 }, { x: 32, y: -3, height: 4, width: 4 }], steel);
		housing(hull, 'cockpit', [{ x: 0, y: 10, height: 4, width: 9 }, { x: 15, y: 7, height: 5, width: 7 }, { x: 27, y: 0, height: 3, width: 3 }], glass);
		housing(hull, 'dorsal-armor', [{ x: -28, y: 10, height: 3, width: 8 }, { x: -7, y: 14, height: 3, width: 10 }, { x: 2, y: 12, height: 2, width: 7 }], accent);
		for (const side of [-1, 1]) {
			const wing = group(hull, 'wing'); wing.position.z = side * 22;
			housing(wing, 'wing-panel', [{ x: -16, y: 1, height: 2.2, width: 13 }, { x: -5, y: 1, height: 2.2, width: 20 }, { x: 7, y: 0, height: 1.5, width: 13 }], steel);
			const nacelle = group(hull, 'tilt-nacelle'); nacelle.position.set(-7, 2, side * 43); nacelles.push(nacelle);
			const duct = parts.mesh(nacelle, 'fan-duct', parts.own(new TorusGeometry(15, 3.2, 5, 14)), steel); duct.rotation.x = Math.PI / 2;
			cylinder(nacelle, 'fan-hub', 4, 8, accent, 0, 0, 0);
			const fan = group(nacelle, 'lift-fan');
			for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) blade(fan, 12.8, 1.3, angle);
			rotors.push({ part: fan, axis: 'y', rate: side * 37 });
			cylinder(nacelle, 'fan-nozzle', 5, 5, recess, 0, -6, 0);
			vents.push(anchor(nacelle, 'engine-exhaust', 0, -9, 0));
			const fin = group(hull, 'tailplane'); fin.position.set(-27, 8, side * 11); fin.rotation.x = side * 0.5;
			housing(fin, 'tail-fin', [{ x: -7, y: 4, height: 9, width: 2 }, { x: 8, y: 1, height: 5, width: 2 }], accent);
			const pod = group(turret, side === -1 ? 'left-missile-pod' : 'right-missile-pod'); pod.position.set(3, -8, side * 19);
			housing(pod, 'pod-shell', [{ x: -16, y: 0, height: 6, width: 6 }, { x: 13, y: 0, height: 6, width: 6 }], dark);
			housing(pod, 'pod-armor', [{ x: -15, y: 4, height: 3, width: 7 }, { x: 11, y: 4, height: 3, width: 7 }], steel);
			const muzzle = anchor(pod, 'weapon-muzzle', 15, 0, 0);
			for (const row of [-1, 1]) for (const column of [-1, 1]) {
				parts.aperture(pod, 'missile-tube', 13.5, row * 2.8, column * 2.8, 2, 0.5);
				anchor(muzzle, 'rocket-tube', 0, row * 2.8, column * 2.8);
			}
			muzzles.push(muzzle);
		}
	} else {
		housing(hull, 'lower-hull', [{ x: -34, y: 11, height: 7, width: 17 }, { x: 22, y: 11, height: 8, width: 19 }, { x: 38, y: 14, height: 4, width: 17 }], dark);
		housing(hull, 'sloped-armor', [{ x: -33, y: 20, height: 7, width: 16 }, { x: 15, y: 23, height: 7, width: 19 }, { x: 39, y: 16, height: 3, width: 18 }], steel);
		housing(hull, 'front-glacis', [{ x: 22, y: 24, height: 2.5, width: 19 }, { x: 40, y: 17, height: 2.5, width: 18 }], accent);
		for (const side of [-1, 1]) {
			housing(hull, 'track-belt', [{ x: -39, y: 11, height: 7, width: 6 }, { x: -31, y: 11, height: 10, width: 6 }, { x: 29, y: 11, height: 10, width: 6 }, { x: 37, y: 11, height: 7, width: 6 }], recess, side * 25);
			housing(hull, 'track-guard', [{ x: -35, y: 23, height: 3, width: 7 }, { x: 32, y: 23, height: 3, width: 7 }], steel, side * 25);
			for (const x of [-29, -14, 1, 16, 29]) {
				const wheel = group(hull, 'road-wheel'); wheel.position.set(x, 10, side * 28); wheels.push(wheel);
				cylinder(wheel, 'wheel-rim', 7, 2.5, dark, 0, 0, 0, 'z');
				cylinder(wheel, 'wheel-hub', 3.5, 3, trim, 0, 0, side, 'z');
				housing(wheel, 'wheel-spoke', [{ x: -5.5, y: 0, height: 1, width: 1.7 }, { x: 5.5, y: 0, height: 1, width: 1.7 }], steel);
			}
			for (let index = 0; index < 12; index++) for (const y of [1.5, 20]) cylinder(hull, 'track-cleat', 1.1, 12, dark, -33 + index * 6, y, side * 25, 'z');
		}
		for (const x of [-24, -16, -8]) housing(hull, 'engine-grille', [{ x, y: 28, height: 0.8, width: 8 }, { x: x + 3, y: 28, height: 0.8, width: 8 }], recess);
		turret.position.set(0, 29, 0);
		cylinder(turret, 'turret-bearing', 16, 5, dark, 0, 0, 0);
		housing(turret, 'turret-armor', [{ x: -21, y: 8, height: 7, width: 13 }, { x: 4, y: 11, height: 9, width: 15 }, { x: 19, y: 7, height: 6, width: 11 }], steel);
		housing(turret, 'mantlet', [{ x: 14, y: 7, height: 6, width: 7 }, { x: 22, y: 7, height: 5, width: 6 }], accent);
		cylinder(turret, 'commander-hatch', 6, 2, trim, -6, 21, 0);
		cylinder(turret, 'radio-aerial', 0.7, 22, dark, -15, 23, -8);
		barrel(turret, 45, 7, 2.3);
	}
	anatomy.position.y = kind === 'helicopter' ? 100 : kind === 'vtol' ? 135 : 0;
	const assemblies = muzzles.map(function (muzzle) {
		const part = muzzle.parent; if (!(part instanceof Group)) throw new Error('Vehicle muzzle must belong to an articulated assembly');
		return { part, muzzle };
	});
	const poseWeapons = articulateWeapons(root, assemblies, getEnemyWeaponRig(kind));
	parts.batch(root);
	const bounds: { part: Mesh; corners: Vector3[] }[] = [];
	root.traverse(function (object) {
		if (!(object instanceof Mesh)) return;
		object.geometry.computeBoundingBox(); const box: Box3 | null = object.geometry.boundingBox;
		if (!box) return;
		bounds.push({ part: object, corners: [box.min.x, box.max.x].flatMap(function (x) { return [box.min.y, box.max.y].flatMap(function (y) { return [box.min.z, box.max.z].map(function (z) { return new Vector3(x, y, z); }); }); }) });
	});
	const muzzlePositions = muzzles.map(function () { return new Vector3(); });
	const rocketTubes = muzzles.map(function (muzzle) { return muzzle.children.filter(function (child) { return child.name === 'rocket-tube'; }); });
	const rocketPositions = rocketTubes.map(function (tubes) { return tubes.map(function () { return new Vector3(); }); });
	const exhaust = new Vector3(); const vertex = new Vector3(); const up = new Vector3(0, 1, 0);
	const inverseRoot = new Matrix4(); const relative = new Matrix4();
	const turretPosition = turret.position.clone(); let labelHeight = 0; let disposed = false;
	let previousPose: { time: number; x: number; y: number } | undefined; let wheelPhase = 0;
	return {
		root,
		get muzzles(): readonly Vector3[] { return muzzlePositions; },
		get rocketMuzzles(): readonly (readonly Vector3[])[] { return rocketPositions; },
		get exhaust(): Vector3 | undefined { return vents.length > 0 ? exhaust : undefined; },
		get labelHeight(): number { return labelHeight; },
		pose: function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			const time = feedback?.time ?? 0;
			const flying = kind !== 'tank'; const altitude = kind === 'helicopter' ? 100 : kind === 'vtol' ? 135 : 0;
			anatomy.position.y = altitude + (flying ? Math.sin(time * 2.4) * 2.8 : 0);
			hull.rotation.y = -gait.body.angle;
			hull.rotation.z = flying ? gait.motion.pitch * 0.7 : 0;
			hull.rotation.x = flying ? gait.motion.roll * 0.7 : 0;
			turret.rotation.y = -heading;
			turret.position.copy(turretPosition);
			if (kind === 'helicopter') turret.position.applyAxisAngle(up, -gait.body.angle);
			poseWeapons(gait.body, heading, feedback?.target);
			for (const rotor of rotors) rotor.part.rotation[rotor.axis] = time * rotor.rate;
			for (const nacelle of nacelles) nacelle.rotation.z = -0.15 + Math.sin(time * 0.8) * 0.045;
			if (kind === 'tank' && previousPose && time > previousPose.time) {
				const dx = gait.body.x - previousPose.x; const dy = gait.body.y - previousPose.y;
				const direction = Math.sign(dx * Math.cos(gait.body.angle) + dy * Math.sin(gait.body.angle));
				wheelPhase -= Math.min(80, Math.hypot(dx, dy)) * direction / 7;
			} else if (previousPose && time < previousPose.time) wheelPhase = 0;
			previousPose = { time, x: gait.body.x, y: gait.body.y };
			for (const wheel of wheels) wheel.rotation.z = wheelPhase;
			for (const sleeve of recoilSleeves) sleeve.position.x = -(feedback?.recoil ?? 0) * (kind === 'tank' ? 6 : 2);
			parts.solid.emissive.set('#ffae73'); parts.solid.emissiveIntensity = (feedback?.hit ?? 0) * 0.8;
			root.updateMatrixWorld(true); inverseRoot.copy(root.matrixWorld).invert();
			for (const [index, muzzle] of muzzles.entries()) muzzlePositions[index]?.setFromMatrixPosition(muzzle.matrixWorld).applyMatrix4(inverseRoot);
			for (const [slot, tubes] of rocketTubes.entries()) for (const [index, tube] of tubes.entries()) rocketPositions[slot]?.[index]?.setFromMatrixPosition(tube.matrixWorld).applyMatrix4(inverseRoot);
			exhaust.set(0, 0, 0);
			for (const vent of vents) exhaust.add(vertex.setFromMatrixPosition(vent.matrixWorld).applyMatrix4(inverseRoot));
			if (vents.length > 0) exhaust.divideScalar(vents.length);
			labelHeight = 0;
			for (const bound of bounds) {
				relative.multiplyMatrices(inverseRoot, bound.part.matrixWorld);
				for (const corner of bound.corners) { vertex.copy(corner).applyMatrix4(relative); labelHeight = Math.max(labelHeight, vertex.y - (vertex.x + vertex.z) * 0.5); }
			}
		},
		dispose: function () { if (disposed) return; disposed = true; parts.dispose(); root.removeFromParent(); root.clear(); },
	};
};
