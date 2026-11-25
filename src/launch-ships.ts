import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { createShipParts } from './launch-ship-parts';
import { cabinBeam, DROPSHIP_DECK, podCenter, rampFrameHalfWidth } from './launch-berths';
export { DROPSHIP_DECK, DROPSHIP_WIDTH } from './launch-berths';

const sides = [-1, 1] as const;
const clamp = function (value: number) { return Math.max(0, Math.min(1, value)); };

// The open stern is +Z. The split shell leaves an actual hold between the forward
// pressure bulkhead and the hinged aft ramp, visible from both camera positions.
export const createDropship = function () {
	const parts = createShipParts('#899ba4');
	const { box, hull, beam, sash, steel, dark, trim, accent, piston, recess, glass } = parts;
	const craft = new Group(); craft.name = 'company-dropship-vehicle';
	// Only the pressure hull is widened for a pair of Mauls. The docking frame,
	// embarked walking rigs, and twin bought-in lift modules retain world scale.
	const root = parts.group(craft, 'pressure-hull'); root.scale.x = cabinBeam;
	const engines = parts.group(root, 'lift-modules'); engines.scale.x = 1 / cabinBeam;
	const { height, hinge, toe } = DROPSHIP_DECK;
	box(root, 'cargo-deck', dark, 0, height - 6, 35, 234, 12, 347);
	box(root, 'hold-floor', steel, 0, height - 1, 35, 211, 2.4, 340);
	hull(root, 'forward-keel', dark, 'z', 0, [[-233, 62, 17, 62], [-194, 66, 40, 96], [-129, 80, 59, 116]]);
	hull(root, 'sloped-prow', steel, 'z', 0, [[-231, 69, 18, 62], [-191, 88, 43, 97], [-129, 101, 78, 120]]);
	hull(root, 'flight-deck-coaming', dark, 'z', 0, [[-222, 98, 4, 48], [-198, 122, 9, 87], [-162, 154, 13, 83], [-140, 167, 10, 62]]);
	hull(root, 'armored-canopy-brow', steel, 'z', 0, [[-159, 165, 6, 76], [-133, 190, 12, 82], [-111, 197, 11, 81]]);
	for (const side of sides) {
		box(root, 'cockpit-windscreen', recess, side * 32, 145, -185, 57, 4, 65).rotation.x = -0.72;
		beam(root, 'canopy-glint', glass, [side * 45, 141, -195], [side * 52, 150, -185], 3.5, 3.5);
		box(root, 'prow-lamp', glass, side * 46, 71, -231, 16, 3.5, 3);
	}
	box(root, 'cabin-bulkhead', dark, 0, 116, -133, 228, 172, 12);
	for (const side of sides) {
		hull(root, 'cargo-cheek', steel, 'z', side * 117, [[-140, 114, 88, 8], [-70, 117, 91, 11], [164, 117, 91, 11], [205, 117, 88, 8]]);
		box(root, 'internal-belt-rail', dark, side * 107, 84, 36, 5, 11, 332);
		for (const z of [-98, -20, 72, 169]) {
			box(root, 'hold-frame', dark, side * 110, 111, z, 9, 163, 9);
			beam(root, 'upper-knee', trim, [side * 109, 182, z], [side * 96, 198, z], 7, 8);
		}
		box(root, 'floor-edge', accent, side * 98, 30.8, 39, 4, 1.4, 315);
		for (const z of [-46, 114]) {
			// Painted lock pockets define both rows even when a berth is empty.
			box(root, 'berth-pocket', dark, side * 54, 30.8, z, 48, 1.4, 12);
			box(root, 'lock-jaw', piston, side * 54, 32, z, 17, 2.2, 5);
		}
	}
	hull(root, 'roof-frame', dark, 'z', 0, [[-143, 204, 4, 113], [-107, 207, 7, 120], [163, 207, 7, 122], [206, 204, 5, 115]]);
	hull(root, 'fore-roof-armor', steel, 'z', 0, [[-142, 206, 3, 108], [-106, 212, 5, 119], [7, 212, 5, 119]]);
	hull(root, 'aft-roof-armor', steel, 'z', 0, [[15, 212, 5, 119], [161, 212, 5, 119], [204, 206, 5, 114]]);
	const wrap = [[-129, 103], [-129, 174], [-124, 205], [-119, 215], [-74, 218], [74, 218], [119, 215], [124, 205], [129, 174], [129, 103]] as const;
	sash(root, 'company-sash', accent, 0, 51, 42, -0.25, wrap);
	sash(root, 'company-keyline', dark, 0, 98, 9, -0.25, wrap);
	box(root, 'stern-lintel', dark, 0, 205, 201, 232, 13, 14);
	for (const side of sides) {
		box(root, 'door-jamb', dark, side * 112, 114, 202, 13, 164, 14);
		box(root, 'jamb-marker', accent, side * 113, 110, 210, 11, 72, 3);
		box(root, 'roof-rub-rail', dark, side * 92, 214, -38, 7, 7, 121);
	}
	box(root, 'roof-service-recess', dark, 0, 217.4, -58, 91, 3, 66);
	for (const z of [-80, -65, -50, -35]) {
		box(root, 'radiator-blade', steel, 0, 220, z, 72, 3.5, 5);
	}
	for (const side of sides) {
		box(root, 'service-hatch', dark, side * 43, 214, 169, 40, 5, 35);
		box(root, 'service-hatch-lid', trim, side * 43, 217, 169, 29, 2, 24);
	}
	for (const side of sides) {
		const x = side * podCenter;
		for (const z of [-68, 104]) box(root, 'thrust-spar', dark, side * 134, 82, z, 39, 17, 25);
		// Broad, independently armored lift pods give the caravan ferry its short T silhouette.
		hull(engines, 'lift-pod-spine', dark, 'z', x, [[-141, 85, 31, 22], [-112, 96, 56, 32], [116, 97, 57, 32], [157, 91, 41, 25]]);
		hull(engines, 'forward-pod-cowl', steel, 'z', x, [[-145, 111, 27, 21], [-105, 127, 39, 31], [2, 124, 42, 31]]);
		hull(engines, 'aft-pod-cowl', trim, 'z', x, [[11, 125, 41, 31], [119, 126, 40, 31], [159, 114, 29, 25]]);
		const podWrap = [[-33, 68], [-33, 137], [-31.4, 151], [-20, 167], [20, 167], [31.4, 151], [33, 137], [33, 68]] as const;
		sash(engines, 'pod-service-belt', accent, x, 16, 34, -0.20, podWrap);
		box(engines, 'pod-aft-guard', dark, x, 109, 157, 47, 54, 7);
		box(engines, 'pod-aft-livery', accent, x, 112, 161.5, 42, 26, 3);
		for (const offset of [-10, 6]) box(engines, 'pod-aft-notch', trim, x + offset, 112, 163.5, 5, 22, 2).rotation.z = -0.29;
		for (const z of [-77, 85]) {
			box(engines, 'pod-intake', recess, x, 166, z, 28, 3, 49);
			for (const offset of [-13, 0, 13]) box(engines, 'intake-baffle', dark, x, 168, z + offset, 26, 3, 4);
			parts.cylinder(engines, 'venturi-mount', 23, 15, dark, x, 46, z);
			parts.cylinder(engines, 'lift-nozzle', 18, 5, piston, x, 37, z);
			parts.cylinder(engines, 'lift-throat', 14, 2, recess, x, 34, z);
		}
		box(engines, 'aft-navigation-lamp', glass, x, 130, 162, 27, 4, 3);
		for (const z of [-118, 135]) {
			const skidX = side * 109;
			beam(root, 'landing-piston', piston, [side * 100, 30, z - 10], [skidX, 4, z + 5], 10, 9);
			box(root, 'landing-pad', dark, skidX, 3, z + 4, 25, 6, 32);
		}
	}

	const ramp = parts.group(root, 'aft-ramp');
	ramp.position.set(0, height, hinge);
	const run = toe - hinge, fall = height - 1;
	const length = Math.hypot(run, fall);
	const down = Math.atan2(fall, run);
	hull(ramp, 'ramp-armature', steel, 'z', 0, [[0, -3, 3, rampFrameHalfWidth], [length - 8, -3, 3, rampFrameHalfWidth], [length, -0.6, 0.6, 103]]);
	for (const side of sides) {
		box(ramp, 'ramp-edge', accent, side * 93, 0.55, length * 0.48, 5, 1, length - 13);
		box(ramp, 'outer-door-plate', trim, side * 51, -6.2, length * 0.5, 93, 2, length - 17);
		box(ramp, 'door-spine', dark, side * 5, -7, length * 0.5, 5, 3, length - 4);
		box(ramp, 'door-chevron', accent, side * 50, -8, length * 0.48, 88, 1.8, 23).rotation.y = side * 0.34;
		for (const z of [23, 113]) box(ramp, 'door-latch', dark, side * 79, -8.5, z, 17, 3, 10);
	}
	for (const z of [19, 45, 71, 97, 123]) box(ramp, 'ramp-tread', dark, 0, 0.7, z, 172, 1.2, 3.5);
	const upperSeal = parts.group(root, 'upper-door-seal');
	box(upperSeal, 'seal-plate', dark, 0, 192, 201, 213, 30, 6);
	for (const side of sides) box(upperSeal, 'seal-stripe', accent, side * 63, 189, 205, 49, 8, 3);
	parts.batch(craft);

	// Only the animated lenses and exhaust share unlit colors. Hulls keep the battle palette.
	const lamps = new MeshBasicMaterial({ color: '#e8f3ce' });
	const lens = parts.own(new BoxGeometry(1, 1, 1));
	const lamp = function (x: number, y: number, z: number, width: number, depth: number) {
		const mesh = new Mesh(lens, lamps); mesh.position.set(x, y, z); mesh.scale.set(width, 3, depth); root.add(mesh);
	};
	lamp(0, 198, 191, 83, 5);
	for (const side of sides) { lamp(side * 102, 66, 178, 5, 21); lamp(side * 72, 198, 26, 8, 38); }
	const jets = new Group(); jets.position.y = 34; engines.add(jets);
	const exhaust = new MeshBasicMaterial({ color: '#ffce81' });
	const flame = parts.own(new CylinderGeometry(13, 4, 37, 8));
	for (const side of sides) for (const z of [-77, 85]) {
		const plume = new Mesh(flame, exhaust); plume.position.set(side * podCenter, -18.5, z); jets.add(plume);
	}
	const setRamp = function (open: number, poseOpen: number) {
		const step = Math.round(clamp(poseOpen) * 12) / 12;
		const sealTravel = clamp(open);
		ramp.rotation.x = -Math.PI / 2 + (Math.PI / 2 + down) * step;
		upperSeal.scale.y = 1 - sealTravel;
		upperSeal.position.y = 207 * sealTravel; upperSeal.visible = sealTravel < 1;
		lamps.color.setHex(step > 0.5 ? 0xe8f3ce : 0xff794e);
	};
	const setThrust = function (level01: number) {
		const level = clamp(level01);
		jets.visible = level > 0; jets.scale.y = level;
	};
	setRamp(0, 0); setThrust(0);
	return { root: craft, setRamp, setThrust, dispose: function () { craft.clear(); lamps.dispose(); exhaust.dispose(); parts.dispose(); } };
};

// X follows the orbital tender's keel. Its working bay is built between the
// fore and aft hulls, with a recessed deck at y=0 and an open starboard mouth.
export const createWayfarer = function () {
	const parts = createShipParts('#768da2');
	const { box, hull, beam, steel, dark, trim, accent, piston, recess, glass } = parts;
	const root = new Group(); root.name = 'wayfarer-vehicle';
	hull(root, 'engine-block', steel, 'x', -16, [[-2060, 42, 140, 315], [-1870, 60, 229, 463], [-1040, 73, 224, 474], [-332, 80, 210, 462]]);
	hull(root, 'fore-hull', steel, 'x', 0, [[679, 78, 213, 460], [1480, 73, 214, 457], [1990, 30, 147, 308], [2150, -2, 65, 178]]);
	hull(root, 'underslung-keel', dark, 'x', -38, [[-2070, -77, 54, 260], [-1730, -125, 91, 397], [-550, -135, 98, 402], [1260, -125, 89, 402], [2000, -75, 44, 221]]);
	hull(root, 'port-engineering-spine', steel, 'x', -472, [[-800, 94, 136, 69], [-365, 116, 218, 88], [720, 116, 218, 88], [1130, 89, 150, 62]]);
	hull(root, 'hangar-roof', steel, 'x', 4, [[-580, 324, 22, 439], [-326, 343, 29, 492], [684, 343, 29, 492], [930, 319, 20, 435]]);
	box(root, 'upper-cross-deck', dark, 180, 323, 46, 1018, 26, 911);
	box(root, 'flight-deck-raft', dark, 180, -48, 20, 1018, 96, 985);
	for (const side of sides) {
		const z = side * 292;
		hull(root, 'armored-shoulder', trim, 'x', z, [[-1880, 223, 32, 73], [-1510, 266, 46, 94], [-731, 265, 45, 94], [-512, 242, 27, 61]]);
		hull(root, 'forecastle', trim, 'x', z * 0.83, [[820, 262, 24, 88], [1100, 286, 37, 108], [1660, 247, 41, 80], [1920, 184, 25, 48]]);
		// Long recessed thermal radiators lie below the broad armor plates.
		for (const x of [-1580, -1120, 1020, 1430]) {
			box(root, 'radiator-trough', recess, x, 47, side * 457, 305, 86, 23);
			for (const offset of [-108, -54, 0, 54, 108]) {
				box(root, 'radiator-fin', dark, x + offset, 47, side * 473, 26, 73, 14).rotation.z = -0.22;
			}
		}
		hull(root, 'engine-sponson', dark, 'x', side * 290, [[-2180, 38, 104, 98], [-1950, 66, 124, 133], [-1530, 99, 116, 141], [-1310, 108, 74, 94]]);
		for (const y of [0, 131]) {
			parts.cylinder(root, 'drive-collar', 78, 116, dark, -2178, y, side * 288, 'x');
			parts.cylinder(root, 'drive-lip', 65, 15, piston, -2241, y, side * 288, 'x');
			parts.cylinder(root, 'drive-throat', 51, 5, recess, -2250, y, side * 288, 'x');
			parts.cylinder(root, 'drive-core', 22, 5, glass, -2253, y, side * 288, 'x');
		}
		for (const x of [-1780, -1310, -830, 998, 1330]) {
			box(root, 'running-light', glass, x, 158, side * 469, 34, 8, 8);
		}
		for (const x of [768, 846]) {
			box(root, 'fore-service-bands', accent, x, 85, side * 463, 44, 213, 10).rotation.z = -0.35;
		}
		// A raised service trunk and its narrow windows give the tender a second deck of scale.
		hull(root, 'aft-service-trunk', dark, 'x', side * 449, [[-1790, 168, 12, 21], [-1680, 184, 28, 36], [-704, 183, 27, 36], [-620, 166, 14, 20]]);
		for (const x of [-1596, -1488, -1380, -1070, -962, -854]) {
			box(root, 'crew-window', glass, x, 181, side * 486, 45, 8, 5);
		}
		hull(root, 'fore-keel-fairing', dark, 'x', z, [[1092, -108, 32, 93], [1265, -145, 66, 100], [1780, -118, 49, 47], [1951, -68, 19, 31]]);
	}
	hull(root, 'bridge-plinth', dark, 'x', -60, [[-1420, 278, 37, 170], [-1170, 315, 69, 204], [-568, 313, 59, 185], [-390, 289, 21, 119]]);
	hull(root, 'bridge-brow', trim, 'x', -88, [[-1220, 377, 34, 121], [-1080, 399, 40, 157], [-656, 397, 43, 166], [-501, 362, 23, 118]]);
	for (const x of [-1028, -932, -836, -740]) {
		box(root, 'bridge-window-recess', dark, x, 400, 74, 81, 27, 13);
		box(root, 'bridge-window', glass, x, 403, 81, 60, 9, 5);
	}
	box(root, 'communications-mast', dark, -1090, 462, -90, 14, 100, 16);
	box(root, 'mast-array', trim, -1090, 488, -90, 115, 9, 20);
	for (const x of [937, 1046]) box(root, 'company-flash', accent, x, 299, 229, 63, 53, 174).rotation.z = -0.12;

	const bay = parts.group(root, 'wayfarer-flight-deck');
	bay.position.set(180, 0, 65);
	box(bay, 'hangar-deck', steel, 0, -5, -15, 982, 10, 928);
	box(bay, 'belly-lip', trim, 0, -18, 438, 998, 34, 29);
	box(bay, 'back-pressure-wall', dark, 0, 154, -475, 987, 310, 20);
	box(bay, 'service-door-surround', trim, 272, 107, -460, 174, 185, 14);
	box(bay, 'service-shutter', steel, 272, 106, -451, 152, 168, 10);
	for (const y of [49, 81, 113, 145]) box(bay, 'shutter-slat', dark, 272, y, -444, 148, 5, 5);
	// The bay behind the ramp has a lit open service gantry and cargo, visibly
	// deeper than the plated door which will close in front of it.
	box(bay, 'rear-gallery', steel, -52, 143, -429, 532, 13, 90);
	box(bay, 'gallery-task-light', glass, -67, 136, -382, 418, 5, 7);
	box(bay, 'rear-gallery-rail', piston, -52, 171, -384, 535, 5, 6);
	for (const x of [-314, -226, -138, -50, 38, 126, 210]) {
		box(bay, 'gantry-railing-post', dark, x, 159, -384, 6, 27, 6);
	}
	for (const x of [-299, -99, 101]) {
		beam(bay, 'deck-brace', steel, [x, 22, -458], [x + 85, 132, -458], 14, 13);
		beam(bay, 'wall-upright', trim, [x, 0, -452], [x, 255, -452], 18, 19);
	}
	for (const [x, y] of [[-183, 32], [-93, 32], [-181, 94]] as const) {
		box(bay, 'freight-case', steel, x, y, -409, 85, 61, 74);
		for (const offset of [-27, 27]) {
			box(bay, 'case-strap', accent, x + offset, y, -370, 9, 61, 7);
		}
		box(bay, 'cargo-mark', trim, x, y + 10, -369, 16, 7, 5);
	}
	for (const side of sides) {
		box(bay, 'inner-sidewall', steel, side * 490, 156, -10, 40, 312, 921);
		box(bay, 'portal-jamb', dark, side * 484, 158, 427, 56, 330, 49);
		box(bay, 'portal-corner-paint', accent, side * 492, 139, 453, 27, 203, 6);
		box(bay, 'portal-marker', glass, side * 470, 250, 455, 10, 78, 6);
		box(bay, 'deck-guide', trim, side * 218, 0.6, -10, 12, 1, 837);
		for (const z of [-365, -140, 90, 318]) {
			box(bay, 'service-gallery-column', dark, side * 436, 142, z, 23, 281, 27);
			beam(bay, 'gantry-knee', trim, [side * 433, 213, z], [side * 363, 292, z], 15, 19);
			box(bay, 'deck-caution-mark', accent, side * 244, 0.7, z, 30, 1.2, 11).rotation.y = side * 0.48;
		}
		box(bay, 'service-gallery', dark, side * 437, 115, -26, 84, 13, 851);
		box(bay, 'gallery-rail', piston, side * 394, 137, -26, 5, 5, 849);
		box(bay, 'gantry-practical', glass, side * 348, 292, -24, 12, 7, 759);
	}
	for (const z of [-360, -145, 125, 414]) {
		box(bay, 'hangar-transverse', dark, 0, 314, z, 948, 30, 25);
		box(bay, 'deck-light', glass, 0, 296, z, 248, 5, 13);
	}
	box(bay, 'bridge-crane', trim, 0, 259, -312, 837, 16, 28);
	box(bay, 'travel-carriage', accent, 62, 243, -318, 112, 22, 52);
	for (const side of sides) {
		beam(bay, 'hoist-strap', piston, [62 + side * 39, 231, -318], [62 + side * 27, 155, -325], 5, 5);
	}
	box(bay, 'lifting-yoke', dark, 62, 150, -325, 88, 12, 18);
	hull(bay, 'suspended-drive', accent, 'x', -325, [[24, 124, 15, 20], [37, 124, 25, 29], [90, 124, 25, 29], [101, 124, 15, 19]]);
	box(bay, 'drive-band', dark, 54, 124, -325, 13, 51, 59);
	parts.batch(root);
	return { root, bay, dispose: function () { root.clear(); parts.dispose(); } };
};
