import {
	Box3, Color, DataTexture, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
	NearestFilter, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, type WebGLRenderer,
} from 'three';
import type { Biome } from './campaign-types';
import { FRAME_RIGS } from './frame-rig';
import { getFrame } from './frames';
import { createGait } from './gait';
import type { LaunchBerth } from './launch-berths';
import { DROPSHIP_DECK, createDropship, createWayfarer } from './launch-ships';
import { LAUNCH_TIMING, sampleLaunchPoseTime } from './launch-timing';
import { createMech } from './mech-3d';
import type { MechSkinId } from './mech-skin';
import type { CombatStateView } from './simulation';
import type { createSolidInk } from './solid-ink';

const clamp = function (value: number) { return Math.max(0, Math.min(1, value)); };
const ease = function (value: number) { const t = clamp(value); return t * t * (3 - 2 * t); };
const bankPose = function (degrees: number) { return Math.round(degrees / 5) * Math.PI / 36; };
const rampAt = function (time: number) { return 1 - ease((time - .875) / 1.125); };
const flightAt = function (time: number) { return clamp((time - LAUNCH_TIMING.release) / (LAUNCH_TIMING.approach - LAUNCH_TIMING.release)); };
const bankAt = function (flight: number) { return ease((flight - .60) / .40); };

// One indexed-color orbital plate. The faint daylight bands describe the curved
// limb even when a narrow viewport crops most of the planet.
const planetColors = {
	badlands: [0x353448, 0x574650, 0x795956, 0xa07863, 0xc3a17b, 0xe1c697],
	volcanic: [0x23283b, 0x363448, 0x50404d, 0x755355, 0xa37266, 0xc69076],
	tundra: [0x293747, 0x385266, 0x507785, 0x78979d, 0xa6bebc, 0xd2dcd0],
} as const;
const createOrbitPlate = function (biome: Biome, seed: number) {
	const width = 448, height = 256;
	const pixels = new Uint8Array(width * height * 4);
	const surface = planetColors[biome];
	const phase = (seed >>> 0) % 127 / 17;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const nx = (x - width * .33) / 390, ny = (y - 568) / 390;
			const radius = Math.hypot(nx, ny);
			let color = 0x101827;
			if (radius < 1) {
				const depth = Math.sqrt(1 - radius * radius);
				const longitude = Math.atan2(nx, depth), latitude = Math.asin(ny);
				const coast = Math.sin(8 * longitude + phase + 2 * Math.sin(13 * latitude))
					+ Math.cos(16 * latitude - phase) + .45 * Math.sin(24 * longitude + 19 * latitude)
					+ .17 * Math.cos(58 * longitude - 31 * latitude);
				const sunlight = clamp(.68 - nx * .72 - depth * .2);
				const front = 40 * latitude + 2.7 * Math.sin(4 * longitude + phase) + .5 * Math.cos(16 * longitude - 7 * latitude);
				const cloud = Math.sin(front) > .86 && Math.sin(6 * longitude - 3 * latitude - phase) > -.14;
				const shade = Math.min(5, Math.floor(sunlight * 4 + (coast > .4 ? 1 : 0) + (cloud || coast > 1.4 ? 1 : 0) + (cloud ? 1 : 0)));
				color = radius > .991 ? surface[5] : radius > .977 ? surface[4] : surface[shade] ?? surface[0];
			} else if (radius < 1.012) color = 0x667f8b;
			else {
				const star = Math.imul(Math.imul(x + 163, 73856093) ^ Math.imul(y + 17, 19349663) ^ seed, 1597334677) >>> 0;
				if (star % 1049 < 2) color = star & 8 ? 0xa7b5b6 : 0x637887;
			}
			const offset = ((height - 1 - y) * width + x) * 4;
			pixels[offset] = color >> 16; pixels[offset + 1] = color >> 8; pixels[offset + 2] = color; pixels[offset + 3] = 255;
		}
	}
	const texture = new DataTexture(pixels, width, height);
	texture.colorSpace = SRGBColorSpace; texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true;
	return texture;
};

export const createLaunchFlight = function (berths: readonly LaunchBerth[]) {
	const commander = berths[0];
	if (!commander) throw new Error('Missing commander berth');
	const scene = new Scene(); scene.background = new Color('#111925');
	const camera = new PerspectiveCamera(38, 1, 2, 32000); scene.add(camera);
	const plateDepth = 24000;
	const plateGeometry = new PlaneGeometry(1, 1);
	const plateMaterial = new MeshBasicMaterial({ toneMapped: false, fog: false });
	const plate = new Mesh(plateGeometry, plateMaterial); plate.position.z = -plateDepth; camera.add(plate);
	const overhead = new HemisphereLight('#c3d8e4', '#514856', 1.55);
	const redCabinLight = new Fog('#4a2533', 0, 500);
	const key = new DirectionalLight('#ffdeb4', 3.1); key.position.set(-1100, 2200, 1600);
	const fill = new DirectionalLight('#89b6cb', 1.05); fill.position.set(2200, 700, -1400);
	scene.add(overhead, key, fill);

	const carrier = createWayfarer(), ship = createDropship();
	scene.add(carrier.root); carrier.bay.add(ship.root);
	ship.root.rotation.order = 'YXZ';
	const crew = new Group(); ship.root.add(crew);
	const rigs: ReturnType<typeof createMech>[] = [];
	const bounds = new Box3();
	let shoulderHeight = 0;
	let manifest: CombatStateView | undefined, livery: MechSkinId | undefined;
	const emptyBerths = function () { for (const rig of rigs.splice(0)) rig.dispose(); };
	const embark = function (state: CombatStateView, skin: MechSkinId) {
		if (state === manifest && skin === livery) return;
		emptyBerths(); shoulderHeight = 0;
		const entries = [{ frame: state.frame, loadout: state.loadout }, ...state.squadmates.map(function (mate) {
			return { frame: mate.frameId, loadout: mate.loadout };
		})];
		for (const [i, entry] of entries.entries()) {
			const berth = berths[i];
			if (!berth) throw new Error('Missing deployment berth');
			const rig = createMech(undefined, false, entry.frame, skin);
			rigs.push(rig);
			const heading = Math.PI / 2;
			const gait = createGait({ x: 0, y: 0, angle: heading }, getFrame(entry.frame).size, FRAME_RIGS[entry.frame]);
			rig.pose(gait, heading, { time: 0, heat: 0, hit: 0, recoil: 0, equippedSlots: entry.loadout.map(function (mount, index) { return mount.slot ?? index; }) });
			if (berth.z <= commander.z) shoulderHeight = Math.max(shoulderHeight, bounds.setFromObject(rig.root, true).max.y);
			rig.root.position.set(berth.x, DROPSHIP_DECK.height, berth.z); crew.add(rig.root);
		}
		if (manifest !== state) {
			plateMaterial.map?.dispose();
			plateMaterial.map = createOrbitPlate(state.mission?.map.biome ?? 'badlands', state.seed);
			plateMaterial.needsUpdate = true;
		}
		manifest = state; livery = skin;
	};

	const aim = new Vector3(), inkAnchor = new Vector3();
	const cameraFrom = function (group: Group, ex: number, ey: number, ez: number, ax: number, ay: number, az: number) {
		group.localToWorld(camera.position.set(ex, ey, ez));
		group.localToWorld(aim.set(ax, ay, az)); camera.lookAt(aim);
	};
	const shots = function (seconds: number, aspect: number) {
		const exterior = seconds >= LAUNCH_TIMING.carrier;
		crew.visible = !exterior; plate.visible = exterior;
		const poseTime = sampleLaunchPoseTime(seconds);
		const ramp = rampAt(seconds); ship.setRamp(ramp, rampAt(poseTime));
		const flight = flightAt(seconds), bankTravel = bankAt(flight), heldBank = bankAt(flightAt(poseTime));
		ship.setThrust(exterior ? .16 + .84 * ease(flight * 3) : 0);
		// Outboard of the maintenance gallery, the crew sees past their own ramp
		// into the long side of the bay. The prow is still behind the carrier lip.
		ship.root.position.set(-132 + 410 * bankTravel, 26 * ease(flight * 3) - 320 * bankTravel, 126 + 1580 * flight * flight);
		ship.root.rotation.set(bankPose(-19 * heldBank), Math.PI + bankPose(25 * heldBank), bankPose(-26 * heldBank), 'YXZ');

		if (!exterior) {
			// The hatch seals off the bright gantry. Switch to the practicals'
			// red palette, keeping the near shoulder darker than the aft sill.
			scene.fog = redCabinLight;
			redCabinLight.near = 20 + 900 * ramp; redCabinLight.far = 470 + 1500 * ramp;
			key.color.set(ramp > .15 ? '#ffe1b7' : '#ef8672');
			overhead.intensity = .95 + .62 * ramp; key.intensity = 1.65 + 1.5 * ramp;
			camera.fov = aspect < .86 ? 74 : 63;
			const eye = DROPSHIP_DECK.height + Math.min(154, shoulderHeight + 17);
			const tall = ease((shoulderHeight - 105) / 46);
			cameraFrom(ship.root, rigs.length === 1 ? -27 : 0, eye, commander.z - 88,
				-3 * Math.sign(commander.x), eye - 54 + 10 * tall, 278);
			ship.root.localToWorld(inkAnchor.set(0, 96, DROPSHIP_DECK.hinge));
			return;
		}

		scene.fog = null; key.color.set('#ffe0b3'); key.intensity = 3.1; overhead.intensity = 1.5;
		camera.fov = 37;
		if (seconds < LAUNCH_TIMING.release) {
			const portrait = clamp((1.2 - aspect) / .65);
			const distance = Math.max(3350, Math.min(14000, (7170 - 640 * portrait) / aspect));
			cameraFrom(carrier.root, -212 - distance * .34, 92 + distance * .17, distance * .94, -212, 88, 0);
			camera.rotateZ(-.045 - .29 * portrait);
		} else {
			const distance = Math.max(1150, Math.min(2250, 1820 / aspect));
			const { x, y, z } = ship.root.position;
			const track = ease(flight);
			cameraFrom(carrier.bay, -.46 * distance + .63 * x, 100 + .21 * distance + .76 * y, .90 * distance + .86 * z,
				x - 25, 84 + y * .9, z * (.82 + .15 * track));
		}
		ship.root.localToWorld(inkAnchor.set(0, 85, 0));
	};
	return {
		render: function (renderer: WebGLRenderer, ink: ReturnType<typeof createSolidInk>, state: CombatStateView, skin: MechSkinId, seconds: number, width: number, height: number) {
			if (width <= 0 || height <= 0) return;
			embark(state, skin);
			camera.aspect = width / height; shots(seconds, camera.aspect); camera.updateProjectionMatrix();
			const field = 2 * plateDepth * Math.tan(camera.fov * Math.PI / 360);
			const cover = Math.max(1, camera.aspect / 1.75); plate.scale.set(field * cover * 1.75, field * cover, 1);
			const cell = Math.max(1.25, Math.min(width / 320, height / 200, 3.5));
			// Flight uses the battlefield's existing renderer and ink targets.
			if (ink.available) ink.render(scene, camera, width, height, { anchor: inkAnchor, cell });
			else renderer.render(scene, camera);
		},
		dispose: function () {
			emptyBerths(); ship.dispose(); carrier.dispose();
			plateMaterial.map?.dispose(); plateMaterial.dispose(); plateGeometry.dispose(); scene.clear();
		},
	};
};
