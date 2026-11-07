export const ACTIONS = ['forward', 'back', 'left', 'right', 'stop', 'mount-0', 'mount-1', 'mount-2', 'mount-3', 'coolant'] as const;
export type Action = typeof ACTIONS[number];
export type KeyboardBindings = Record<Action, string[]>;
export type ControllerBindings = Record<'stop' | 'mount-0' | 'mount-1' | 'mount-2' | 'mount-3' | 'coolant', number>;
export const LABELS: Record<Action, string> = { forward: 'Increase throttle', back: 'Decrease throttle', left: 'Steer left', right: 'Steer right', stop: 'Stop', 'mount-0': 'Mount 1', 'mount-1': 'Mount 2', 'mount-2': 'Mount 3', 'mount-3': 'Mount 4', coolant: 'Vent coolant' };
export const defaultKeyboard = function (): KeyboardBindings { return { forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], stop: ['KeyX'], 'mount-0': ['Space', 'Digit1', 'Mouse0'], 'mount-1': ['KeyE', 'Digit2', 'Mouse2'], 'mount-2': ['KeyQ', 'Digit3', 'Mouse1'], 'mount-3': ['KeyF', 'Digit4', 'Mouse3'], coolant: ['KeyV'] }; };
export const defaultController = function (): ControllerBindings { return { stop: 2, 'mount-0': 7, 'mount-1': 6, 'mount-2': 5, 'mount-3': 4, coolant: 1 }; };
export const validKey = function (value: unknown): value is string { return typeof value === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|F[1-9]|F1[0-2]|Numpad[0-9]|Mouse[0-4]|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/.test(value) && !['Escape', 'Enter', 'Tab'].includes(value); };
const object = function (value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); };
export const parseKeyboard = function (value: unknown): KeyboardBindings {
	const result = defaultKeyboard();
	if (object(value)) for (const action of ACTIONS) { const keys = value[action]; if (Array.isArray(keys) && keys.length <= 8 && keys.every(validKey)) result[action] = keys; }
	return result;
};
export const parseController = function (value: unknown): ControllerBindings {
	const result = defaultController();
	if (object(value)) for (const action of ACTIONS) { if (!(action in result)) continue; const button = value[action]; if (typeof button === 'number' && Number.isInteger(button) && button >= 1 && button <= 17 && button !== 9) { switch (action) { case 'stop': case 'coolant': case 'mount-0': case 'mount-1': case 'mount-2': case 'mount-3': result[action] = button; } } }
	return result;
};
export const keyLabel = function (code: string) { return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Mouse/, 'Mouse '); };
export const padLabel = function (button: number) { return ['A / ×', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back / Share', 'Start / Options', 'Left stick press', 'Right stick press', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Guide', 'Touchpad'][button] ?? `Button ${button}`; };
