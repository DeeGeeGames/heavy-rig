/** Audit straight firing rays in the authoring clip; report scale against current standing Warden. */
import { AnimationMixer, Box3, DoubleSide, LoopOnce, Mesh, Texture, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMech } from '../../src/mech-3d';
import { createGait } from '../../src/gait';
import { FRAME_RIGS } from '../../src/frame-rig';
import { getFrame } from '../../src/frames';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) throw new Error('Provide component folder');
const load = async function (file: string) { return new GLTFLoader().register(function () { return { name: 'HEADLESS_TEXTURE_PLACEHOLDER', loadTexture: async function () { return new Texture(); } }; }).parseAsync(await Bun.file(join(folder, file)).arrayBuffer(), ''); };
const production = createMech();
production.pose(createGait({ x: 0, y: 0, angle: 0 }, getFrame('warden').size, FRAME_RIGS.warden), 0);
const productionSize = new Box3().setFromObject(production.root).getSize(new Vector3());
const results = [];
for (const [variant, families] of Object.entries({ A: ['launcher', 'launcher'], B: ['energy', 'energy'], C: ['energy', 'launcher'] })) {
	const model = await load('chassis.glb');
	const names = ['muzzle_left_gun', 'muzzle_right_gun'];
	for (const [index, side] of ['left', 'right'].entries()) {
		const socket = model.scene.getObjectByName(`socket_${side}_shoulder`);
		if (!socket) throw new Error('Missing socket');
		const module = await load(`${side}-${families[index]}.glb`);
		socket.add(module.scene);
		names.push(`muzzle_${side}_${families[index]}__export`);
	}
	model.scene.traverse(function (node) {
		if (node instanceof Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.side = DoubleSide;
	});
	const clip = model.animations[0];
	if (!clip) throw new Error('Missing animation');
	const mixer = new AnimationMixer(model.scene);
	const action = mixer.clipAction(clip).setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
	const obstructions = [];
	let size = new Vector3();
	let bottom = 0;
	for (let frame = 0; frame <= 90; frame++) {
		mixer.setTime(frame / 60); model.scene.updateMatrixWorld(true);
		if (frame === 0) { const bounds = new Box3().setFromObject(model.scene); size = bounds.getSize(new Vector3()); bottom = bounds.min.y; }
		for (const name of names) {
			const anchor = model.scene.getObjectByName(name);
			if (!anchor) throw new Error(`Missing muzzle ${name}`);
			const ray = new Raycaster(anchor.getWorldPosition(new Vector3()), new Vector3(0, 0, 1).transformDirection(anchor.matrixWorld), 0.00001, 2);
			const hit = ray.intersectObject(model.scene, true)[0];
			if (hit) obstructions.push({ frame, muzzle: name, mesh: hit.object.name, distance: hit.distance });
		}
	}
	results.push({ variant, raySamples: 364, obstructions, sourceSize: size.toArray(), sourceBottom: bottom, productionSize: productionSize.toArray(), heightMatchScale: productionSize.y / size.y });
	mixer.stopAllAction(); mixer.uncacheRoot(model.scene);
}
await Bun.write(join(folder, 'firing-scale-audit.json'), JSON.stringify({ status: results.some(function (result) { return result.obstructions.length > 0; }) ? 'obstructions-found' : 'straight-rays-clear', scope: 'Straight muzzle rays over walk only; no aim sweep or per-tube validation. Scale matches standing render height, not physical meters.', results }, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
