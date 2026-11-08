import { definePlugin } from 'ecspresso';
import type { Controls } from './simulation';

// DOM adapters keep physical KeyboardEvent.code bindings, independent touch
// pointers, and controller ownership. This bridge owns their fixed-step handoff.
export const createRuntimeInput = function () {
	let fire: Controls['fire'] = [false, false, false, false];
	let coolant = false;
	let stop = false;
	const clear = function () {
		fire = [false, false, false, false]; coolant = false; stop = false;
	};
	const sample = function (controls: Controls) {
		fire = [fire[0] || controls.fire[0], fire[1] || controls.fire[1], fire[2] || controls.fire[2], fire[3] || controls.fire[3]];
		coolant ||= controls.coolant;
		stop ||= controls.stop;
	};
	const consume = function (controls: Controls): Controls {
		sample(controls);
		const result = { ...controls, fire, coolant, stop };
		clear();
		return result;
	};
	const input = { clear, sample, consume };
	const plugin = definePlugin('heavy-rig-input')
		.withResourceTypes<{ combatInput: typeof input }>()
		.install(function (world, onCleanup) {
			world.addResource('combatInput', input);
			onCleanup(clear);
		});
	return { ...input, plugin };
};
