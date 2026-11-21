import { expect, test } from 'bun:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredKestrel } from '../src/authored-mech';
import { createKestrelCadence } from '../src/kestrel-cadence';
import { createState, step } from '../src/simulation';

test('Kestrel exposes its landings and bounds while its chassis moves through held leg poses', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_KESTREL', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/kestrel/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredKestrel(asset);
	const remove = factory.install();
	try {
		const state = createState({ frame: 'kestrel', seed: 1 });
		Object.assign(state.player, { angle: 0, turret: 0, x: 620, y: 500 });
		state.spawnIn = Infinity;
		const cadence = createKestrelCadence();
		let previous = factory.advancePose(undefined, state.player, 0).gait;
		let heldSteps = 0; let landings = 0; let bounds = 0; let showedBound = false;
		for (let tick = 1; tick <= 540; tick++) {
			// The reviewed maneuver accelerates into a running turn, brakes, reverses, then settles.
			const drive = tick < 110 ? 1 : tick >= 275 && tick < 365 ? -1 : 0;
			const turn = tick >= 110 && tick < 172 ? 0.75 : 0;
			const stop = tick >= 230 && tick < 275 || tick >= 440;
			const aim = { x: state.player.x + Math.cos(0.12 + tick * 0.001) * 450, y: state.player.y + Math.sin(0.12 + tick * 0.001) * 450 };
			step(state, { drive, turn, stop, aim, fire: [tick >= 330 && tick < 440, false, false, false], coolant: false }, 1 / 60);
			const pose = state.authoredPose;
			cadence.advance(pose, state.player.speed);
			const visual = cadence.visualPose(pose);
			if (!pose?.gait || !visual?.gait || !previous) throw new Error('Expected authored Kestrel legs');
			const exposed = visual.gait.feet === pose.gait.feet;
			if (visual.gait !== pose.gait) heldSteps++;
			expect(visual.gait.body).toBe(pose.gait.body);
			expect(visual.gait.motion).toBe(pose.gait.motion);
			expect(visual.pelvisDrop).toBe(pose.pelvisDrop);
			for (const side of [0, 1] as const) {
				if (pose.gait.feet[side].lift === 0 && previous.feet[side].lift > 0) {
					expect(exposed).toBe(true);
					landings++;
				}
			}
			const airborne = pose.gait.feet.every(function (foot) { return foot.lift > 0; });
			const wasAirborne = previous.feet.every(function (foot) { return foot.lift > 0; });
			if (airborne && !wasAirborne) { bounds++; showedBound = false; }
			if (airborne && exposed) showedBound = true;
			if (!airborne && wasAirborne) expect(showedBound).toBe(true);
			previous = pose.gait;
		}
		expect(landings).toBeGreaterThan(15);
		expect(bounds).toBeGreaterThan(5);
		expect(heldSteps).toBeGreaterThan(400);
		cadence.reset();
		expect(cadence.visualPose(state.authoredPose)).toBe(state.authoredPose);
	} finally { remove(); factory.dispose(); }
});
