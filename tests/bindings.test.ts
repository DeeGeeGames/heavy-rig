import { expect, test } from 'bun:test';
import { defaultController, defaultKeyboard } from '../src/bindings';
import { parseProfile } from '../src/profile';
import { createGamepadInput, type GamepadSnapshot } from '../src/gamepad';

test('device mappings survive reload independently and invalid storage retains usable defaults', function () {
	const settings = parseProfile(null).settings;
	settings.keyboard.forward = ['KeyI']; settings.controller['mount-0'] = 3;
	const restored = parseProfile(JSON.stringify({ settings })).settings;
	expect(restored.keyboard.forward).toEqual(['KeyI']); expect(restored.controller['mount-0']).toBe(3);
	expect(restored.keyboard['mount-0']).toEqual(defaultKeyboard()['mount-0']);
	const corrupt = parseProfile(JSON.stringify({ settings: { keyboard: { forward: ['Escape'], stop: ['Mouse9'] }, controller: { 'mount-0': 9, coolant: -1 } } })).settings;
	expect(corrupt.keyboard).toEqual(defaultKeyboard()); expect(corrupt.controller).toEqual(defaultController());
});

test('remapped fire requires neutral after a transition and remains separate from default trigger', function () {
	const input = createGamepadInput(); const bindings = { ...defaultController(), 'mount-0': 3 };
	const pad = function (buttons: number[]): GamepadSnapshot { return { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, function (_, index) { return { pressed: buttons.includes(index), value: buttons.includes(index) ? 1 : 0, touched: false }; }) }; };
	input.read([pad([])], 0, bindings); input.read([pad([0])], 1, bindings); input.read([pad([])], 2, bindings);
	expect(input.read([pad([3])], 3, bindings).fire[0]).toBe(true);
	input.requireNeutral(); expect(input.read([pad([3])], 4, bindings).fire[0]).toBe(false);
	input.read([pad([])], 5, bindings); expect(input.read([pad([7])], 6, bindings).fire[0]).toBe(false);
	expect(input.read([pad([3])], 7, bindings).fire[0]).toBe(true);
});
