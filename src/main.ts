import { ACTIONS, LABELS, defaultKeyboard, defaultController, keyLabel, padLabel, validKey, type Action } from './bindings';
import { getWeapon, WEAPON_FAMILY_LABELS } from './arsenal';
import { canEquipWeapon, getHardpoints } from './hardpoints';
import { getFrame } from './frames';
import { MOUNTS, rankLabel } from './loadout-ui';
import { mountGame } from './shared/lifecycle';
import { createMissionState, createState, distance, getOperationReport, step, type Controls, type Point } from './simulation';
import { createPresentation } from './presentation';
import { advanceGaits, createGaits } from './gait';
import { viewScale } from './projection-3d';
import type { ScreenRect } from './overlay';
import { createAudio } from './audio';
import { createGamepadInput, type PadInput } from './gamepad';
import { createControllerFeedback } from './controller-feedback';
import { createTraining, stepTraining, trainingCopy, type Training } from './training';
import { isDifficulty, readProfile, saveProfile } from './profile';
import { abandonContract, acceptContract, CAMPAIGN_STORAGE_KEY, getFaction, getPlanet, readCampaign, saveCampaign, settleContract, travelTo } from './campaign';
import { MISSION_NAMES, renderBridge } from './campaign-ui';
import type { PlanetId } from './campaign-types';
import { missionObjective } from './missions';
import { advanceDays, applyRigCheat, beginDeployment, buyFrame, buyWeapon, cancelWorkOrder, checkpointDeployment, getOwnedMech, queueRefit, queueRepair, selectFrame } from './company';
import { renderCompany, type CompanyEditor, type ShipScreen } from './company-ui';
import type { Campaign } from './campaign';
import { createTitleScene } from './title-scene';
import { mountWorkspaceLayout, revealWorkspaceElement, selectWorkspacePane } from './workspace';
import { mountDialogLayout } from './dialog-layout';

const element = function (id: string): HTMLElement {
	const value = document.getElementById(id);
	if (!(value instanceof HTMLElement)) throw new Error(`Missing interface element: ${id}`);
	return value;
};
const inputElement = function (id: string): HTMLInputElement {
	const value = element(id);
	if (!(value instanceof HTMLInputElement)) throw new Error(`Missing input: ${id}`);
	return value;
};
const formatTime = function (time: number) { return `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`; };
type Screen = ShipScreen | 'title' | 'jump' | 'playing' | 'pause-panel' | 'result' | 'training-result';
type Auxiliary = 'settings' | 'handbook' | 'confirm' | 'save-conflict';
const shutdown = await mountGame('game', async function (container) {
	const canvas = container.querySelector('canvas');
	if (!canvas) throw new Error('Missing battlefield');
	canvas.tabIndex = 0;
	const presentation = await createPresentation(canvas);
	const titleCanvas = element('title-scene');
	if (!(titleCanvas instanceof HTMLCanvasElement)) throw new Error('Missing title scene');
	let titleScene: ReturnType<typeof createTitleScene> | undefined;
	const showTitleScene = function () {
		if (titleScene) return;
		try { titleScene = createTitleScene(titleCanvas); }
		catch (error: unknown) { console.warn('Title scene unavailable', error); }
	};
	const audio = createAudio();
	const padInput = createGamepadInput();
	const feedback = createControllerFeedback();
	const profile = readProfile();
	const savedSnapshot = function (): string | null | undefined {
		try { return localStorage.getItem(CAMPAIGN_STORAGE_KEY); } catch { return undefined; }
	};
	let campaignSnapshot = savedSnapshot();
	let campaign = readCampaign();
	const returningCompany = campaignSnapshot !== null && campaignSnapshot !== undefined;
	let campaignSaved = false;
	let campaignConflict = false;
	let destination: PlanetId = campaign.planetId;
	let selectedContract: string | undefined;
	let jumpUntil = 0;
	const abort = new AbortController(); const listenerOptions = { signal: abort.signal };
	const updateWorkspaceLayout = mountWorkspaceLayout(container, abort.signal);
	const updateDialogLayout = mountDialogLayout(container, abort.signal);
	const keys = new Set<string>(); const pending = new Set<string>(); const held = new Map<number, string>();
	const coarsePointer = window.matchMedia('(pointer: coarse)');
	const ui = {
		phase: element('phase'), status: element('status'), armor: element('armor-value'), armorFill: element('armor-fill'),
		relay: element('relay-value'), relayFill: element('relay-fill'), heat: element('heat-value'), heatFill: element('heat-fill'),
		drive: element('drive-value'), throttleFill: element('throttle-fill'), speed: element('speed-value'),
		coolant: element('coolant-value'), message: element('message'),
		sound: element('sound'), hint: element('pilot-hint'), hintCopy: element('hint-copy'), inputMode: element('input-mode'),
	};
	const cockpitElements = [...container.querySelectorAll<HTMLElement>('.left-instruments, .weapon-console, #touch, #training-guide')];
	let hudObstructions: ScreenRect[] = [];
	const weaponButtons = MOUNTS.map(function (binding) {
		const button = document.createElement('button'); button.className = 'weapon'; button.dataset['control'] = binding.action;
		button.innerHTML = '<span class="weapon-mount"></span><span class="weapon-icon" aria-hidden="true"></span><b></b><small><kbd></kbd></small><em></em><i></i>';
		return button;
	});
	element('weapon-bank').replaceChildren(...weaponButtons);
	let training: Training | undefined;
	let screen: Screen = 'title'; let auxiliary: Auxiliary | undefined;
	let trainingOrigin: 'title' | 'bridge' = 'bridge';
	let editor: CompanyEditor = { loadout: [...(getOwnedMech(campaign)?.loadout ?? [])], slot: null, notice: '' };
	const mouseButtons = new Set<number>();
	const consumedMouseButtons = new Set<number>();
	let state = createState({ difficulty: profile.settings.difficulty }); let gaits = createGaits(state); let muted = false;
	let aim: Point = { x: 900, y: 450 }; let pointer: Point | undefined; let aimMode: 'pointer' | 'gamepad' = 'pointer';
	let frame = 0; let previous = 0; let accumulator = 0; let lastHud = 0;
	let message = ''; let messageUntil = 0; let terminalUntil = 0; let contextLost = false; let focused = true;
	let returnFocus: HTMLElement | undefined; let confirmedAction: (() => void) | undefined; let tipDismissed = false;
	let inputMode: 'keyboard' | 'gamepad' | 'touch' = coarsePointer.matches ? 'touch' : 'keyboard'; let controllerLost = false; let screenRevision = 0;
	let currentPad: PadInput | undefined;
	let lastSoundState = '';
	const resetInput = function () { keys.clear(); pending.clear(); held.clear(); mouseButtons.clear(); padInput.requireNeutral(); void feedback.stop(); };
	const playing = function () { return screen === 'playing' && !auxiliary && !campaignConflict && !contextLost && !document.hidden && focused; };
	const keyboardAction = function (code: string) { return ACTIONS.find(function (action) { return profile.settings.keyboard[action].includes(code); }); };
	const active = function (action: string) { return [...mouseButtons].some(function (button) { return keyboardAction(`Mouse${button}`) === action; }) || [...keys].some(function (code) { return keyboardAction(code) === action; }) || pending.has(action) || [...held.values()].includes(action); };
	const silenceAudio = function () { audio.update({ speed: 0, laser: false, heat: 0, active: false }); };
	const unlockSound = function () { void audio.unlock(); };
	const updateMenuHint = function () {
		const onTitle = screen === 'title' && !auxiliary;
		element('menu-input-hint').textContent = inputMode === 'gamepad' ? onTitle ? 'D-PAD / STICK SELECT · A / × CONFIRM' : 'D-PAD SELECT · A / × CONFIRM · B / ○ BACK' : inputMode === 'touch' ? onTitle ? 'TAP TO SELECT' : 'TAP TO SELECT · PREV / NEXT FOR PAGES' : onTitle ? '↑ / ↓ OR TAB SELECT · ENTER CONFIRM' : 'TAB SELECT · ENTER CONFIRM · ESC BACK';
	};
	const setInputMode = function (value: typeof inputMode) {
		if (inputMode === value && container.dataset['input'] === value && container.classList.contains('couch-ui') === (value === 'gamepad' || profile.settings.couchUI)) return;
		inputMode = value; container.dataset['input'] = value;
		container.classList.toggle('using-gamepad', value === 'gamepad');
		container.classList.toggle('couch-ui', value === 'gamepad' || profile.settings.couchUI);
		ui.inputMode.textContent = value === 'gamepad' ? 'GAMEPAD' : value === 'touch' ? 'TOUCH' : 'KB / MOUSE';
		const prompts = [['#pause kbd', 'Esc', 'Menu'], ['#coolant kbd', 'V', 'B / ○']] as const;
		for (const [selector, keyboard, gamepad] of prompts) {
			const prompt = container.querySelector(selector); if (prompt) prompt.textContent = value === 'gamepad' ? gamepad : keyboard;
		}
		element('weapon-hint').textContent = value === 'gamepad' ? 'HOLD TRIGGERS + BUMPERS' : value === 'touch' ? 'HOLD TOGETHER TO COMBINE' : 'HOLD MOUSE BUTTONS / 1–4';
		updateMenuHint();
		updateWorkspaceLayout(); updateDialogLayout();
	};
	const save = function () {
		element('storage-status').textContent = saveProfile(profile) ? 'Preferences are saved on this device.' : 'Device storage is unavailable. You can keep playing; records will last for this session.';
	};
	const updateSettings = function () {
		audio.setMix(profile.settings);
		container.classList.toggle('touch-enabled', coarsePointer.matches || profile.settings.touchControls);
		for (const name of ['master', 'music', 'effects'] as const) {
			inputElement(`${name}-volume`).value = String(Math.round(profile.settings[name] * 100));
			element(`${name}-output`).textContent = `${Math.round(profile.settings[name] * 100)}%`;
		}
		inputElement('show-touch').checked = profile.settings.touchControls;
		inputElement('large-interface').checked = profile.settings.couchUI;
		inputElement('controller-vibration').checked = profile.settings.vibration;
		const modeSelect = element('control-mode'); if (modeSelect instanceof HTMLSelectElement) modeSelect.value = profile.settings.controlMode;
		setInputMode(inputMode);
	};
	const menu = function () { return auxiliary ? element(auxiliary) : screen === 'playing' ? undefined : element(screen); };
	const focusable = function (root: HTMLElement) {
		return [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(function (item) { return !item.closest('[hidden], [inert]') && item.getClientRects().length > 0; });
	};
	const syncScreen = function (focus = true) {
		if (campaignConflict) auxiliary = 'save-conflict';
		screenRevision++;
		element('reset').hidden = !training;
		element('reset').textContent = 'RESTART TRAINING';
		element('leave').textContent = state.mission && !training ? 'ABORT CONTRACT & RETURN TO SHIP' : trainingOrigin === 'title' && training ? 'RETURN TO TITLE' : 'RETURN TO SHIP';
		element('training-deploy').textContent = campaign.active ? 'REVIEW CONTRACT LOADOUT →' : 'RETURN TO SHIP →';
		element('training-briefing').textContent = trainingOrigin === 'title' ? 'RETURN TO TITLE' : 'RETURN TO SHIP';
		element('pause-copy').textContent = training ? 'Training is paused. The simulator does not affect your company.' : 'Your throttle and mission are preserved. Aborting or reloading returns the mech with its current damage.';
		for (const id of ['title', 'bridge', 'mechbay', 'market', 'engineering', 'jump', 'pause-panel', 'result', 'training-result', 'settings', 'handbook', 'confirm', 'save-conflict']) {
			const node = element(id); const visible = auxiliary ? id === auxiliary : id === screen;
			node.hidden = !visible; node.inert = !visible;
		}
		const modal = screen !== 'playing' || Boolean(auxiliary);
		container.classList.toggle('training-active', Boolean(training));
		container.classList.toggle('menu-open', modal); container.dataset['screen'] = auxiliary ?? screen;
		updateMenuHint();
		element('title-save-status').textContent = `${campaignSaved ? 'LOCAL COMPANY' : 'SESSION ONLY · STORAGE UNAVAILABLE'} / DAY ${String(campaign.day).padStart(2, '0')} / ${getPlanet(campaign.planetId).name.toUpperCase()}`;
		if (screen === 'title') showTitleScene();
		element('hud').inert = modal; canvas.inert = modal;
		resetInput(); accumulator = 0; lastHud = 0;
		updateWorkspaceLayout(); updateDialogLayout();
		if (!focus) return;
		const root = menu();
		const initial = auxiliary === 'save-conflict' ? element('reload-company') : auxiliary === 'settings' ? element('master-volume') : auxiliary === 'handbook' ? element('handbook') : auxiliary === 'confirm' ? element('confirm-cancel') : screen === 'bridge' ? element('bridge') : screen === 'pause-panel' ? element('resume') : screen === 'result' ? element('restart') : root?.querySelector<HTMLElement>('[aria-current="page"]') ?? root?.querySelector<HTMLElement>('button');
		(initial ?? canvas).focus({ preventScroll: true });
		updateDialogLayout();
	};
	const updateDifficulty = function () {
		for (const input of container.querySelectorAll<HTMLInputElement>('input[data-difficulty]')) input.checked = input.value === profile.settings.difficulty;
	};
	const start = function () {
		if (contextLost || auxiliary || screen !== 'mechbay') return;
		const next = beginDeployment(campaign);
		if (next === campaign || !next.active || !next.deployed) return;
		const mech = getOwnedMech(next);
		if (!mech) return;
		campaign = next; if (!persistCampaign()) return;
		presentation.resetZoom(); training = undefined;
		state = createMissionState(next.active, { difficulty: profile.settings.difficulty, frame: mech.frameId, loadout: mech.loadout, integrity: mech.integrity, coolantCharges: next.deployed.coolantCharges });
		gaits = createGaits(state); screen = 'playing'; auxiliary = undefined; aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer';
		aim = state.mission ? { ...state.mission.map.objective } : { ...state.player };
		pointer = undefined; message = `${getFrame(mech.frameId).name} ON SURFACE · ${MISSION_NAMES[next.active.kind].toUpperCase()}`; messageUntil = 5; tipDismissed = false;
		terminalUntil = 0; audio.reset(); syncScreen(); unlockSound();
	};
	const startTraining = function () {
		if (contextLost) return;
		if (!training) trainingOrigin = screen === 'title' ? 'title' : 'bridge';
		presentation.resetZoom();
		training = createTraining(); state = training.state; gaits = createGaits(state);
		screen = 'playing'; auxiliary = undefined; aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; pointer = undefined; aim = { x: 900, y: 450 };
		message = ''; messageUntil = 0; tipDismissed = true; terminalUntil = 0;
		audio.reset(); syncScreen(); unlockSound();
	};
	const setPaused = function (paused: boolean) {
		if (paused) silenceAudio();
		if (paused && screen === 'playing') { screen = 'pause-panel'; auxiliary = undefined; syncScreen(); }
		else if (!paused && screen === 'pause-panel' && !contextLost) { screen = 'playing'; auxiliary = undefined; aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; syncScreen(); unlockSound(); }
	};
	const showAuxiliary = function (value: Auxiliary) {
		if (document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
		auxiliary = value; syncScreen();
	};
	const closeAuxiliary = function () {
		if (campaignConflict) return;
		capture = undefined; renderMappings();
		auxiliary = undefined; confirmedAction = undefined; syncScreen(false);
		if (returnFocus?.isConnected && !returnFocus.closest('[hidden], [inert]')) returnFocus.focus({ preventScroll: true });
		else syncScreen();
	};
	const confirm = function (action: () => void, label: string, copy = 'The current operation will be lost. Your recorded results and settings will be kept.', title = 'ABANDON THIS RUN?') {
		confirmedAction = action; element('confirm-action').textContent = label; element('confirm-copy').textContent = copy; element('confirm-title').textContent = title; showAuxiliary('confirm');
	};
	const stopForConflict = function () {
		campaignConflict = true; silenceAudio(); padInput.suspend(); auxiliary = 'save-conflict'; syncScreen();
	};
	const persistCampaign = function (): boolean {
		if (campaignConflict) return false;
		const current = savedSnapshot();
		if (current !== undefined && campaignSnapshot !== undefined && current !== campaignSnapshot) { stopForConflict(); return false; }
		campaignSaved = saveCampaign(campaign);
		if (campaignSaved) campaignSnapshot = JSON.stringify(campaign);
		return true;
	};
	const checkpoint = function () {
		if (training || !state.mission || !campaign.deployed) return;
		const next = checkpointDeployment(campaign, state.player.hp, state.coolantCharges);
		if (next !== campaign) { campaign = next; if (!persistCampaign()) return; }
	};
	const resetEditor = function (notice = '') {
		editor = { loadout: [...(getOwnedMech(campaign)?.loadout ?? [])], slot: null, notice };
	};
	const updateCompany = function (next: Campaign, notice: string, nextScreen?: ShipScreen) {
		if (next === campaign) return;
		const current = getOwnedMech(campaign); const upcoming = getOwnedMech(next);
		const installedChanged = current?.frameId !== upcoming?.frameId || current?.loadout.some(function (weapon, index) { return weapon !== upcoming?.loadout[index]; });
		campaign = next; if (!persistCampaign()) return;
		if (installedChanged || nextScreen || screen === 'mechbay') resetEditor(notice);
		else editor = { ...editor, notice };
		if (nextScreen && nextScreen !== 'bridge') { screen = nextScreen; refreshCompany(); syncScreen(); }
		else refreshCompany();
	};
	const focusCompany = function (selector: string, fallback?: string) {
		const target = element('mechbay').querySelector<HTMLElement>(selector) ?? (fallback ? element('mechbay').querySelector<HTMLElement>(fallback) : null);
		if (target) { revealWorkspaceElement(target); target.focus({ preventScroll: true }); }
	};
	const refreshCompany = function () {
		if (screen !== 'mechbay' && screen !== 'market' && screen !== 'engineering') return;
		const root = element(screen); const previousFocus = document.activeElement;
		const focusIndex = focusable(root).findIndex(function (item) { return item === previousFocus; });
		renderCompany(root, campaign, screen, editor, campaignSaved, {
			navigate: navigateShip,
			selectFrame: function (id) { updateCompany(selectFrame(campaign, id), 'Frame selected.'); },
			editSlot: function (slot) {
				if (!getHardpoints(campaign.selectedFrame)[slot]) return;
				editor = { ...editor, slot }; refreshCompany(); focusCompany('.equipment-choice[aria-pressed="true"]:not(:disabled)', '.equipment-choice:not(:disabled)');
			},
			setWeapon: function (weapon) {
				if (editor.slot === null || !getHardpoints(campaign.selectedFrame)[editor.slot]) return;
				const slot = editor.slot;
				if (weapon !== null && !canEquipWeapon(campaign.selectedFrame, slot, weapon)) {
					editor = { ...editor, notice: 'This weapon does not fit the selected hardpoint.' }; refreshCompany(); return;
				}
				editor = { ...editor, loadout: editor.loadout.map(function (current, index) { return index === editor.slot ? weapon : current; }), slot: null, notice: 'Refit staged. Queue the work order to fit these weapons.' }; refreshCompany();
				focusCompany(`[data-loadout-slot="${slot}"]`);
			},
			closePicker: function () { const slot = editor.slot; editor = { ...editor, slot: null }; refreshCompany(); focusCompany(`[data-loadout-slot="${slot}"]`, '[data-loadout-slot]'); },
			discardRefit: function () { resetEditor('Staged changes discarded.'); refreshCompany(); },
			queueRefit: function () { updateCompany(queueRefit(campaign, campaign.selectedFrame, editor.loadout), 'Refit queued. Advance the calendar to finish installation.', 'engineering'); },
			buyFrame: function (id) { updateCompany(buyFrame(campaign, id), `${getFrame(id).name} purchased with its standard weapon. Select it in the Mech Bay.`); },
			buyWeapon: function (id) { updateCompany(buyWeapon(campaign, id), `${getWeapon(id).name} purchased. Fit it in the Mech Bay.`); },
			repair: function (id) { updateCompany(queueRepair(campaign, id), 'Repair queued. The mech remains unavailable until its completion day.', 'engineering'); },
			cancelWork: function (id) { updateCompany(cancelWorkOrder(campaign, id), 'Work order cancelled. Original equipment and condition retained.'); },
			advanceDays: function (days) { updateCompany(advanceDays(campaign, days), `${days} calendar ${days === 1 ? 'day' : 'days'} elapsed. Due work orders are complete.`); },
			deploy: function () {
				const mech = getOwnedMech(campaign);
				if (mech && editor.loadout.some(function (weapon, index) { return weapon !== mech.loadout[index]; })) {
					editor = { ...editor, notice: 'Queue or discard your staged loadout before deployment.' }; refreshCompany(); return;
				}
				start();
			},
			settings: function () { showAuxiliary('settings'); },
			handbook: function () { showAuxiliary('handbook'); },
		});
		if (focusIndex >= 0 && (!(previousFocus instanceof HTMLElement) || !previousFocus.isConnected || previousFocus.matches(':disabled'))) {
			const items = focusable(root); items[Math.min(focusIndex, items.length - 1)]?.focus({ preventScroll: true });
		}
	};
	const refreshBridge = function () {
		renderBridge(element('bridge'), campaign, destination, selectedContract, campaignSaved, {
			navigate: navigateShip,
			selectPlanet: function (id) { if (campaign.active) return; destination = id; selectedContract = undefined; refreshBridge(); },
			selectContract: function (id) { selectedContract = id; refreshBridge(); selectWorkspacePane(element('bridge'), 'briefing', true); },
			travel: function () {
				if (screen !== 'bridge' || auxiliary || contextLost) return;
				const origin = getPlanet(campaign.planetId); const next = travelTo(campaign, destination); if (next === campaign) return;
				campaign = next; if (!persistCampaign()) return;
				element('jump-destination').textContent = getPlanet(campaign.planetId).name.toUpperCase();
				element('jump-copy').textContent = `${origin.name} → ${getPlanet(campaign.planetId).name} · DAY ${campaign.day} · APPROACHING ORBIT`;
				screen = 'jump'; jumpUntil = performance.now() + 2200; syncScreen();
				element('jump').focus({ preventScroll: true });
			},
			accept: function (contract) {
				if (screen !== 'bridge' || auxiliary || destination !== campaign.planetId) return;
				const next = acceptContract(campaign, contract.id); if (next === campaign) return;
				campaign = next; if (!persistCampaign()) return; refreshBridge(); syncScreen();
				selectWorkspacePane(element('bridge'), 'briefing'); element('bridge-deploy').focus({ preventScroll: true });
			},
			deploy: function () { navigateShip('mechbay'); },
			abandon: function () { confirm(function () { campaign = abandonContract(campaign); persistCampaign(); toBridge(); }, 'ABORT & RETURN TO SHIP', 'No payment or employer favor will be earned. The opposition reputation penalty from acceptance remains.', 'ABORT THIS CONTRACT?'); },
			training: startTraining,
			title: toTitle,
			settings: function () { showAuxiliary('settings'); },
			handbook: function () { showAuxiliary('handbook'); },
		});
	};
	const navigateShip = function (target: ShipScreen) {
		if (campaignConflict) return;
		training = undefined; screen = target; auxiliary = undefined;
		editor = { ...editor, slot: null };
		if (target === 'bridge') { destination = campaign.planetId; selectedContract = undefined; refreshBridge(); }
		else refreshCompany();
		pointer = undefined; presentation.resetZoom(); audio.reset(); syncScreen();
	};
	const toBridge = function () { navigateShip('bridge'); };
	const toTitle = function () {
		element('title-company-label').textContent = 'CONTINUE COMPANY';
		training = undefined; screen = 'title'; auxiliary = undefined; audio.reset(); syncScreen();
	};
	const back = function () {
		if (auxiliary) { closeAuxiliary(); return; }
		if (screen === 'mechbay' && editor.slot !== null) { const slot = editor.slot; editor = { ...editor, slot: null }; refreshCompany(); focusCompany(`[data-loadout-slot="${slot}"]`); return; }
		if (screen === 'training-result' && trainingOrigin === 'title') { toTitle(); return; }
		if (screen === 'mechbay' || screen === 'market' || screen === 'engineering' || screen === 'training-result') { toBridge(); return; }
		if (screen === 'bridge') { toTitle(); return; }
		setPaused(screen === 'playing');
	};
	const listen = function (id: string, callback: () => void) { element(id).addEventListener('click', callback, listenerOptions); };
	listen('title-continue', toBridge);
	listen('title-training', startTraining);
	listen('title-settings', function () { showAuxiliary('settings'); });
	listen('title-handbook', function () { showAuxiliary('handbook'); });
	const titleChoices = ['title-continue', 'title-training', 'title-settings', 'title-handbook'];
	const describeTitleChoice = function (selected: string) {
		for (const id of titleChoices) element(`${id}-description`).hidden = id !== selected;
	};
	for (const id of titleChoices) {
		element(id).addEventListener('focus', function () { describeTitleChoice(id); }, listenerOptions);
		element(id).addEventListener('pointerenter', function () { describeTitleChoice(id); }, listenerOptions);
		element(id).addEventListener('pointerleave', function () {
			const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
			describeTitleChoice(titleChoices.includes(focusedId) ? focusedId : 'title-continue');
		}, listenerOptions);
	}
	element('title-company-label').textContent = returningCompany ? 'CONTINUE COMPANY' : 'START COMPANY';
	listen('training-deploy', function () { if (campaign.active) navigateShip('mechbay'); else toBridge(); });
	listen('training-briefing', function () { if (trainingOrigin === 'title') toTitle(); else toBridge(); }); listen('restart', toBridge);
	listen('resume', function () { setPaused(false); });
	listen('pause', function () { setPaused(true); });
	listen('reset', function () { if (training) confirm(startTraining, 'RESTART TRAINING'); });
	listen('leave', function () {
		if (state.mission && !training) confirm(function () { checkpoint(); campaign = abandonContract(campaign); persistCampaign(); toBridge(); }, 'ABORT & RETURN TO SHIP', 'Current mech damage is retained. No payment or employer favor is earned; the opposition penalty remains. Recovery takes one day.', 'ABORT THIS CONTRACT?');
		else confirm(trainingOrigin === 'title' ? toTitle : toBridge, trainingOrigin === 'title' ? 'RETURN TO TITLE' : 'RETURN TO SHIP', 'Leave the simulator? Company progress is untouched.', 'LEAVE TRAINING?');
	});
	listen('result-briefing', toBridge);
	listen('confirm-action', function () { const action = confirmedAction; confirmedAction = undefined; action?.(); });
	listen('confirm-cancel', closeAuxiliary);
	listen('reload-company', function () { window.location.reload(); });
	window.addEventListener('storage', function (event) {
		if ((event.key === CAMPAIGN_STORAGE_KEY || event.key === null) && savedSnapshot() !== campaignSnapshot) stopForConflict();
	}, listenerOptions);
	for (const id of ['pause-settings']) listen(id, function () { showAuxiliary('settings'); });
	for (const id of ['pause-controls']) listen(id, function () { showAuxiliary('handbook'); });
	let capture: Action | undefined;
	const renderMappings = function () {
		const root = element('keyboard-mappings'); const focusedAction = root.querySelector('button:focus')?.getAttribute('data-action'); root.replaceChildren();
		for (const action of ACTIONS) {
			const button = document.createElement('button'); button.className = 'secondary'; button.type = 'button';
			button.dataset['action'] = action;
			const arcadeLabels: Partial<Record<Action, string>> = { forward: 'Move up', back: 'Move down', left: 'Move left', right: 'Move right' };
			button.textContent = `${profile.settings.controlMode === 'arcade' ? arcadeLabels[action] ?? LABELS[action] : LABELS[action]}: ${capture === action ? 'PRESS KEY / MOUSE · ESC CANCEL' : profile.settings.keyboard[action].map(keyLabel).join(' / ') || 'Unbound'}`;
			button.addEventListener('click', function () { capture = action; renderMappings(); }); root.append(button); if (capture === action || focusedAction === action) button.focus();
		}
	};
	const assignKey = function (code: string) {
		if (!capture) return;
		for (const action of ACTIONS) profile.settings.keyboard[action] = profile.settings.keyboard[action].filter(function (key) { return key !== code; });
		profile.settings.keyboard[capture] = [code]; capture = undefined; resetInput(); save(); renderMappings();
	};
	element('keyboard-mappings').addEventListener('mousedown', function (event) { if (capture && auxiliary === 'settings' && !element('keyboard-mappings').closest('[hidden], [inert]')) { event.preventDefault(); event.stopPropagation(); consumedMouseButtons.add(event.button); assignKey(`Mouse${event.button}`); } });
	for (const action of ['stop', 'coolant', 'mount-0', 'mount-1', 'mount-2', 'mount-3'] as const) {
		const label = document.createElement('label'); label.textContent = `${LABELS[action]} `;
		const select = document.createElement('select'); select.dataset['mapping'] = action;
		for (let index = 1; index <= 17; index++) { if (index === 9) continue; const option = document.createElement('option'); option.value = String(index); option.textContent = padLabel(index); select.append(option); }
		select.value = String(profile.settings.controller[action]);
		select.addEventListener('change', function () { const previous = profile.settings.controller[action]; const next = Number(select.value); for (const other of ['stop', 'coolant', 'mount-0', 'mount-1', 'mount-2', 'mount-3'] as const) if (other !== action && profile.settings.controller[other] === next) profile.settings.controller[other] = previous; profile.settings.controller[action] = next; resetInput(); save(); syncControllerMappings(); });
		label.append(select); element('controller-mappings').append(label);
	}
	const syncControllerMappings = function () { for (const select of element('controller-mappings').querySelectorAll('select')) { const action = select.dataset['mapping']; if (action === 'stop' || action === 'coolant' || action === 'mount-0' || action === 'mount-1' || action === 'mount-2' || action === 'mount-3') select.value = String(profile.settings.controller[action]); } };
	element('control-mode').addEventListener('change', function (event) {
		const select = event.target; if (!(select instanceof HTMLSelectElement) || (select.value !== 'simulation' && select.value !== 'arcade')) return;
		profile.settings.controlMode = select.value; capture = undefined; resetInput(); aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; save(); renderMappings(); updateSettings();
	}, listenerOptions);
	listen('reset-keyboard', function () { capture = undefined; profile.settings.keyboard = defaultKeyboard(); resetInput(); save(); renderMappings(); });
	listen('reset-controller', function () { profile.settings.controller = defaultController(); resetInput(); save(); syncControllerMappings(); });
	renderMappings();
	for (const tab of element('settings').querySelectorAll('[data-dialog-tab]')) tab.addEventListener('click', function () { capture = undefined; renderMappings(); });
	listen('close-settings', function () { capture = undefined; renderMappings(); closeAuxiliary(); }); listen('close-handbook', closeAuxiliary);
	listen('dismiss-hint', function () { tipDismissed = true; ui.hint.hidden = true; canvas.focus({ preventScroll: true }); });
	listen('sound', function () {
		if (audio.status() !== 'running') { muted = false; audio.setMuted(false); unlockSound(); }
		else { muted = !muted; audio.setMuted(muted); }
		canvas.focus({ preventScroll: true });
	});
	for (const input of container.querySelectorAll<HTMLInputElement>('input[data-difficulty]')) input.addEventListener('change', function () {
		if (!isDifficulty(input.value)) return;
		profile.settings.difficulty = input.value; save(); updateDifficulty();
	}, listenerOptions);
	for (const name of ['master', 'music', 'effects'] as const) inputElement(`${name}-volume`).addEventListener('input', function () {
		profile.settings[name] = Number(inputElement(`${name}-volume`).value) / 100; updateSettings(); save(); unlockSound();
	}, listenerOptions);
	inputElement('show-touch').addEventListener('change', function () { profile.settings.touchControls = inputElement('show-touch').checked; updateSettings(); save(); }, listenerOptions);
	inputElement('large-interface').addEventListener('change', function () { profile.settings.couchUI = inputElement('large-interface').checked; updateSettings(); save(); }, listenerOptions);
	inputElement('controller-vibration').addEventListener('change', function () { profile.settings.vibration = inputElement('controller-vibration').checked; updateSettings(); save(); if (!profile.settings.vibration) void feedback.stop(); }, listenerOptions);
	element('handbook').tabIndex = -1;
	coarsePointer.addEventListener('change', updateSettings, listenerOptions);
	const showResult = function (now: number) {
		if (training || !state.mission) return;
		checkpoint();
		const report = getOperationReport(state); const won = state.outcome === 'won'; const contract = state.mission.contract;
		campaign = settleContract(campaign, won); if (!persistCampaign()) return;
		screen = 'result'; terminalUntil = now + 1600;
		element('result-title').textContent = won ? 'CONTRACT COMPLETE.' : 'CONTRACT FAILED.';
		element('result-copy').textContent = won ? `${getPlanet(contract.planetId).name} extraction complete. ${getFaction(contract.employer).name} has confirmed the objective and released payment.` : `The sortie was lost. Your frame was recovered with ${report.armor}% integrity. No payment or employer favor was earned. Repair it in Engineering before its next deployment.`;
		element('result-difficulty').textContent = `${getFrame(state.frame).name} · ${state.difficulty.toUpperCase()}`;
		element('result-score').textContent = `${campaign.lastResult?.payout.toLocaleString() ?? '0'} CR`;
		element('result-rank').textContent = won ? '✓' : '×';
		const heading = element('result-score').previousElementSibling; if (heading) heading.textContent = 'CONTRACT PAYMENT';
		const stats = [[String(report.kills), 'ELIMINATED'], [formatTime(report.time), 'FIELD TIME'], [`${report.armor}%`, 'FRAME INTEGRITY'], [`+${campaign.lastResult?.favor ?? 0}`, 'EMPLOYER FAVOR']];
		element('result-stats').replaceChildren(...stats.map(function ([value, label]) { const node = document.createElement('div'); const strong = document.createElement('b'); const small = document.createElement('small'); strong.textContent = value ?? ''; small.textContent = label ?? ''; node.append(strong, small); return node; }));
		element('result-upgrades').textContent = `DAY ${campaign.day} · Equipment retained. Damage requires a repair work order. ${getFaction(contract.opponent).name}: −${contract.hostility} reputation applied on acceptance.`;
		element('restart').textContent = 'RETURN TO SHIP →'; element('result-briefing').hidden = true;
		element('record-feedback').textContent = campaignSaved ? 'CAMPAIGN SAVED ON THIS DEVICE' : 'STORAGE UNAVAILABLE · CAMPAIGN CONTINUES FOR THIS SESSION';
		syncScreen();
	};
	const rigCode = ['ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
	let rigCodeInput: string[] = [];
	window.addEventListener('keydown', function (event) {
		if (capture) rigCodeInput = [];
		setInputMode('keyboard'); if (event.isTrusted) unlockSound();
		if (capture && auxiliary === 'settings' && !element('keyboard-mappings').closest('[hidden], [inert]')) { event.preventDefault(); if (event.code === 'Escape') { capture = undefined; renderMappings(); } else if (!event.repeat && validKey(event.code)) assignKey(event.code); return; }
		if (capture || auxiliary || campaignConflict || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLElement && event.target.isContentEditable) {
			rigCodeInput = [];
		} else if (!event.repeat) {
			rigCodeInput = [...rigCodeInput, event.code].slice(-rigCode.length);
			if (rigCode.every(function (code, index) { return code === rigCodeInput[index]; })) {
				rigCodeInput = [];
				updateCompany(applyRigCheat(campaign), 'Cheat enabled: all rigs unlocked and 1,000,000 credits added.');
			}
		}
		if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) back(); return; }
		const root = menu();
		if (root && screen === 'title' && !auxiliary && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
			event.preventDefault(); const items = focusable(root); const index = items.findIndex(function (item) { return item === document.activeElement; });
			items[(index + (event.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); audio.cue('focus'); return;
		}
		// Purchases and work orders require a fresh confirmation press.
		if (root && event.repeat && (event.code === 'Enter' || event.code === 'Space')) { event.preventDefault(); return; }
		if (root && event.code === 'Tab') {
			const items = focusable(root); const first = items[0]; const last = items.at(-1);
			if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
			return;
		}
		if (!playing()) return;
		if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
		const action = keyboardAction(event.code); if (!action) return;
		event.preventDefault(); if (event.repeat && !keys.has(event.code)) return; keys.add(event.code); if (!event.repeat) pending.add(action);
	}, listenerOptions);
	window.addEventListener('keyup', function (event) { const action = keyboardAction(event.code); if (action) keys.delete(event.code); }, listenerOptions);
	container.addEventListener('pointerdown', function (event) { setInputMode(event.pointerType === 'touch' ? 'touch' : 'keyboard'); if (event.isTrusted) unlockSound(); }, listenerOptions);
	container.addEventListener('click', function (event) {
		if (!(event.target instanceof Element) || !event.target.closest('button') || !menu()) return;
		audio.cue(event.target.closest('#close-settings, #close-handbook, #confirm-cancel') ? 'back' : 'confirm');
	}, { ...listenerOptions, capture: true });
	window.addEventListener('pagehide', checkpoint, listenerOptions);
	window.addEventListener('blur', function () { checkpoint(); focused = false; padInput.suspend(); resetInput(); setPaused(true); }, listenerOptions);
	window.addEventListener('focus', function () { focused = true; padInput.suspend(); }, listenerOptions);
	document.addEventListener('visibilitychange', function () { padInput.suspend(); if (document.hidden) { checkpoint(); silenceAudio(); resetInput(); setPaused(true); } }, listenerOptions);
	canvas.addEventListener('webglcontextlost', function (event) {
		event.preventDefault(); contextLost = true; padInput.suspend(); resetInput(); setPaused(true);
		const error = element('error'); error.textContent = 'Graphics interrupted. Waiting for recovery…'; error.hidden = false;
	}, listenerOptions);
	canvas.addEventListener('webglcontextrestored', function () { contextLost = false; padInput.suspend(); element('error').hidden = true; accumulator = 0; previous = 0; }, listenerOptions);
	const updatePointer = function (event: PointerEvent) {
		if (!playing()) return;
		const rect = canvas.getBoundingClientRect(); pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }; aimMode = 'pointer';
		setInputMode(event.pointerType === 'touch' ? 'touch' : 'keyboard');
	};
	canvas.addEventListener('pointermove', updatePointer, listenerOptions);
	canvas.addEventListener('wheel', function (event) {
		if (!playing() || event.ctrlKey || event.metaKey) return;
		event.preventDefault(); presentation.zoomWithWheel(event); setInputMode('keyboard');
	}, { ...listenerOptions, passive: false });
	canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); }, listenerOptions);
	canvas.addEventListener('auxclick', function (event) { event.preventDefault(); }, listenerOptions);
	canvas.addEventListener('pointerdown', function (event) {
		if (!playing()) return;
		updatePointer(event); canvas.focus({ preventScroll: true });
		if (event.pointerType === 'touch') canvas.setPointerCapture(event.pointerId);
	}, listenerOptions);
	// Pointerdown only fires for the first mouse button in a chord. Mouse events
	// report every press/release, so all four mounts remain independent.
	canvas.addEventListener('mousedown', function (event) {
		const binding = keyboardAction(`Mouse${event.button}`);
		if (!binding || !playing()) return;
		event.preventDefault(); mouseButtons.add(event.button); consumedMouseButtons.add(event.button); pending.add(binding);
	}, listenerOptions);
	window.addEventListener('mouseup', function (event) {
		// Chromium handles side-button history on mouseup, before auxclick.
		if (consumedMouseButtons.has(event.button) || event.target === canvas) event.preventDefault();
		mouseButtons.delete(event.button); consumedMouseButtons.delete(event.button);
	}, listenerOptions);
	const release = function (event: PointerEvent) { held.delete(event.pointerId); if (event.type === 'pointercancel') mouseButtons.clear(); };
	window.addEventListener('pointerup', release, listenerOptions); window.addEventListener('pointercancel', release, listenerOptions);
	for (const button of container.querySelectorAll<HTMLButtonElement>('[data-control]')) {
		const action = button.dataset['control']; if (!action) continue;
		button.addEventListener('pointerdown', function (event) {
			if (!playing() || event.button !== 0) return;
			event.preventDefault(); button.setPointerCapture(event.pointerId); held.set(event.pointerId, action); pending.add(action);
		}, listenerOptions);
		button.addEventListener('click', function (event) { if (event.detail === 0 && playing()) { pending.add(action); canvas.focus({ preventScroll: true }); } }, listenerOptions);
		button.addEventListener('lostpointercapture', release, listenerOptions);
	}
	const updateHud = function () {
		hudObstructions = cockpitElements.filter(function (node) { return node.offsetWidth > 0; }).map(function (node) { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
		const p = state.player;
		ui.phase.textContent = 'FRAME TRAINING'; ui.status.textContent = 'SIMULATOR';
		element('mission-name').textContent = state.mission ? `${getPlanet(state.mission.contract.planetId).name.toUpperCase()} / ${getFaction(state.mission.contract.employer).shortName}` : 'WAYFARER TRAINING';
		element('relay-readout').hidden = Boolean(state.mission && state.mission.contract.kind !== 'defend');
		element('relay-name').textContent = state.mission ? 'CONTRACT RELAY' : 'RELAY 09';
		if (state.mission) { ui.phase.textContent = state.mission.stage === 'extract' ? 'OBJECTIVE COMPLETE / EXTRACT' : MISSION_NAMES[state.mission.contract.kind].toUpperCase(); ui.status.textContent = missionObjective(state); }
		element('training-guide').hidden = !training || screen !== 'playing';
		if (training) {
			const copy = trainingCopy(training, inputMode === 'gamepad', { ...profile.settings, controlMode: inputMode === 'touch' ? 'simulation' : profile.settings.controlMode });
			container.dataset['trainingStage'] = training.stage;
			ui.phase.textContent = `${getFrame(state.frame).name} QUALIFICATION`; ui.status.textContent = 'LOANED TRAINING FRAME · NO SCORED RECORD';
			element('training-progress').textContent = `DRILL ${copy.progress}`;
			element('training-title').textContent = copy.title;
			element('training-copy').textContent = inputMode === 'gamepad' && currentPad?.connected && !currentPad.ready ? 'Release sticks and triggers to arm the controls, then follow the drill.' : copy.instruction;
		} else delete container.dataset['trainingStage'];
		ui.armor.textContent = `${Math.max(0, Math.ceil(p.hp))}%`; ui.armorFill.style.width = `${Math.max(0, p.hp)}%`; ui.armorFill.style.background = p.hp < 30 ? 'var(--danger)' : 'var(--cyan)';
		ui.relay.textContent = `${Math.max(0, Math.ceil(state.relay))}%`; ui.relayFill.style.width = `${Math.max(0, state.relay)}%`; ui.relayFill.style.background = state.relay < 30 ? 'var(--danger)' : 'var(--cyan)';
		ui.heat.textContent = p.overheated ? 'LOCKOUT' : `${Math.ceil(p.heat)}%`; ui.heatFill.style.width = `${p.heat}%`; ui.heatFill.style.background = p.heat > 80 ? 'var(--danger)' : 'var(--amber)';
		ui.drive.textContent = `${p.throttle < -0.005 ? 'REV' : p.throttle > 0.005 ? 'FWD' : 'N'} ${Math.round(Math.abs(p.throttle) * 100)}%`;
		const definition = getFrame(state.frame);
		ui.throttleFill.style.left = `${p.throttle < 0 ? 50 + p.throttle * 50 : 50}%`; ui.throttleFill.style.width = `${Math.abs(p.throttle) * 50}%`; ui.speed.textContent = `SPD ${Math.round(p.speed / (p.speed < 0 ? definition.reverseSpeed : definition.speed) * 100)}%`;
		const hardpoints = getHardpoints(state.frame);
		element('weapon-bank').style.setProperty('--hardpoint-columns', String(hardpoints.length));
		element('weapon-bank').style.setProperty('--hardpoint-mobile-columns', String(Math.min(2, hardpoints.length)));
		for (const [index, button] of weaponButtons.entries()) {
			const hardpoint = hardpoints[index];
			button.hidden = hardpoint === undefined;
			if (!hardpoint) { button.disabled = true; continue; }
			const family = WEAPON_FAMILY_LABELS[hardpoint.family];
			const mount = state.loadout.find(function (entry, position) { return (entry.slot ?? position) === index; }); const binding = MOUNTS[index]; if (!binding) continue;
			const weapon = mount ? getWeapon(mount.weapon) : undefined;
			const drillSlot = training?.stage === 'cannon' ? 0 : training?.stage === 'missiles' ? 2 : training?.stage === 'heat' ? 0 : -1;
			button.disabled = !mount || Boolean(training && training.stage !== 'combined' && index !== drillSlot);
			const firing = Boolean(mount && !button.disabled && !p.overheated && playing() && (mount.firing || active(binding.action) || currentPad?.fire[index]));
			button.classList.toggle('empty', !mount); button.classList.toggle('firing', firing); button.classList.toggle('locked', p.overheated);
			button.setAttribute('aria-label', mount && weapon ? `Fire mount ${index + 1}, ${hardpoint.name}, ${family}: ${weapon.name}, rank ${rankLabel(mount.level)}. ${profile.settings.keyboard[binding.action].map(keyLabel).join(' / ') || 'Unbound'}; controller ${padLabel(profile.settings.controller[binding.action])}.` : `Mount ${index + 1}, ${hardpoint.name}, ${family}, empty. Equip compatible purchased weapons in the Mech Bay.`);
			const location = button.querySelector('.weapon-mount'); if (location) location.textContent = hardpoint.name;
			button.title = `${hardpoint.name} · ${family}${weapon ? ` · ${weapon.type}` : ' · Empty'}`;
			const title = button.querySelector('b'); if (title) title.textContent = mount && weapon ? weapon.name : 'EMPTY';
			const icon = button.querySelector('.weapon-icon'); if (icon) icon.textContent = `${String(index + 1).padStart(2, '0')}${mount ? ` · ${rankLabel(mount.level)}` : ''}`;
			const prompt = button.querySelector('kbd'); if (prompt) prompt.textContent = inputMode === 'gamepad' ? padLabel(profile.settings.controller[binding.action]) : inputMode === 'touch' ? `HOLD ${index + 1}` : profile.settings.keyboard[binding.action].map(keyLabel).join(' / ') || 'UNBOUND';
			const label = button.querySelector('em'); if (label) label.textContent = `${family.toUpperCase()} · ${!mount ? 'EMPTY' : button.disabled ? 'DRILL LOCK' : p.overheated ? 'HEAT LOCK' : firing ? 'FIRING' : mount.cooldown > 0 ? `${mount.cooldown.toFixed(1)}s` : 'READY'}`;
			const fill = button.querySelector('i'); if (fill) fill.style.width = `${mount && weapon ? Math.max(0, 1 - mount.cooldown / Math.max(.01, weapon.interval)) * 100 : 0}%`;
			button.style.setProperty('--weapon-color', weapon?.color ?? 'var(--muted)');
		}
		element('coolant').toggleAttribute('disabled', Boolean(training && training.stage !== 'coolant'));
		ui.coolant.textContent = `${state.coolantCharges} ${state.coolantCharges === 1 ? 'CHARGE' : 'CHARGES'}`;
		ui.message.textContent = !playing() ? '' : inputMode === 'gamepad' && currentPad?.connected && !currentPad.ready ? 'RELEASE STICKS AND TRIGGERS TO ARM CONTROLS' : p.overheated ? 'REACTOR LOCKOUT / VENT COOLANT OR CEASE FIRE' : state.time < messageUntil ? message : state.relay < 30 ? 'RELAY INTEGRITY CRITICAL' : '';
		ui.hint.hidden = tipDismissed || state.time > 35 || screen !== 'playing';
		const coolantPrompt = element('coolant').querySelector('kbd'); if (coolantPrompt) coolantPrompt.textContent = inputMode === 'gamepad' ? padLabel(profile.settings.controller.coolant) : profile.settings.keyboard.coolant.map(keyLabel).join(' / ') || 'UNBOUND';
		ui.hintCopy.textContent = inputMode === 'gamepad' ? profile.settings.controlMode === 'arcade' ? `Left stick moves toward its direction; release to slow. Right stick aims. ${padLabel(profile.settings.controller.stop)} stops.` : `Left stick up/down adjusts persistent throttle; left/right turns legs. Right stick left/right rotates torso; release to hold. ${padLabel(profile.settings.controller.stop)} stops.` : inputMode === 'touch' || coarsePointer.matches || profile.settings.touchControls ? 'Tap the field to aim. Hold + to move; STOP sets neutral. Hold a weapon to fire.' : profile.settings.controlMode === 'arcade' ? 'WASD / mapped movement keys choose direction; release to slow. Mouse aims. STOP sets neutral.' : state.time < 14 ? `${profile.settings.keyboard.forward.map(keyLabel).join(' / ')} increases throttle; ${profile.settings.keyboard.back.map(keyLabel).join(' / ')} decreases it. Release to cruise. ${profile.settings.keyboard.stop.map(keyLabel).join(' / ')} stops.` : 'Hold mapped weapon inputs together to combine mounts. Check Settings for keyboard / mouse and controller mappings.';
		const audioState = audio.status(); const needsGesture = audioState === 'locked' || audioState === 'pending';
		const soundState = audioState === 'unavailable' ? 'UNAVAILABLE' : needsGesture ? 'ENABLE SOUND' : muted ? 'SOUND OFF' : 'SOUND ON';
		if (lastSoundState !== soundState) { lastSoundState = soundState; ui.sound.textContent = soundState; ui.sound.setAttribute('aria-label', needsGesture ? 'Click to enable audio' : audioState === 'unavailable' ? 'Retry audio' : muted ? 'Unmute sound' : 'Mute sound'); ui.sound.setAttribute('aria-pressed', String(muted)); }
		const audioStatus = needsGesture && inputMode === 'gamepad' ? 'Audio needs a click or key press in this browser.' : audioState === 'unavailable' ? 'Audio device unavailable. Click or press a key to retry.' : '';
		if (element('audio-status').textContent !== audioStatus) element('audio-status').textContent = audioStatus;
	};
	const audioFrame = function (now: number) {
		const combat = playing(); const audibleMenu = screen === 'title' || screen === 'jump' || screen === 'bridge' || screen === 'mechbay' || screen === 'market' || screen === 'engineering' || screen === 'training-result' || (screen === 'result' && now < terminalUntil + 30000);
		return { speed: combat ? state.player.speed : 0, laser: combat && !!state.beam, heat: state.player.heat,
			active: !contextLost && focused && !document.hidden && (combat || audibleMenu), uiActive: !contextLost && focused && !document.hidden,
			phase: screen === 'title' || screen === 'jump' || screen === 'bridge' || screen === 'mechbay' || screen === 'market' || screen === 'engineering' ? 'briefing' as const : screen === 'training-result' ? 'refit' as const : screen === 'result' ? 'result' as const : 'combat' as const,
			intensity: Math.min(1, state.enemies.length / 5 + (state.wave - 1) * 0.08), danger: Math.max(0, 1 - Math.min(state.player.hp, state.relay) / 50), victory: state.outcome === 'won' };
	};
	const tick = function (now: number) {
		if (screen === 'jump' && focused && !document.hidden && now >= jumpUntil) toBridge();
		const revisionAtFrame = screenRevision;
		const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0; previous = now;
		const rect = canvas.getBoundingClientRect(); const width = rect.width; const height = rect.height;
		presentation.resize(state, width, height);
		let pads: readonly (Gamepad | null)[] = [];
		try { pads = navigator.getGamepads?.() ?? []; } catch { /* Gamepad access can be restricted by an embedding policy. */ }
		if (!focused || document.hidden || contextLost) padInput.suspend();
		const pad = padInput.read(pads, now, profile.settings.controller);
		currentPad = pad;
		if (pad.lost) { controllerLost = true; setPaused(true); }
		feedback.update(pads.find(function (candidate) { return candidate?.index === pad.index; }) ?? undefined, playing() && profile.settings.vibration && inputMode === 'gamepad');
		if (pad.claimed) { controllerLost = false; audio.cue('confirm'); }
		if (pad.activity && focused && !document.hidden) {
			if (profile.settings.controlMode === 'simulation' && pad.claimed) aimMode = 'gamepad';
			setInputMode('gamepad');
		}
		container.dataset['controllerState'] = pad.connected ? 'connected' : controllerLost ? 'disconnected' : pad.available ? 'available' : 'none';
		const controllerStatus = pad.connected ? 'CONTROLLER CONNECTED' : controllerLost ? 'CONTROLLER LOST · PRESS A / MENU TO RECONNECT, THEN RESUME' : pad.available ? 'PRESS A / MENU TO CONNECT CONTROLLER' : 'CONTROLLER OPTIONAL · CONNECT AND PRESS A / MENU';
		if (element('controller-status').textContent !== controllerStatus) element('controller-status').textContent = controllerStatus;
		if (pad.pause && focused && !document.hidden && !contextLost) { audio.cue('back'); if (auxiliary) closeAuxiliary(); else setPaused(screen === 'playing'); }
		const root = menu();
		if (root && pad.connected && screenRevision === revisionAtFrame && focused && !document.hidden && !contextLost) {
			if (pad.navigate) {
				const focusedElement = document.activeElement;
				if (pad.adjust && focusedElement instanceof HTMLSelectElement) { focusedElement.selectedIndex = (focusedElement.selectedIndex + pad.adjust + focusedElement.options.length) % focusedElement.options.length; focusedElement.dispatchEvent(new Event('change', { bubbles: true }));
				} else if (pad.adjust && focusedElement instanceof HTMLInputElement && focusedElement.type === 'range') {
					focusedElement.value = String(Math.max(Number(focusedElement.min), Math.min(Number(focusedElement.max), Number(focusedElement.value) + pad.adjust * 5)));
					focusedElement.dispatchEvent(new Event('input', { bubbles: true }));
				} else {
					const items = focusable(root); const index = items.findIndex(function (item) { return item === focusedElement; });
					const next = index < 0 ? (pad.navigate < 0 ? items.length - 1 : 0) : (index + pad.navigate + items.length) % items.length;
					items[next]?.focus({ preventScroll: true });
				}
				audio.cue('focus');
			}
			if (pad.confirm && document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.click();
			if (pad.back && screenRevision === revisionAtFrame) { audio.cue('back'); back(); }
		}
		if (playing() && screenRevision === revisionAtFrame) {
			if (profile.settings.controlMode === 'simulation' && pad.aimX !== 0) {
				aimMode = 'gamepad';
			} else if (profile.settings.controlMode === 'arcade' && Math.hypot(pad.aimX, pad.aimY) > 0.2) {
				aimMode = 'gamepad';
				const origin = presentation.toScreen(state.player); const length = Math.hypot(pad.aimX, pad.aimY);
				const projected = presentation.toGround({ x: origin.x + pad.aimX / length * 380, y: origin.y + pad.aimY / length * 380 });
				if (projected) aim = projected;
				const facility = state.mission?.structure;
				const aimTargets = [...state.enemies, ...(facility && facility.hp > 0 ? [facility] : [])];
				const targets = aimTargets.map(function (enemy) { const at = presentation.toScreen(enemy); const dx = at.x - origin.x; const dy = at.y - origin.y; return { enemy, alignment: (dx * pad.aimX + dy * pad.aimY) / Math.max(1, Math.hypot(dx, dy) * length) }; }).filter(function (target) { return target.alignment > 0.975 && distance(target.enemy, state.player) < 850; }).sort(function (a, b) { return b.alignment - a.alignment; });
				const target = targets[0]; if (target) aim = { x: target.enemy.x, y: target.enemy.y };
			} else if (pointer && aimMode === 'pointer') {
				aim = presentation.toGround(pointer) ?? aim;
				const cursor = pointer;
				const facility = state.mission?.structure;
				const picked = [...state.enemies, ...(facility && facility.hp > 0 ? [facility] : [])].sort(function (a, b) { return distance(presentation.toScreen(a, 45), cursor) - distance(presentation.toScreen(b, 45), cursor); })[0];
				if (picked && distance(presentation.toScreen(picked, 45), cursor) < 42 * viewScale(width, height)) aim = { x: picked.x, y: picked.y };
			}
			if (profile.settings.controlMode === 'simulation' && aimMode === 'gamepad') aim = { x: state.player.x + Math.cos(state.player.turret) * 600, y: state.player.y + Math.sin(state.player.turret) * 600 };
			const makeInput = function (): Controls {
				const arcade = profile.settings.controlMode === 'arcade' && inputMode !== 'touch';
				const x = Math.max(-1, Math.min(1, Number(active('right')) - Number(active('left')) + pad.turn));
				const y = Math.max(-1, Math.min(1, Number(active('back')) - Number(active('forward')) - pad.drive));
				const length = Math.hypot(x, y);
				const origin = presentation.toScreen(state.player);
				const destination = arcade && length > 0 ? presentation.toGround({ x: origin.x + x / length * 380, y: origin.y + y / length * 380 }) : undefined;
				return {
					...(arcade ? { throttleTarget: Math.min(1, length), ...(destination ? { heading: Math.atan2(destination.y - state.player.y, destination.x - state.player.x) } : {}) } : {}),
					...(profile.settings.controlMode === 'simulation' && aimMode === 'gamepad' ? { turretTurn: pad.aimX } : {}),
					drive: -y, stop: active('stop') || pad.stop, turn: x, aim,
					fire: [active('mount-0') || pad.fire[0], active('mount-1') || pad.fire[1], active('mount-2') || pad.fire[2], active('mount-3') || pad.fire[3]], coolant: active('coolant') || pad.coolant,
				};
			};
			accumulator += elapsed;
			while (accumulator >= 1 / 60 && playing()) {
				const previousGaits = gaits;
				const previousStage = training?.stage;
				const previousFrame = state.frame;
				const previousMissionStage = state.mission?.stage;
				if (training) stepTraining(training, makeInput(), 1 / 60); else step(state, makeInput(), 1 / 60);
				gaits = state.frame !== previousFrame || training?.stage === 'evade' && previousStage !== 'evade' ? createGaits(state) : advanceGaits(gaits, state);
				pending.clear(); accumulator -= 1 / 60;
				if (training && previousStage !== training.stage) audio.cue('confirm');
				audio.update(audioFrame(now)); audio.play(state.events);
				feedback.play(state.events, now);
				for (const index of [0, 1] as const) if (previousGaits.player.feet[index].lift > 0 && gaits.player.feet[index].lift === 0) audio.footstep(index === 0 ? -1 : 1);
				if (state.mission?.stage === 'extract' && previousMissionStage !== 'extract') { message = 'OBJECTIVE COMPLETE · REACH EXTRACTION AND HOLD FOR 3 SECONDS'; messageUntil = state.time + 7; }
				if (state.events.includes('coolant')) { message = 'COOLANT PURGE / REACTOR STABILIZING'; messageUntil = state.time + 2; }
				if (training?.stage === 'complete') { screen = 'training-result'; syncScreen(); }
				else if (!training && state.outcome !== 'playing') showResult(now);
				else checkpoint();
			}
		}
		audio.update(audioFrame(now));
		if (screen === 'title' && !auxiliary && focused && !document.hidden) titleScene?.render(now);
		if (!contextLost && (screen === 'playing' || screen === 'pause-panel' || screen === 'result' || screen === 'training-result')) presentation.render(state, aim, gaits, false, hudObstructions, inputMode === 'gamepad' || profile.settings.couchUI);
		if (now - lastHud > 80 || lastHud === 0) { updateHud(); lastHud = now; }
		frame = requestAnimationFrame(tick);
	};
	updateSettings(); updateDifficulty(); refreshBridge(); persistCampaign(); syncScreen(); frame = requestAnimationFrame(tick);
	return async function () { checkpoint(); cancelAnimationFrame(frame); abort.abort(); resetInput(); padInput.reset(); titleScene?.dispose(); await feedback.dispose(); try { await audio.dispose(); } finally { await presentation.dispose(); } };
});
if (import.meta.hot) import.meta.hot.dispose(shutdown);
