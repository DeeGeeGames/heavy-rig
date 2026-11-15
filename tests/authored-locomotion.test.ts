import { expect, test } from 'bun:test';
import { Mesh, Object3D, Quaternion, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { authoredMuzzleError, prepareAuthoredWarden } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { coolingStep, createState, movementStep, type Controls } from '../src/simulation';

test('selected Warden plants both feet through turns, forward/reverse, braking and paused rendering', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_LOCOMOTION', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/warden/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredWarden(asset); const remove = factory.install(); const model = factory.create();
	const named = function (name: string): Object3D { const node = model.root.getObjectByName(name); if (!node) throw new Error(`Missing ${name}`); return node; };
	const feet = ['left', 'right'].map(function (side) { return named(`rig_leg_${side}_foot`); });
	const footMeshes = feet.map(function (foot) { const meshes = new Set<Mesh>(); foot.traverse(function (node) { if (node instanceof Mesh) meshes.add(node); }); return meshes; });
	const vertices: { node: Mesh; point: Vector3; foot: number }[] = [];
	model.root.traverse(function (node) {
		if (!(node instanceof Mesh)) return;
		const position = node.geometry.getAttribute('position');
		for (let index = 0; index < position.count; index++) vertices.push({ node, point: new Vector3().fromBufferAttribute(position, index), foot: footMeshes.findIndex(function (meshes) { return meshes.has(node); }) });
	});
	let body = { x: 500, y: 400, angle: 0 }; let context = factory.advancePose(undefined, body, 0);
	const positions = feet.map(function () { return new Vector3(); }); const rotations = feet.map(function () { return new Quaternion(); });
	let maximumSlide = 0; let maximumTwist = 0; let minimumGround = Infinity; let maximumMuzzleError = 0; let lifted = 0;
	const planted = [0, 0];
	let flightFrames = 0; let pausedFlight = false;
	try {
		for (let tick = 0; tick <= 900; tick++) {
			const before = context;
			if (tick > 0) {
				const turn = tick < 180 ? 1.6 : tick < 300 ? -1.6 : tick < 600 ? 0.6 : 0;
				const speed = tick < 300 ? 0 : tick < 600 ? 90 : tick < 780 ? -35 : 0;
				const angle = body.angle + turn / 60;
				body = { x: body.x + Math.cos(angle) * speed / 60, y: body.y + Math.sin(angle) * speed / 60, angle };
				context = factory.advancePose(context, body, tick / 60);
			}
			const gait = context.gait; if (!gait) throw new Error('Missing procedural contacts');
			model.root.position.set(body.x, 0, body.y);
			const heading = body.angle + Math.sin(tick / 35);
			model.pose(createGait(body), heading, { recoil: 0, hit: 0, heat: 0, time: tick / 60, authoredPose: context });
			maximumMuzzleError = Math.max(maximumMuzzleError, authoredMuzzleError(model, factory.weaponRigs, createGait(body), heading, undefined, context));
			for (const [index, foot] of feet.entries()) {
				const contact = gait.feet[index]; const old = before.gait?.feet[index]; const position = positions[index]; const rotation = rotations[index];
				if (!contact || !position || !rotation) throw new Error('Incomplete foot state');
				const currentPosition = foot.getWorldPosition(new Vector3()); const currentRotation = foot.getWorldQuaternion(new Quaternion());
				if (tick > 0 && old && old.lift === 0 && contact.lift === 0 && old.x === contact.x && old.y === contact.y && old.angle === contact.angle) {
					maximumSlide = Math.max(maximumSlide, position.distanceTo(currentPosition));
					maximumTwist = Math.max(maximumTwist, 1 - Math.abs(rotation.dot(currentRotation)));
					planted[index] = (planted[index] ?? 0) + 1;
				}
				if (contact.lift > 1) lifted++;
				position.copy(currentPosition); rotation.copy(currentRotation);
			}
			const soles = [Infinity, Infinity];
			for (const vertex of vertices) {
				const height = vertex.point.clone().applyMatrix4(vertex.node.matrixWorld).y;
				minimumGround = Math.min(minimumGround, height);
				if (vertex.foot >= 0) soles[vertex.foot] = Math.min(soles[vertex.foot] ?? Infinity, height);
			}
			if (soles.every(function (height) { return height > 2; })) {
				flightFrames++;
				if (!pausedFlight) {
					const frozen = feet.map(function (foot) { return foot.matrixWorld.toArray(); });
					expect(factory.advancePose(context, body, context.time)).toBe(context);
					model.pose(createGait(body), heading, { recoil: 0, hit: 0, heat: 0, time: context.time, authoredPose: context });
					expect(feet.map(function (foot) { return foot.matrixWorld.toArray(); })).toEqual(frozen);
					pausedFlight = true;
				}
			}
			if (tick < 300 || tick > 660) expect(gait.running).toBeUndefined();
		}
		expect(planted.every(function (count) { return count > 100; })).toBe(true);
		expect(lifted).toBeGreaterThan(100);
		expect(maximumSlide).toBeLessThan(1e-6);
		expect(maximumTwist).toBeLessThan(1e-10);
		expect(minimumGround).toBeGreaterThan(-1e-5);
		expect(maximumMuzzleError).toBeLessThan(1e-7);
		expect(flightFrames).toBeGreaterThan(20);
		const snapshot = feet.map(function (foot) { return foot.matrixWorld.toArray(); });
		const unchanged = factory.advancePose(context, body, context.time);
		expect(unchanged).toEqual(context);
		for (let frame = 0; frame < 5; frame++) model.pose(createGait(body), body.angle + Math.sin(900 / 35), { recoil: 0, hit: 0, heat: 0, time: context.time, authoredPose: context });
		expect(feet.map(function (foot) { return foot.matrixWorld.toArray(); })).toEqual(snapshot);
	} finally {
		model.dispose(); remove(); factory.dispose();
		asset.scene.traverse(function (node) { if (!(node instanceof Mesh)) return; node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); } });
	}
});

test('Warden uses longer walking steps and run-speed hysteresis before returning to a grounded walk', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_RUN_TRANSITION', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/warden/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredWarden(asset);
	let body = { x: 0, y: 0, angle: 0 }; let context = factory.advancePose(undefined, body, 0); let tick = 0;
	const touchdowns = [0, 0]; let longestWalkStride = 0;
	try {
		for (const [speed, count, running] of [[38, 240, false], [49, 120, false], [51, 120, true], [46, 120, true], [40, 120, false], [0, 60, false]] as const) {
			for (let frame = 0; frame < count; frame++) {
				const before = context.gait;
				body = { ...body, x: body.x + speed / 60 }; tick++;
				context = factory.advancePose(context, body, tick / 60);
				const gait = context.gait; if (!gait) throw new Error('Missing gait');
				if (speed === 38) for (const index of [0, 1] as const) {
					const foot = gait.feet[index];
					if ((before?.feet[index].lift ?? 0) > 0 && foot.lift === 0) { longestWalkStride = Math.max(longestWalkStride, foot.x - (touchdowns[index] ?? 0)); touchdowns[index] = foot.x; }
				}
			}
			expect(Boolean(context.gait?.running)).toBe(running);
		}
		expect(longestWalkStride).toBeGreaterThan(35);
		expect(context.gait?.feet.every(function (foot) { return foot.lift === 0; })).toBe(true);
	} finally {
		factory.dispose();
		asset.scene.traverse(function (node) { if (!(node instanceof Mesh)) return; node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); } });
	}
});

test('normal Warden acceleration enters a run and settles through steering, braking and reversal', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_ACCELERATION', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/warden/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredWarden(asset); const remove = factory.install(); const state = createState();
	let ran = false; let flew = false; let maximumAirStep = 0;
	try {
		for (const [drive, turn, stop, ticks] of [[1, 0, false, 240], [1, -1, false, 120], [1, 1, false, 120], [0, 0, true, 90], [-1, 1, false, 180], [0, 0, true, 90]] as const) {
			const controls: Controls = { drive, turn, stop, aim: { x: 1500, y: 300 }, fire: [false, false, false, false], coolant: false };
			for (let tick = 0; tick < ticks; tick++) {
				const before = state.authoredPose?.gait;
				coolingStep(state, controls, 1 / 60); movementStep(state, controls, 1 / 60);
				const gait = state.authoredPose?.gait;
				if (before?.running && gait?.running) for (const index of [0, 1] as const) {
					const old = before.feet[index]; const foot = gait.feet[index];
					if (old.lift > 0 && foot.lift > 0) maximumAirStep = Math.max(maximumAirStep, Math.hypot(foot.x - old.x, foot.y - old.y, foot.lift - old.lift));
				}
				ran ||= gait?.running !== undefined;
				flew ||= gait?.feet.every(function (foot) { return foot.lift > 2; }) ?? false;
			}
		}
		expect(ran).toBe(true); expect(flew).toBe(true);
		expect(maximumAirStep).toBeLessThan(6);
		expect(state.authoredPose?.gait?.running).toBeUndefined();
		expect(state.authoredPose?.gait?.feet.every(function (foot) { return foot.lift === 0; })).toBe(true);
	} finally {
		remove(); factory.dispose();
		asset.scene.traverse(function (node) { if (!(node instanceof Mesh)) return; node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); } });
	}
});
