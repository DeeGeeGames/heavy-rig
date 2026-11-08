import { defaultController, type ControllerBindings } from './bindings';
import type { FireInputs } from './arsenal';

export type GamepadSnapshot = Pick<Gamepad, 'axes' | 'buttons' | 'connected' | 'index' | 'mapping' | 'id'>;
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
const pressedButtons = function (pad: GamepadSnapshot) {
	const buttons = new Set<number>();
	pad.buttons.forEach(function (button, index) { if (button.pressed || button.value > 0.35) buttons.add(index); });
	return buttons;
};
const pressedMenuButtons = function (pad: GamepadSnapshot, previous: ReadonlySet<number> | undefined) {
	const buttons = new Set<number>();
	pad.buttons.forEach(function (button, index) {
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
	const requireNeutral = function () { gameplayReady = false; menuReady = false; navigation = undefined; };
	const suspend = function () { previous.clear(); previousMenu.clear(); promptAxes = undefined; requireNeutral(); };
	const reset = function () { suspend(); owner = undefined; repeatAt = 0; };
	const read = function (pads: readonly (GamepadSnapshot | null)[], now: number, bindings: ControllerBindings = defaultController()): PadInput {
		const connected = pads.filter(function (candidate): candidate is GamepadSnapshot { return candidate !== null && candidate.connected && candidate.mapping === 'standard'; });
		const samples = connected.map(function (pad) {
			const key = identity(pad);
			return { pad, key, buttons: pressedButtons(pad), menuButtons: pressedMenuButtons(pad, previousMenu.get(key)) };
		});
		let sample = samples.find(function (candidate) { return candidate.key === owner; });
		const lost = owner !== undefined && !sample;
		let claimed = false;
		if (lost) { owner = undefined; promptAxes = undefined; requireNeutral(); }
		// A replacement never takes over on the loss frame. Newly exposed/held
		// buttons are baselined, so connecting a pad cannot deploy or resume a run.
		if (!owner && !lost) {
			sample = samples.find(function (candidate) {
				const before = previous.get(candidate.key);
				return before !== undefined && [0, 9].some(function (button) { return candidate.buttons.has(button) && !before.has(button); });
			});
			if (sample) { owner = sample.key; claimed = true; repeatAt = 0; requireNeutral(); }
		}
		const buttons = sample?.buttons ?? new Set<number>();
		const before = sample ? previous.get(sample.key) : undefined;
		const menuBefore = sample ? previousMenu.get(sample.key) : undefined;
		const pressed = function (button: number) { return buttons.has(button); };
		const menuPressed = function (button: number) { return sample?.menuButtons.has(button) ?? false; };
		const edge = function (button: number) { return menuReady && !claimed && menuBefore !== undefined && menuPressed(button) && !menuBefore.has(button); };
		const x = deadZone(sample?.pad.axes[0] ?? 0); const y = deadZone(sample?.pad.axes[1] ?? 0);
		const aimX = deadZone(sample?.pad.axes[2] ?? 0); const aimY = deadZone(sample?.pad.axes[3] ?? 0);
		const axes = [x, y, aimX, aimY];
		// Compare against the last meaningful sample, allowing a slow stick move
		// to accumulate without letting a held control steal keyboard prompts.
		const axesChanged = axes.some(function (value, index) { return Math.abs(value - (promptAxes?.[index] ?? 0)) >= .15; });
		const promptActivity = Boolean(sample) && (claimed || before !== undefined && (
			[...buttons].some(function (button) { return !before.has(button); }) || axesChanged && axes.some(function (value) { return value !== 0; })
		));
		if (!sample) promptAxes = undefined;
		else if (claimed || before === undefined || axesChanged || axes.every(function (value) { return value === 0; })) promptAxes = axes;
		const neutral = x === 0 && y === 0 && aimX === 0 && aimY === 0 && !Object.values(bindings).some(pressed);
		if (sample && !claimed && neutral) gameplayReady = true;
		if (sample && !claimed && x === 0 && y === 0 && aimX === 0 && aimY === 0 && ![0, 1, 2, 3, 4, 5, 6, 7, 9, 12, 13, 14, 15].some(menuPressed)) menuReady = true;
		const direction: PadInput['direction'] = pressed(12) || y < -0.55 ? 'up' : pressed(14) || x < -0.55 ? 'left' : pressed(13) || y > 0.55 ? 'down' : pressed(15) || x > 0.55 ? 'right' : undefined;
		let navigate = 0;
		if (menuReady && !claimed && direction && (navigation !== direction || now >= repeatAt)) { navigate = direction === 'up' || direction === 'left' ? -1 : 1; repeatAt = now + (navigation === direction ? 160 : 400); }
		navigation = direction;
		const ready = gameplayReady && !claimed;
		const result: PadInput = {
			connected: Boolean(sample), available: connected.length > 0, lost, claimed,
			activity: Boolean(sample) && (claimed || buttons.size > 0 || x !== 0 || y !== 0 || aimX !== 0 || aimY !== 0), promptActivity, ready, index: sample?.pad.index, id: sample?.pad.id,
			drive: ready ? -y : 0, turn: ready ? x : 0, aimX: ready ? aimX : 0, aimY: ready ? aimY : 0,
			fire: [ready && pressed(bindings['mount-0']), ready && pressed(bindings['mount-1']), ready && pressed(bindings['mount-2']), ready && pressed(bindings['mount-3'])],
			coolant: ready && pressed(bindings.coolant), stop: ready && pressed(bindings.stop),
			pause: edge(9), confirm: edge(0), back: edge(1), navigate,
			department: edge(4) === edge(5) ? 0 : edge(4) ? -1 : 1,
			page: edge(6) === edge(7) ? 0 : edge(6) ? -1 : 1,
			help: edge(3), discard: edge(2), direction: navigate ? direction : undefined,
			adjust: direction === 'left' || direction === 'right' ? navigate : 0,
			scroll: claimed || !menuReady ? 0 : aimY,
		};
		previous = new Map(samples.map(function (candidate) { return [candidate.key, candidate.buttons]; }));
		previousMenu = new Map(samples.map(function (candidate) { return [candidate.key, candidate.menuButtons]; }));
		return result;
	};
	return { read, reset, requireNeutral, suspend };
};
