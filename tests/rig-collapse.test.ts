import { expect, test } from 'bun:test';
import { InstancedMesh, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredWarden } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import type { MechAssetModel } from '../src/mech-asset-registry';
import { RIG_DEFEAT_SECONDS } from '../src/rig-defeat-timing';

const named = function (parent: Object3D, name: string) {
	const node = parent.getObjectByName(name);
	if (!node) throw new Error('Missing rig part ' + name);
	return node;
};

const checkDefeat = function (model: MechAssetModel, joints: Object3D[], hip: Object3D, muzzle: Object3D) {
	const body = { x: 173, y: 194, angle: 0 };
	model.pose(createGait(body), 0);
	model.root.updateWorldMatrix(true, true);
	const transforms = function () { return joints.flatMap(function (joint) { return joint.matrixWorld.toArray(); }); };
	const position = function (node: Object3D) { return node.getWorldPosition(new Vector3()); };
	const standing = joints.map(function (joint) { return { joint, point: position(joint), rotation: joint.getWorldQuaternion(new Quaternion()) }; });
	const hipStart = position(hip), muzzleStart = position(muzzle);
	const sample = model.beginCollapse?.({ ...body, heading: body.angle, side: 1 });
	if (!sample) throw new Error('Missing rig defeat animation');
	sample(0.5);
	for (const { joint, point, rotation } of standing) {
		expect(position(joint).distanceTo(point)).toBeLessThan(1e-6);
		expect(joint.getWorldQuaternion(new Quaternion()).angleTo(rotation)).toBeLessThan(1e-6);
	}
	expect(muzzleStart.y - position(muzzle).y).toBeGreaterThan(10);

	sample(1.05);
	expect(hipStart.y - position(hip).y).toBeGreaterThan(10);
	sample(1.75);
	expect(hipStart.x - position(hip).x).toBeGreaterThan(15);
	const settled = transforms();
	sample(3);
	expect(transforms()).toEqual(settled);
};

test('the authored Warden drops its guns with both legs braced, then folds into a stable wreck', async function () {
	const asset = await new GLTFLoader().parseAsync(await Bun.file(new URL('../public/assets/mechs/warden/pixel.glb', import.meta.url)).arrayBuffer(), '');
	const factory = prepareAuthoredWarden(asset), model = factory.create();
	try {
		const joints = ['left', 'right'].flatMap(function (side) {
			return ['thigh', 'shin', 'foot'].map(function (part) { return named(model.root, 'rig_leg_' + side + '_' + part); });
		});
		checkDefeat(model, joints, named(model.root, 'rig_pelvis'), named(model.root, 'physical_exit_right_gun_1'));
	} finally { model.dispose(); factory.dispose(); }
});

test('a procedural enemy connects its combat pose at the joints and follows the same delayed release', function () {
	const model = createMech('striker');
	try {
		const legs = ['left-leg', 'right-leg'].map(function (name) { return named(model.root, name); });
		const joints = legs.flatMap(function (leg) { return ['hip', 'knee', 'ankle'].map(function (name) { return named(leg, name); }); });
		checkDefeat(model, joints, named(model.root, 'hip'), named(model.root, 'weapon-muzzle'));
	} finally { model.dispose(); }
});

test('an unequipped rig still flashes at five distinct armor sites and retires its effects', function () {
	const model = createMech(undefined, false, 'morrow');
	try {
		model.pose(createGait({ x: 0, y: 0, angle: 0 }), 0, { time: 0, hit: 0, heat: 0, recoil: 0, equippedSlots: [] });
		const sample = model.beginCollapse?.({ x: 0, y: 0, heading: 0, side: -1 });
		if (!sample) throw new Error('Missing rig defeat animation');
		const effects = function () { return model.root.children.find(function (node) { return node.userData['nativeEffects'] === true; }); };
		const flashes = new Map<Object3D, Vector3>();
		for (let tick = 0; tick < RIG_DEFEAT_SECONDS * 60; tick++) {
			sample(tick / 60);
			for (const part of effects()?.children ?? []) {
				if (part instanceof Mesh && !(part instanceof InstancedMesh) && part.visible && !flashes.has(part)) {
					flashes.set(part, part.getWorldPosition(new Vector3()));
				}
			}
		}
		expect(flashes.size).toBe(5);
		const sites = [...flashes.values()];
		for (const [i, site] of sites.entries()) {
			for (const other of sites.slice(i + 1)) expect(site.distanceTo(other)).toBeGreaterThan(4);
		}
		sample(RIG_DEFEAT_SECONDS);
		expect(effects()).toBeUndefined();
		sample(30);
		expect(effects()).toBeUndefined();
	} finally { model.dispose(); }
});
