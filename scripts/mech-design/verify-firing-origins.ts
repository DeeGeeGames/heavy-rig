/** Check measured physical exit rays in actual GLB assemblies over the full clip. */
import { AnimationMixer, DoubleSide, LoopOnce, Mesh, Raycaster, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) throw new Error('Provide a component package directory');
const manifest: unknown = await Bun.file(join(folder, 'package.json')).json();
if (typeof manifest !== 'object' || manifest === null || !('fps' in manifest) || !('frameCount' in manifest)) throw new Error('Missing motion timing');
const { fps, frameCount } = manifest;
if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || typeof frameCount !== 'number' || !Number.isInteger(frameCount) || frameCount < 2) throw new Error('Invalid motion timing');
const load = async function (file: string) {
	return new GLTFLoader().register(function () {
		return { name: 'HEADLESS_TEXTURE_PLACEHOLDER', loadTexture: async function () { return new Texture(); } };
	}).parseAsync(await Bun.file(join(folder, file)).arrayBuffer(), '');
};
const configurations = [
	{ variant: 'A', families: ['launcher', 'launcher'], exits: 18 },
	{ variant: 'B', families: ['energy', 'energy'], exits: 4 },
	{ variant: 'C', families: ['energy', 'launcher'], exits: 11 },
	{ variant: 'empty-shoulders', families: ['empty', 'empty'], exits: 2 },
] as const;
const results = [];
for (const configuration of configurations) {
	const chassis = await load('chassis.glb');
	for (const [index, side] of ['left', 'right'].entries()) {
		const socket = chassis.scene.getObjectByName(`socket_${side}_shoulder`);
		const family = configuration.families[index];
		if (!socket || !family) throw new Error('Missing module contract');
		socket.add((await load(`${side}-${family}.glb`)).scene);
	}
	const exits = [];
	for (const node of chassis.scene.getObjectsByProperty('type', 'Object3D')) {
		if (node.name.startsWith('physical_exit_')) exits.push(node);
	}
	if (exits.length !== configuration.exits) throw new Error(`Wrong physical exit count in ${configuration.variant}: ${exits.length}`);
	chassis.scene.traverse(function (node) {
		if (!(node instanceof Mesh)) return;
		for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.side = DoubleSide;
	});
	const clip = chassis.animations[0];
	if (!clip || chassis.animations.length !== 1 || Math.abs(clip.duration - (frameCount - 1) / fps) > 1e-6) throw new Error('Invalid full-cycle clip');
	const mixer = new AnimationMixer(chassis.scene);
	const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
	action.clampWhenFinished = true;
	action.play();
	const hits = [];
	for (let frame = 0; frame < frameCount; frame++) {
		mixer.setTime(frame / fps);
		chassis.scene.updateMatrixWorld(true);
		for (const exit of exits) {
			const ray = new Raycaster(exit.getWorldPosition(new Vector3()), new Vector3(0, 0, 1).transformDirection(exit.matrixWorld), 0, 2);
			const hit = ray.intersectObject(chassis.scene, true)[0];
			if (hit) hits.push({ frame, exit: exit.name, mesh: hit.object.name, distance: hit.distance });
		}
	}
	results.push({ variant: configuration.variant, frames: frameCount, exits: exits.length, rays: frameCount * exits.length, hits });
	mixer.stopAllAction();
	mixer.uncacheRoot(chassis.scene);
}
const report = { status: results.some(function (result) { return result.hits.length > 0; }) ? 'obstructions-found' : 'passed', scope: 'Physical exit center rays across original approved motion clips, in source units. Separate weapon aim articulation and finite projectile volume are not modeled.', results };
if (process.argv[3]) await Bun.write(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
