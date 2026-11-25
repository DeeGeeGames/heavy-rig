import { Group, Object3D, Vector3, type Plane } from 'three';
import { EMPLACEMENT_BARREL_LENGTH, EMPLACEMENT_PITCH, EMPLACEMENT_PIVOT_HEIGHT } from './artillery-emplacement-rig';
import type { FieldTerrain } from './field-terrain';
import type { WalkerGait } from './gait';
import { createLowPolyParts, type LowPolyParts } from './low-poly-parts';
import type { MechFeedback } from './mech-3d';
import type { Point, Wreck } from './simulation';
import { groundHeight, groundNormal } from './terrain-elevation';

const gunPalette = { steel: '#a35d43', accent: '#e1aa5b', trim: '#9f9c8d', glass: '#ffb673' };
const up = new Vector3(0, 1, 0);
const slope = new Vector3();

// The footings and anchor bolts sit on the grade. The spindle above them
// stays vertical so the bore has the same elevation on every hillside.
const buildFoundation = function (parts: LowPolyParts, root: Group) {
	const { group, cylinder, housing, trim, dark, recess, piston } = parts;
	const base = group(root, 'emplacement-foundation');
	cylinder(base, 'concrete-caisson', 36, 22, trim, 0, -6, 0);
	for (let i = 0; i < 4; i++) {
		const azimuth = Math.PI * (.25 + .5 * i);
		const foot = housing(base, 'concrete-footing', [
			{ x: 18, y: -3, height: 11, width: 12 }, { x: 36, y: -4, height: 11, width: 10 }, { x: 46, y: -6, height: 10, width: 7 },
		], trim);
		foot.rotation.y = -azimuth;
		const x = 36 * Math.cos(azimuth), z = 36 * Math.sin(azimuth);
		cylinder(base, 'anchor-plate', 6, 2, dark, x, 8, z);
		cylinder(base, 'foundation-bolt', 3, 3, piston, x, 10, z);
	}
	cylinder(root, 'bearing-plinth', 25, 27, dark, 0, 2, 0);
	cylinder(root, 'traverse-race', 26, 4, recess, 0, 15, 0);
	return base;
};
const groundFoundation = function (base: Object3D, terrain: FieldTerrain | undefined, at: Point) {
	const normal = groundNormal(terrain, at);
	base.quaternion.setFromUnitVectors(up, slope.set(normal.x, normal.elevation, normal.y));
};

export const createArtilleryEmplacement = function (entryPlanes?: Plane[]) {
	const root = new Group(); root.name = 'artillery-emplacement';
	const parts = createLowPolyParts(gunPalette);
	if (entryPlanes) for (const material of [parts.solid, parts.glass]) {
		material.clippingPlanes = entryPlanes; material.clipShadows = true;
	}
	const { group, cylinder, housing, steel, accent, trim, dark, recess, piston, glass } = parts;
	const base = buildFoundation(parts, root);
	const carriage = group(root, 'artillery-carriage');
	cylinder(carriage, 'traverse-table', 25, 6, steel, 0, 20, 0);
	housing(carriage, 'rear-drive', [
		{ x: -29, y: 25, height: 6, width: 13 }, { x: -19, y: 25, height: 8, width: 18 }, { x: -6, y: 23, height: 5, width: 16 },
	], dark);
	for (const side of [-1, 1]) {
		const lateral = side * 15;
		housing(carriage, 'trunnion-cheek', [
			{ x: -21, y: 25, height: 6, width: 3 }, { x: -5, y: 34, height: 13, width: 4 },
			{ x: 7, y: 34, height: 12, width: 4.5 }, { x: 21, y: 25, height: 5, width: 4 },
		], steel, lateral);
		cylinder(carriage, 'trunnion-cap', 7, 5, accent, 0, EMPLACEMENT_PIVOT_HEIGHT, side * 19, 'z');
		cylinder(carriage, 'trunnion-pin', 3.4, 6, dark, 0, EMPLACEMENT_PIVOT_HEIGHT, side * 20, 'z');
		cylinder(carriage, 'drive-indicator', 2.5, 3, glass, -22, 30, side * 14, 'z');
	}
	const cradle = group(carriage, 'artillery-gun-cradle');
	cradle.position.y = EMPLACEMENT_PIVOT_HEIGHT; cradle.rotation.z = EMPLACEMENT_PITCH;
	cylinder(cradle, 'barrel-guide', 8.7, 24, dark, 10, 0, 0, 'x');
	for (const side of [-1, 1]) {
		cylinder(cradle, 'recoil-cylinder', 3.5, 26, steel, -1, -3, side * 8.5, 'x');
		cylinder(cradle, 'recoil-piston', 2, 15, piston, 18, -3, side * 8.5, 'x');
	}
	const slide = group(cradle, 'artillery-barrel-slide');
	housing(slide, 'breech', [
		{ x: -23, y: 0, height: 8, width: 9 }, { x: -16, y: 0, height: 10, width: 10 }, { x: 6, y: 0, height: 7, width: 7 },
	], dark);
	cylinder(slide, 'barrel', 5.1, 72, dark, 36, 0, 0, 'x');
	cylinder(slide, 'barrel-jacket', 6.8, 27, steel, 30, 0, 0, 'x');
	cylinder(slide, 'jacket-collar', 7.2, 4, trim, 42, 0, 0, 'x');
	const length = EMPLACEMENT_BARREL_LENGTH;
	housing(slide, 'muzzle-brake', [
		{ x: length - 17, y: 0, height: 5.4, width: 5.6 }, { x: length - 13, y: 0, height: 6.7, width: 8.4 },
		{ x: length - 1, y: 0, height: 6.7, width: 8.4 },
	], accent);
	for (const side of [-1, 1]) for (const x of [length - 11, length - 6]) {
		housing(slide, 'brake-vent', [{ x: x - 1.2, y: 0, height: 3.4, width: .25 }, { x: x + 1.2, y: 0, height: 3.4, width: .25 }], recess, side * 8.4);
	}
	parts.aperture(slide, 'bore', length - .72, 0, 0, 4.7, 1.25);
	const muzzle = new Object3D(); muzzle.name = 'weapon-muzzle'; muzzle.position.x = length; slide.add(muzzle);
	parts.batch(root);
	parts.solid.emissive.set('#ffae73');
	const muzzlePosition = new Vector3(); const muzzles = [muzzlePosition]; const rocketMuzzles: readonly (readonly Vector3[])[] = [[]];
	let labelHeight = 0; let disposed = false;
	return {
		root, muzzles, rocketMuzzles, exhaust: undefined,
		get labelHeight(): number { return labelHeight; },
		pose: function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			groundFoundation(base, feedback?.terrain, gait.body);
			carriage.rotation.y = -heading;
			slide.position.x = -(feedback?.response?.mounts.get(0)?.distance ?? 0);
			parts.solid.emissiveIntensity = Math.max(feedback?.hit ?? 0, feedback?.response?.flash ?? 0) * .8;
			muzzle.getWorldPosition(muzzlePosition); root.worldToLocal(muzzlePosition);
			labelHeight = Math.max(55, muzzlePosition.y - (muzzlePosition.x + muzzlePosition.z) * .5 + 9);
		},
		dispose: function () { if (disposed) return; disposed = true; parts.dispose(); root.removeFromParent(); root.clear(); },
	};
};

// Every destroyed gun uses these same batched castings. Each scene instance
// retains only the transforms for its own slope and final traverse angle.
export const createArtilleryWreckAssets = function () {
	const root = new Group(); root.name = 'artillery-emplacement-wreck';
	const parts = createLowPolyParts(gunPalette);
	buildFoundation(parts, root);
	const remains = parts.group(root, 'wrecked-carriage');
	parts.cylinder(remains, 'seized-table', 24, 6, parts.dark, 0, 20, 0);
	parts.housing(remains, 'collapsed-breech', [
		{ x: -22, y: 27, height: 7, width: 12 }, { x: -6, y: 27, height: 10, width: 13 }, { x: 9, y: 23, height: 7, width: 8 },
	], parts.steel);
	const gun = parts.group(remains, 'collapsed-barrel'); gun.position.set(0, 24, 0); gun.rotation.z = -.27;
	parts.cylinder(gun, 'burnt-barrel', 5, 70, parts.dark, 35, 0, 0, 'x');
	parts.cylinder(gun, 'twisted-jacket', 7, 20, parts.steel, 14, 0, 0, 'x');
	parts.cylinder(gun, 'spent-muzzle-brake', 7, 11, parts.dark, 69, 0, 0, 'x');
	parts.batch(root);
	return {
		create: function () {
			const instance = root.clone();
			const base = instance.getObjectByName('emplacement-foundation'), carriage = instance.getObjectByName('wrecked-carriage');
			if (!base || !carriage) throw new Error('Missing wrecked artillery assemblies');
			return {
				root: instance,
				place: function (terrain: FieldTerrain | undefined, wreck: Wreck) {
					instance.position.set(wreck.x, groundHeight(terrain, wreck), wreck.y);
					groundFoundation(base, terrain, wreck); carriage.rotation.y = -wreck.angle;
				},
			};
		},
		dispose: parts.dispose,
	};
};
