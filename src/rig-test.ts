import { PLAYABLE_FRAMES } from './frames';
import { stockPackage } from './hardpoints';
import { frameWeight, loadedMounts } from './combat-resources';
import { createState, type CombatStateView, type State } from './simulation';
import type { Settings } from './profile';

export const rigTestEnabled = new URLSearchParams(location.search).has('rig-test');

interface RigTestPresentation {
	canCompareKestrel: () => boolean;
	canBakeYard: () => boolean;
	setKestrelComparison: (scenario: CombatStateView | undefined, enabled: boolean, lighter: boolean, bakedYard: boolean) => void;
}

// This harness configures scenarios; movement and input remain owned by the game.
export const mountRigTest = function (container: HTMLElement, settings: Settings, start: (state: State) => void, current: () => CombatStateView, presentation: RigTestPresentation): () => void {
	const abort = new AbortController();
	const panel = document.createElement('details');
	const drill = new URLSearchParams(location.search).get('rig-test');
	const backup = drill === 'backup';
	panel.id = 'rig-test-panel'; panel.open = !backup;
	panel.classList.toggle('rig-test-backup', backup);
	const summary = document.createElement('summary'); summary.textContent = backup ? 'RETREAT & FIRE DRILL' : 'RIG HANDLING TEST';
	const rig = document.createElement('select'); rig.id = 'test-rig'; rig.title = 'Rig';
	for (const frame of PLAYABLE_FRAMES) rig.add(new Option(frame.name, frame.id));
	if (drill === 'kestrel') rig.value = 'kestrel';
	const legs = document.createElement('select'); legs.id = 'test-leg-controls'; legs.title = 'Leg controls';
	legs.add(new Option('Legs: Tank', 'tank')); legs.add(new Option('Legs: Arcade', 'arcade')); legs.value = backup ? 'arcade' : settings.legControls;
	const torso = document.createElement('select'); torso.id = 'test-torso-aim'; torso.title = 'Controller torso aim';
	torso.add(new Option('Torso: Rotate', 'rotate')); torso.add(new Option('Torso: Point', 'point')); torso.value = backup ? 'point' : settings.torsoAim;
	const equipment = document.createElement('select'); equipment.id = 'test-equipment'; equipment.title = 'Equipment';
	equipment.add(new Option('Starter weapon', 'starter'));
	equipment.add(new Option('All mounts loaded', 'loaded'));
	equipment.add(new Option('Empty mounts', 'empty'));
	const reset = document.createElement('button'); reset.textContent = 'RESET RUN';
	const controls = document.createElement('div'); controls.className = 'rig-test-options'; controls.append(rig, legs, torso, equipment, reset);
	const finishes = document.createElement('div'); finishes.className = 'rig-test-finishes';
	const checkbox = function (id: string, text: string, checked: boolean) {
		const label = document.createElement('label');
		const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
		label.append(input, text); finishes.append(label); return input;
	};
	const ink = checkbox('test-kestrel-ink', 'Blue Kestrel · solid ink', true);
	const light = checkbox('test-kestrel-housing', 'Lighter gun housing', true);
	const yard = checkbox('test-baked-yard', 'Baked yard', true);
	let scenario: CombatStateView | undefined;
	let bakeAvailable = presentation.canBakeYard();
	const applyFinish = function () {
		if (!ink.disabled && !presentation.canCompareKestrel()) {
			ink.checked = false; ink.disabled = true;
			finishes.append('Solid ink is unavailable for this Kestrel preview.');
		}
		const available = rig.value === 'kestrel' && !ink.disabled;
		finishes.hidden = rig.value !== 'kestrel'; light.disabled = !available || !ink.checked;
		bakeAvailable = presentation.canBakeYard();
		yard.disabled = light.disabled || !bakeAvailable;
		yard.title = bakeAvailable ? '' : 'Baked yard is unavailable';
		if (!bakeAvailable) yard.checked = false;
		presentation.setKestrelComparison(available && scenario === current() ? scenario : undefined, ink.checked, light.checked, yard.checked);
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
	if (backup) guide.textContent = 'Close this panel to see the scout. Hold right stick up on a controller, or tap the scout on touch. Drive down and fire while backing away. Release aim or tap the lock again, then compare. RESET RUN restores the target and ammo. Nothing is saved.';
	panel.append(summary, controls, finishes, telemetry, guide); container.append(panel);
	const restart = function () {
		const frame = PLAYABLE_FRAMES.find(function (candidate) { return candidate.id === rig.value; });
		if (!frame) return;
		settings.legControls = legs.value === 'tank' ? 'tank' : 'arcade';
		settings.torsoAim = torso.value === 'rotate' ? 'rotate' : 'point';
		const state = createState({ frame: frame.id });
		if (equipment.value === 'empty') state.loadout = [];
		if (equipment.value === 'loaded') {
			const stock = stockPackage(frame.id);
			state.loadout = loadedMounts(stock.loadout, stock.reserves);
		}
		state.spawnIn = Infinity;
		if (backup) {
			state.player.y = 420;
			state.player.angle = state.player.turret = -3 * Math.PI / 4;
			state.enemies.push({ id: state.nextId++, x: state.player.x - 95, y: state.player.y - 95, kind: 'scout', angle: Math.PI / 4, hp: 600, maxHp: 600, cooldown: 0, heavy: false, stationary: true, loadout: [] });
		}
		start(state); scenario = current(); applyFinish();
	};
	for (const select of [rig, legs, torso, equipment]) select.addEventListener('change', restart, { signal: abort.signal });
	reset.addEventListener('click', restart, { signal: abort.signal });
	const interval = window.setInterval(function () {
		// Render-target allocation can fail on the first draw or after a resize.
		if ((!ink.disabled && !presentation.canCompareKestrel()) || bakeAvailable !== presentation.canBakeYard()) applyFinish();
		const state = current();
		const degrees = function (radians: number) { return Math.round((radians * 180 / Math.PI % 360 + 360) % 360); };
		const drive = state.player.arcadeBacking ? 'BACKUP · ' : '';
		telemetry.textContent = `${drive}${frameWeight(state.frame, state.loadout).total.toFixed(1)}T · speed ${state.player.speed.toFixed(1)} · throttle ${Math.round(state.player.throttle * 100)}% · hull ${degrees(state.player.angle)}° · torso ${degrees(state.player.turret)}° · heat ${Math.round(state.player.heat)}%`;
	}, 100);
	restart();
	return function () { abort.abort(); clearInterval(interval); panel.remove(); };
};
