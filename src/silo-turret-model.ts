import { Group, MathUtils, Object3D, Vector3 } from 'three';
import { getWeapon, type WeaponDefinition, type WeaponId } from './arsenal';
import type { WalkerGait } from './gait';
import { createLowPolyParts, type LowPolyParts } from './low-poly-parts';
import type { MechFeedback } from './mech-3d';
import { SILO_HEAD_HEIGHT, siloLiftOffset, siloWeaponRig } from './silo-turret-rig';
import { weaponDirection, type WeaponRig } from './weapon-rig';

const palette = { steel: '#a26350', accent: '#d5aa68', trim: '#8c9994', glass: '#ffab62' };

const buildHatch = function (parts: LowPolyParts, root: Group) {
	const { group, cylinder, housing, trim, steel, accent, dark, recess } = parts;
	housing(root, 'concrete-apron', [
		{ x: -46, y: -2, height: 3, width: 36 }, { x: -37, y: -2, height: 3, width: 46 },
		{ x: 37, y: -2, height: 3, width: 46 }, { x: 46, y: -2, height: 3, width: 36 },
	], trim);
	housing(root, 'shaft-opening', [{ x: -34, y: 1, height: .8, width: 32 }, { x: 34, y: 1, height: .8, width: 32 }], recess);
	const doors = [-1, 1].map(function (side) {
		const outer = group(root, 'outer-hatch-leaf'), inner = group(outer, 'inner-hatch-leaf');
		outer.position.set(0, 3, side * 31);
		inner.position.z = -side * 15.5;
		for (const leaf of [outer, inner]) {
			housing(leaf, 'steel-door', [
				{ x: -32, y: 0, height: 1.1, width: 6.9 }, { x: -28, y: 0, height: 1.4, width: 7.4 },
				{ x: 28, y: 0, height: 1.4, width: 7.4 }, { x: 32, y: 0, height: 1.1, width: 6.9 },
			], dark, -side * 7.75);
			housing(leaf, 'armored-panel', [{ x: -26, y: 1.1, height: .8, width: 4.5 }, { x: 26, y: 1.1, height: .8, width: 4.5 }], trim, -side * 7.75);
			for (const x of [-23, 23]) cylinder(leaf, 'door-hinge', 1.7, 9, steel, x, 0, 0, 'x');
		}
		housing(root, 'hatch-sill', [{ x: -39, y: 1, height: 2.3, width: 2.7 }, { x: 39, y: 1, height: 2.3, width: 2.7 }], dark, side * 36.5);
		for (const x of [-30, 30]) {
			housing(root, 'corner-marker', [{ x: x - 5, y: 1.3, height: .8, width: 2 }, { x: x + 5, y: 1.3, height: .8, width: 2 }], accent, side * 41);
		}
		return { outer, inner, side };
	});
	return function (open: number) {
		for (const { outer, inner, side } of doors) {
			const angle = side * open * Math.PI * .47;
			outer.rotation.x = angle;
			inner.rotation.x = -2 * angle;
		}
	};
};

const buildWeapon = function (parts: LowPolyParts, slide: Group, weapon: WeaponDefinition, rig: WeaponRig) {
	const { housing, cylinder, aperture, steel, accent, trim, dark, recess, glass } = parts;
	const length = rig.muzzle.x;
	if (weapon.family === 'launcher') {
		const width = Math.max(...rig.tubes.map(function (tube) { return Math.abs(tube.y); })) + 4.5;
		const height = Math.max(...rig.tubes.map(function (tube) { return Math.abs(tube.elevation); })) + 4.5;
		const guided = weapon.kind === 'missile';
		housing(slide, 'launcher-cassette', [
			{ x: -7, y: 0, height, width: width * .85 }, { x: 0, y: 0, height: height + 1, width: width + 1 },
			{ x: guided ? length - 2 : length - 12, y: 0, height: height + 1, width: width + 1 },
		], guided ? steel : dark);
		for (const tube of rig.tubes) {
			cylinder(slide, 'launch-tube', 3.7, 15, guided ? dark : trim, length - 8, tube.elevation, tube.y, 'x');
			aperture(slide, 'tube-exit', length - .65, tube.elevation, tube.y, 2.7, .8);
		}
		return;
	}
	if (weapon.family === 'energy') {
		const charged = weapon.kind === 'ppc';
		housing(slide, 'emitter-housing', [
			{ x: -8, y: 0, height: 6, width: 8 }, { x: 5, y: 0, height: 8, width: 10 },
			{ x: length - 4, y: 0, height: charged ? 4 : 5, width: charged ? 4 : 7 },
		], steel);
		if (charged) {
			for (const x of [13, 20, 27]) cylinder(slide, 'accelerator-coil', 8.5, 3.4, trim, x, 0, 0, 'x');
		} else {
			for (const side of [-1, 1]) cylinder(slide, 'cooling-rail', 2.3, 22, trim, 13, 2.4, side * 8, 'x');
		}
		cylinder(slide, 'optic-collar', charged ? 5.5 : 7, 5, recess, length - 2.6, 0, 0, 'x');
		cylinder(slide, 'emitter-lens', charged ? 3.2 : 4.8, .8, glass, length - .4, 0, 0, 'x');
		return;
	}
	const cannon = weapon.kind === 'cannon';
	cylinder(slide, 'gun-tube', cannon ? 3.8 : 2.5, length, dark, length / 2, 0, 0, 'x');
	cylinder(slide, 'barrel-jacket', cannon ? 6 : 4.5, cannon ? 18 : 24, steel, 12, 0, 0, 'x');
	if (cannon) {
		housing(slide, 'muzzle-brake', [{ x: length - 8, y: 0, height: 4, width: 5.5 }, { x: length - .7, y: 0, height: 4.3, width: 5.5 }], trim);
	} else {
		cylinder(slide, 'feed-drum', 7, 8, accent, 0, 0, 8, 'z');
		for (const x of [8, 14, 20]) cylinder(slide, 'cooling-ring', 5.2, 2.4, dark, x, 0, 0, 'x');
	}
	aperture(slide, 'bore', length - .65, 0, 0, cannon ? 2.8 : 1.6, .7);
};

export const createSiloTurret = function (weaponId: WeaponId) {
	const weapon = getWeapon(weaponId), rig = siloWeaponRig(weapon);
	const root = new Group(); root.name = 'silo-turret';
	const parts = createLowPolyParts({ ...palette, glass: weapon.family === 'energy' ? weapon.color : palette.glass });
	const { group, housing, cylinder, steel, accent, trim, dark, piston, glass } = parts;
	const foldDoors = buildHatch(parts, root);
	const lift = group(root, 'silo-lift');
	const swivel = group(lift, 'turret-carriage');
	cylinder(lift, 'elevator-ram', 10, 32, piston, 0, 7, 0);
	cylinder(lift, 'bearing-race', 17, 7, dark, 0, 23, 0);
	cylinder(swivel, 'traverse-table', 18, 4, steel, 0, 27, 0);
	for (const side of [-1, 1]) {
		housing(swivel, 'yoke-cheek', [
			{ x: -18, y: 33, height: 4, width: 3 }, { x: -9, y: 36, height: 8, width: 4.5 },
			{ x: 6, y: 36, height: 8, width: 4.5 }, { x: 14, y: 33, height: 4, width: 3 },
		], steel, side * 15.5);
		cylinder(swivel, 'trunnion-pin', 4.5, 3, accent, 0, rig.pivot.elevation, side * 20, 'z');
	}
	housing(swivel, 'sight-hood', [{ x: -17, y: 42, height: 3, width: 4 }, { x: -12, y: 44, height: SILO_HEAD_HEIGHT - 44, width: 4.5 }, { x: -5, y: 44, height: 3, width: 4 }], trim, -14.5);
	cylinder(swivel, 'rangefinder', 2.4, 2, glass, -5.5, 44, -14.5, 'x');
	const mount = group(swivel, 'weapon-cradle'); mount.position.y = rig.pivot.elevation;
	const slide = group(mount, 'weapon-slide');
	buildWeapon(parts, slide, weapon, rig);
	const muzzle = new Object3D(); muzzle.name = 'weapon-muzzle'; muzzle.position.x = rig.muzzle.x; slide.add(muzzle);
	const exits = rig.tubes.map(function (tube) {
		const exit = new Object3D(); exit.name = 'rocket-tube'; exit.position.set(tube.x, tube.elevation, tube.y); muzzle.add(exit); return exit;
	});
	parts.batch(root);
	parts.solid.emissive.set('#ffae73'); parts.solid.emissiveIntensity = 0;
	const muzzlePosition = new Vector3(), tubePositions = exits.map(function () { return new Vector3(); });
	let labelHeight = 0, disposed = false;
	lift.visible = false;
	return {
		root, muzzles: [muzzlePosition], rocketMuzzles: [tubePositions], exhaust: undefined,
		get labelHeight() { return labelHeight; },
		pose: function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			const deployment = feedback?.siloDeployment ?? 0;
			foldDoors(MathUtils.smoothstep(deployment, 0, .44));
			lift.position.y = siloLiftOffset(deployment);
			lift.visible = SILO_HEAD_HEIGHT + lift.position.y > 0;
			swivel.rotation.y = -heading;
			const direction = feedback?.mountDirections?.get(0) ?? weaponDirection(rig, gait.body, heading, feedback?.target);
			const extend = MathUtils.smoothstep(deployment, .76, 1);
			mount.rotation.set(0, heading - Math.atan2(direction.y, direction.x), extend * Math.atan2(direction.elevation, Math.hypot(direction.x, direction.y)), 'YXZ');
			slide.position.x = -12 * (1 - extend);
			root.worldToLocal(muzzle.getWorldPosition(muzzlePosition));
			labelHeight = Math.max(20, SILO_HEAD_HEIGHT + lift.position.y + 8, muzzlePosition.y - (muzzlePosition.x + muzzlePosition.z) * .5 + 6);
			exits.forEach(function (exit, index) {
				const position = tubePositions[index];
				if (position) root.worldToLocal(exit.getWorldPosition(position));
			});
			slide.position.x -= feedback?.response?.mounts.get(0)?.distance ?? 0;
			parts.solid.emissiveIntensity = Math.max(feedback?.hit ?? 0, feedback?.response?.flash ?? 0) * .75;
		},
		dispose: function () { if (disposed) return; disposed = true; parts.dispose(); root.removeFromParent(); root.clear(); },
	};
};

export const createSiloWreck = function () {
	const root = new Group(); root.name = 'silo-turret-wreck';
	const parts = createLowPolyParts(palette);
	buildHatch(parts, root)(1);
	const remains = parts.group(root, 'burnt-turret');
	parts.cylinder(remains, 'jammed-bearing', 15, 6, parts.dark, 0, 5, 0);
	const casing = parts.housing(remains, 'broken-carriage', [
		{ x: -17, y: 11, height: 4, width: 8 }, { x: -5, y: 13, height: 8, width: 13 }, { x: 8, y: 7, height: 4, width: 6 },
	], parts.steel);
	casing.rotation.z = -.17;
	const stub = parts.cylinder(remains, 'sheared-trunnion', 5.7, 18, parts.dark, 12, 8, -3, 'x'); stub.rotation.z -= .22;
	parts.batch(root);
	return { root, remains, dispose: parts.dispose };
};
