import { expect, test } from 'bun:test';
import { Box3, Mesh, Object3D, Quaternion, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { authoredMuzzleError, prepareAuthoredKestrel } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { FRAME_RIGS } from '../src/frame-rig';
import { getFrame } from '../src/frames';
import { coolingStep, createState, movementStep, type Controls } from '../src/simulation';
import { createMech } from '../src/mech-3d';
import { getPlayerMuzzle, getPlayerWeaponRig } from '../src/weapon-rig';

test('retained Kestrel preserves equipped slots, fixed-step contacts and firing origins through full-speed movement', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_KESTREL', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/kestrel/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const procedural = createMech(undefined, false, 'kestrel');
	procedural.pose(createGait({ x: 0, y: 0, angle: 0 }, getFrame('kestrel').size, FRAME_RIGS.kestrel), 0);
	const expectedHeight = new Box3().setFromObject(procedural.root).getSize(new Vector3()).y; procedural.dispose();
	const factory = prepareAuthoredKestrel(asset); expect(factory.height).toBeCloseTo(expectedHeight, 6); const remove = factory.install(); const model = createMech(undefined, false, 'kestrel');
	const named = function (name: string): Object3D { const node = model.root.getObjectByName(name); if (!node) throw new Error(`Missing ${name}`); return node; };
	const feet = ['left', 'right'].map(function (side) { return named(`rig_leg_${side}_foot`); });
	const footVertices = feet.map(function (foot) {
		const vertices: { mesh: Mesh; point: Vector3 }[] = [];
		foot.traverse(function (node) {
			if (!(node instanceof Mesh)) return;
			const position = node.geometry.getAttribute('position');
			for (let index = 0; index < position.count; index++) vertices.push({ mesh: node, point: new Vector3().fromBufferAttribute(position, index) });
		});
		return vertices;
	});
	const positions = feet.map(function () { return new Vector3(); }); const rotations = feet.map(function () { return new Quaternion(); });
	const state = createState({ frame: 'kestrel' }); state.spawnIn = 3600;
	let maximumSlide = 0; let minimumGround = Infinity; let maximumMuzzleError = 0; let planted = 0; let ran = false; let tick = 0;
	try {
		expect(model.root.name).toBe('authored-kestrel-frame');
		expect(factory.weaponRigs).toHaveLength(2);
		expect(factory.weaponRigs.every(function (rig) { return rig.tubes.length === 0; })).toBe(true);
		const variant = createMech(undefined, false, 'kestrel-b'); expect(variant.root.name).toBe('kestrel-b-frame'); variant.dispose();
		for (const [drive, turn, stop, ticks] of [[1, 0, false, 180], [1, -1, false, 120], [1, 1, false, 120], [0, 0, true, 90], [-1, 1, false, 180], [0, 0, true, 90]] as const) {
			const controls: Controls = { drive, turn, stop, aim: { x: 1500, y: 300 }, fire: [false, false, false, false], coolant: false };
			for (let frame = 0; frame < ticks; frame++) {
				const before = state.authoredPose; tick++;
				coolingStep(state, controls, 1 / 60); movementStep(state, controls, 1 / 60);
				const context = state.authoredPose; const gait = context?.gait; if (!context || !gait) throw new Error('Missing Kestrel fixed-step pose');
				ran ||= gait.running !== undefined;
				const heading = state.player.angle + Math.sin(tick / 25);
				model.root.position.set(state.player.x, 0, state.player.y);
				model.pose(createGait(state.player), heading, { recoil: 0, hit: 0, heat: 0, time: state.time, authoredPose: context, equippedSlots: [0] });
				maximumMuzzleError = Math.max(maximumMuzzleError, authoredMuzzleError(model, factory.weaponRigs, createGait(state.player), heading, undefined, context, 'kestrel'));
				for (const [index, foot] of feet.entries()) {
					const old = before?.gait?.feet[index]; const contact = gait.feet[index]; const position = positions[index]; const rotation = rotations[index];
					if (!position || !rotation || !contact) throw new Error('Incomplete Kestrel foot state');
					const currentPosition = foot.getWorldPosition(new Vector3()); const currentRotation = foot.getWorldQuaternion(new Quaternion());
					if (old && old.lift === 0 && contact.lift === 0 && old.x === contact.x && old.y === contact.y && old.angle === contact.angle) {
						maximumSlide = Math.max(maximumSlide, position.distanceTo(currentPosition)); planted++;
					}
					position.copy(currentPosition); rotation.copy(currentRotation);
				}
				if (tick % 5 === 0) for (const vertices of footVertices) for (const vertex of vertices) minimumGround = Math.min(minimumGround, vertex.point.clone().applyMatrix4(vertex.mesh.matrixWorld).y);
			}
		}
		expect(named('rig_mount_left-gun').visible).toBe(true);
		expect(named('rig_mount_right-gun').visible).toBe(false);
		const context = state.authoredPose; if (!context) throw new Error('Missing Kestrel pose');
		const heading = state.player.angle + Math.sin(tick / 25); const frozen = feet.map(function (foot) { return foot.matrixWorld.toArray(); });
		expect(factory.advancePose(context, state.player, context.time)).toBe(context);
		model.pose(createGait(state.player), heading, { recoil: 0, hit: 0, heat: 0, time: context.time, authoredPose: context, equippedSlots: [] });
		expect(feet.map(function (foot) { return foot.matrixWorld.toArray(); })).toEqual(frozen);
		expect(named('rig_mount_left-gun').visible).toBe(false);
		expect(named('rig_mount_right-gun').visible).toBe(false);
		const rightOrigin = getPlayerMuzzle('kestrel', 1, state.player, heading, undefined, undefined, context);
		expect([rightOrigin.x, rightOrigin.y, rightOrigin.elevation].every(Number.isFinite)).toBe(true);
		expect(planted).toBeGreaterThan(200);
		expect(ran).toBe(true);
		expect(maximumSlide).toBeLessThan(1e-5);
		expect(minimumGround).toBeGreaterThan(-1e-5);
		expect(maximumMuzzleError).toBeLessThan(1e-7);
	} finally {
		model.dispose(); remove(); factory.dispose();
		asset.scene.traverse(function (node) { if (!(node instanceof Mesh)) return; node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); } });
	}
	expect(getPlayerWeaponRig('kestrel')).not.toBe(factory.weaponRigs);
});

test('Kestrel bounds through sustained flight with its torso rising above the supported pose', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_KESTREL_BOUND', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/kestrel/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredKestrel(asset); const model = factory.create();
	try {
		const torso = model.root.getObjectByName('rig_torso'); if (!torso) throw new Error('Missing Kestrel torso');
		const soles = ['left', 'right'].map(function (side) {
			const foot = model.root.getObjectByName(`rig_leg_${side}_foot`); if (!foot) throw new Error('Missing Kestrel foot');
			const vertices: { mesh: Mesh; point: Vector3 }[] = [];
			foot.traverse(function (node) {
				if (!(node instanceof Mesh)) return;
				const position = node.geometry.getAttribute('position');
				for (let index = 0; index < position.count; index++) vertices.push({ mesh: node, point: new Vector3().fromBufferAttribute(position, index) });
			});
			return vertices;
		});
		// Exercise nominal and light-load pace. Measure the rendered sole and torso,
		// since valid numeric contacts alone can still produce a grounded fast walk.
		for (const speed of [90, 145]) {
			let body = { x: 0, y: 0, angle: 0 }; let context = factory.advancePose(undefined, body, 0);
			let airborne = 0; let longestFlight = 0; let flightFrames = 0; let supportFrames = 0;
			let flightTorso = 0; let supportTorso = 0; let low = Infinity; let high = -Infinity;
			let previousTorso: number | undefined; let largestVerticalStep = 0;
			const touchdowns: [number | undefined, number | undefined] = [undefined, undefined]; const strides: number[] = [];
			for (let tick = 1; tick <= 300; tick++) {
				const before = context.gait; body = { ...body, x: body.x + speed / 60 };
				context = factory.advancePose(context, body, tick / 60);
				const gait = context.gait; if (!gait) throw new Error('Missing bounding pose');
				model.root.position.set(body.x, 0, body.y);
				model.pose(createGait(body), 0, { recoil: 0, hit: 0, heat: 0, time: tick / 60, authoredPose: context });
				if (tick <= 60) continue;
				const height = torso.getWorldPosition(new Vector3()).y; low = Math.min(low, height); high = Math.max(high, height);
				if (previousTorso !== undefined) largestVerticalStep = Math.max(largestVerticalStep, Math.abs(height - previousTorso));
				previousTorso = height;
				const flying = soles.every(function (vertices) { return vertices.every(function (vertex) { return vertex.point.clone().applyMatrix4(vertex.mesh.matrixWorld).y > 0.5; }); });
				if (flying) { airborne++; flightFrames++; flightTorso += height; longestFlight = Math.max(longestFlight, airborne); }
				else { airborne = 0; supportFrames++; supportTorso += height; }
				for (const index of [0, 1] as const) {
					const foot = gait.feet[index]; const prior = touchdowns[index];
					if ((before?.feet[index].lift ?? 0) <= 0 || foot.lift !== 0) continue;
					if (prior !== undefined) strides.push(foot.x - prior);
					touchdowns[index] = foot.x;
				}
			}
			// Clear flight lasts several rendered frames, and the body crest follows it.
			expect(longestFlight / 60).toBeGreaterThan(0.1);
			expect(supportFrames).toBeGreaterThan(30);
			expect(flightFrames).toBeGreaterThan(30);
			expect(flightTorso / flightFrames - supportTorso / supportFrames).toBeGreaterThan(2);
			expect(high - low).toBeGreaterThan(4);
			expect(largestVerticalStep).toBeLessThan(3);
			expect(strides.length).toBeGreaterThan(5);
			expect(strides.reduce(function (sum, stride) { return sum + stride; }, 0) / strides.length).toBeGreaterThan(60);
		}
	} finally {
		model.dispose(); factory.dispose();
		asset.scene.traverse(function (node) { if (!(node instanceof Mesh)) return; node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); } });
	}
});
