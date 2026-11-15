import { expect, test } from 'bun:test';
import { Mesh, Object3D, Quaternion, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { authoredMuzzleError, prepareAuthoredWarden } from '../src/authored-mech';
import { createGait } from '../src/gait';

test('selected Warden plants both feet through turns, forward/reverse, braking and paused rendering', async function () {
	const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_LOCOMOTION', loadTexture: async function () { return new Texture(); } }; });
	const asset = await loader.parseAsync(await Bun.file(new URL('../public/assets/mechs/warden/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredWarden(asset); const remove = factory.install(); const model = factory.create();
	const named = function (name: string): Object3D { const node = model.root.getObjectByName(name); if (!node) throw new Error(`Missing ${name}`); return node; };
	const feet = ['left', 'right'].map(function (side) { return named(`rig_leg_${side}_foot`); });
	const vertices: { node: Mesh; point: Vector3 }[] = [];
	model.root.traverse(function (node) {
		if (!(node instanceof Mesh)) return;
		const position = node.geometry.getAttribute('position');
		for (let index = 0; index < position.count; index++) vertices.push({ node, point: new Vector3().fromBufferAttribute(position, index) });
	});
	let body = { x: 500, y: 400, angle: 0 }; let context = factory.advancePose(undefined, body, 0);
	const positions = feet.map(function () { return new Vector3(); }); const rotations = feet.map(function () { return new Quaternion(); });
	let maximumSlide = 0; let maximumTwist = 0; let minimumGround = Infinity; let maximumMuzzleError = 0; let lifted = 0;
	const planted = [0, 0];
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
			for (const vertex of vertices) minimumGround = Math.min(minimumGround, vertex.point.clone().applyMatrix4(vertex.node.matrixWorld).y);
		}
		expect(planted.every(function (count) { return count > 100; })).toBe(true);
		expect(lifted).toBeGreaterThan(100);
		expect(maximumSlide).toBeLessThan(1e-6);
		expect(maximumTwist).toBeLessThan(1e-10);
		expect(minimumGround).toBeGreaterThan(-1e-5);
		expect(maximumMuzzleError).toBeLessThan(1e-7);
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
