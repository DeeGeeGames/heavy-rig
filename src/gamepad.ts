import { defaultController, type ControllerBindings } from './bindings';
import type { FireInputs } from './arsenal';

export type GamepadSnapshot = Pick<Gamepad, 'axes' | 'buttons' | 'connected' | 'index' | 'mapping' | 'id'>;
export const isGc101 = function (id: string) { return /vendor:\s*20bc\s+product:\s*5656\b/i.test(id); };
export interface PadInput {
	connected: boolean;
	available: boolean;
	lost: boolean;
	claimed: boolean;
	activity: boolean;
	promptActivity: boolean;
	ready: boolean;
	index: number | undefined;
	id: string | undefined;
	drive: number;
	turn: number;
	aimX: number;
	aimY: number;
	fire: FireInputs;
	coolant: boolean;
	stop: boolean;
	targetNearest: boolean;
	targetNext: boolean;
	pause: boolean;
	confirm: boolean;
	back: boolean;
	department: -1 | 0 | 1;
	page: -1 | 0 | 1;
	help: boolean;
	discard: boolean;
	navigate: number;
	direction: 'up' | 'down' | 'left' | 'right' | undefined;
	adjust: number;
	scroll: number;
}
const deadZone = function (value: number, zone = 0.18) {
	return !Number.isFinite(value) || Math.abs(value) <= zone ? 0 : Math.sign(value) * (Math.min(1, Math.abs(value)) - zone) / (1 - zone);
};
const identity = function (pad: GamepadSnapshot) { return `${pad.index}:${pad.id}`; };
const digitalButton = function (pressed: boolean): GamepadButton { return { pressed, touched: pressed, value: Number(pressed) }; };
const gamepadButtons = function (pad: GamepadSnapshot): readonly GamepadButton[] {
	// Chromium on Linux exposes this GC101/GameSir layout as 13 raw buttons
	// and six axes. The last two axes are the horizontal and vertical HID hat.
	if (pad.mapping || pad.axes.length !== 6 || pad.buttons.length !== 13 || !isGc101(pad.id)) return pad.buttons;
	const [,,,, hatX = 0, hatY = 0] = pad.axes;
	return [
		...[1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(function (index) { return pad.buttons[index] ?? digitalButton(false); }),
		digitalButton(hatY < -.5), digitalButton(hatY > .5),
		digitalButton(hatX < -.5), digitalButton(hatX > .5),
		pad.buttons[12] ?? digitalButton(false),
	];
};
const pressedButtons = function (gamepadButtons: readonly GamepadButton[]) {
	const buttons = new Set<number>();
	gamepadButtons.forEach(function (button, index) { if (button.pressed || button.value > 0.35) buttons.add(index); });
	return buttons;
};
const pressedMenuButtons = function (gamepadButtons: readonly GamepadButton[], previous: ReadonlySet<number> | undefined) {
	const buttons = new Set<number>();
	gamepadButtons.forEach(function (button, index) {
		// Analog triggers must release well below their press threshold before
		// navigating again. Combat retains its existing sampling threshold.
		const threshold = index === 6 || index === 7 ? previous?.has(index) ? .2 : .55 : .35;
		if (button.pressed || button.value > threshold) buttons.add(index);
	});
	return buttons;
};

export const createGamepadInput = function () {
	let previous = new Map<string, ReadonlySet<number>>();
	let previousMenu = new Map<string, ReadonlySet<number>>();
	let owner: string | undefined;
	let navigation: PadInput['direction'];
	let repeatAt = 0;
	let promptAxes: readonly number[] | undefined;
	let gameplayReady = false;
	let menuReady = true;
	let hasClaimed = false;
	let suspended = false;
	const requireNeutral = function () { gameplayReady = false; menuReady = false; navigation = undefined; };
	const suspend = function () { previous.clear(); previousMenu.clear(); promptAxes = undefined; suspended = true; requireNeutral(); };
	const reset = function () { suspend(); owner = undefined; hasClaimed = false; repeatAt = 0; };
	const read = function (pads: readonly (GamepadSnapshot | null)[], now: number, bindings: ControllerBindings = defaultController()): PadInput {
		// An empty mapping still exposes usable browser inputs.
		// Use their positional indices as a fallback, keeping saved combat bindings.
		const connected = pads.filter(function (candidate): candidate is GamepadSnapshot { return candidate !== null && candidate.connected; });
		const samples = connected.map(function (pad) {
			const key = identity(pad);
			const buttons = gamepadButtons(pad);
			return { pad, key, buttons: pressedButtons(buttons), menuButtons: pressedMenuButtons(buttons, previousMenu.get(key)) };
		});
		let sample = samples.find(function (candidate) { return candidate.key === owner; });
		const lost = owner !== undefined && !sample;
		let claimed = false;
		if (lost) { owner = undefined; promptAxes = undefined; requireNeutral(); }
		// The browser may first expose a pad while its activation button is held.
		// Consume that press on startup. After a loss or suspension, require a
		// fresh edge so controllers held during the interruption cannot take over.
		if (!owner && !lost) {
			sample = samples.find(function (candidate) {
				const before = previous.get(candidate.key);
				return before === undefined ? !hasClaimed && !suspended && candidate.buttons.size > 0
					: [...candidate.buttons].some(function (button) { return !before.has(button); });
			});
			if (sample) { owner = sample.key; claimed = true; hasClaimed = true; repeatAt = 0; requireNeutral(); }
		}
		const buttons = sample?.buttons ?? new Set<number>();
		const before = sample ? previous.get(sample.key) : undefined;
		const menuBefore = sample ? previousMenu.get(sample.key) : undefined;
		const pressed = function (button: number) { return buttons.has(button); };
		const menuPressed = function (button: number) { return sample?.menuButtons.has(button) ?? false; };
		const edge = function (button: number) { return menuReady && !claimed && menuBefore !== undefined && menuPressed(button) && !menuBefore.has(button); };
		const x = deadZone(sample?.pad.axes[0] ?? 0); const y = deadZone(sample?.pad.axes[1] ?? 0);
		const aimX = deadZone(sample?.pad.axes[2] ?? 0); const aimY = deadZone(sample?.pad.axes[3] ?? 0);
		const up = pressed(12); const down = pressed(13); const left = pressed(14); const right = pressed(15);
		const drive = -y || Number(up) - Number(down);
		const turn = x || Number(right) - Number(left);
		const axes = [x, y, aimX, aimY];
		// Compare against the last meaningful sample, allowing a slow stick move
		// to accumulate without letting a held control steal keyboard prompts.
		const axesChanged = axes.some(function (value, index) { return Math.abs(value - (promptAxes?.[index] ?? 0)) >= .15; });
		const promptActivity = Boolean(sample) && (claimed || before !== undefined && (
			[...buttons].some(function (button) { return !before.has(button); }) || axesChanged && axes.some(function (value) { return value !== 0; })
		));
		if (!sample) promptAxes = undefined;
		else if (claimed || before === undefined || axesChanged || axes.every(function (value) { return value === 0; })) promptAxes = axes;
		const movementNeutral = x === 0 && y === 0 && aimX === 0 && aimY === 0 && !up && !down && !left && !right;
		const neutral = movementNeutral && !Object.values(bindings).some(pressed);
		if (sample && !claimed && neutral) gameplayReady = true;
		if (sample && !claimed && movementNeutral && ![0, 1, 2, 3, 4, 5, 6, 7, 9].some(menuPressed)) menuReady = true;
		const direction: PadInput['direction'] = up || y < -0.55 ? 'up' : left || x < -0.55 ? 'left' : down || y > 0.55 ? 'down' : right || x > 0.55 ? 'right' : undefined;
		let navigate = 0;
		if (menuReady && !claimed && direction && (navigation !== direction || now >= repeatAt)) { navigate = direction === 'up' || direction === 'left' ? -1 : 1; repeatAt = now + (navigation === direction ? 160 : 400); }
		navigation = direction;
		const ready = gameplayReady && !claimed;
		const result: PadInput = {
			connected: Boolean(sample), available: connected.length > 0, lost, claimed,
			activity: Boolean(sample) && (claimed || buttons.size > 0 || x !== 0 || y !== 0 || aimX !== 0 || aimY !== 0), promptActivity, ready, index: sample?.pad.index, id: sample?.pad.id,
			drive: ready ? drive : 0, turn: ready ? turn : 0,
			aimX: ready ? aimX : 0, aimY: ready ? aimY : 0,
			fire: [ready && pressed(bindings['mount-0']), ready && pressed(bindings['mount-1']), ready && pressed(bindings['mount-2']), ready && pressed(bindings['mount-3'])],
			coolant: ready && pressed(bindings.coolant), stop: ready && pressed(bindings.stop),
			targetNearest: ready && before !== undefined && pressed(bindings['target-nearest']) && !before.has(bindings['target-nearest']),
			targetNext: ready && before !== undefined && pressed(bindings['target-next']) && !before.has(bindings['target-next']),
			pause: edge(9), confirm: edge(0), back: edge(1), navigate,
			department: edge(4) === edge(5) ? 0 : edge(4) ? -1 : 1,
			page: edge(6) === edge(7) ? 0 : edge(6) ? -1 : 1,
			help: edge(3), discard: edge(2), direction: navigate ? direction : undefined,
			adjust: direction === 'left' || direction === 'right' ? navigate : 0,
			scroll: claimed || !menuReady ? 0 : aimY,
		};
		previous = new Map(samples.map(function (candidate) { return [candidate.key, candidate.buttons]; }));
		previousMenu = new Map(samples.map(function (candidate) { return [candidate.key, candidate.menuButtons]; }));
		suspended = false;
		return result;
	};
	return { read, reset, requireNeutral, suspend };
};
