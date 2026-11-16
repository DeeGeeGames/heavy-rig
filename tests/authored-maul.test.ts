import { expect, test } from 'bun:test';
import { AnimationClip, Mesh, Quaternion, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredMaul, authoredMuzzleError } from '../src/authored-mech';
import { createGait } from '../src/gait';
import type { AuthoredPoseContext } from '../src/authored-pose';

test('Maul keeps forward-bending knees, firing alignment and a vertical torso through locomotion', async function () {
	// This regression evaluates geometry and transforms; browser QA covers images.
	const source = await new GLTFLoader().register(function () {
		return { name: 'HEADLESS_MAUL', loadTexture: async function () { return new Texture(); } };
	}).parseAsync(await Bun.file(new URL('../public/assets/mechs/maul/game-ready.glb', import.meta.url)).arrayBuffer(), '');
	const animations = ['walk', 'run', 'backward'].map(function (name) {
		const clip = new AnimationClip(name, 1, []);
		clip.userData['nominalForwardSpeed'] = name === 'run' ? 0.5 : name === 'backward' ? -0.1 : 0.1;
		return clip;
	});
	const factory = prepareAuthoredMaul({ scene: source.scene, animations });
	const uninstall = factory.install();
	const model = factory.create();
	const torso = model.root.getObjectByName('rig_torso');
	if (!torso) throw new Error('Missing Maul torso');
	let context: AuthoredPoseContext | undefined;
	let body = { x: 0, y: 0, angle: 0 };
	let time = 0;
	const quaternion = new Quaternion();
	const legs = ['left', 'right'].map(function (side) {
		const hip = model.root.getObjectByName(`rig_leg_${side}_thigh`);
		const knee = model.root.getObjectByName(`rig_leg_${side}_shin`);
		const ankle = model.root.getObjectByName(`rig_leg_${side}_foot`);
		if (!hip || !knee || !ankle) throw new Error('Missing Maul leg joints');
		return { hip, knee, ankle, previous: new Vector3() };
	});
	try {
		for (const speed of [30, 82, 0, -40]) for (let frame = 0; frame < 120; frame++) {
			const dt = 1 / 60;
			body = { x: body.x + Math.cos(body.angle) * speed * dt, y: body.y + Math.sin(body.angle) * speed * dt, angle: body.angle + dt * 0.2 };
			time += dt;
			context = factory.advancePose(context, body, time);
			const gait = createGait(body);
			const heading = body.angle + Math.sin(time) * 1.2;
			model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time, authoredPose: context });
			const up = new Vector3(0, 1, 0).applyQuaternion(torso.getWorldQuaternion(quaternion));
			expect(up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-10);
			expect(authoredMuzzleError(model, factory.weaponRigs, gait, heading, undefined, context, 'maul')).toBeLessThan(1e-8);
			const forward = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), -(context.gait?.body.angle ?? body.angle));
			for (const leg of legs) {
				const hip = leg.hip.getWorldPosition(new Vector3());
				const knee = leg.knee.getWorldPosition(new Vector3());
				const axis = leg.ankle.getWorldPosition(new Vector3()).sub(hip).normalize();
				const bend = knee.clone().sub(hip);
				bend.addScaledVector(axis, -bend.dot(axis));
				expect(bend.dot(forward)).toBeGreaterThan(0);
				if (frame > 20) expect(knee.distanceTo(leg.previous)).toBeLessThan(6);
				leg.previous.copy(knee);
			}
		}
	} finally {
		model.dispose(); uninstall(); factory.dispose();
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
