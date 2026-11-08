import { expect, test } from 'bun:test';
import { controllerButtonGlyph, controllerButtonLabel, detectControllerFamily, promptGlyph } from '../src/input-prompts';

test('browser names and USB vendor IDs choose one controller family, with honest unknown fallback', function () {
	for (const id of ['Xbox Wireless Controller', 'XInput STANDARD GAMEPAD', 'Xbox 360 Controller (045e)', 'Microsoft X-Box One pad']) expect(detectControllerFamily(id)).toBe('xbox');
	for (const id of ['DualSense Wireless Controller', 'DualShock 4', 'Wireless Controller (Vendor: 054c Product: 0ce6)', 'PS5 Controller']) expect(detectControllerFamily(id)).toBe('playstation');
	for (const id of ['Nintendo Switch Pro Controller', 'Joy-Con (L)', 'Vendor: 057e Product: 2009']) expect(detectControllerFamily(id)).toBe('switch');
	for (const id of ['Steam Deck', 'SteamDeck', 'Valve Controller (28de)']) expect(detectControllerFamily(id)).toBe('steamdeck');
	expect(detectControllerFamily('USB Gamepad')).toBe('generic');
	expect(promptGlyph('generic', 'confirm')).toEqual({ kind: 'key', text: 'South', label: 'South button' });
	expect(controllerButtonLabel('generic', 7)).toBe('R trigger');
});

test('Nintendo and PlayStation prompts retain standard physical button positions rather than Xbox lettering', function () {
	expect(promptGlyph('switch', 'confirm')).toEqual({ kind: 'image', src: './button-prompts/switch/button_b.svg', label: 'B button' });
	expect(promptGlyph('switch', 'back')).toEqual({ kind: 'image', src: './button-prompts/switch/button_a.svg', label: 'A button' });
	expect(promptGlyph('switch', 'help')).toEqual({ kind: 'image', src: './button-prompts/switch/button_x.svg', label: 'X button' });
	expect(promptGlyph('switch', 'discard')).toEqual({ kind: 'image', src: './button-prompts/switch/button_y.svg', label: 'Y button' });
	expect(promptGlyph('playstation', 'confirm')).toEqual({ kind: 'image', src: './button-prompts/playstation/button_cross.svg', label: 'Cross button' });
	expect(promptGlyph('playstation', 'back')).toEqual({ kind: 'image', src: './button-prompts/playstation/button_circle.svg', label: 'Circle button' });
	expect(controllerButtonLabel('switch', 6)).toBe('ZL'); expect(controllerButtonLabel('playstation', 6)).toBe('L2'); expect(controllerButtonLabel('xbox', 6)).toBe('LT');
	expect(controllerButtonGlyph('steamdeck', 3)).toEqual({ kind: 'image', src: './button-prompts/steamdeck/button_y.svg', label: 'Y button' });
});

test('every displayed glyph is packaged at a relative path and keyboard/touch never reuse controller labels', async function () {
	const actions = ['previousDepartment', 'nextDepartment', 'previousPage', 'nextPage', 'confirm', 'back', 'help', 'discard', 'move', 'settings'] as const;
	for (const device of ['keyboard', 'touch', 'xbox', 'playstation', 'switch', 'steamdeck', 'generic'] as const) {
		for (const action of actions) {
			const glyph = promptGlyph(device, action);
			if (glyph.kind === 'image') {
				expect(glyph.src.startsWith('./button-prompts/')).toBe(true);
				expect(await Bun.file(new URL(`../public/${glyph.src.slice(2)}`, import.meta.url)).exists()).toBe(true);
			}
		}
	}
	expect(promptGlyph('keyboard', 'previousDepartment')).toEqual({ kind: 'key', text: 'Q', label: 'Q key' });
	expect(promptGlyph('keyboard', 'previousPage')).toEqual({ kind: 'key', text: 'Z', label: 'Z key' });
	expect(promptGlyph('keyboard', 'nextPage')).toEqual({ kind: 'key', text: 'C', label: 'C key' });
	expect(promptGlyph('touch', 'confirm')).toEqual({ kind: 'key', text: 'Tap', label: 'Tap' });
});
