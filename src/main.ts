import ECSpresso from 'ecspresso';
import { html, render } from 'lit-html';
import { createHangarPreview } from './hangar-preview';
import { detectControllerFamily, controllerButtonLabel, renderControllerButton, renderGlyph, type ControllerFamily, type PromptDevice } from './input-prompts';
import { refreshNavigationGlyphs, menuActionLabel } from './menu-prompts';
import { transform3DSystems } from 'ecspresso/plugins/spatial/transform3D';
import { createCombatRuntime } from './combat-runtime';
import { createRuntimeNavigation, type RuntimeAuxiliary } from './runtime-navigation';
import { createRuntimeInput } from './runtime-input';
import { ACTIONS, LABELS, defaultKeyboard, defaultController, keyLabel, validKey, type Action } from './bindings';
import { getWeapon, WEAPON_FAMILY_LABELS } from './arsenal';
import { canEquipWeapon, getHardpoints } from './hardpoints';
import { getFrame } from './frames';
import { MOUNTS, rankLabel } from './loadout-ui';
import { mountGame } from './shared/lifecycle';
import { createMissionState, createState, distance, getOperationReport, type Controls, type Point } from './simulation';
import { createPresentation } from './presentation';
import { advanceGaits, createGaits } from './gait';
import { viewScale } from './projection-3d';
import { targetElevation, type ScreenRect } from './overlay';
import { createAudio } from './audio';
import { createGamepadInput, type PadInput } from './gamepad';
import { createControllerFeedback } from './controller-feedback';
import { createTraining, trainingCopy, type Training } from './training';
import { isDifficulty, readProfile, saveProfile } from './profile';
import { abandonContract, acceptContract, createCampaign, CAMPAIGN_STORAGE_KEY, getFaction, getPlanet, readCampaign, saveCampaign, settleContract, travelTo } from './campaign';
import { MISSION_NAMES, renderBridge, renderStarmap, type BridgeActions } from './campaign-ui';
import type { PlanetId } from './campaign-types';
import { missionObjective } from './missions';
import { FRAME_PRICES, WEAPON_PRICES, refitDays, repairDays, advanceDays, applyRigCheat, beginDeployment, buyFrame, buyWeapon, cancelWorkOrder, checkpointDeployment, getOwnedMech, queueRefit, queueRepair, selectFrame } from './company';
import { adjacentShipScreen, isShipScreen, renderCompany, type CompanyEditor, type ShipScreen } from './company-ui';
import type { Campaign } from './campaign';
import { createTitleScene } from './title-scene';
import { mountWorkspaceLayout, revealWorkspaceElement, selectWorkspacePane, focusWorkspace, rememberWorkspaceFocus, moveWorkspaceFocus, cycleWorkspaceView } from './workspace';
import { mountDialogLayout } from './dialog-layout';
import { createEscape, escapeMessage, INTRO_FRAMES, INTRO_LINES, narrativeFrame, SADDLE_LINES, type IntroFrame } from './intro';

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
const shutdown = await mountGame('game', async function (container, onCleanup) {
	const canvas = container.querySelector('canvas');
	if (!canvas) throw new Error('Missing battlefield');
	canvas.tabIndex = 0;
	const presentation = createPresentation(canvas);
	onCleanup(presentation.dispose);
	const combatRuntime = createCombatRuntime();
	const navigation = createRuntimeNavigation();
	const runtimeInput = createRuntimeInput();
	const world = ECSpresso.create()
		.withPlugin(combatRuntime.plugin)
		.withPlugin(runtimeInput.plugin)
		.withPlugin(presentation.plugin)
		.withPlugin(navigation.plugin)
		.withScreens(navigation.screens)
		.withFixedTimestep(1 / 60)
		.build();
	onCleanup(function () { return world.dispose(); });
	presentation.bind(combatRuntime);
	await world.initialize(); await navigation.initialize();
	const titleCanvas = element('title-scene');
	if (!(titleCanvas instanceof HTMLCanvasElement)) throw new Error('Missing title scene');
	let titleScene: ReturnType<typeof createTitleScene> | undefined;
	onCleanup(function () { titleScene?.dispose(); });
	const showTitleScene = function () {
		if (titleScene) return;
		try { titleScene = createTitleScene(titleCanvas); }
		catch (error: unknown) { console.warn('Title scene unavailable', error); }
	};
	const audio = createAudio();
	onCleanup(audio.dispose);
	const padInput = createGamepadInput();
	onCleanup(padInput.reset);
	const feedback = createControllerFeedback();
	onCleanup(feedback.dispose);
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
	onCleanup(function () { abort.abort(); });
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
	const cockpitElements = [...container.querySelectorAll<HTMLElement>('.left-instruments, .weapon-console, #touch, #training-guide, #escape-guide')];
	let hudObstructions: ScreenRect[] = [];
	const weaponButtons = MOUNTS.map(function (binding) {
		const button = document.createElement('button'); button.className = 'weapon'; button.dataset['control'] = binding.action;
		button.innerHTML = '<span class="weapon-mount"></span><span class="weapon-icon" aria-hidden="true"></span><b></b><small><kbd></kbd></small><em></em><i></i>';
		return button;
	});
	element('weapon-bank').replaceChildren(...weaponButtons);
	let training: Training | undefined;
	let escape = false;
	let introFrame: IntroFrame = 'kestrel';
	let narrativePart: 'before' | 'after' = 'before';
	let narrativeElapsed = 0;
	let narrativeWaiting = false;
	let trainingOrigin: 'title' | 'bridge' = 'bridge';
	let editor: CompanyEditor = { loadout: [...(getOwnedMech(campaign)?.loadout ?? [])], slot: null, notice: '' };
	const mouseButtons = new Set<number>();
	const consumedMouseButtons = new Set<number>();
	let state = combatRuntime.attach(createState({ difficulty: profile.settings.difficulty })); let gaits = createGaits(state); let muted = false;
	let aim: Point = { x: 900, y: 450 }; let pointer: Point | undefined; let aimMode: 'pointer' | 'gamepad' = 'pointer';
	let frame = 0; let previous = 0; let lastHud = 0;
	onCleanup(function () { cancelAnimationFrame(frame); });
	let message = ''; let messageUntil = 0; let terminalUntil = 0; let contextLost = false; let focused = true;
	let returnFocus: HTMLElement | undefined; let confirmedAction: (() => void) | undefined; let tipDismissed = false;
	let inputMode: 'keyboard' | 'gamepad' | 'touch' = coarsePointer.matches ? 'touch' : 'keyboard'; let controllerLost = false; let screenRevision = 0;
	let currentPad: PadInput | undefined;
	let controllerFamily: ControllerFamily = 'generic';
	let lastMenuTarget: HTMLElement | undefined;
	let hangar: { canvas: HTMLCanvasElement; view: ReturnType<typeof createHangarPreview> } | undefined;
	onCleanup(function () { hangar?.view.dispose(); });
	const rigPreviews = new Map<IntroFrame, ReturnType<typeof createHangarPreview>>();
	const clearRigPreviews = function () { for (const view of rigPreviews.values()) view.dispose(); rigPreviews.clear(); };
	onCleanup(clearRigPreviews);
	const promptDevice = function (): PromptDevice { return inputMode === 'gamepad' ? controllerFamily : inputMode; };
	const hasRefitDraft = function () { const mech = getOwnedMech(campaign); return Boolean(mech && editor.loadout.some(function (weapon, index) { return weapon !== mech.loadout[index]; })); };
	const companyOpen = function () { return isShipScreen(navigation.screen) && !navigation.auxiliary; };
	const companyNavigationReady = function () { return companyOpen() && !navigation.transitioning && editor.slot === null && !campaignConflict && !contextLost; };
	let lastSoundState = '';
	const resetInput = function () { keys.clear(); pending.clear(); held.clear(); mouseButtons.clear(); runtimeInput.clear(); combatRuntime.setEnabled(false); padInput.requireNeutral(); void feedback.stop(); };
	const playing = function () { return !navigation.transitioning && navigation.screen === 'playing' && !navigation.auxiliary && !campaignConflict && !contextLost && !document.hidden && focused; };
	const keyboardAction = function (code: string) { return ACTIONS.find(function (action) { return profile.settings.keyboard[action].includes(code); }); };
	const active = function (action: string) { return [...mouseButtons].some(function (button) { return keyboardAction(`Mouse${button}`) === action; }) || [...keys].some(function (code) { return keyboardAction(code) === action; }) || pending.has(action) || [...held.values()].includes(action); };
	const silenceAudio = function () { audio.update({ speed: 0, laser: false, heat: 0, active: false }); };
	const unlockSound = function () { void audio.unlock(); };
	const updateMenuHint = function () {
		const device = promptDevice();
		refreshNavigationGlyphs(container, device);
		for (const node of container.querySelectorAll<HTMLElement>('[data-controller-bindings]')) {
			const names = node.dataset['controllerBindings']?.split(' ') ?? [];
			const bindings = names.flatMap(function (name) {
				switch (name) { case 'stop': case 'coolant': case 'mount-0': case 'mount-1': case 'mount-2': case 'mount-3': return [profile.settings.controller[name]]; default: return []; }
			});
			render(html`${bindings.map(function (index) { return renderControllerButton(controllerFamily, index); })}`, node);
		}
		for (const node of container.querySelectorAll<HTMLElement>('[data-controller-button]')) render(renderControllerButton(controllerFamily, Number(node.dataset['controllerButton'])), node);
		const root = menu();
		const focusedElement = document.activeElement;
		if (root && focusedElement instanceof HTMLElement && root.contains(focusedElement) && focusedElement.matches('button, input, select, a')) lastMenuTarget = focusedElement;
		const target = root && lastMenuTarget?.isConnected && root.contains(lastMenuTarget) && !lastMenuTarget.closest('[hidden], [inert]') && !lastMenuTarget.matches(':disabled') ? lastMenuTarget : undefined;
		const onCompany = companyOpen();
		const label = menuActionLabel(target);
		render(html`
			${device !== 'touch' ? html`<span class="menu-key">${renderGlyph(device, 'move')}<span class="key-label">Move</span></span>` : ''}
			${target ? html`<button class="menu-key" @click=${function () { target.click(); }}>${renderGlyph(device, 'confirm')}<span class="key-label">${label}</span></button>` : ''}
			${navigation.screen !== 'title' || navigation.auxiliary ? html`<button class="menu-key" @click=${back}>${renderGlyph(device, 'back')}<span class="key-label">${onCompany && editor.slot === null ? 'Title' : 'Back'}</span></button>` : ''}
			${onCompany && editor.slot === null ? html`<button class="menu-key" @click=${function () { showAuxiliary('handbook'); }}>${renderGlyph(device, 'help')}<span class="key-label">Button guide</span></button>` : ''}
			${onCompany && editor.slot === null && hasRefitDraft() ? html`<button class="menu-key" @click=${discardDraft}>${renderGlyph(device, 'discard')}<span class="key-label">Discard draft</span></button>` : ''}
		`, element('menu-input-hint'));
	};
	const setInputMode = function (value: typeof inputMode) {
		if (inputMode === value && container.dataset['input'] === value && container.dataset['promptDevice'] === promptDevice() && container.classList.contains('couch-ui') === (value === 'gamepad' || profile.settings.couchUI)) return;
		inputMode = value; container.dataset['input'] = value; container.dataset['promptDevice'] = promptDevice();
		container.classList.toggle('using-gamepad', value === 'gamepad');
		container.classList.toggle('couch-ui', value === 'gamepad' || profile.settings.couchUI);
		ui.inputMode.textContent = value === 'gamepad' ? 'GAMEPAD' : value === 'touch' ? 'TOUCH' : 'KB / MOUSE';
		const pausePrompt = element('pause').querySelector('kbd');
		if (pausePrompt) render(renderGlyph(promptDevice(), inputMode === 'keyboard' ? 'back' : 'settings'), pausePrompt);
		element('weapon-hint').textContent = value === 'gamepad' ? 'HOLD TRIGGERS + BUMPERS' : value === 'touch' ? 'HOLD TOGETHER TO COMBINE' : 'HOLD MOUSE BUTTONS / 1–4';
		for (const select of container.querySelectorAll<HTMLSelectElement>('#controller-mappings select')) for (const option of select.options) option.textContent = controllerButtonLabel(controllerFamily, Number(option.value));
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
	const menu = function () { return navigation.auxiliary ? element(navigation.auxiliary) : navigation.screen === 'playing' ? undefined : element(navigation.screen); };
	const focusable = function (root: HTMLElement) {
		return [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(function (item) { return !item.closest('[hidden], [inert]') && item.getClientRects().length > 0; });
	};
	const syncScreen = function (focus = true) {
		screenRevision++;
		element('reset').hidden = !training && !escape;
		element('reset').textContent = escape ? 'RESTART ESCAPE' : 'RESTART TRAINING';
		element('leave').textContent = escape ? 'RETURN TO TITLE' : state.mission && !training ? 'ABORT CONTRACT & RETURN TO SHIP' : trainingOrigin === 'title' && training ? 'RETURN TO TITLE' : 'RETURN TO SHIP';
		element('training-deploy').textContent = campaign.active ? 'REVIEW CONTRACT LOADOUT →' : 'RETURN TO SHIP →';
		element('training-briefing').textContent = trainingOrigin === 'title' ? 'RETURN TO TITLE' : 'RETURN TO SHIP';
		element('pause-copy').textContent = escape ? 'The escape is paused. Resume when ready. This borrowed rig does not affect your company.' : training ? 'Training is paused. The simulator does not affect your company.' : 'Your throttle and mission are preserved. Aborting or reloading returns the mech with its current damage.';
		for (const id of ['title', 'intro', 'rig-bay', 'escape-result', 'bridge', 'starmap', 'mechbay', 'market', 'engineering', 'jump', 'pause-panel', 'result', 'training-result', 'settings', 'handbook', 'confirm', 'save-conflict']) {
			const node = element(id); const visible = navigation.auxiliary ? id === navigation.auxiliary : id === navigation.screen;
			node.hidden = !visible; node.inert = !visible;
		}
		if (navigation.screen !== 'rig-bay') clearRigPreviews();
		const modal = navigation.screen !== 'playing' || Boolean(navigation.auxiliary);
		container.classList.toggle('training-active', Boolean(training));
		container.classList.toggle('menu-open', modal); container.dataset['screen'] = navigation.auxiliary ?? navigation.screen;
		updateMenuHint();
		element('title-save-status').textContent = `${campaignSaved ? 'LOCAL COMPANY' : 'SESSION ONLY · STORAGE UNAVAILABLE'} / DAY ${String(campaign.day).padStart(2, '0')} / ${getPlanet(campaign.planetId).name.toUpperCase()}`;
		if (navigation.screen === 'title') showTitleScene();
		element('hud').inert = modal; canvas.inert = modal;
		resetInput(); lastHud = 0;
		updateWorkspaceLayout(); updateDialogLayout();
		if (!focus) return;
		const root = menu();
		const initial = navigation.auxiliary === 'save-conflict' ? element('reload-company') : navigation.auxiliary === 'settings' ? element('master-volume') : navigation.auxiliary === 'handbook' ? element('handbook') : navigation.auxiliary === 'confirm' ? element('confirm-cancel') : navigation.screen === 'intro' ? element(narrativeWaiting ? 'intro-begin' : 'intro') : navigation.screen === 'escape-result' ? element('escape-retry') : navigation.screen === 'bridge' ? element('bridge') : navigation.screen === 'pause-panel' ? element('resume') : navigation.screen === 'result' ? element('restart') : root?.querySelector<HTMLElement>('[aria-current="page"]') ?? root?.querySelector<HTMLElement>('button');
		if (root?.classList.contains('workspace')) focusWorkspace(root);
		else (initial ?? canvas).focus({ preventScroll: true });
		updateMenuHint(); updateDialogLayout();
	};
	let stopped = false;
	const transition = function (operation: Promise<void>, after: () => void = syncScreen) {
		screenRevision++; resetInput();
		void operation.then(function () { if (!stopped) after(); }).catch(function (error: unknown) {
			console.error(error); const node = element('error'); node.textContent = 'Could not change screen. Reload to recover.'; node.hidden = false;
		});
	};
	const updateDifficulty = function () {
		for (const input of container.querySelectorAll<HTMLInputElement>('input[data-difficulty]')) input.checked = input.value === profile.settings.difficulty;
	};
	const start = function () {
		if (contextLost || navigation.auxiliary || navigation.screen !== 'mechbay') return;
		const next = beginDeployment(campaign);
		if (next === campaign || !next.active || !next.deployed) return;
		const mech = getOwnedMech(next);
		if (!mech) return;
		if (!replaceCampaign(next)) return;
		presentation.resetZoom(); training = undefined;
		state = combatRuntime.attach(createMissionState(next.active, { difficulty: profile.settings.difficulty, frame: mech.frameId, loadout: mech.loadout, integrity: mech.integrity, coolantCharges: next.deployed.coolantCharges }));
		gaits = createGaits(state); aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer';
		aim = state.mission ? { ...state.mission.map.objective } : { ...state.player };
		pointer = undefined; message = `${getFrame(mech.frameId).name} ON SURFACE · ${MISSION_NAMES[next.active.kind].toUpperCase()}`; messageUntil = 5; tipDismissed = false;
		terminalUntil = 0; audio.reset(); transition(navigation.setScreen('playing')); unlockSound();
	};
	const startTraining = function () {
		if (contextLost) return;
		escape = false;
		if (!training) trainingOrigin = navigation.screen === 'title' ? 'title' : 'bridge';
		presentation.resetZoom();
		training = createTraining(); state = combatRuntime.attach(training.state, training); gaits = createGaits(state);
		aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; pointer = undefined; aim = { x: 900, y: 450 };
		message = ''; messageUntil = 0; tipDismissed = true; terminalUntil = 0;
		audio.reset(); transition(navigation.setScreen('playing', true)); unlockSound();
	};
	const startIntro = function () {
		training = undefined; escape = false; narrativePart = 'before'; narrativeElapsed = 0;
		narrativeWaiting = audio.status() === 'locked' || audio.status() === 'unavailable';
		element('intro-begin').hidden = !narrativeWaiting; element('intro-line').hidden = narrativeWaiting;
		element('intro-line').textContent = ''; element('intro-line').style.opacity = '1';
		audio.reset(); transition(navigation.setScreen('intro'));
	};
	const startEscape = function () {
		if (contextLost) return;
		// Attach after leaving the narrative system's screen scope. Otherwise ECS
		// would assign the borrowed rig to 'intro' and remove it on screen exit.
		transition(navigation.setScreen('playing'), function () {
			training = undefined; escape = true;
			presentation.resetZoom(); state = combatRuntime.attach(createEscape(introFrame)); gaits = createGaits(state);
			aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; pointer = undefined;
			aim = state.mission ? { ...state.mission.map.extraction } : { ...state.player };
			message = ''; messageUntil = 0; tipDismissed = true; terminalUntil = 0;
			audio.reset(); syncScreen(); unlockSound();
		});
	};
	const setPaused = function (paused: boolean) {
		if (campaignConflict) return;
		if (paused) silenceAudio();
		if (paused && navigation.screen === 'playing') transition(navigation.pause());
		else if (!paused && navigation.screen === 'pause-panel' && !contextLost) { aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; transition(navigation.resume()); unlockSound(); }
	};
	const showAuxiliary = function (value: RuntimeAuxiliary) {
		if (document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
		transition(navigation.showAuxiliary(value));
	};
	const closeAuxiliary = function () {
		if (campaignConflict) return;
		capture = undefined; renderMappings();
		confirmedAction = undefined;
		transition(navigation.closeAuxiliary(), function () {
			syncScreen(false);
			if (returnFocus?.isConnected) updateDialogLayout(returnFocus);
			if (returnFocus?.isConnected && !returnFocus.closest('[hidden], [inert]')) returnFocus.focus({ preventScroll: true });
			else syncScreen();
		});
	};
	const confirm = function (action: () => void, label: string, copy = 'The current operation will be lost. Your recorded results and settings will be kept.', title = 'ABANDON THIS RUN?') {
		element('confirm-cancel').textContent = isShipScreen(navigation.screen) ? 'KEEP BROWSING' : 'CANCEL';
		confirmedAction = action; element('confirm-action').textContent = label; element('confirm-copy').textContent = copy; element('confirm-title').textContent = title; showAuxiliary('confirm');
	};
	const stopForConflict = function () {
		campaignConflict = true; silenceAudio(); padInput.suspend(); transition(navigation.showAuxiliary('save-conflict'));
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
		if (training || escape || !state.mission || !campaign.deployed) return;
		const next = checkpointDeployment(campaign, state.player.hp, state.coolantCharges);
		if (next !== campaign) { if (!replaceCampaign(next)) return; }
	};
	const resetEditor = function (notice = '') {
		editor = { loadout: [...(getOwnedMech(campaign)?.loadout ?? [])], slot: null, notice };
	};
	const replaceCampaign = function (next: Campaign): boolean {
		const current = getOwnedMech(campaign); const upcoming = getOwnedMech(next);
		const installedChanged = current?.frameId !== upcoming?.frameId || current?.loadout.some(function (weapon, index) { return weapon !== upcoming?.loadout[index]; });
		campaign = next;
		if (installedChanged) resetEditor();
		return persistCampaign();
	};
	const updateCompany = function (next: Campaign, notice: string, nextScreen?: ShipScreen, clearDraft = false) {
		if (next === campaign || !replaceCampaign(next)) return;
		if (clearDraft) resetEditor(notice);
		else editor = { ...editor, notice };
		if (nextScreen && nextScreen !== 'bridge') { transition(navigation.setScreen(nextScreen), function () { refreshCompany(); syncScreen(); }); }
		else refreshCompany();
	};
	const discardDraft = function () {
		if (!hasRefitDraft()) return;
		confirm(function () { resetEditor('Staged changes discarded.'); if (navigation.screen === 'bridge' || navigation.screen === 'starmap') refreshCampaign(); else refreshCompany(); }, 'DISCARD DRAFT', 'Installed equipment stays unchanged. No work order is queued and no calendar time passes.', 'DISCARD REFIT DRAFT?');
	};
	const focusCompany = function (selector: string, fallback?: string) {
		const target = element('mechbay').querySelector<HTMLElement>(selector) ?? (fallback ? element('mechbay').querySelector<HTMLElement>(fallback) : null);
		if (target) { revealWorkspaceElement(target); target.focus({ preventScroll: true }); }
	};
	const refreshCompany = function () {
		if (navigation.screen !== 'mechbay' && navigation.screen !== 'market' && navigation.screen !== 'engineering') return;
		const root = element(navigation.screen); const previousFocus = document.activeElement;
		const focusIndex = focusable(root).findIndex(function (item) { return item === previousFocus; });
		renderCompany(root, campaign, navigation.screen, editor, campaignSaved, {
			navigate: navigateShip,
			selectFrame: function (id) { const select = function () { updateCompany(selectFrame(campaign, id), 'Frame selected.'); }; if (hasRefitDraft() && id !== campaign.selectedFrame) confirm(select, 'DISCARD & SELECT FRAME', 'Changing frames discards this unqueued refit. Installed equipment is unchanged.', 'DISCARD REFIT DRAFT?'); else select(); },
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
			discardRefit: discardDraft,
			queueRefit: function () { const days = refitDays(getOwnedMech(campaign)?.loadout ?? [], editor.loadout); confirm(function () { updateCompany(queueRefit(campaign, campaign.selectedFrame, editor.loadout), 'Refit queued. Advance the calendar to finish installation.', 'engineering', true); }, 'QUEUE REFIT', `${days} calendar days. Ready day ${campaign.day + days}. The frame cannot deploy until work finishes.`, 'QUEUE THIS REFIT?'); },
			buyFrame: function (id) { confirm(function () { updateCompany(buyFrame(campaign, id), `${getFrame(id).name} purchased with its standard weapon. Select it in the Mech Bay.`); }, 'BUY FRAME', `${FRAME_PRICES[id].toLocaleString()} CR. Includes its signature weapon; arrives immediately.`, `BUY ${getFrame(id).name}?`); },
			buyWeapon: function (id) { confirm(function () { updateCompany(buyWeapon(campaign, id), `${getWeapon(id).name} purchased. Fit it in the Mech Bay.`); }, 'BUY WEAPON', `${WEAPON_PRICES[id].toLocaleString()} CR. Delivered to stores. Installation requires a separate refit.`, `BUY ${getWeapon(id).name}?`); },
			repair: function (id) { const days = repairDays(getOwnedMech(campaign, id)?.integrity ?? 100); confirm(function () { updateCompany(queueRepair(campaign, id), 'Repair queued. The mech remains unavailable until its completion day.', 'engineering'); }, 'SCHEDULE REPAIR', `${days} calendar days · 0 CR. Ready day ${campaign.day + days}. The frame cannot deploy during repairs.`, `REPAIR ${getFrame(id).name}?`); },
			cancelWork: function (id) { confirm(function () { updateCompany(cancelWorkOrder(campaign, id), 'Work order cancelled. Original equipment and condition retained.'); }, 'CANCEL WORK ORDER', 'Installed weapons and current integrity are retained. Reserved equipment returns to stores; elapsed calendar time remains spent.', `CANCEL ${getFrame(id).name} WORK?`); },
			advanceDays: function (days) { confirm(function () { updateCompany(advanceDays(campaign, days), `${days} calendar ${days === 1 ? 'day' : 'days'} elapsed. Due work orders are complete.`); }, `ADVANCE ${days} ${days === 1 ? 'DAY' : 'DAYS'}`, `Move from day ${campaign.day} to day ${campaign.day + days}. All work orders progress. No credit fee; contract postings remain unchanged.`, 'ADVANCE SHIP CALENDAR?'); },
			deploy: function () {
				const mech = getOwnedMech(campaign);
				if (mech && editor.loadout.some(function (weapon, index) { return weapon !== mech.loadout[index]; })) {
					editor = { ...editor, notice: 'Queue or discard your staged loadout before deployment.' }; refreshCompany(); return;
				}
				confirm(start, 'DEPLOY FRAME', `${getFrame(campaign.selectedFrame).name} deploys with installed weapons and ${Math.ceil(mech?.integrity ?? 0)}% integrity. Damage persists between sorties.`, 'DEPLOY ON THIS CONTRACT?');
			},
			settings: function () { showAuxiliary('settings'); },
			handbook: function () { showAuxiliary('handbook'); },
		});
		if (focusIndex >= 0 && (!(previousFocus instanceof HTMLElement) || !previousFocus.isConnected || previousFocus.matches(':disabled'))) {
			const items = focusable(root); items[Math.min(focusIndex, items.length - 1)]?.focus({ preventScroll: true });
		}
	};
	const refreshCampaign = function () {
		const actions: BridgeActions = {
			navigate: navigateShip,
			selectPlanet: function (id) { if (campaign.active) return; destination = id; selectedContract = undefined; refreshCampaign(); },
			selectContract: function (id) { selectedContract = id; refreshCampaign(); selectWorkspacePane(element('bridge'), 'briefing', true); const target = element('bridge').querySelector<HTMLElement>('[data-pane="briefing"] .pane-actions button:not(:disabled), [data-pane="briefing"] .paged-content'); target?.focus({ preventScroll: true }); },
			travel: function () {
				if (navigation.screen !== 'starmap' || navigation.auxiliary || contextLost) return;
				confirm(function () {
					const origin = getPlanet(campaign.planetId); const next = travelTo(campaign, destination); if (next === campaign) return;
					if (!replaceCampaign(next)) return;
					element('jump-destination').textContent = getPlanet(campaign.planetId).name.toUpperCase();
					element('jump-copy').textContent = `${origin.name} → ${getPlanet(campaign.planetId).name} · DAY ${campaign.day} · APPROACHING ORBIT`;
					jumpUntil = performance.now() + 2200; transition(navigation.setScreen('jump'), function () { syncScreen(); element('jump').focus({ preventScroll: true }); });
				}, 'CONFIRM JUMP', `One calendar day · 0 CR. Arrive at ${getPlanet(destination).name} on day ${campaign.day + 1}. Work orders progress and contract postings change.`, 'CONFIRM TRANSIT?');
			},
			accept: function (contract) {
				if (navigation.screen !== 'bridge' || navigation.auxiliary || destination !== campaign.planetId) return;
				confirm(function () {
					const next = acceptContract(campaign, contract.id); if (next === campaign) return;
					if (!replaceCampaign(next)) return; refreshCampaign(); syncScreen();
					selectWorkspacePane(element('bridge'), 'briefing'); element('bridge-deploy').focus({ preventScroll: true });
				}, 'ACCEPT CONTRACT', `${getFaction(contract.opponent).name}: −${contract.hostility} reputation immediately, including if you abort. Payment of ${contract.reward.toLocaleString()} CR requires successful extraction. Success strengthens the employer on this front; failure or abort strengthens the opposition.`, 'ACCEPT THIS CONTRACT?');
			},
			deploy: function () { navigateShip('mechbay'); },
			abandon: function () { confirm(function () { if (replaceCampaign(abandonContract(campaign))) toBridge(); }, 'ABORT & RETURN TO SHIP', 'No payment or employer favor will be earned. The opposition reputation penalty from acceptance remains, and the opposition gains local influence.', 'ABORT THIS CONTRACT?'); },
			training: startTraining,
			title: back,
			settings: function () { showAuxiliary('settings'); },
			handbook: function () { showAuxiliary('handbook'); },
		};
		renderBridge(element('bridge'), campaign, destination, selectedContract, campaignSaved, actions);
		renderStarmap(element('starmap'), campaign, destination, campaignSaved, actions);
	};
	const navigateShip = function (target: ShipScreen, view?: 'board' | 'route' | 'system') {
		if (campaignConflict || navigation.auxiliary || navigation.transitioning || editor.slot !== null) return;
		if (isShipScreen(navigation.screen)) rememberWorkspaceFocus(element(navigation.screen));
		training = undefined; escape = false; state = combatRuntime.attach(createState({ difficulty: profile.settings.difficulty })); gaits = createGaits(state);
		editor = { ...editor, slot: null };
		pointer = undefined; presentation.resetZoom(); audio.reset();
		transition(navigation.setScreen(target), function () {
			if (target === 'bridge' || target === 'starmap') refreshCampaign();
			else refreshCompany();
			syncScreen();
			if (view) selectWorkspacePane(element(target), view);
		});
	};
	const toBridge = function () { navigateShip('bridge', 'board'); };
	const toTitle = function () {
		element('title-company-label').textContent = campaign.introComplete ? 'CONTINUE COMPANY' : 'CONTINUE ESCAPE';
		training = undefined; escape = false; state = combatRuntime.attach(createState({ difficulty: profile.settings.difficulty })); gaits = createGaits(state); audio.reset(); transition(navigation.setScreen('title'));
	};
	const back = function () {
		if (navigation.transitioning) return;
		if (navigation.auxiliary) { closeAuxiliary(); return; }
		if (navigation.screen === 'intro' || navigation.screen === 'rig-bay' || navigation.screen === 'escape-result') { confirm(toTitle, 'RETURN TO TITLE', 'The escape will restart from the beginning when you return. Company progress is untouched.', 'LEAVE THE ESCAPE?'); return; }
		if (navigation.screen === 'mechbay' && editor.slot !== null) { const slot = editor.slot; editor = { ...editor, slot: null }; refreshCompany(); focusCompany(`[data-loadout-slot="${slot}"]`); return; }
		if (navigation.screen === 'training-result' && trainingOrigin === 'title') { toTitle(); return; }
		if (isShipScreen(navigation.screen)) { confirm(toTitle, 'RETURN TO TITLE', hasRefitDraft() ? 'Company progress is saved. Your unqueued refit draft is kept while this session remains open.' : 'Company progress is saved on this device.', 'RETURN TO TITLE?'); return; }
		if (navigation.screen === 'training-result') { toBridge(); return; }
		setPaused(navigation.screen === 'playing');
	};
	const listen = function (id: string, callback: () => void) { element(id).addEventListener('click', function () { if (!navigation.transitioning) callback(); }, listenerOptions); };
	listen('title-continue', function () { if (campaign.introComplete) toBridge(); else startIntro(); });
	listen('title-new-campaign', function () {
		confirm(function () {
			if (!replaceCampaign(createCampaign())) return;
			destination = campaign.planetId; selectedContract = undefined;
			resetEditor();
			element('title-company-label').textContent = 'CONTINUE COMPANY';
			startIntro();
		}, 'START NEW CAMPAIGN', 'This replaces your current company on this device, including its contracts, fleet, credits, reputation, and progress. This cannot be undone. Your settings are kept.', 'START A NEW CAMPAIGN?');
	});
	listen('title-training', startTraining);
	listen('title-intro', startIntro);
	listen('intro-begin', function () {
		unlockSound(); narrativeWaiting = false;
		element('intro-begin').hidden = true; element('intro-line').hidden = false;
		element('intro').focus({ preventScroll: true });
	});
	listen('escape-retry', startEscape);
	listen('escape-change-rig', function () { audio.reset(); transition(navigation.setScreen('rig-bay')); });
	for (const id of INTRO_FRAMES) listen(`intro-${id}`, function () {
		introFrame = id; narrativePart = 'after'; narrativeElapsed = 0;
		narrativeWaiting = false; element('intro-begin').hidden = true; element('intro-line').hidden = false;
		element('intro-line').textContent = ''; element('intro-line').style.opacity = '1';
		transition(navigation.setScreen('intro'));
	});
	listen('title-settings', function () { showAuxiliary('settings'); });
	listen('title-handbook', function () { showAuxiliary('handbook'); });
	const titleChoices = ['title-continue', 'title-new-campaign', 'title-training', 'title-intro', 'title-settings', 'title-handbook'];
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
	listen('reset', function () { if (escape) confirm(startEscape, 'RESTART ESCAPE'); else if (training) confirm(startTraining, 'RESTART TRAINING'); });
	listen('leave', function () {
		if (escape) confirm(toTitle, 'RETURN TO TITLE', 'The escape can be restarted from the title screen. Company progress is untouched.', 'LEAVE THE ESCAPE?');
		else if (state.mission && !training) confirm(function () { checkpoint(); if (replaceCampaign(abandonContract(campaign))) toBridge(); }, 'ABORT & RETURN TO SHIP', 'Current mech damage is retained. No payment or employer favor is earned; the opposition penalty remains and its local influence grows. Recovery takes one day.', 'ABORT THIS CONTRACT?');
		else confirm(trainingOrigin === 'title' ? toTitle : toBridge, trainingOrigin === 'title' ? 'RETURN TO TITLE' : 'RETURN TO SHIP', 'Leave the simulator? Company progress is untouched.', 'LEAVE TRAINING?');
	});
	listen('result-briefing', toBridge);
	listen('confirm-action', function () {
		const action = confirmedAction; confirmedAction = undefined;
		transition(navigation.closeAuxiliary(), function () { syncScreen(false); action?.(); if (!navigation.transitioning) { const root = menu(); if (root?.classList.contains('workspace')) focusWorkspace(root); updateMenuHint(); } });
	});
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
	element('keyboard-mappings').addEventListener('mousedown', function (event) { if (capture && navigation.auxiliary === 'settings' && !element('keyboard-mappings').closest('[hidden], [inert]')) { event.preventDefault(); event.stopPropagation(); consumedMouseButtons.add(event.button); assignKey(`Mouse${event.button}`); } }, listenerOptions);
	element('controller-mappings').replaceChildren();
	for (const action of ['stop', 'coolant', 'mount-0', 'mount-1', 'mount-2', 'mount-3'] as const) {
		const label = document.createElement('label'); label.textContent = `${LABELS[action]} `;
		const select = document.createElement('select'); select.dataset['mapping'] = action;
		for (let index = 1; index <= 17; index++) { if (index === 9) continue; const option = document.createElement('option'); option.value = String(index); option.textContent = controllerButtonLabel(controllerFamily, index); select.append(option); }
		select.value = String(profile.settings.controller[action]);
		select.addEventListener('change', function () { const previous = profile.settings.controller[action]; const next = Number(select.value); for (const other of ['stop', 'coolant', 'mount-0', 'mount-1', 'mount-2', 'mount-3'] as const) if (other !== action && profile.settings.controller[other] === next) profile.settings.controller[other] = previous; profile.settings.controller[action] = next; resetInput(); save(); syncControllerMappings(); }, listenerOptions);
		label.append(select); element('controller-mappings').append(label);
	}
	const syncControllerMappings = function () { for (const select of element('controller-mappings').querySelectorAll('select')) { const action = select.dataset['mapping']; if (action === 'stop' || action === 'coolant' || action === 'mount-0' || action === 'mount-1' || action === 'mount-2' || action === 'mount-3') select.value = String(profile.settings.controller[action]); } updateMenuHint(); };
	element('control-mode').addEventListener('change', function (event) {
		const select = event.target; if (!(select instanceof HTMLSelectElement) || (select.value !== 'simulation' && select.value !== 'arcade')) return;
		profile.settings.controlMode = select.value; capture = undefined; resetInput(); aimMode = inputMode === 'gamepad' ? 'gamepad' : 'pointer'; save(); renderMappings(); updateSettings();
	}, listenerOptions);
	listen('reset-keyboard', function () { capture = undefined; profile.settings.keyboard = defaultKeyboard(); resetInput(); save(); renderMappings(); });
	listen('reset-controller', function () { profile.settings.controller = defaultController(); resetInput(); save(); syncControllerMappings(); });
	renderMappings();
	for (const tab of element('settings').querySelectorAll('[data-dialog-tab]')) tab.addEventListener('click', function () { capture = undefined; renderMappings(); }, listenerOptions);
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
		if (training || escape || !state.mission) return;
		checkpoint();
		const report = getOperationReport(state); const won = state.outcome === 'won'; const contract = state.mission.contract;
		if (!replaceCampaign(settleContract(campaign, won))) return;
		terminalUntil = now + 1600;
		element('result-title').textContent = won ? 'CONTRACT COMPLETE.' : 'CONTRACT FAILED.';
		element('result-copy').textContent = won ? `${getPlanet(contract.planetId).name} extraction complete. ${getFaction(contract.employer).name} has confirmed the objective, released payment, and strengthened its influence around this system.` : `The sortie was lost. Your frame was recovered with ${report.armor}% integrity. No payment or employer favor was earned. ${getFaction(contract.opponent).name} gained local influence. Repair it in Engineering before its next deployment.`;
		element('result-difficulty').textContent = `${getFrame(state.frame).name} · ${state.difficulty.toUpperCase()}`;
		element('result-score').textContent = `${campaign.lastResult?.payout.toLocaleString() ?? '0'} CR`;
		element('result-rank').textContent = won ? '✓' : '×';
		const heading = element('result-score').previousElementSibling; if (heading) heading.textContent = 'CONTRACT PAYMENT';
		const stats = [[String(report.kills), 'ELIMINATED'], [formatTime(report.time), 'FIELD TIME'], [`${report.armor}%`, 'FRAME INTEGRITY'], [`+${campaign.lastResult?.favor ?? 0}`, 'EMPLOYER FAVOR']];
		element('result-stats').replaceChildren(...stats.map(function ([value, label]) { const node = document.createElement('div'); const strong = document.createElement('b'); const small = document.createElement('small'); strong.textContent = value ?? ''; small.textContent = label ?? ''; node.append(strong, small); return node; }));
		element('result-upgrades').textContent = `DAY ${campaign.day} · Equipment retained. Damage requires a repair work order. ${getFaction(contract.opponent).name}: −${contract.hostility} reputation applied on acceptance.`;
		element('restart').textContent = 'RETURN TO SHIP →'; element('result-briefing').hidden = true;
		element('record-feedback').textContent = campaignSaved ? 'CAMPAIGN SAVED ON THIS DEVICE' : 'STORAGE UNAVAILABLE · CAMPAIGN CONTINUES FOR THIS SESSION';
		transition(navigation.setScreen('result'));
	};
	container.addEventListener('focusin', function (event) { if (event.target instanceof HTMLElement && !event.target.closest('.menu-controls')) updateMenuHint(); }, listenerOptions);
	container.addEventListener('workspacechange', updateMenuHint, listenerOptions);
	const rigCode = ['ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
	let rigCodeInput: string[] = [];
	window.addEventListener('keydown', function (event) {
		if (capture) rigCodeInput = [];
		setInputMode('keyboard'); if (event.isTrusted) unlockSound();
		if (capture && navigation.auxiliary === 'settings' && !element('keyboard-mappings').closest('[hidden], [inert]')) { event.preventDefault(); if (event.code === 'Escape') { capture = undefined; renderMappings(); } else if (!event.repeat && validKey(event.code)) assignKey(event.code); return; }
		if (capture || navigation.auxiliary || campaignConflict || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLElement && event.target.isContentEditable) {
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
		if (root?.classList.contains('workspace') && companyOpen()) {
			if (['KeyQ', 'KeyE', 'KeyZ', 'KeyC', 'KeyH', 'KeyX', 'F1'].includes(event.code)) {
				event.preventDefault();
				if (!event.repeat && companyNavigationReady() && isShipScreen(navigation.screen)) {
					if (event.code === 'KeyQ' || event.code === 'KeyE') navigateShip(adjacentShipScreen(navigation.screen, event.code === 'KeyQ' ? -1 : 1));
					else if (event.code === 'KeyZ' || event.code === 'KeyC') cycleWorkspaceView(root, event.code === 'KeyZ' ? -1 : 1);
					else if (event.code === 'KeyH') showAuxiliary('handbook');
					else if (event.code === 'F1') showAuxiliary('settings');
					else if (event.code === 'KeyX' && hasRefitDraft()) discardDraft();
				}
				return;
			}
			const direction = event.code === 'ArrowUp' ? 'up' : event.code === 'ArrowDown' ? 'down' : event.code === 'ArrowLeft' ? 'left' : event.code === 'ArrowRight' ? 'right' : undefined;
			if (direction) { event.preventDefault(); moveWorkspaceFocus(root, direction); audio.cue('focus'); return; }
		}
		if (root && ['title', 'rig-bay', 'escape-result'].includes(navigation.screen) && !navigation.auxiliary && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
			event.preventDefault(); const items = focusable(root); const index = items.findIndex(function (item) { return item === document.activeElement; });
			items[(index + (event.code === 'ArrowDown' || event.code === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus(); audio.cue('focus'); return;
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
	canvas.addEventListener('webglcontextrestored', function () { contextLost = false; padInput.suspend(); element('error').hidden = true; previous = 0; }, listenerOptions);
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
		if (escape) {
			element('mission-name').textContent = 'RIG BAY / SECURITY ALERT'; ui.phase.textContent = 'STOLEN FREEDOM';
			ui.status.textContent = state.mission && state.mission.extractTime > 0 ? `Evacuation in ${Math.ceil(3 - state.mission.extractTime)}s · hold position` : `REACH EVACUATION · ${Math.round(distance(state.player, state.mission?.map.extraction ?? state.player))} m`;
		}
		element('escape-guide').hidden = !escape || navigation.screen !== 'playing';
		element('escape-guide').textContent = escape ? escapeMessage(state.time, { ...profile.settings, device: inputMode, buttonLabel: function (index) { return controllerButtonLabel(controllerFamily, index); } }) : '';
		element('training-guide').hidden = !training || navigation.screen !== 'playing';
		if (training) {
			const copy = trainingCopy(training, inputMode === 'gamepad', { ...profile.settings, buttonLabel: function (index) { return controllerButtonLabel(controllerFamily, index); }, controlMode: inputMode === 'touch' ? 'simulation' : profile.settings.controlMode });
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
			button.setAttribute('aria-label', mount && weapon ? `Fire mount ${index + 1}, ${hardpoint.name}, ${family}: ${weapon.name}, rank ${rankLabel(mount.level)}. ${profile.settings.keyboard[binding.action].map(keyLabel).join(' / ') || 'Unbound'}; controller ${controllerButtonLabel(controllerFamily, profile.settings.controller[binding.action])}.` : `Mount ${index + 1}, ${hardpoint.name}, ${family}, empty. Equip compatible purchased weapons in the Mech Bay.`);
			const location = button.querySelector('.weapon-mount'); if (location) location.textContent = hardpoint.name;
			button.title = `${hardpoint.name} · ${family}${weapon ? ` · ${weapon.type}` : ' · Empty'}`;
			const title = button.querySelector('b'); if (title) title.textContent = mount && weapon ? weapon.name : 'EMPTY';
			const icon = button.querySelector('.weapon-icon'); if (icon) icon.textContent = `${String(index + 1).padStart(2, '0')}${mount ? ` · ${rankLabel(mount.level)}` : ''}`;
			const prompt = button.querySelector('kbd'); if (prompt) render(inputMode === 'gamepad' ? renderControllerButton(controllerFamily, profile.settings.controller[binding.action]) : html`${inputMode === 'touch' ? `HOLD ${index + 1}` : profile.settings.keyboard[binding.action].map(keyLabel).join(' / ') || 'UNBOUND'}`, prompt);
			const label = button.querySelector('em'); if (label) label.textContent = `${family.toUpperCase()} · ${!mount ? 'EMPTY' : button.disabled ? 'DRILL LOCK' : p.overheated ? 'HEAT LOCK' : firing ? 'FIRING' : mount.cooldown > 0 ? `${mount.cooldown.toFixed(1)}s` : 'READY'}`;
			const fill = button.querySelector('i'); if (fill) fill.style.width = `${mount && weapon ? Math.max(0, 1 - mount.cooldown / Math.max(.01, weapon.interval)) * 100 : 0}%`;
			button.style.setProperty('--weapon-color', weapon?.color ?? 'var(--muted)');
		}
		element('coolant').toggleAttribute('disabled', Boolean(training && training.stage !== 'coolant'));
		ui.coolant.textContent = `${state.coolantCharges} ${state.coolantCharges === 1 ? 'CHARGE' : 'CHARGES'}`;
		ui.message.textContent = !playing() ? '' : inputMode === 'gamepad' && currentPad?.connected && !currentPad.ready ? 'RELEASE STICKS AND TRIGGERS TO ARM CONTROLS' : p.overheated ? 'REACTOR LOCKOUT / VENT COOLANT OR CEASE FIRE' : state.time < messageUntil ? message : state.relay < 30 ? 'RELAY INTEGRITY CRITICAL' : '';
		ui.hint.hidden = tipDismissed || state.time > 35 || navigation.screen !== 'playing';
		const coolantPrompt = element('coolant').querySelector('kbd'); if (coolantPrompt) render(inputMode === 'gamepad' ? renderControllerButton(controllerFamily, profile.settings.controller.coolant) : html`${profile.settings.keyboard.coolant.map(keyLabel).join(' / ') || 'UNBOUND'}`, coolantPrompt);
		ui.hintCopy.textContent = inputMode === 'gamepad' ? profile.settings.controlMode === 'arcade' ? `Left stick moves toward its direction; release to slow. Right stick aims. ${controllerButtonLabel(controllerFamily, profile.settings.controller.stop)} stops.` : `Left stick up/down adjusts persistent throttle; left/right turns legs. Right stick left/right rotates torso; release to hold. ${controllerButtonLabel(controllerFamily, profile.settings.controller.stop)} stops.` : inputMode === 'touch' || coarsePointer.matches || profile.settings.touchControls ? 'Tap the field to aim. Hold + to move; STOP sets neutral. Hold a weapon to fire.' : profile.settings.controlMode === 'arcade' ? 'WASD / mapped movement keys choose direction; release to slow. Mouse aims. STOP sets neutral.' : state.time < 14 ? `${profile.settings.keyboard.forward.map(keyLabel).join(' / ')} increases throttle; ${profile.settings.keyboard.back.map(keyLabel).join(' / ')} decreases it. Release to cruise. ${profile.settings.keyboard.stop.map(keyLabel).join(' / ')} stops.` : 'Hold mapped weapon inputs together to combine mounts. Check Settings for keyboard / mouse and controller mappings.';
		const audioState = audio.status(); const needsGesture = audioState === 'locked' || audioState === 'pending';
		const soundState = audioState === 'unavailable' ? 'UNAVAILABLE' : needsGesture ? 'ENABLE SOUND' : muted ? 'SOUND OFF' : 'SOUND ON';
		if (lastSoundState !== soundState) { lastSoundState = soundState; ui.sound.textContent = soundState; ui.sound.setAttribute('aria-label', needsGesture ? 'Click to enable audio' : audioState === 'unavailable' ? 'Retry audio' : muted ? 'Unmute sound' : 'Mute sound'); ui.sound.setAttribute('aria-pressed', String(muted)); }
		const audioStatus = needsGesture && inputMode === 'gamepad' ? 'Audio needs a click or key press in this browser.' : audioState === 'unavailable' ? 'Audio device unavailable. Click or press a key to retry.' : '';
		if (element('audio-status').textContent !== audioStatus) element('audio-status').textContent = audioStatus;
	};
	const audioFrame = function (now: number) {
		const combat = playing(); const audibleMenu = navigation.screen === 'title' || navigation.screen === 'jump' || isShipScreen(navigation.screen) || navigation.screen === 'training-result' || (navigation.screen === 'result' && now < terminalUntil + 30000);
		return { speed: combat ? state.player.speed : 0, laser: combat && !!state.beam, heat: state.player.heat,
			alarm: combat && escape,
			active: !contextLost && focused && !document.hidden && (combat || audibleMenu), uiActive: !contextLost && focused && !document.hidden,
			phase: navigation.screen === 'title' || navigation.screen === 'jump' || isShipScreen(navigation.screen) ? 'briefing' as const : navigation.screen === 'training-result' ? 'refit' as const : navigation.screen === 'result' ? 'result' as const : 'combat' as const,
			intensity: Math.min(1, state.enemies.length / 5 + (state.wave - 1) * 0.08), danger: Math.max(0, 1 - Math.min(state.player.hp, state.relay) / 50), victory: state.outcome === 'won' };
	};
	let frameTime = 0;
	let makeInput = function (): Controls { return { drive: 0, stop: false, turn: 0, aim, fire: [false, false, false, false], coolant: false }; };
	world.addSystem('intro-narrative').inScreens(['intro']).inPhase('preUpdate').setProcess(function ({ dt }) {
		if (narrativeWaiting || navigation.transitioning || navigation.auxiliary || !focused || document.hidden || contextLost) return;
		const lines = narrativePart === 'before' ? INTRO_LINES : SADDLE_LINES;
		const previousNarrative = narrativeFrame(lines, narrativeElapsed);
		narrativeElapsed += dt;
		const narrative = narrativeFrame(lines, narrativeElapsed);
		element('intro-line').textContent = narrative.text; element('intro-line').style.opacity = String(narrative.opacity);
		const revealed = narrative.text.slice(previousNarrative.index === narrative.index ? previousNarrative.text.length : 0);
		if (revealed) { audio.update(audioFrame(frameTime)); audio.typeText(revealed); }
		if (narrative.done) {
			if (narrativePart === 'before') transition(navigation.setScreen('rig-bay'));
			else startEscape();
		}
	});
	world.addSystem('browser-input').inPhase('preUpdate').setProcess(function () {
		const now = frameTime;
		if (!navigation.transitioning && navigation.screen === 'jump' && focused && !document.hidden && now >= jumpUntil) toBridge();
		const revisionAtFrame = screenRevision;
		const rect = canvas.getBoundingClientRect(); const width = rect.width; const height = rect.height;
		presentation.resize(state, width, height);
		let pads: readonly (Gamepad | null)[] = [];
		try { pads = navigator.getGamepads?.() ?? []; } catch { /* Gamepad access can be restricted by an embedding policy. */ }
		if (!focused || document.hidden || contextLost) padInput.suspend();
		const pad = padInput.read(pads, now, profile.settings.controller);
		currentPad = pad;
		if (pad.lost) { controllerLost = true; setInputMode(coarsePointer.matches ? 'touch' : 'keyboard'); setPaused(true); }
		feedback.update(pads.find(function (candidate) { return candidate?.index === pad.index; }) ?? undefined, playing() && profile.settings.vibration && inputMode === 'gamepad');
		if (pad.claimed) { controllerLost = false; audio.cue('confirm'); }
		if (pad.promptActivity && focused && !document.hidden) {
			controllerFamily = detectControllerFamily(pad.id ?? '');
			if (profile.settings.controlMode === 'simulation' && pad.claimed) aimMode = 'gamepad';
			setInputMode('gamepad');
		}
		container.dataset['controllerState'] = pad.connected ? 'connected' : controllerLost ? 'disconnected' : pad.available ? 'available' : 'none';
		const availablePad = pads.find(function (candidate) { return candidate?.connected && candidate.mapping === 'standard'; });
		const availableFamily = detectControllerFamily(availablePad?.id ?? '');
		const claimLabel = controllerButtonLabel(availableFamily, 0); const menuLabel = controllerButtonLabel(availableFamily, 9);
		const controllerStatus = pad.connected ? 'CONTROLLER CONNECTED' : controllerLost ? `CONTROLLER LOST · ${claimLabel} / ${menuLabel} TO RECONNECT` : pad.available ? `PRESS ${claimLabel} / ${menuLabel} TO CONNECT` : 'CONTROLLER OPTIONAL';
		if (element('controller-status').textContent !== controllerStatus) element('controller-status').textContent = controllerStatus;
		for (const status of container.querySelectorAll<HTMLElement>('.ship-controller-status')) {
			status.hidden = pad.connected || !pad.available && !controllerLost;
			if (status.textContent !== controllerStatus) status.textContent = controllerStatus;
		}
		if (pad.pause && focused && !document.hidden && !contextLost) { audio.cue('back'); if (navigation.auxiliary) closeAuxiliary(); else if (companyNavigationReady()) showAuxiliary('settings'); else setPaused(navigation.screen === 'playing'); }
		const root = menu();
		if (root && !navigation.transitioning && pad.connected && screenRevision === revisionAtFrame && focused && !document.hidden && !contextLost) {
			if (companyNavigationReady() && isShipScreen(navigation.screen)) {
				if (pad.department) { navigateShip(adjacentShipScreen(navigation.screen, pad.department)); return; }
				if (pad.page) { cycleWorkspaceView(root, pad.page); padInput.requireNeutral(); return; }
				if (pad.help) { showAuxiliary('handbook'); return; }
				if (pad.discard && hasRefitDraft()) { discardDraft(); return; }
			}
			if (pad.navigate) {
				const focusedElement = document.activeElement;
				if (pad.adjust && focusedElement instanceof HTMLSelectElement) { focusedElement.selectedIndex = (focusedElement.selectedIndex + pad.adjust + focusedElement.options.length) % focusedElement.options.length; focusedElement.dispatchEvent(new Event('change', { bubbles: true }));
				} else if (pad.adjust && focusedElement instanceof HTMLInputElement && focusedElement.type === 'range') {
					focusedElement.value = String(Math.max(Number(focusedElement.min), Math.min(Number(focusedElement.max), Number(focusedElement.value) + pad.adjust * 5)));
					focusedElement.dispatchEvent(new Event('input', { bubbles: true }));
				} else if (root.classList.contains('workspace') && pad.direction) { moveWorkspaceFocus(root, pad.direction);
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
				const targets = aimTargets.map(function (enemy) { const at = presentation.toScreen(enemy, targetElevation(enemy)); const dx = at.x - origin.x; const dy = at.y - origin.y; return { enemy, alignment: (dx * pad.aimX + dy * pad.aimY) / Math.max(1, Math.hypot(dx, dy) * length) }; }).filter(function (target) { return target.alignment > 0.975 && distance(target.enemy, state.player) < 850; }).sort(function (a, b) { return b.alignment - a.alignment; });
				const target = targets[0]; if (target) aim = { x: target.enemy.x, y: target.enemy.y };
			} else if (pointer && aimMode === 'pointer') {
				aim = presentation.toGround(pointer) ?? aim;
				const cursor = pointer;
				const facility = state.mission?.structure;
				const targetScreen = function (target: Point) { return presentation.toScreen(target, targetElevation(target)); };
				const aimTargets = [...state.enemies, ...(facility && facility.hp > 0 ? [facility] : [])];
				const picked = aimTargets.sort(function (a, b) { return distance(targetScreen(a), cursor) - distance(targetScreen(b), cursor); })[0];
				if (picked && distance(targetScreen(picked), cursor) < 42 * viewScale(width, height)) aim = { x: picked.x, y: picked.y };
			}
			if (profile.settings.controlMode === 'simulation' && aimMode === 'gamepad') aim = { x: state.player.x + Math.cos(state.player.turret) * 600, y: state.player.y + Math.sin(state.player.turret) * 600 };
			makeInput = function (): Controls {
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
			runtimeInput.sample(makeInput());
		}
		combatRuntime.setEnabled(playing() && screenRevision === revisionAtFrame);
	});
	world.addSystem('combat-feedback').setEventHandlers({
		combatStepFinished: function ({ data }) {
			audio.update(audioFrame(frameTime)); audio.play(data.events);
			feedback.play(data.events, frameTime);
		},
	});
	let previousGaits = gaits;
	let previousStage = training?.stage;
	let previousFrame = state.frame;
	let previousMissionStage = state.mission?.stage;
	combatRuntime.setControls(function () { return runtimeInput.consume(makeInput()); });
	combatRuntime.setHooks({
		beforeStep: function () {
			previousGaits = gaits; previousStage = training?.stage;
			previousFrame = state.frame; previousMissionStage = state.mission?.stage;
		},
		afterStep: function () {
			const now = frameTime;
			gaits = state.frame !== previousFrame || training?.stage === 'evade' && previousStage !== 'evade' ? createGaits(state) : advanceGaits(gaits, state);
			pending.clear();
			if (training && previousStage !== training.stage) audio.cue('confirm');

			for (const index of [0, 1] as const) if (previousGaits.player.feet[index].lift > 0 && gaits.player.feet[index].lift === 0) audio.footstep(index === 0 ? -1 : 1);
			if (state.mission?.stage === 'extract' && previousMissionStage !== 'extract') { message = 'OBJECTIVE COMPLETE · REACH EXTRACTION AND HOLD FOR 3 SECONDS'; messageUntil = state.time + 7; }
			if (state.events.includes('coolant')) { message = 'COOLANT PURGE / REACTOR STABILIZING'; messageUntil = state.time + 2; }
			if (escape && state.outcome === 'won') {
				if (!campaign.introComplete && !replaceCampaign({ ...campaign, introComplete: true })) return;
				toBridge();
			}
			else if (escape && state.outcome === 'lost') { audio.reset(); transition(navigation.setScreen('escape-result')); }
			else if (training?.stage === 'complete') transition(navigation.setScreen('training-result'));
			else if (!training && state.outcome !== 'playing') showResult(now);
			else checkpoint();
		},
	});
	const battlefieldVisible = function () {
		return !contextLost && (navigation.screen === 'playing' || navigation.screen === 'pause-panel' || navigation.screen === 'escape-result' || navigation.screen === 'result' || navigation.screen === 'training-result');
	};
	world.addSystem('battlefield-presentation').inPhase('postUpdate').before(transform3DSystems.propagate).setProcess(function () {
		if (battlefieldVisible()) {
			world.enableSystemGroup('renderer3d');
			presentation.prepare(state, aim, gaits, false, hudObstructions, inputMode === 'gamepad' || profile.settings.couchUI);
		} else world.disableSystemGroup('renderer3d');
	});
	world.addSystem('browser-feedback').inPhase('render').setPriority(-100).setProcess(function () {
		const now = frameTime;
		audio.update(audioFrame(now));
		if (navigation.screen === 'title' && !navigation.auxiliary && focused && !document.hidden) titleScene?.render(now);
		if (navigation.screen === 'rig-bay' && !navigation.auxiliary && focused && !document.hidden) {
			for (const id of INTRO_FRAMES) {
				const modelCanvas = element(`intro-${id}`).querySelector('canvas');
				if (!modelCanvas || modelCanvas.dataset['hangarFailed'] === 'true') continue;
				let view = rigPreviews.get(id);
				if (!view) {
					try { view = createHangarPreview(modelCanvas); view.setFrame(id); rigPreviews.set(id, view); }
					catch (error: unknown) { view?.dispose(); view = undefined; modelCanvas.dataset['hangarFailed'] = 'true'; console.warn('Rig preview unavailable', error); }
				}
				view?.render();
			}
		}
		if (navigation.screen === 'mechbay' && !navigation.auxiliary && focused && !document.hidden) {
			const modelCanvas = element('mechbay').querySelector<HTMLCanvasElement>('[data-hangar-frame]');
			if (modelCanvas && modelCanvas.clientWidth > 0 && modelCanvas.clientHeight > 0) {
				if (hangar?.canvas !== modelCanvas) {
					hangar?.view.dispose(); hangar = undefined;
					if (modelCanvas.dataset['hangarFailed'] !== 'true') {
						try { hangar = { canvas: modelCanvas, view: createHangarPreview(modelCanvas) }; }
						catch (error: unknown) { modelCanvas.dataset['hangarFailed'] = 'true'; console.warn('Hangar preview unavailable', error); }
					}
				}
				hangar?.view.setFrame(campaign.selectedFrame); hangar?.view.render();
			}
		}
		if (battlefieldVisible()) presentation.drawOverlay();
		if (now - lastHud > 80 || lastHud === 0) { updateHud(); lastHud = now; }
	});
	const tick = function (now: number) {
		if (stopped) return;
		const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0; previous = now;
		frameTime = now;
		world.update(elapsed);
		frame = requestAnimationFrame(tick);
	};
	updateSettings(); updateDifficulty(); refreshCampaign(); persistCampaign();
	if (!campaignConflict && !campaign.introComplete) startIntro(); else syncScreen();
	frame = requestAnimationFrame(tick);
	return function () {
		if (stopped) return; stopped = true;
		checkpoint(); cancelAnimationFrame(frame); abort.abort(); resetInput();
	};
});
if (import.meta.hot) import.meta.hot.dispose(shutdown);
