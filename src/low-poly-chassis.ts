import { Group, type MeshStandardMaterial, type Object3D } from 'three';
import { getFrame, type FrameId } from './frames';
import { getHardpoints } from './hardpoints';
import type { WeaponFamily } from './arsenal';
import type { LowPolyParts } from './low-poly-parts';
import type { EnemyKind } from './simulation';

// Armor sections describe actual slopes and clipped silhouettes. All positions
// are in chassis units; the production adapter owns scale and articulation.
export const buildLowPolyChassis = function (parts: LowPolyParts, turret: Group, frame: FrameId, kind?: EnemyKind, commander = false) {
	const chassis = getFrame(frame).chassisId;
	const familyAt = function (slot: number): WeaponFamily {
		const hardpoint = getHardpoints(frame)[slot];
		if (!hardpoint) throw new RangeError(`Missing model hardpoint ${frame}/${slot}`);
		return hardpoint.family;
	};
	const { housing, cylinder, aperture, group, steel, accent, dark, trim, recess, glass } = parts;
	const slides: Group[] = []; const muzzles: Object3D[] = []; const pods: Object3D[] = []; const vents: Object3D[] = [];
	const shutters: { part: Group; y: number }[] = [];
	const anchor = function (parent: Group, name: string, x: number, y: number, z: number) {
		const value = group(parent, name); value.position.set(x, y, z); return value;
	};
	const launchTube = function (parent: Group, x: number, y: number, z: number, radius: number, rim: number) {
		aperture(parent, 'launch-tube', x, y, z, radius, rim);
		anchor(parent, 'launch-tube', x + 0.12, y, z);
	};
	const casting = function (parent: Group, name: string, x: number, y: number, z: number, length: number, height: number, width: number, material: MeshStandardMaterial) {
		return housing(parent, name, [
			{ x: x - length * 0.5, y, height: height * 0.32, width: width * 0.36 },
			{ x: x - length * 0.16, y: y + height * 0.04, height: height * 0.5, width: width * 0.5 },
			{ x: x + length * 0.5, y: y - height * 0.03, height: height * 0.37, width: width * 0.39 },
		], material, z);
	};
	const vent = function (x: number, y: number, z: number, count: number) {
		for (let index = 0; index < count; index++) housing(turret, 'cooling-louver', [
			{ x: x - 0.4, y: y + index * 4, height: 0.65, width: 4.5 },
			{ x: x + 0.7, y: y + index * 4 + 0.6, height: 0.65, width: 4.5 },
		], trim, z);
		vents.push(anchor(turret, 'cooling-vent', x - 0.7, y + (count - 1) * 4, z));
	};
	const gun = function (z: number, y: number, length: number, radius: number, center = 21) {
		casting(turret, 'gun-cradle', center - length * 0.4, y, z, 24, radius * 4.3, radius * 4.7, steel);
		const slide = group(turret, z < 0 ? 'left-gun-slide' : 'right-gun-slide');
		const sleeve = group(slide, 'recoil-sleeve'); slides.push(sleeve);
		cylinder(slide, 'octagonal-barrel', radius, length, dark, center, y, z, 'x');
		cylinder(sleeve, 'barrel-collar', radius * 1.36, 3.5, accent, center - length * 0.32, y, z, 'x');
		const tip = center + length * 0.5 + 5;
		housing(slide, 'muzzle-brake', [
			{ x: tip - 9.5, y, height: radius * 1.2, width: radius * 1.35 },
			{ x: tip - 7, y, height: radius * 1.65, width: radius * 1.65 },
			{ x: tip, y, height: radius * 1.45, width: radius * 1.45 },
		], trim, z);
		aperture(slide, 'gun-bore', tip + 0.05, y, z, radius * 0.92, 0.45);
		muzzles.push(anchor(slide, 'weapon-muzzle', tip + 0.7, y, z));
		return slide;
	};
	const moduleFace = function (parent: Group, family: 'ballistic' | 'energy', x: number, y: number, z: number, width: number) {
		if (family === 'energy') {
			cylinder(parent, 'emitter-collar', width * 0.4, 8, dark, x + 1, y, z, 'x');
			for (const offset of [-2, 2, 6]) cylinder(parent, 'emitter-coil', width * 0.46, 1.6, accent, x + offset, y, z, 'x');
			cylinder(parent, 'emitter-face', width * 0.34, 1, recess, x + 7, y, z, 'x');
			cylinder(parent, 'emitter-lens', width * 0.25, 0.5, glass, x + 7.8, y, z, 'x');
			return anchor(parent, 'weapon-muzzle', x + 8.2, y, z);
		}
		for (const offset of [-1, 0, 1]) {
			const lateral = z + offset * width * 0.29;
			cylinder(parent, 'array-barrel', width * 0.095, 19, dark, x + 6, y, lateral, 'x');
			cylinder(parent, 'array-collar', width * 0.135, 2, trim, x + 12, y, lateral, 'x');
			aperture(parent, 'array-bore', x + 15.6, y, lateral, width * 0.075, 0.35);
		}
		return anchor(parent, 'weapon-muzzle', x + 16.1, y, z);
	};
	const energyGun = function (z: number, y: number, compact = false, center = 20) {
		const radius = compact ? 3.4 : 5;
		casting(turret, 'energy-cradle', center - 11, y, z, 25, radius * 3, radius * 3, steel);
		const slide = group(turret, z < 0 ? 'left-energy-slide' : 'right-energy-slide');
		const sleeve = group(slide, 'recoil-sleeve'); slides.push(sleeve);
		cylinder(sleeve, 'accelerator-body', radius, compact ? 25 : 37, dark, center, y, z, 'x');
		muzzles.push(moduleFace(slide, 'energy', center + (compact ? 10 : 16), y, z, radius * 2));
		return slide;
	};
	const compactLauncher = function (z: number, y: number, center = 14) {
		const pod = group(turret, 'compact-launcher');
		casting(pod, 'compact-pod-casing', center, y, z, 29, 13, 17, steel);
		casting(pod, 'compact-pod-cap', center - 1, y + 7, z, 24, 2.2, 14, accent);
		const front = center + 14.6;
		for (const side of [-1, 1]) launchTube(pod, front, y, z + side * 3.7, 2.5, 0.65);
		const muzzle = anchor(pod, 'weapon-muzzle', front + 0.7, y, z);
		for (const side of [-1, 1]) anchor(muzzle, 'rocket-tube', 0, 0, side * 3.7);
		const shutter = group(pod, 'compact-shutter');
		casting(shutter, 'shutter-armor', center + 14.6, y + 8, z, 2, 2, 12, accent);
		shutters.push({ part: shutter, y: 0 });
		muzzles.push(muzzle);
		return pod;
	};
	const rack = function (z: number, bottom: number, width: number, rows: number, x = -12, family: WeaponFamily = 'launcher') {
		const pod = group(turret, 'salvo-pod');
		const y = bottom + rows * 4 + 5;
		housing(pod, 'salvo-casing', [
			{ x: x - 17, y: y - 1, height: rows * 4 + 2, width: width * 0.38 },
			{ x: x - 7, y: y + 1, height: rows * 4 + 6, width: width * 0.58 },
			{ x: x + 15, y, height: rows * 4 + 4, width: width * 0.53 },
		], steel, z);
		housing(pod, 'salvo-cap', [
			{ x: x - 13, y: bottom + rows * 8 + 10.5, height: 1.3, width: width * 0.4 },
			{ x: x - 5, y: bottom + rows * 8 + 12.6, height: 1.5, width: width * 0.55 },
			{ x: x + 14, y: bottom + rows * 8 + 9.5, height: 1.2, width: width * 0.47 },
		], accent, z);
		// Keep neighboring lips physically separate on the narrow gauntlet rack.
		const tubeRadius = Math.min(2.3, width / 6.8 - 0.85);
		if (family === 'launcher') {
			for (const column of [-1, 0, 1]) for (let row = 0; row < rows; row++) launchTube(pod, x + 15.05, bottom + 7 + row * 8, z + column * width / 3.4, tubeRadius, 0.7);
			const muzzle = anchor(pod, 'weapon-muzzle', x + 15.8, bottom + 7, z);
			for (const column of [-1, 0, 1]) for (let row = 0; row < rows; row++) anchor(muzzle, 'rocket-tube', 0, row * 8, column * width / 3.4);
			muzzles.push(muzzle);
		} else muzzles.push(moduleFace(pod, family, x + 15, y, z, width));
		const shutter = group(pod, 'salvo-shutter');
		casting(shutter, 'shutter-armor', x + 16.5, bottom + rows * 8 + 10, z, 2, 3, width * 0.8, accent);
		shutters.push({ part: shutter, y: 0 });
		return pod;
	};
	const cockpit = function (x: number, bottom: number, width: number, length: number, height: number) {
		housing(turret, 'cockpit-shell', [
			{ x: x - length * 0.5, y: bottom + height * 0.47, height: height * 0.34, width: width * 0.35 },
			{ x: x - length * 0.17, y: bottom + height * 0.55, height: height * 0.5, width: width * 0.52 },
			{ x: x + length * 0.5, y: bottom + height * 0.33, height: height * 0.33, width: width * 0.4 },
		], steel);
		const front = x + length * 0.5;
		housing(turret, 'visor-socket', [{ x: front - 2, y: bottom + height * 0.46, height: 3, width: width * 0.42 }, { x: front + 0.8, y: bottom + height * 0.43, height: 2.5, width: width * 0.37 }], recess);
		housing(turret, 'cockpit-visor', [{ x: front + 0.95, y: bottom + height * 0.45, height: 1.3, width: width * 0.31 }, { x: front + 1.45, y: bottom + height * 0.43, height: 1.15, width: width * 0.3 }], glass);
		housing(turret, 'canopy-brow', [
			{ x: x - length * 0.3, y: bottom + height + 1.6, height: 1.3, width: width * 0.38 },
			{ x: x + length * 0.08, y: bottom + height + 2, height: 1.5, width: width * 0.5 },
			{ x: front + 0.25, y: bottom + height * 0.72, height: 1.3, width: width * 0.42 },
		], trim);
	};
	const aerial = function (x: number, y: number, z: number, length: number) {
		cylinder(turret, 'antenna-base', 1.7, 3, dark, x, y, z);
		cylinder(turret, 'antenna', 0.65, length, dark, x, y + length * 0.5 + 1.5, z);
		cylinder(turret, 'antenna-tip', 1.1, 1.5, trim, x, y + length + 2, z);
	};

	if (kind || chassis === 'warden') {
		// The approved Warden study is the common line-frame language. Hostile
		// variants change hardware as well as palette and presentation scale.
		housing(turret, 'torso-shell', [
			{ x: -29, y: 63, height: 10, width: 17 }, { x: -12, y: 65, height: 14, width: 23 },
			{ x: 15, y: 63, height: 12, width: 21 }, { x: 35, y: 59.5, height: 7, width: 14 },
		], steel);
		housing(turret, 'canopy-brow', [{ x: -19, y: 78.3, height: 2.5, width: 16 }, { x: 7, y: 78.5, height: 3, width: 20 }, { x: 31.8, y: 72.7, height: 2, width: 16.2 }], trim);
		housing(turret, 'visor-socket', [{ x: 27, y: 70, height: 3.8, width: 16 }, { x: 33, y: 69.2, height: 2.7, width: 14.5 }], recess);
		housing(turret, 'cockpit-visor', [{ x: 33.15, y: 69.8, height: 1.25, width: 12.5 }, { x: 33.7, y: 69.65, height: 1.15, width: 12.4 }], glass);
		housing(turret, 'chin-intake', [{ x: 33.9, y: 58.4, height: 2.3, width: 9.8 }, { x: 35.6, y: 58.4, height: 2, width: 9.3 }], recess);
		housing(turret, 'reactor-pack', [{ x: -37, y: 63, height: 9, width: 13 }, { x: -25, y: 64, height: 12, width: 17 }], dark);
		for (const side of [-1, 1]) {
			housing(turret, 'cheek-inlay', [{ x: 8, y: 65.7, height: 1.3, width: 1 }, { x: 23, y: 63.8, height: 1.2, width: 1 }], accent, side * 21);
			vent(-37.3, 57, side * 7, 4);
			const z = side * 34;
			if (kind === 'scout') {
				casting(turret, 'sensor-shoulder', -12, 74, z, 25, 11, 16, accent);
				cylinder(turret, 'sensor-stalk', 1, 15, dark, -16, 86, z);
				casting(turret, 'sensor-head', -14, 94, z, 8, 3, 5, glass);
			} else {
				housing(turret, 'pod-support', [{ x: -23, y: 66, height: 7, width: 6 }, { x: -7, y: 71, height: 10, width: 7 }], dark, z);
				const pod = group(turret, 'shoulder-pod');
				housing(pod, 'missile-pod', [{ x: -29, y: 82, height: 8, width: 10 }, { x: -19, y: 83, height: 12, width: 13 }, { x: 2, y: 82.5, height: 10.5, width: 12 }], accent, z);
				housing(pod, 'pod-cap', [{ x: -27, y: 92.3, height: 1.4, width: 8 }, { x: -16, y: 95.6, height: 1.5, width: 11 }, { x: 1, y: 93.8, height: 1.2, width: 10.5 }], trim, z);
				if (kind || familyAt(side < 0 ? 2 : 3) === 'launcher') {
					for (const row of [-1, 1]) for (const column of [-1, 0, 1]) launchTube(pod, 2.05, 82.5 + row * 4.3, z + column * 7.1, 2.5, 0.75);
					const muzzle = anchor(pod, 'weapon-muzzle', 2.8, 78.2, z);
					for (const row of [0, 1]) for (const column of [-1, 0, 1]) anchor(muzzle, 'rocket-tube', 0, row * 8.6, column * 7.1);
					const shutter = group(pod, 'pod-shutter');
					casting(shutter, 'pod-shutter-armor', 2, 94, z, 2, 2, 18, trim);
					shutters.push({ part: shutter, y: 0 });
					pods.push(muzzle);
				} else {
					const emitter = group(pod, 'shoulder-energy-slide');
					const sleeve = group(emitter, 'recoil-sleeve'); slides.push(sleeve);
					cylinder(sleeve, 'emitter-recoil-collar', 8, 3, accent, 2, 82.5, z, 'x');
					pods.push(moduleFace(emitter, 'energy', 2, 82.5, z, 19));
				}
			}
			gun(z, 55.5, kind === 'siege' ? 48 : kind === 'scout' ? 20 : 31, 3.3);
			casting(turret, 'gun-mantlet', 6, 55.7, z, 6, 12.8, 14.8, trim);
		}
		aerial(-20, 80, -16, kind === 'scout' ? 26 : 19);
		if (kind === 'siege' || commander) {
			casting(turret, 'dorsal-artillery-cradle', -18, 90, 0, 34, 23, 26, dark);
			gun(0, commander ? 102 : 101, commander ? 49 : 62, commander ? 5.4 : 4.5, 3);
			for (const side of [-1, 1]) {
				housing(turret, 'siege-shoulder-shield', [{ x: 1, y: 60, height: 15, width: 4 }, { x: 13, y: 60, height: 22, width: 6 }, { x: 23, y: 56, height: 13, width: 4 }], steel, side * 49);
				casting(turret, 'shield-inlay', 23.3, 58, side * 49, 1.8, 20, 6, accent);
			}
		}
		if (commander) {
			for (const side of [-1, 1]) {
				housing(turret, 'command-crown', [{ x: -28, y: 86, height: 9, width: 3 }, { x: -11, y: 90, height: 13, width: 5 }, { x: 8, y: 86, height: 7, width: 3.5 }], trim, side * 49);
				aerial(-24, 94, side * 24, side < 0 ? 25 : 19);
			}
		}
	} else if (chassis === 'kestrel') {
		// Narrow beak and a raised counterweight tail over the avian legs.
		casting(turret, 'keel', -6, 59, 0, 30, 13, 21, dark);
		cockpit(12, 65, 22, 45, 12);
		housing(turret, 'beak-prow', [{ x: 14, y: 64, height: 5, width: 10 }, { x: 31, y: 62, height: 4.5, width: 8 }, { x: 45, y: 60, height: 1.7, width: 4 }], steel);
		housing(turret, 'beak-inlay', [{ x: 32, y: 64.3, height: 1.1, width: 6 }, { x: 44, y: 61.9, height: 0.8, width: 3.5 }], accent);
		housing(turret, 'counterweight-tail', [{ x: -39, y: 71, height: 3, width: 4 }, { x: -23, y: 68, height: 7, width: 8 }, { x: -8, y: 65, height: 5, width: 8 }], steel);
		for (const side of [-1, 1]) {
			const family = familyAt(side < 0 ? 0 : 1);
			if (family === 'ballistic') gun(side * 20, 59, 25, 2, 19);
			else if (family === 'energy') energyGun(side * 20, 59, true, 19);
			else compactLauncher(side * 20, 59, 19);
			casting(turret, 'wing-root', -9, 69, side * 14, 18, 9, 5, accent);
			housing(turret, 'tail-fin', [{ x: -39, y: 73, height: 2, width: 1 }, { x: -28, y: 80, height: 7, width: 1.5 }, { x: -17, y: 72, height: 2, width: 1 }], steel, side * 9);
			vent(-35.5, 64, side * 5, 2);
		}
	} else if (chassis === 'maul') {
		// Separate head, broad chest, and hanging gauntlets retain the brawler's
		// humanoid mass without reproducing the Warden's shoulder missile towers.
		casting(turret, 'abdomen', -3, 66, 0, 24, 18, 27, dark);
		housing(turret, 'breacher-chest', [{ x: -22, y: 82, height: 8, width: 17 }, { x: -4, y: 84, height: 13, width: 24 }, { x: 18, y: 81, height: 8, width: 19 }], steel);
		for (const side of [-1, 1]) {
			housing(turret, 'breastplate', [{ x: 9, y: 85, height: 8, width: 8 }, { x: 19.4, y: 84, height: 5, width: 7 }], steel, side * 11);
			casting(turret, 'breast-inlay', 20, 85, side * 11, 1, 3, 10, accent);
			housing(turret, 'pauldron', [{ x: -20, y: 91, height: 5, width: 7 }, { x: -4, y: 94, height: 10, width: 12 }, { x: 13, y: 89, height: 5, width: 9 }], steel, side * 34);
			housing(turret, 'pauldron-cap', [{ x: -16, y: 100, height: 1.5, width: 7 }, { x: -3, y: 104.8, height: 1.7, width: 11 }, { x: 10, y: 96, height: 1.4, width: 8 }], trim, side * 34);
			cylinder(turret, 'shoulder-bearing', 6.5, 12, dark, -3, 87, side * 33, 'z');
			casting(turret, 'upper-arm', -2, 75, side * 39, 17, 25, 13, dark);
			casting(turret, 'arm-armor', 2, 76, side * 42, 18, 17, 11, steel);
			cylinder(turret, 'elbow-bearing', 5, 16, dark, 3, 62, side * 41, 'z');
			rack(side * 41, 39, 19, 2, 10, familyAt(side < 0 ? 0 : 1));
			housing(turret, 'gauntlet-shield', [{ x: -2, y: 52, height: 8, width: 2 }, { x: 11, y: 54, height: 13, width: 3.5 }, { x: 25, y: 50, height: 9, width: 2 }], steel, side * 55);
			casting(turret, 'rear-reactor', -24, 81, side * 14, 15, 26, 14, dark);
			vent(-32.2, 73, side * 14, 4);
		}
		cylinder(turret, 'neck-bearing', 6, 6, dark, -2, 97, 0);
		cockpit(0, 101, 19, 22, 13);
		housing(turret, 'jaw-guard', [{ x: 8, y: 102, height: 2, width: 10 }, { x: 14, y: 102, height: 2, width: 8 }], accent);
	} else if (chassis === 'longbow') {
		// A narrow torso and one long accelerator arm, balanced by the cooling
		// pack and compact offhand rather than a matching second cannon.
		casting(turret, 'abdomen', -3, 78, 0, 20, 18, 20, dark);
		housing(turret, 'precision-chest', [{ x: -16, y: 97, height: 9, width: 10 }, { x: -2, y: 98, height: 14, width: 15 }, { x: 14, y: 96, height: 9, width: 11 }], steel);
		casting(turret, 'sternum-inlay', 14.5, 98, 0, 1.6, 3, 14, accent);
		cylinder(turret, 'neck-bearing', 4.5, 5, dark, -2, 112, 0);
		cockpit(0, 114, 16, 20, 13);
		aerial(-9, 129, -4, 7);
		casting(turret, 'rangefinder', -7, 138, -4, 12, 3, 4, glass);
		for (const side of [-1, 1]) {
			housing(turret, 'precision-pauldron', [{ x: -15, y: 102, height: 4, width: 5 }, { x: -4, y: 105, height: 8, width: 8 }, { x: 8, y: 101, height: 4, width: 6 }], steel, side * 23);
			cylinder(turret, 'shoulder-bearing', 4.5, 9, dark, -3, 100, side * 23, 'z');
			casting(turret, 'hanging-arm', -1, 87, side * 26, 12, 24, 10, dark);
			casting(turret, 'arm-armor', 3, 87, side * 27, 10, 17, 12, steel);
			cylinder(turret, 'elbow-bearing', 4.2, 12, dark, 3, 75, side * 26, 'z');
		}
		const accelerator = gun(-27, 72, 81, 3.5, 25);
		if (familyAt(0) === 'energy') for (const x of [4, 15, 26, 37]) cylinder(accelerator, 'accelerator-coil', 5.5, 3.2, accent, x, 72, -27, 'x');
		if (getHardpoints(frame).length === 1) {
			casting(turret, 'offhand-gauntlet', 5, 66, 27, 18, 22, 15, steel);
			casting(turret, 'offhand-palm', 9, 58, 27, 14, 6, 11, dark);
		} else {
			casting(turret, 'auxiliary-brace', -2, 74, 27, 22, 13, 17, dark);
			if (familyAt(1) === 'energy') energyGun(27, 65, true, 13);
			else compactLauncher(27, 65, 13);
		}
		housing(turret, 'cooling-pack', [{ x: -33, y: 99, height: 11, width: 6 }, { x: -23, y: 100, height: 17, width: 10 }, { x: -13, y: 100, height: 12, width: 7 }], dark, 15);
		for (const z of [9, 15, 21]) housing(turret, 'radiator-fin', [{ x: -35, y: 100, height: 12, width: 0.8 }, { x: -23, y: 101, height: 16, width: 0.8 }, { x: -12, y: 101, height: 11, width: 0.8 }], trim, z);
		casting(turret, 'radiator-cap', -23, 117.8, 15, 23, 3, 18, accent);
		vent(-16, 91, -6, 4);
	} else if (chassis === 'morrow') {
		// The low bridge remains visibly below the twin outboard silos, leaving
		// open space above its center instead of a humanoid head or arms.
		housing(turret, 'carrier-keel', [{ x: -30, y: 50, height: 4, width: 15 }, { x: -10, y: 50, height: 7, width: 23 }, { x: 16, y: 49, height: 5, width: 16 }], dark);
		cockpit(16, 51, 26, 36, 15);
		housing(turret, 'bridge-chin', [{ x: 24, y: 48, height: 3, width: 13 }, { x: 36, y: 48, height: 2, width: 9 }], accent);
		for (const side of [-1, 1]) {
			casting(turret, 'silo-bearing', -15, 60, side * 25, 25, 18, 15, steel);
			rack(side * 36, 66, 22, 4, -17, familyAt(side < 0 ? 0 : 1));
			casting(turret, 'silo-counterweight', -32, 62, side * 36, 14, 15, 27, dark);
			housing(turret, 'silo-brace', [{ x: -33, y: 58, height: 4, width: 4 }, { x: -25, y: 65, height: 13, width: 5 }, { x: -20, y: 59, height: 4, width: 3 }], steel, side * 28);
			housing(turret, 'silo-rear-armor', [{ x: -40, y: 84, height: 9, width: 6 }, { x: -35, y: 84, height: 15, width: 9 }, { x: -31, y: 84, height: 11, width: 7 }], trim, side * 36);
			casting(turret, 'silo-side-armor', -18, 85, side * 51, 22, 21, 4, steel);
			vent(-29, 49, side * 12, 3);
		}
		aerial(-30, 102, -47, 15);
	} else {
		// Rook: a compact forward cockpit over two low arms, with a single
		// central dorsal pod. Its narrow waist and forward knees separate its
		// silhouette from the broad four-mount Warden and twin-silo Morrow.
		casting(turret, 'rook-waist', -2, 59, 0, 26, 16, 27, dark);
		housing(turret, 'rook-torso', [{ x: -27.5, y: 74, height: 10, width: 15 }, { x: -8, y: 78, height: 14, width: 19 }, { x: 20, y: 72, height: 8, width: 13 }], steel);
		cockpit(12, 79, 23, 33, 14);
		housing(turret, 'rook-breastplate', [{ x: 16, y: 69, height: 5, width: 12 }, { x: 29, y: 64, height: 4, width: 9 }], trim);
		for (const side of [-1, 1]) {
			casting(turret, 'rook-shoulder', -6, 77, side * 27, 23, 14, 15, accent);
			cylinder(turret, 'rook-shoulder-bearing', 5, 11, dark, -4, 72, side * 26, 'z');
			casting(turret, 'rook-arm', 1, 62, side * 29, 16, 18, 12, steel);
			if (familyAt(side < 0 ? 0 : 1) === 'ballistic') gun(side * 29, 53, 39, 3, 23);
			else energyGun(side * 29, 53, false, 23);
			casting(turret, 'rook-reactor', -28, 74, side * 12, 15, 22, 10, dark);
			vent(-35, 66, side * 12, 3);
		}
		casting(turret, 'dorsal-pod-pedestal', -17, 91, 0, 22, 18, 16, dark);
		compactLauncher(0, 104, -12);
		aerial(-22, 91, -19, 19);
	}
	// Slot order is left gun, right gun, left pod, right pod, dorsal gun.
	if (pods.length > 0) muzzles.splice(2, 0, ...pods);
	const assemblies = muzzles.map(function (muzzle) {
		const part = muzzle.parent; if (!(part instanceof Group)) throw new Error('Weapon muzzle must belong to an articulated assembly');
		return { part, muzzle };
	});
	return { slides, muzzles, vents, shutters, assemblies };
};
