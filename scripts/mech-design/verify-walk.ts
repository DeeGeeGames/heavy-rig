/** Headless Three.js verification of an exported Warden walk and its source samples. */
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const isRecord = function (value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const record = function (value: unknown): Record<string, unknown> {
	if (!isRecord(value)) throw new Error('Expected a record.');
	return value;
};
const number = function (value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite number.');
	return value;
};
const [modelPath, reportPath] = process.argv.slice(2);
if (!modelPath || !reportPath) throw new Error('Usage: bun scripts/mech-design/verify-walk.ts model.glb gait-report.json');
const report = record(await Bun.file(reportPath).json());
if (!Array.isArray(report['samples'])) throw new Error('Missing motion samples.');
const parameters = record(report['parameters']);
const duration = number(parameters['durationSeconds']);
const fps = number(parameters['fps']);
if (duration <= 0 || !Number.isInteger(fps) || fps <= 0) throw new Error('Invalid sample timing.');
const expectedSamples = Math.round(duration * fps) + 1;
if (report['samples'].length !== expectedSamples || expectedSamples < 2) throw new Error('Missing full-cycle motion samples.');
const model = await new GLTFLoader().parseAsync(await Bun.file(modelPath).arrayBuffer(), '');
const clip = model.animations[0];
if (!clip || model.animations.length !== 1) throw new Error('Expected one baked animation.');
if (Math.abs(clip.duration - duration) > 0.000001) throw new Error('Exported clip duration differs from the source.');
const mixer = new AnimationMixer(model.scene);
const action = mixer.clipAction(clip);
action.setLoop(LoopOnce, 1);
action.clampWhenFinished = true;
action.play();
let maximumAnkleError = 0;
let maximumFootTilt = 0;
let maximumPistonEndpointError = 0;
let minimumOverlap = Infinity;
let maximumActuatorAngleError = 0;
let maximumBodyMatrixError = 0;
const pelvisHeights: number[] = [];
const pelvisSides: number[] = [];
const find = function (name: string) {
	const object = model.scene.getObjectByName(name);
	if (!object) throw new Error(`Missing exported node ${name}`);
	return object;
};
for (const [index, raw] of report['samples'].entries()) {
	const sample = record(raw);
	const phase = number(sample['phase']);
	if (Math.abs(phase - index / (expectedSamples - 1)) > 0.000000001 || number(sample['frame']) !== index + 1) {
		throw new Error('Samples must cover the full cycle in frame order.');
	}
	mixer.setTime(phase * duration);
	model.scene.updateMatrixWorld(true);
	if (report['revision'] === 'v2-weight-transfer') {
		const body = record(sample['body']);
		for (const name of ['pelvis', 'torso']) {
			const expected = body[name];
			if (!Array.isArray(expected) || expected.length !== 16) throw new Error('Missing body motion matrix.');
			const actual = find(`rig_${name}`).matrixWorld.elements;
			expected.forEach(function (value: unknown, index: number) {
				maximumBodyMatrixError = Math.max(maximumBodyMatrixError, Math.abs(number(value) - number(actual[index])));
			});
		}
		const pelvis = find('rig_pelvis').getWorldPosition(new Vector3());
		pelvisHeights.push(pelvis.y);
		pelvisSides.push(pelvis.x);
	}
	const feet = record(sample['feet']);
	for (const side of ['left', 'right'] as const) {
		const foot = record(feet[side]);
		if (!Array.isArray(foot['ankle']) || foot['ankle'].length !== 3) throw new Error('Invalid ankle target.');
		// Blender Z-up/-Y-forward -> glTF Y-up/+Z-forward.
		const expected = new Vector3(number(foot['ankle'][0]), number(foot['ankle'][2]), -number(foot['ankle'][1]));
		const node = find(`rig_leg_${side}_foot`);
		maximumAnkleError = Math.max(maximumAnkleError, node.getWorldPosition(new Vector3()).distanceTo(expected));
		const origin = node.localToWorld(new Vector3());
		const up = node.localToWorld(new Vector3(0, 1, 0)).sub(origin).normalize();
		maximumFootTilt = Math.max(maximumFootTilt, up.angleTo(new Vector3(0, 1, 0)));
		for (const location of ['front', 'rear'] as const) {
			const prefix = `repair_${side}_${location}_piston_`;
			const top = find(`${prefix}top`).getWorldPosition(new Vector3());
			const bottom = find(`${prefix}bottom`).getWorldPosition(new Vector3());
			const barrel = find(`${prefix}barrel`).getWorldPosition(new Vector3());
			const rod = find(`${prefix}rod`).getWorldPosition(new Vector3());
			maximumPistonEndpointError = Math.max(maximumPistonEndpointError, barrel.distanceTo(top), rod.distanceTo(bottom));
			for (const [name, from, to] of [[`${prefix}barrel`, top, bottom], [`${prefix}rod`, bottom, top]] as const) {
				const piece = find(name);
				const axis = piece.localToWorld(new Vector3(0, 1, 0)).sub(piece.getWorldPosition(new Vector3())).normalize();
				maximumActuatorAngleError = Math.max(maximumActuatorAngleError, axis.angleTo(to.clone().sub(from).normalize()));
			}
			minimumOverlap = Math.min(minimumOverlap, (location === 'front' ? 0.15 : 0.2) - top.distanceTo(bottom));
		}
	}
}
const result = { samples: report['samples'].length, duration: clip.duration, maximumAnkleError, maximumFootTilt, maximumPistonEndpointError, maximumActuatorAngleError, maximumBodyMatrixError, minimumOverlap,
	pelvisVerticalTravel: pelvisHeights.length ? Math.max(...pelvisHeights) - Math.min(...pelvisHeights) : 0,
	pelvisLateralTravel: pelvisSides.length ? Math.max(...pelvisSides) - Math.min(...pelvisSides) : 0 };
console.log(JSON.stringify(result, null, 2));
if (maximumAnkleError > 0.00001 || maximumFootTilt > 0.00001 || maximumPistonEndpointError > 0.00001 || maximumActuatorAngleError > 0.00001 || maximumBodyMatrixError > 0.00001 || minimumOverlap <= 0) {
	throw new Error('Exported walk failed planting, orientation or actuator checks.');
}

if (report['revision'] === 'v2-weight-transfer' && (result.pelvisVerticalTravel < 0.01 || result.pelvisLateralTravel < 0.025)) {
	throw new Error('Export lost the intended pelvis weight transfer.');
}
