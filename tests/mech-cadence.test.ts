import { expect, test } from 'bun:test';
import { Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredKestrel } from '../src/authored-mech';
import { createContactCadence, createMechCadences } from '../src/mech-cadence';
import { createGait, createGaits, advanceGaits } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { createState, step, type Unit, type Squadmate } from '../src/simulation';

test('Kestrel exposes its landings and bounds while its chassis moves through held leg poses', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_KESTREL', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/kestrel/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredKestrel(asset);
	const remove = factory.install();
	try {
		const state = createState({ frame: 'kestrel', seed: 1 });
		Object.assign(state.player, { angle: 0, turret: 0, x: 620, y: 500 });
		state.spawnIn = Infinity;
		const cadence = createContactCadence();
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
			if (!pose?.gait || !previous) throw new Error('Expected authored Kestrel legs');
			cadence.advance(pose.gait, pose.time);
			const visual = cadence.visualGait(pose.gait);
			const exposed = visual.feet === pose.gait.feet;
			if (visual !== pose.gait) heldSteps++;
			expect(visual.body).toBe(pose.gait.body);
			expect(visual.motion).toBe(pose.gait.motion);
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
			// At eight poses per second the final braking bound can land before another airborne pose is shown.
			if (!airborne && wasAirborne && !previous.running?.stopping) expect(showedBound).toBe(true);
			previous = pose.gait;
		}
		expect(landings).toBeGreaterThan(15);
		expect(bounds).toBeGreaterThan(5);
		expect(540 - heldSteps).toBe(1 + 9 * 8); // Initial pose plus eight updates per second.
		cadence.reset();
		if (!state.authoredPose?.gait) throw new Error('Expected a final pose');
		expect(cadence.visualGait(state.authoredPose.gait)).toBe(state.authoredPose.gait);
	} finally { remove(); factory.dispose(); }
});

test('crossing a heading sector moves the hip and weapon sockets independently while the shoe stays planted', function () {
	const model = createMech(undefined, false, 'longbow');
	try {
		const hull = model.root.getObjectByName('hull'), turret = model.root.getObjectByName('turret');
		const hip = model.root.getObjectByName('hip'), shoe = model.root.getObjectByName('planted-foot');
		const socket = model.root.getObjectByName('weapon-gimbal-0');
		if (!hull || !turret || !hip || !shoe || !socket) throw new Error('Missing Longbow body, leg or weapon socket');
		const gait = { ...createGait({ x: 0, y: 0, angle: 0 }), motion: { lift: 2, roll: 0.07, pitch: -0.05, impact: 0 } };
		const degree = Math.PI / 180;
		const pose = function (legs: number, aim: number) {
			model.pose({ ...gait, body: { ...gait.body, angle: legs * degree } }, aim * degree);
		};
		pose(14, 70);
		expect(hull.rotation.y).toBeCloseTo(0);
		expect(turret.rotation.y).toBeCloseTo(-60 * degree);
		const firstHip = hip.getWorldPosition(new Vector3()).setY(0);
		const plant = shoe.matrixWorld.clone(), mount = socket.getWorldPosition(new Vector3());

		pose(16, 74);
		expect(hull.rotation.y).toBeCloseTo(-30 * degree);
		expect(turret.rotation.y).toBeCloseTo(-60 * degree);
		const torsoForward = new Vector3(1, 0, 0).transformDirection(turret.matrixWorld);
		expect(Math.atan2(torsoForward.z, torsoForward.x)).toBeCloseTo(60 * degree, 10);
		const rotatedHip = firstHip.applyAxisAngle(new Vector3(0, 1, 0), -30 * degree);
		expect(hip.getWorldPosition(new Vector3()).setY(0).distanceTo(rotatedHip)).toBeLessThan(1e-8);
		expect(socket.getWorldPosition(new Vector3()).distanceTo(mount)).toBeLessThan(1e-8);
		expect(shoe.matrixWorld.equals(plant)).toBe(true);

		pose(16, 76);
		expect(hull.rotation.y).toBeCloseTo(-30 * degree);
		expect(turret.rotation.y).toBeCloseTo(-90 * degree);
		expect(socket.getWorldPosition(new Vector3()).distanceTo(mount)).toBeGreaterThan(1);
		const barrel = new Vector3(1, 0, 0).transformDirection(socket.matrixWorld);
		expect(Math.atan2(barrel.z, barrel.x)).toBeCloseTo(90 * degree);
		expect(shoe.matrixWorld.equals(plant)).toBe(true);
	} finally { model.dispose(); }
});

test('independent leg samples follow walkers through a squad turn and leave hulls, gun sockets and vehicles live', function () {
	const state = createState({ frame: 'longbow' });
	const mate: Squadmate = { ...state.player, pilotId: 'flint', callsign: 'Flint', specialty: 'marksman', frameId: 'warden-b', loadout: [], shotsFired: 0, coolantCharges: 2, y: 400 };
	const scout: Unit = { x: 350, y: 220, angle: 0, id: 73, hp: 100, maxHp: 100, cooldown: 0, heavy: false, kind: 'scout' };
	const tank: Unit = { ...scout, kind: 'tank', id: 74 };
	state.squadmates = [mate]; state.enemies.push(scout, tank);
	const histories = createMechCadences();
	const model = createMech(undefined, false, 'longbow');
	const turret = model.root.getObjectByName('turret');
	if (!turret) throw new Error('Missing procedural Longbow torso');
	let gaits = createGaits(state);
	let playerHeld = false; let mateHeld = false; let enemyHeld = false; let movedShoe = false;
	try {
		for (let tick = 0; tick < 120; tick++) {
			state.time += 1 / 60;
			state.player.x += 1; state.player.angle += 0.015; state.player.turret -= 0.01;
			mate.y -= 1.25; scout.x += 1.5; tank.x -= 1;
			gaits = advanceGaits(gaits, state);
			histories.advance(state, gaits);
			const legs = histories.visualGait(state.player, gaits.player);
			const ally = gaits.squadmates.get(mate.pilotId), enemy = gaits.enemies.get(scout.id), vehicle = gaits.enemies.get(tank.id);
			if (!ally || !enemy || !vehicle) throw new Error('Missing squad actors');
			playerHeld ||= legs !== gaits.player;
			mateHeld ||= histories.visualGait(mate, ally) !== ally;
			enemyHeld ||= histories.visualGait(scout, enemy) !== enemy;
			expect(histories.visualGait(tank, vehicle)).toBe(vehicle);
			model.pose(gaits.player, state.player.turret);
			const baseline = turret.matrixWorld.clone();
			const muzzle = model.muzzles[0]?.clone();
			const shoe = model.root.getObjectByName('planted-foot');
			if (!muzzle || !shoe) throw new Error('Missing Longbow shoe or barrel');
			const foot = shoe.matrixWorld.clone();
			model.pose(gaits.player, state.player.turret, { hit: 0, heat: 0, recoil: 0, time: state.time, legGait: legs });
			expect(turret.matrixWorld.equals(baseline)).toBe(true);
			expect(model.muzzles[0]?.equals(muzzle)).toBe(true);
			movedShoe ||= !shoe.matrixWorld.equals(foot);
		}
		expect([playerHeld, mateHeld, enemyHeld, movedShoe]).toEqual([true, true, true, true]);

		state.time += 1 / 60;
		const replacement = { ...scout, x: scout.x + 600 };
		state.enemies = [replacement];
		gaits = advanceGaits(gaits, state);
		histories.advance(state, gaits);
		const fresh = gaits.enemies.get(replacement.id);
		if (!fresh) throw new Error('Missing replacement scout');
		expect(histories.visualGait(replacement, fresh)).toBe(fresh);
	} finally { model.dispose(); }
});
