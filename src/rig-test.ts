import { FRAMES } from './frames';
import { createMount } from './arsenal';
import { getHardpoints } from './hardpoints';
import { frameWeight } from './combat-resources';
import { createState, type CombatStateView, type State } from './simulation';
import type { Settings } from './profile';

export const rigTestEnabled = new URLSearchParams(location.search).has('rig-test');

// This harness configures scenarios; movement and input remain owned by the game.
export const mountRigTest = function (container: HTMLElement, settings: Settings, start: (state: State) => void, current: () => CombatStateView, canTestKestrel: boolean, setKestrelTrial: (scenario: CombatStateView | undefined, lighter: boolean) => void): () => void {
	const abort = new AbortController();
	const panel = document.createElement('details');
	panel.id = 'rig-test-panel'; panel.open = true;
	const summary = document.createElement('summary'); summary.textContent = 'RIG HANDLING TEST';
	const rig = document.createElement('select'); rig.id = 'test-rig'; rig.title = 'Rig';
	for (const frame of FRAMES) rig.add(new Option(frame.name, frame.id));
	const directKestrel = new URLSearchParams(location.search).get('rig-test') === 'kestrel';
	if (directKestrel) rig.value = 'kestrel';
	const mode = document.createElement('select'); mode.id = 'test-mode'; mode.title = 'Control mode';
	mode.add(new Option('Simulation', 'simulation')); mode.add(new Option('Arcade', 'arcade')); mode.value = settings.controlMode;
	const equipment = document.createElement('select'); equipment.id = 'test-equipment'; equipment.title = 'Equipment';
	equipment.add(new Option('Starter weapon', 'starter'));
	equipment.add(new Option('All mounts loaded', 'loaded'));
	equipment.add(new Option('Empty mounts', 'empty'));
	const reset = document.createElement('button'); reset.textContent = 'RESET RUN';
	const controls = document.createElement('div'); controls.className = 'rig-test-options'; controls.append(rig, mode, equipment, reset);
	const finishes = document.createElement('div'); finishes.className = 'rig-test-finishes';
	const checkbox = function (id: string, text: string, checked: boolean) {
		const label = document.createElement('label');
		const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
		label.append(input, text); finishes.append(label); return input;
	};
	const ink = checkbox('test-kestrel-ink', 'Blue Kestrel · solid ink', directKestrel && canTestKestrel);
	ink.disabled = !canTestKestrel;
	if (!canTestKestrel) finishes.append('Ink requires the authored Kestrel and float color buffers.');
	const light = checkbox('test-kestrel-housing', 'Lighter gun housing', true);
	let scenario: CombatStateView | undefined;
	const applyFinish = function () {
		const available = rig.value === 'kestrel' && canTestKestrel;
		finishes.hidden = rig.value !== 'kestrel'; light.disabled = !available || !ink.checked;
		setKestrelTrial(available && ink.checked && scenario === current() ? scenario : undefined, light.checked);
	};
	// A pointer-operated comparison should leave the pilot's steering keys live.
	// Keyboard activation keeps focus in the panel for the next control.
	let pointerFinish = false;
	finishes.addEventListener('pointerdown', function () { pointerFinish = true; }, { signal: abort.signal });
	finishes.addEventListener('keydown', function () { pointerFinish = false; }, { signal: abort.signal });
	finishes.addEventListener('change', function () {
		applyFinish();
		if (pointerFinish) container.querySelector<HTMLCanvasElement>('#battlefield')?.focus({ preventScroll: true });
		pointerFinish = false;
	}, { signal: abort.signal });
	const telemetry = document.createElement('output'); telemetry.id = 'rig-test-telemetry';
	const guide = document.createElement('p'); guide.textContent = 'Compare: accelerate → release throttle → brake → reverse → turn a circle → aim while turning → fire. Use the normal keyboard, controller or touch controls. Pause → Controls for bindings. No enemy waves; reset restores ammo and heat. Preferences and campaign are not saved.';
	panel.append(summary, controls, finishes, telemetry, guide); container.append(panel);
	const restart = function () {
		const frame = FRAMES.find(function (candidate) { return candidate.id === rig.value; });
		if (!frame) return;
		settings.controlMode = mode.value === 'arcade' ? 'arcade' : 'simulation';
		const state = createState({ frame: frame.id });
		if (equipment.value === 'empty') state.loadout = [];
		if (equipment.value === 'loaded') state.loadout = getHardpoints(frame.id).flatMap(function (mount, slot) {
			const weapon = mount.weapons[0]; return weapon ? [{ ...createMount(weapon), slot }] : [];
		});
		state.spawnIn = Infinity;
		start(state); scenario = current(); applyFinish();
	};
	for (const select of [rig, mode, equipment]) select.addEventListener('change', restart, { signal: abort.signal });
	reset.addEventListener('click', restart, { signal: abort.signal });
	const interval = window.setInterval(function () {
		const state = current();
		const degrees = function (radians: number) { return Math.round((radians * 180 / Math.PI % 360 + 360) % 360); };
		telemetry.textContent = `${frameWeight(state.frame, state.loadout).total.toFixed(1)}T · speed ${state.player.speed.toFixed(1)} · throttle ${Math.round(state.player.throttle * 100)}% · hull ${degrees(state.player.angle)}° · torso ${degrees(state.player.turret)}° · heat ${Math.round(state.player.heat)}%`;
	}, 100);
	restart();
	return function () { abort.abort(); clearInterval(interval); panel.remove(); };
};
