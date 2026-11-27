import {
	Box3, Color, DirectionalLight, Fog, Group, HemisphereLight, MathUtils, Mesh, MeshBasicMaterial,
	PerspectiveCamera, PlaneGeometry, Scene, Vector3, type WebGLRenderer,
} from 'three';
import { createOrbitPlate } from './orbit-plate';
import { FRAME_RIGS } from './frame-rig';
import { getFrame } from './frames';
import { createGait } from './gait';
import type { LaunchBerth } from './launch-berths';
import { DROPSHIP_DECK, createDropship, createWayfarer } from './launch-ships';
import { LAUNCH_TIMING, sampleLaunchPoseTime } from './launch-timing';
import { createMech } from './mech-3d';
import type { MechFinish } from './mech-skin';
import type { CombatStateView } from './simulation';
import type { createSolidInk } from './solid-ink';

const clamp = function (value: number) { return Math.max(0, Math.min(1, value)); };
const ease = function (value: number) { const t = clamp(value); return t * t * (3 - 2 * t); };
const bankPose = function (degrees: number) { return Math.round(degrees / 5) * Math.PI / 36; };
const rampAt = function (time: number) { return 1 - ease((time - .875) / 1.125); };
const flightAt = function (time: number) { return clamp((time - LAUNCH_TIMING.release) / (LAUNCH_TIMING.descent - LAUNCH_TIMING.release)); };
const descentAt = function (time: number) { return clamp((time - LAUNCH_TIMING.descent) / (LAUNCH_TIMING.approach - LAUNCH_TIMING.descent)); };
const bankAt = function (flight: number) { return ease((flight - .60) / .40); };

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
	let manifest: CombatStateView | undefined, livery: MechFinish | undefined;
	const emptyBerths = function () { for (const rig of rigs.splice(0)) rig.dispose(); };
	const embark = function (state: CombatStateView, skin: MechFinish) {
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
	const eyeOffset = new Vector3(), chaseOffset = new Vector3();
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
		const descent = descentAt(seconds), turn = ease(descent), heldTurn = ease(descentAt(poseTime));
		ship.setThrust(exterior ? .16 + .84 * ease(flight * 3) : 0);
		// Outboard of the maintenance gallery, the crew sees past their own ramp
		// into the long side of the bay. The prow is still behind the carrier lip.
		const bayX = -132 + 410 * bankTravel, bayY = 26 * ease(flight * 3) - 320 * bankTravel, bayZ = 126 + 1580 * flight * flight;
		const dive = descent * descent;
		ship.root.position.set(bayX + 1250 * dive, bayY - 3200 * dive, bayZ + 4200 * descent - 750 * dive);
		ship.root.rotation.set(bankPose(-19 * heldBank - 36 * heldTurn), Math.PI + bankPose(25 * heldBank + 15 * heldTurn), bankPose(-26 * heldBank * (1 - heldTurn)), 'YXZ');

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
		const map = plateMaterial.map;
		if (map) {
			map.repeat.set(1 - .32 * turn, .5 - .16 * turn);
			map.offset.set(.10 * turn, .5 - .41 * turn);
		}
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
			// Swing over the falling ship's shoulder on a widening arc. Interpolate
			// the range independently so the camera stays clear of the lift pods.
			eyeOffset.set(-.46 * distance - .37 * bayX, 100 + .21 * distance - .24 * bayY, .90 * distance - .14 * bayZ);
			chaseOffset.set(-.67 * distance, 1.22 * distance, -.74 * distance);
			const range = MathUtils.lerp(eyeOffset.length(), chaseOffset.length(), turn);
			eyeOffset.normalize().lerp(chaseOffset.normalize(), turn).setLength(range);
			cameraFrom(carrier.bay, x + eyeOffset.x, y + eyeOffset.y, z + eyeOffset.z,
				x + MathUtils.lerp(-25, 75, turn), y + MathUtils.lerp(84 - .1 * bayY, 40, turn), z + MathUtils.lerp(bayZ * (-.18 + .15 * track), 90, turn));
		}
		ship.root.localToWorld(inkAnchor.set(0, 85, 0));
	};
	return {
		render: function (renderer: WebGLRenderer, ink: ReturnType<typeof createSolidInk>, state: CombatStateView, skin: MechFinish, seconds: number, width: number, height: number) {
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
