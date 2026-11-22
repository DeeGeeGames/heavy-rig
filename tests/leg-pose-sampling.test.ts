import { expect, test } from 'bun:test';
import { Mesh, Object3D, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredKestrel, prepareAuthoredMaul, prepareAuthoredWarden } from '../src/authored-mech';
import { createContactCadence } from '../src/mech-cadence';
import { createGait, type WalkerGait } from '../src/gait';
import { createMech } from '../src/mech-3d';

const transforms = function (nodes: readonly Object3D[]) {
	return nodes.map(function (node) { return [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]; });
};
const feetChanged = function (gait: WalkerGait, previous: WalkerGait | undefined) {
	return !previous || gait.feet.some(function (foot, side) {
		const old = previous.feet[side];
		return !old || foot.x !== old.x || foot.y !== old.y || foot.lift !== old.lift || foot.angle !== old.angle;
	});
};

for (const [frame, prepare] of [['warden', prepareAuthoredWarden], ['kestrel', prepareAuthoredKestrel], ['maul', prepareAuthoredMaul]] as const) {
	test(`${frame} holds entire solved leg poses while torso, travel and muzzles stay live`, async function () {
		const source = await new GLTFLoader().register(function () {
			return { name: 'HEADLESS_STILL_SAMPLING', loadTexture: async function () { return new Texture(); } };
		}).parseAsync(await Bun.file(new URL(`../public/assets/mechs/${frame}/game-ready.glb`, import.meta.url)).arrayBuffer(), '');
		const factory = prepare(source); const sampled = factory.create(); const live = factory.create();
		const named = function (model: typeof sampled, name: string) {
			const node = model.root.getObjectByName(name); if (!node) throw new Error(`Missing ${name}`); return node;
		};
		const legs = ['left', 'right'].flatMap(function (side) {
			return ['thigh', 'shin', 'foot'].map(function (joint) { return named(sampled, `rig_leg_${side}_${joint}`); });
		});
		const cadence = createContactCadence();
		let body = { x: 100, y: 200, angle: 0 }; let context = factory.advancePose(undefined, body, 0);
		let previous: WalkerGait | undefined; let snapshot = transforms(legs);
		let holds = 0; let updates = 0; let runningHolds = 0; let reverseHolds = 0;
		try {
			for (let tick = 1; tick <= 720; tick++) {
				const speed = tick < 240 ? 30 : tick < 480 ? 100 : tick < 660 ? -30 : 0;
				body = { x: body.x + Math.cos(body.angle) * speed / 60, y: body.y + Math.sin(body.angle) * speed / 60, angle: body.angle + 0.003 };
				context = factory.advancePose(context, body, tick / 60);
				if (!context.gait) throw new Error('Missing authored gait');
				cadence.advance(context.gait, context.time);
				const legGait = cadence.visualGait(context.gait);
				const heading = body.angle + Math.sin(tick / 40);
				const feedback = { recoil: 0, hit: 0, heat: 0, time: context.time, authoredPose: context };
				for (const model of [sampled, live]) model.root.position.set(body.x, 0, body.y);
				sampled.pose(context.gait, heading, { ...feedback, legGait });
				live.pose(context.gait, heading, feedback);
				expect(named(sampled, 'rig_torso').matrixWorld.toArray()).toEqual(named(live, 'rig_torso').matrixWorld.toArray());
				expect(sampled.muzzles.map(function (muzzle) { return muzzle.toArray(); })).toEqual(live.muzzles.map(function (muzzle) { return muzzle.toArray(); }));
				const current = transforms(legs);
				if (!feetChanged(legGait, previous)) {
					expect(current).toEqual(snapshot);
					holds++;
					if (context.gait.running) runningHolds++;
					if (speed < 0) reverseHolds++;
				} else if (previous && JSON.stringify(current) !== JSON.stringify(snapshot)) updates++;
				snapshot = current; previous = legGait;
			}
			expect(holds).toBeGreaterThan(200);
			expect(runningHolds).toBeGreaterThan(100);
			expect(reverseHolds).toBeGreaterThan(30);
			expect(updates).toBeGreaterThan(30);
			// Switching to the native comparison clears the held pose; enabling
			// sampling again must capture the current legs, even with the same targets.
			if (!context.gait || !previous) throw new Error('Missing final gait');
			const legsNow = context.gait;
			const feedback = { recoil: 0, hit: 0, heat: 0, time: context.time, authoredPose: context };
			sampled.pose(legsNow, 0, feedback);
			const native = transforms(legs);
			sampled.pose(legsNow, 0, { ...feedback, legGait: previous });
			expect(transforms(legs)).toEqual(native);
		} finally {
			sampled.dispose(); live.dispose(); factory.dispose();
			source.scene.traverse(function (node) {
				if (!(node instanceof Mesh)) return;
				node.geometry.dispose();
				for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
					for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
					material.dispose();
				}
			});
		}
	});
}

test('procedural walkers freeze joints, shoes and hydraulics without holding their gun mounts', function () {
	const model = createMech('scout');
	const parts: Object3D[] = [];
	model.root.traverse(function (node) { if (['upper-leg', 'lower-leg', 'hip', 'knee', 'ankle', 'hydraulic-sleeve', 'hydraulic-rod', 'planted-foot', 'ankle-roll'].includes(node.name)) parts.push(node); });
	const gait = createGait({ x: 100, y: 200, angle: 0 });
	const feedback = { hit: 0, heat: 0, recoil: 0, time: 1, legGait: gait };
	try {
		model.pose(gait, 0, feedback);
		const frozen = transforms(parts); const muzzle = model.muzzles[0]?.clone();
		const moved = { ...gait, body: { x: 105, y: 202, angle: 0.2 }, motion: { ...gait.motion, lift: 2, roll: 0.03 } };
		model.pose(moved, 0.5, { ...feedback, legGait: moved });
		expect(parts.length).toBeGreaterThan(10);
		expect(transforms(parts)).toEqual(frozen);
		expect(model.muzzles[0]?.equals(muzzle ?? model.root.position)).toBe(false);
		model.pose(moved, 0.5);
		expect(transforms(parts)).not.toEqual(frozen);
		const native = transforms(parts);
		model.pose(moved, 0.5, { ...feedback, legGait: moved });
		expect(transforms(parts)).toEqual(native);
	} finally { model.dispose(); }
});
