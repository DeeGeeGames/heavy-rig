/** Verify actual GLB component assemblies against every source animation sample. */
import { AnimationMixer, LoopOnce, Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { join } from 'node:path';
import { getHardpoints } from '../../src/hardpoints';

const record = function (value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected record');
	return Object.fromEntries(Object.entries(value));
};
const list = function (value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Expected array');
	return value;
};
const string = function (value: unknown): string {
	if (typeof value !== 'string') throw new Error('Expected string');
	return value;
};
const number = function (value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite number');
	return value;
};
const folder = process.argv[2];
if (!folder) throw new Error('Usage: bun scripts/mech-design/verify-components.ts package-directory');
const manifest = record(await Bun.file(join(folder, 'package.json')).json());
const load = async function (file: string) {
	return new GLTFLoader().register(function () { return { name: 'HEADLESS_TEXTURE_PLACEHOLDER', loadTexture: async function () { return new Texture(); } }; }).parseAsync(await Bun.file(join(folder, file)).arrayBuffer(), '');
};
const sourceSamples = list(manifest['samples']);
if (sourceSamples.length !== 91) throw new Error('Expected full 91-frame walk');
const moduleSpecs = list(manifest['modules']).map(record);
// Fail if the gameplay contract changes underneath this assembly recipe.
for (const [frame, families] of [
	['warden', ['ballistic', 'ballistic', 'launcher', 'launcher']],
	['warden-b', ['ballistic', 'ballistic', 'energy', 'energy']],
	['warden-c', ['ballistic', 'ballistic', 'energy', 'launcher']],
] as const) {
	const mounts = getHardpoints(frame);
	const ids = ['left-gun', 'right-gun', `left-shoulder ${families[2] === 'energy' ? 'bank' : 'pod'}`, `right-shoulder ${families[3] === 'energy' ? 'bank' : 'pod'}`];
	if (mounts.length !== 4 || mounts.some(function (mount, index) { return mount.family !== families[index] || mount.id !== ids[index]; })) {
		throw new Error(`Gameplay mount contract changed for ${frame}`);
	}
}
const results = [];
for (const [variant, families] of Object.entries({ A: ['launcher', 'launcher'], B: ['energy', 'energy'], C: ['energy', 'launcher'], empty: ['empty', 'empty'] })) {
	const chassis = await load(string(manifest['chassis']));
	const selectedNames = new Set<string>();
	const allModuleNames = new Set(moduleSpecs.flatMap(function (spec) { return list(spec['nodes']).map(string); }));
	for (const [index, side] of ['left', 'right'].entries()) {
		const spec = moduleSpecs.find(function (item) { return item['id'] === `${side}-${families[index]}`; });
		if (!spec) throw new Error('Missing module');
		const socket = chassis.scene.getObjectByName(string(spec['socket']));
		if (!socket) throw new Error('Missing socket');
		const module = await load(string(spec['file']));
		if (module.animations.length) throw new Error('Rigid cartridge unexpectedly animated');
		for (const rawName of list(spec['nodes'])) {
			const name = string(rawName);
			if (chassis.scene.getObjectByName(name)) throw new Error('Module leaked into base chassis');
			const node = module.scene.getObjectByName(`${name}__export`);
			if (!node) throw new Error(`Missing module node ${name}`);
			node.name = name;
			selectedNames.add(name);
		}
		socket.add(module.scene);
	}
	const geometry = record(manifest['geometry']);
	const expectedMeshNames = new Set(Object.keys(geometry).filter(function (name) { return !allModuleNames.has(name) || selectedNames.has(name); }));
	const accountedMeshes = new Set<string>();
	for (const name of expectedMeshNames) {
		const node = chassis.scene.getObjectByName(name);
		if (!node) throw new Error(`Missing geometry ${name}`);
		let triangles = 0;
		node.traverse(function (child) {
			if (!(child instanceof Mesh)) return;
			accountedMeshes.add(child.uuid);
			triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
		});
		if (triangles !== number(record(geometry[name])['triangles'])) throw new Error(`Evaluated triangle count changed for ${name}`);
	}
	chassis.scene.traverse(function (node) {
		if (node instanceof Mesh && !accountedMeshes.has(node.uuid)) throw new Error(`Unexpected exported mesh ${node.name}`);
	});
	const clip = chassis.animations[0];
	if (!clip || chassis.animations.length !== 1 || Math.abs(clip.duration - 1.5) > 1e-6) throw new Error('Invalid animation');
	const mixer = new AnimationMixer(chassis.scene);
	const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
	action.clampWhenFinished = true;
	action.play();
	let maximumMatrixError = 0;
	let comparedMatrices = 0;
	for (const [index, raw] of sourceSamples.entries()) {
		const sample = record(raw);
		const time = number(sample['time']);
		if (Math.abs(time - index / 60) > 1e-8) throw new Error('Invalid sample timing');
		mixer.setTime(time);
		chassis.scene.updateMatrixWorld(true);
		for (const [name, rawMatrix] of Object.entries(record(sample['matrices']))) {
			if (allModuleNames.has(name) && !selectedNames.has(name)) continue;
			const node = chassis.scene.getObjectByName(name);
			if (!node) throw new Error(`Missing assembled node ${name}`);
			const expected = list(rawMatrix);
			if (expected.length !== 16) throw new Error('Invalid matrix');
			for (const [element, value] of expected.entries()) {
				maximumMatrixError = Math.max(maximumMatrixError, Math.abs(number(value) - number(node.matrixWorld.elements[element])));
			}
			comparedMatrices++;
		}
	}
	if (maximumMatrixError > 1e-5) throw new Error(`${variant} transform drift: ${maximumMatrixError}`);
	results.push({ variant, frames: sourceSamples.length, comparedMatrices, maximumMatrixError });
	mixer.stopAllAction();
	mixer.uncacheRoot(chassis.scene);
}
if (process.argv[3]) await Bun.write(process.argv[3], JSON.stringify({ status: 'passed', results }, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
