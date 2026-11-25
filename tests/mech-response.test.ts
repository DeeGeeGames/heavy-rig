import { expect, test } from 'bun:test';
import { Mesh, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredWarden } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { sampleMechResponses } from '../src/mech-response';
import { createState, type Effect } from '../src/simulation';

test('the playable Warden cycles only the firing mounts and recovers its planted pose and firing exits', async function () {
	const url = new URL('../public/assets/mechs/warden/pixel.glb', import.meta.url);
	const source = await new GLTFLoader().parseAsync(await Bun.file(url).arrayBuffer(), '');
	const factory = prepareAuthoredWarden(source); const model = factory.create();
	const state = createState(); const gait = createGait(state.player);
	const authoredPose = factory.advancePose(undefined, state.player, 0);
	const named = function (name: string) {
		const node = model.root.getObjectByName(name);
		if (!node) throw new Error(`Missing Warden joint ${name}`);
		return node;
	};
	const pose = function () {
		const response = sampleMechResponses(state).get(0);
		model.pose(gait, Math.PI / 2, { recoil: 0, hit: 0, heat: 0, time: state.time, authoredPose, ...(response ? { response } : {}) });
	};
	try {
		pose();
		const left = named('rig_mount_left-gun'); const right = named('rig_mount_right-gun');
		const torso = named('rig_torso'); const foot = named('rig_leg_left_foot');
		const leftHome = left.position.clone(); const rightHome = right.position.clone();
		const planted = foot.matrixWorld.clone(); const resting = torso.matrixWorld.clone();
		const exits = model.muzzles.map(function (muzzle) { return muzzle.toArray(); });
		const direction = { x: 0, y: 1, elevation: 0 };
		const base = { x: 0, y: 0, life: 0.75, size: 1, color: '#fff' };
		const shot: Effect = { ...base, feedback: { type: 'fire', slot: 0, family: 'cannon', shooter: 0, heavy: false, time: 0, direction } };
		state.time = 0.026;
		state.effects.push(shot, shot);
		pose();
		const travel = torso.localToWorld(left.position.clone()).sub(torso.localToWorld(leftHome.clone()));
		expect(travel.length()).toBeCloseTo(11, 8);
		expect(travel.z).toBeLessThan(-10);
		expect(right.position).toEqual(rightHome);
		expect(foot.matrixWorld).toEqual(planted);
		expect(model.muzzles.map(function (muzzle) { return muzzle.toArray(); })).toEqual(exits);
		const held = left.matrixWorld.clone();
		pose();
		expect(left.matrixWorld).toEqual(held);
		state.effects.push({ ...base, feedback: { type: 'fire', slot: 1, family: 'bullet', shooter: 0, heavy: false, time: state.time - 0.016, direction } });
		pose();
		expect(torso.localToWorld(right.position.clone()).distanceTo(torso.localToWorld(rightHome.clone()))).toBeCloseTo(4.4, 8);
		state.effects.length = 0;
		state.effects.push({ ...base, feedback: { type: 'impact', surface: 'armor', target: 0, family: 'cannon', shooter: 9, heavy: false, time: 0, direction } });
		state.time = 0.035;
		pose();
		const up = new Vector3(0, 1, 0).transformDirection(torso.matrixWorld);
		expect(up.z).toBeGreaterThan(0.1);
		expect(foot.matrixWorld).toEqual(planted);
		state.time = 0.6;
		pose();
		expect(left.position).toEqual(leftHome);
		expect(right.position).toEqual(rightHome);
		expect(torso.matrixWorld).toEqual(resting);
	} finally {
		model.dispose(); factory.dispose();
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
