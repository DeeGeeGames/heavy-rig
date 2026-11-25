import { html, type TemplateResult } from 'lit-html';
import { keyLabel } from './bindings';

export type ControllerFamily = 'xbox' | 'playstation' | 'switch' | 'steamdeck' | 'generic';
export type PromptDevice = 'keyboard' | 'touch' | ControllerFamily;
export type PromptAction = 'previousDepartment' | 'nextDepartment' | 'previousPage' | 'nextPage' | 'confirm' | 'back' | 'help' | 'discard' | 'move' | 'tabMove' | 'settings';
export type PromptGlyph = { kind: 'image'; src: string; label: string } | { kind: 'key'; text: string; label: string } | {
	kind: 'control'; shape: 'bumper' | 'trigger' | 'stick' | 'stick-press' | 'dpad' | 'mouse' | 'mouse-left' | 'mouse-right' | 'mouse-wheel';
	text: string; label: string;
};

export const detectControllerFamily = function (gamepadId: string): ControllerFamily {
	const id = gamepadId.toLowerCase();
	if (/steam\s?deck|valve|28de/.test(id)) return 'steamdeck';
	if (/playstation|dualshock|dualsense|054c|\bps[345]\b/.test(id)) return 'playstation';
	if (/nintendo|switch|joy-?con|057e/.test(id)) return 'switch';
	if (/xbox|x-box|xinput|microsoft|045e/.test(id)) return 'xbox';
	return 'generic';
};

const labels: Readonly<Record<ControllerFamily, readonly string[]>> = {
	xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Xbox'],
	playstation: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'PS', 'Touchpad'],
	switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home', 'Capture'],
	steamdeck: ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'View', 'Menu', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Steam'],
	generic: ['South', 'East', 'West', 'North', 'L bumper', 'R bumper', 'L trigger', 'R trigger', 'Select', 'Start', 'LS', 'RS', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Guide'],
};

/** Standard Gamepad API indices describe physical positions, including Nintendo. */
export const controllerButtonLabel = function (family: ControllerFamily, index: number): string {
	return labels[family][index] ?? `Button ${index}`;
};

const buttonForAction: Readonly<Record<Exclude<PromptAction, 'move' | 'tabMove'>, number>> = {
	previousDepartment: 4, nextDepartment: 5, previousPage: 6, nextPage: 7,
	confirm: 0, back: 1, help: 3, discard: 2, settings: 9,
};

const image = function (family: Exclude<PromptDevice, 'touch' | 'generic'>, name: string, label: string): PromptGlyph {
	return { kind: 'image', src: `./button-prompts/${family}/${name}.svg`, label };
};
const key = function (text: string, label = text): PromptGlyph { return { kind: 'key', text, label }; };
const control = function (shape: Extract<PromptGlyph, { kind: 'control' }>['shape'], text: string, label: string): PromptGlyph {
	return { kind: 'control', shape, text, label };
};
const dpad = control('dpad', '', 'D-pad');
const leftStick = control('stick', 'L', 'Left stick');
const rightStick = control('stick', 'R', 'Right stick');
const mouse = control('mouse', '', 'Mouse movement');
const wheel = control('mouse-wheel', '', 'Mouse wheel');
const directions = ['↑', '↓', '←', '→'];

const faceImages: Readonly<Record<Exclude<ControllerFamily, 'generic'>, readonly string[]>> = {
	xbox: ['button_a', 'button_b', 'button_x', 'button_y'],
	playstation: ['button_cross', 'button_circle', 'button_square', 'button_triangle'],
	switch: ['button_b', 'button_a', 'button_y', 'button_x'],
	steamdeck: ['button_a', 'button_b', 'button_x', 'button_y'],
};
const settingsImages = { xbox: 'button_start', playstation: 'button_options', switch: 'button_plus', steamdeck: 'button_options' } as const;

export const controllerButtonGlyph = function (family: ControllerFamily, index: number): PromptGlyph {
	const label = controllerButtonLabel(family, index);
	if (index === 4 || index === 5) return control('bumper', family === 'generic' ? index === 4 ? 'LB' : 'RB' : label, label);
	if (index === 6 || index === 7) return control('trigger', family === 'generic' ? index === 6 ? 'LT' : 'RT' : label, label);
	if (index === 10 || index === 11) return control('stick-press', label, index === 10 ? 'Press left stick' : 'Press right stick');
	const direction = directions[index - 12];
	if (direction) return control('dpad', direction, label);
	if (family === 'generic') return key(label, `${label} button`);
	const file = index === 9 ? settingsImages[family] : faceImages[family][index];
	return file ? image(family, file, `${label} button`) : key(label, `${label} button`);
};

const keyboardGlyphs: Readonly<Record<PromptAction, PromptGlyph>> = {
	previousDepartment: key('Q', 'Q key'), nextDepartment: image('keyboard', 'e', 'E key'),
	previousPage: key('Z', 'Z key'), nextPage: key('C', 'C key'),
	confirm: image('keyboard', 'enter', 'Enter key'), back: image('keyboard', 'escape', 'Escape key'),
	help: image('keyboard', 'h', 'H key'), discard: key('X', 'X key'),
	move: key('↑ ↓ ← →', 'Arrow keys'), tabMove: key('Tab', 'Tab key'), settings: key('F1', 'F1 key'),
};

const compactKeys: Readonly<Partial<Record<string, string>>> = {
	ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
	ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
	AltLeft: 'L Alt', AltRight: 'R Alt', Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins',
	PageUp: 'PgUp', PageDown: 'PgDn', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']',
	Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

const bindingGlyph = function (code: string): PromptGlyph {
	if (code === 'Mouse0') return control('mouse-left', '', 'Left mouse button');
	if (code === 'Mouse1') return control('mouse-wheel', '', 'Middle mouse button');
	if (code === 'Mouse2') return control('mouse-right', '', 'Right mouse button');
	if (code === 'Mouse3' || code === 'Mouse4') return key(code === 'Mouse3' ? 'M4' : 'M5', code === 'Mouse3' ? 'Mouse button 4' : 'Mouse button 5');
	return key(compactKeys[code] ?? keyLabel(code).replace(/^Numpad/, 'Num '), keyLabel(code));
};

export const promptGlyph = function (device: PromptDevice, action: PromptAction): PromptGlyph {
	if (device === 'keyboard') return keyboardGlyphs[action];
	if (device === 'touch') {
		if (action === 'previousDepartment' || action === 'previousPage') return key('‹', 'Previous');
		if (action === 'nextDepartment' || action === 'nextPage') return key('›', 'Next');
		return key('Tap', 'Tap');
	}
	if (action === 'move' || action === 'tabMove') return dpad;
	return controllerButtonGlyph(device, buttonForAction[action]);
};

const renderSpec = function (glyph: PromptGlyph): TemplateResult {
	if (glyph.kind === 'image') return html`<img class="input-glyph" src=${glyph.src} alt=${glyph.label} draggable="false">`;
	if (glyph.kind === 'control') return html`<span class="input-control" data-shape=${glyph.shape} role="img" aria-label=${glyph.label} title=${glyph.label}>${glyph.text}</span>`;
	return html`<kbd class="input-keycap" aria-label=${glyph.label} title=${glyph.label}>${glyph.text}</kbd>`;
};

export const renderGlyph = function (device: PromptDevice, action: PromptAction): TemplateResult {
	const move = device !== 'keyboard' && device !== 'touch' && (action === 'move' || action === 'tabMove');
	return html`<span class="input-glyphs" data-prompt-device=${device} data-prompt-action=${action}>${renderSpec(promptGlyph(device, action))}${move ? renderSpec(leftStick) : ''}</span>`;
};

export const renderControllerButton = function (family: ControllerFamily, index: number): TemplateResult {
	return html`<span class="input-glyphs" data-prompt-device=${family}>${renderSpec(controllerButtonGlyph(family, index))}</span>`;
};

export const renderKeyboardBindings = function (codes: readonly string[]): TemplateResult {
	return html`<span class="input-glyphs" data-prompt-device="keyboard">${codes.length ? codes.map(bindingGlyph).map(renderSpec) : html`<span class="input-unbound">UNBOUND</span>`}</span>`;
};

export const renderAimGlyph = function (device: PromptDevice): TemplateResult {
	return html`<span class="input-glyphs" data-prompt-device=${device}>${renderSpec(device === 'keyboard' ? mouse : rightStick)}</span>`;
};

export const renderZoomGlyph = function (): TemplateResult {
	return html`<span class="input-glyphs" data-prompt-device="keyboard">${renderSpec(wheel)}</span>`;
};
