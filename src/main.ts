import { PICKUP_DURATION, PICKUP_LAND_AT, PICKUP_LIFT_AT } from './launch-surface';
import { HARROW_MAX_RANGE, HARROW_MIN_RANGE, mortarProfile, mountInterval } from './frame-tactics';
import { rigFrameId, rigName } from './rigs';
import { getFrameOffer } from './market';
import { companyRank } from './reputation';
import ECSpresso from 'ecspresso';
import { mountRigTest, rigTestEnabled } from './rig-test';
import { createFieldTrial, DEFENSE_TRIAL_SEED } from './field-trial';
import { drawFieldSurvey, fieldTrialSeed } from './field-trial-ui';
import { html, nothing, render } from 'lit-html';
import { createHangarPreview, createHangarPreviewSlot } from './hangar-preview';
import { detectControllerFamily, controllerButtonLabel, renderAimGlyph, renderControllerButton, renderGlyph, renderKeyboardBindings, renderScrollGlyph, renderZoomGlyph, type ControllerFamily, type PromptDevice } from './input-prompts';
import { refreshNavigationGlyphs } from './menu-prompts';
import { transform3DSystems } from 'ecspresso/plugins/spatial/transform3D';
import { createCombatRuntime } from './combat-runtime';
import { mountSquadOrders } from './squad-orders-ui';
import { createRuntimeNavigation, type RuntimeAuxiliary, type RuntimeBaseScreen } from './runtime-navigation';
import { createRuntimeInput } from './runtime-input';
import { createTouchFacing, createTouchTargeting, isContactVisible, mountTouchDrive, touchAimPoint, visibleTouchContacts } from './touch-controls';
import { mountTouchZoom } from './touch-zoom';
import { mountMobileFullscreen } from './mobile-fullscreen';
import { mountFullscreenViewport } from './fullscreen-viewport';
import { ACTIONS, LABELS, defaultKeyboard, defaultController, keyLabel, validKey, type Action, type ControllerBindings } from './bindings';
import { getWeapon, isReserve, WEAPON_FAMILY_LABELS, withinWeaponRange } from './arsenal';
import { canEquipWeapon, getHardpoints } from './hardpoints';
import { getFrame } from './frames';
import { MOUNTS, loadSummary, massLabel } from './loadout-ui';
import { frameWeight, usableMount } from './combat-resources';
import { mountGame } from './shared/lifecycle';
import { artilleryAimStatus, combatTargets, createMissionState, createState, distance, getOperationReport, missileLockRange, type Controls, type Point, type SquadmateOptions } from './simulation';
import { RIG_DEFEAT_SECONDS } from './rig-defeat-timing';
import { createRigDefeatAudio } from './rig-defeat-audio';
import { createPresentation } from './presentation';
import { LAUNCH_DURATION, launchSceneTime } from './launch-timing';
import { advanceGaits, createGaits } from './gait';
import { viewScale } from './projection-3d';
import { targetElevation, type ScreenRect } from './overlay';
import { createAudio } from './audio';
import { createGamepadInput, type PadInput } from './gamepad';
import { createControllerFeedback } from './controller-feedback';
import { createTraining, touchDrillCue, trainingCopy, trainingFireSlot, type Training, type TrainingSetup } from './training';
import { mountTrainingSetup } from './training-ui';
import { createSituationMission } from './situation-sim';
import { mountSituationSetup } from './situation-sim-ui';
import { isDifficulty, readProfile, saveProfile, type Settings } from './profile';
import { abandonContract, assignOperationLead, assignOperationSlot, commitOperations, createCampaign, CAMPAIGN_STORAGE_KEY, getFaction, getPlanet, getPlannedOperation, getTransmission, parseCampaign, recoverInterruptedDeployment, removeOperation, reviewOperations, saveCampaign, settleContract, stageOperation, travelTo, type Campaign, type CampaignResult } from './campaign';
import type { Difficulty } from './operation';
import { focusTerritoryMap } from './territory-map';
import { renderBridge, renderStarmap, type BridgeActions, type BriefingOrigin, type ShipView } from './campaign-ui';
import { MISSION_NAMES, type PlanetId } from './campaign-types';
import { getAuthoredStep } from './contract-chains';
import { combatTask } from './combat-task';
import { fieldContacts } from './tactical-radar';
import { missionStructures } from './missions';
import { isFrameId, WEAPON_PRICES, refitDays, repairDays, advanceDays, applyRigCheat, assignPilot, assignRig, beginDeployment, buyFrame, buyWeapon, canDeploySquad, cancelWorkOrder, checkpointDeployment, getOwnedMech, queueRefit, queueRepair, selectFrame, workOrderFor, type DeployedPilot } from './company';
import { dismissPilot, getPilot, hirePilot } from './pilots';
import { adjacentShipScreen, isShipScreen, renderCompany, type CompanyEditor, type ShipScreen } from './company-ui';
import { availableMenuControl, focusMenuControl, menuControls, menuScrollArea, moveMenuFocus, scrollMenu, selectMenuControl, type MenuDirection } from './menu-focus';
import { mountChoicePicker } from './choice-picker';
import { mountWorkspaceLayout, revealWorkspaceElement, selectWorkspacePane, focusWorkspace, rememberWorkspaceFocus, moveWorkspaceFocus, cycleWorkspaceView, inspectWorkspacePane, workspaceBackTarget, workspaceControls, workspaceNavigationLocked } from './workspace';
import { mountDialogLayout, stepDialogNavigation } from './dialog-layout';
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
const usesMenuScore = function (screen: RuntimeBaseScreen) {
	return screen === 'title' || screen === 'jump' || isShipScreen(screen)
		|| screen === 'training-setup' || screen === 'training-result' || screen === 'situation-setup';
};
const shutdown = await mountGame('game', async function (container, onCleanup) {
	const viewportAbort = new AbortController();
	onCleanup(function () { viewportAbort.abort(); });
	mountFullscreenViewport(viewportAbort.signal);
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
	const audio = createAudio();
	const armorBursts = createRigDefeatAudio();
	onCleanup(audio.dispose);
	const resetAudioForMenuEntry = function () {
		// Clear old scene audio when entering menus, not when moving within them.
		if (!usesMenuScore(navigation.screen)) audio.reset();
	};
	const padInput = createGamepadInput();
	onCleanup(padInput.reset);
	const feedback = createControllerFeedback();
	onCleanup(feedback.dispose);
	const profile = readProfile();
	const trialParams = new URLSearchParams(location.search);
	const defensePacing = !rigTestEnabled && trialParams.has('defense-pacing');
	let trialSeed = rigTestEnabled ? undefined : defensePacing ? DEFENSE_TRIAL_SEED : fieldTrialSeed(trialParams.get('field-trial'));
	const sessionOnly = rigTestEnabled || trialSeed !== undefined;
	presentation.setSkin(profile.settings.mechSkin);
	const savedSnapshot = function (): string | null | undefined {
		try { return localStorage.getItem(CAMPAIGN_STORAGE_KEY); } catch { return undefined; }
	};
	let campaignSnapshot = trialSeed === undefined ? savedSnapshot() : null;
	let campaign = parseCampaign(campaignSnapshot ?? null);
	let returningCompany = campaignSnapshot !== null && campaignSnapshot !== undefined;
	let campaignSaved = returningCompany;
	let campaignConflict = false;
	let destination: PlanetId = campaign.planetId;
	let selectedContract: string | undefined;
	let briefingOrigin: BriefingOrigin = 'board';
	let editedOperation: string | undefined;
	let guidedCourse: PlanetId | undefined;
	let jumpArrival: { until: number; transmission: boolean } | undefined;
	const abort = new AbortController(); const listenerOptions = { signal: abort.signal };
	onCleanup(function () { abort.abort(); });
	const updateWorkspaceLayout = mountWorkspaceLayout(container, abort.signal);
	const updateDialogLayout = mountDialogLayout(container, abort.signal);
	const keys = new Set<string>(); const pending = new Set<string>(); const held = new Map<number, string>();
	const coarsePointer = window.matchMedia('(any-pointer: coarse)');
	const primaryPointer = window.matchMedia('(pointer: coarse)');
	const portrait = window.matchMedia('(orientation: portrait)');
	const hasTouch = function () { return coarsePointer.matches || navigator.maxTouchPoints > 0; };
	const fullscreenButton = element('mobile-fullscreen');
	if (!(fullscreenButton instanceof HTMLButtonElement)) throw new Error('Missing fullscreen button');
	const mobileFullscreen = mountMobileFullscreen(container, fullscreenButton, element('fullscreen-status'), abort.signal);
	const ui = {
		phase: element('phase'), status: element('status'), armor: element('armor-value'), armorFill: element('armor-fill'),
		relay: element('relay-value'), relayFill: element('relay-fill'), heat: element('heat-value'), heatFill: element('heat-fill'),
		drive: element('drive-value'), throttleFill: element('throttle-fill'), speed: element('speed-value'), squad: element('squad-readout'),
		coolant: element('coolant-value'), message: element('message'),
		sound: element('sound'), stripHull: element('strip-hull'), stripHeat: element('strip-heat'), stripDrive: element('strip-drive'),
		stripHullFill: element('strip-hull-fill'), stripHeatFill: element('strip-heat-fill'), stripRelay: element('strip-relay'),
		strip: element('combat-strip'), weapons: element('fire-console'), radar: element('tactical-radar'), radarButton: element('toggle-radar'), pauseRadar: element('pause-radar'),
	};
	const touchDock = element('touch');
	const touchDriveButton = element('touch-drive');
	const touchFireButton = element('touch-fire');
	const zoomControl = element('touch-zoom');
	const stripTask = ui.phase.parentElement;
	const touchTargetStatus = element('touch-target-status');
	const cockpitElements = [...container.querySelectorAll<HTMLElement>('.strip-vitals, .strip-task, .strip-actions, #tactical-radar, .left-instruments, .weapon-console, #zoom-hold, #zoom-panel, #zoom-value')];
	const touchClusters = [...container.querySelectorAll<HTMLElement>('.touch-drive-cluster, .touch-fire-cluster')];
	const touchControls = [...touchDock.querySelectorAll<HTMLElement>('button, .touch-control-label')];
	let hudObstructions: ScreenRect[] = [];
	const refreshHudObstructions = function () {
		const field = canvas.getBoundingClientRect();
		if (zoomControl.offsetWidth > 0) {
			if (portrait.matches) {
				// The task may wrap below the strip and the mount row may sit above the dock.
				const top = Math.max(ui.strip.getBoundingClientRect().bottom, stripTask?.getBoundingClientRect().bottom ?? 0);
				const bottom = Math.min(touchDock.getBoundingClientRect().top, ui.weapons.getBoundingClientRect().top, touchTargetStatus.getBoundingClientRect().top);
				zoomControl.style.setProperty('--touch-zoom-center', `${(top + bottom) / 2 - field.top}px`);
				zoomControl.style.setProperty('--touch-zoom-room', `${bottom - top}px`);
			} else {
				// The compact dock has no cluster boxes. Its thumb controls bound the zoom row.
				const driveCluster = touchDriveButton.parentElement;
				const fireCluster = touchFireButton.parentElement;
				const left = (driveCluster?.offsetWidth ? driveCluster : touchDriveButton).getBoundingClientRect().right;
				const right = (fireCluster?.offsetWidth ? fireCluster : touchFireButton).getBoundingClientRect().left;
				zoomControl.style.setProperty('--touch-zoom-center', `${(left + right) / 2 - field.left}px`);
				zoomControl.style.setProperty('--touch-zoom-room', `${right - left}px`);
			}
		}
		// The compact touch grid lays out the individual controls with display: contents on their clusters.
		const touchObstructions = touchClusters.some(function (node) { return node.offsetWidth > 0; }) ? touchClusters : touchControls;
		hudObstructions = [...cockpitElements, ...touchObstructions].filter(function (node) { return node.offsetWidth > 0; }).map(function (node) { const rect = node.getBoundingClientRect(); return { left: rect.left - field.left, right: rect.right - field.left, top: rect.top - field.top, bottom: rect.bottom - field.top }; });
	};
	const weaponButtons = MOUNTS.map(function (binding) {
		const button = document.createElement('button'); button.className = 'weapon'; button.dataset['control'] = binding.action;
		button.innerHTML = '<span class="weapon-mount"></span><span class="weapon-icon" aria-hidden="true"></span><b></b><span class="weapon-ammo"></span><small class="weapon-prompt"></small><em></em><i></i>';
		return button;
	});
	element('weapon-bank').replaceChildren(...weaponButtons);
	const choicePicker = mountChoicePicker(container, abort.signal, function () {
		screenRevision++; padInput.requireNeutral(); updateMenuHint();
	});
	const trainingSetup = mountTrainingSetup(element('training-fit'), choicePicker);
	const situationSetup = mountSituationSetup(element('situation-fit'), choicePicker);
	let situationSim: { settings: Settings; storageStatus: string; run?: { seed: number; difficulty: Difficulty } } | undefined;
	let training: Training | undefined;
	let escape = false;
	let replayingEscape = false;
	let introFrame: IntroFrame = 'kestrel';
	let narrativePart: 'before' | 'after' = 'before';
	let narrativeElapsed = 0;
	let narrativeWaiting = false;
	let launchElapsed = 0;
	let launchStartedAt: number | undefined;
	const launchTimeNow = function () {
		return launchStartedAt === undefined ? launchElapsed : (performance.now() - launchStartedAt) / 1000;
	};
	const pauseLaunchClock = function () {
		launchElapsed = launchTimeNow();
		launchStartedAt = undefined;
	};
	let trainingOrigin: 'title' | 'bridge' | 'starmap' = 'title';
	let editor: CompanyEditor = { loadout: [...(getOwnedMech(campaign)?.loadout ?? [])], reserves: [...(getOwnedMech(campaign)?.reserves ?? [])], slot: null, notice: '' };
	const mouseButtons = new Set<number>();
	const consumedMouseButtons = new Set<number>();
	let state = combatRuntime.attach(createState({ difficulty: profile.settings.difficulty })); let gaits = createGaits(state); let muted = false;
	let sortieEnding: { owner: typeof state; kind: 'fall' | 'pickup'; startedAt: number; elapsed: number; reveal?: (now: number) => void } | undefined;
	const radarViewport = window.matchMedia('(width > 700px) and (height > 520px)');
	let radarOwner: typeof state | undefined;
	const radarAvailable = function () {
		return radarViewport.matches && !container.classList.contains('touch-enabled') && state.outcome === 'playing' && sortieEnding?.owner !== state;
	};
	const updateRadar = function () {
		const available = radarAvailable();
		if (!available || radarOwner !== state) radarOwner = undefined;
		const open = radarOwner === state;
		ui.radarButton.hidden = !available;
		ui.radarButton.setAttribute('aria-expanded', String(open));
		ui.radar.hidden = !open;
		if (available && navigation.screen === 'playing') ui.radarButton.textContent = `${String(fieldContacts(state).length).padStart(2, '0')} contacts ${open ? '▴' : '▾'}`;
		if (open && navigation.screen === 'playing') {
			const room = ui.weapons.getBoundingClientRect().top - ui.strip.getBoundingClientRect().bottom - 6;
			ui.radar.style.maxHeight = `${Math.max(0, Math.floor(room))}px`;
		}
		if (navigation.screen === 'pause-panel') {
			const changed = ui.pauseRadar.hidden === available;
			ui.pauseRadar.hidden = !available;
			ui.pauseRadar.textContent = open ? 'Hide tactical map' : 'Show tactical map';
			if (changed && !element('pause-panel').hidden) updateDialogLayout();
		}
	};
	const toggleRadar = function () {
		if (!radarAvailable()) return false;
		radarOwner = radarOwner === state ? undefined : state;
		lastHud = 0;
		return true;
	};
	const squadOrdersRoot = element('squad-orders');
	const canIssueSquadOrders = function () {
		return state.outcome === 'playing' && state.squadmates.some(function (mate) { return mate.hp > 0; });
	};
	const squadOrders = mountSquadOrders(squadOrdersRoot, {
		apply: function (current, changes) {
			if (navigation.auxiliary !== 'squad-orders' || navigation.transitioning || campaignConflict || contextLost) return;
			if (combatRuntime.applySquadOrders(current, changes)) setPaused(false);
		},
		back: function () { backFromSquadOrders(); },
	}, abort.signal);
	let acquiredTargetId: number | undefined;
	let aim: Point = { x: 900, y: 450 }; let pointer: Point | undefined; let aimMode: 'pointer' | 'gamepad' | 'touch' | 'target' = 'pointer';
	const touchTargeting = createTouchTargeting();
	const touchFacing = createTouchFacing();
	let touchAimPointer: number | undefined;
	const armedTouchMounts = new Set([0, 1, 2, 3]);
	let touchLoadout = state.loadout;
	let frame = 0; let previous = 0; let lastHud = 0;
	onCleanup(function () { cancelAnimationFrame(frame); });
	let message = ''; let messageUntil = 0; let terminalUntil = 0; let contextLost = false; let focused = true;
	let returnFocus: HTMLElement | undefined; let confirmedAction: (() => void) | undefined;
	let inputMode: 'keyboard' | 'gamepad' | 'touch' = primaryPointer.matches ? 'touch' : 'keyboard'; let controllerLost = false; let screenRevision = 0;
	const defaultAimMode = function () { return inputMode === 'keyboard' ? 'pointer' : inputMode; };
	let capture: Action | undefined;
	let currentPad: PadInput | undefined;
	let controllerFamily: ControllerFamily = 'generic';
	let lastMenuTarget: HTMLElement | undefined;
	const hangar = createHangarPreviewSlot();
	const marketPreview = createHangarPreviewSlot();
	onCleanup(hangar.clear);
	onCleanup(marketPreview.clear);
	const rigPreviews = new Map<IntroFrame, ReturnType<typeof createHangarPreview>>();
	const clearRigPreviews = function () { for (const view of rigPreviews.values()) view.dispose(); rigPreviews.clear(); };
	onCleanup(clearRigPreviews);
	const promptDevice = function (): PromptDevice { return inputMode === 'gamepad' ? controllerFamily : inputMode; };
	const hasRefitDraft = function () { const mech = getOwnedMech(campaign); return Boolean(mech && (editor.loadout.some(function (weapon, index) { return weapon !== mech.loadout[index]; }) || editor.reserves.some(function (rounds, index) { return rounds !== mech.reserves[index]; }))); };
	const companyOpen = function () { return isShipScreen(navigation.screen) && !navigation.auxiliary; };
	const companyNavigationReady = function () { return companyOpen() && !choicePicker.root && !navigation.transitioning && !workspaceNavigationLocked(element(navigation.screen)) && !campaignConflict && !contextLost; };
	let lastSoundState = '';
	const facingMarker = element('touch-facing-marker');
	const trackingMarker = element('touch-lock-marker');
	const clearTouchFacing = function () { touchFacing.clear(); touchAimPointer = undefined; facingMarker.hidden = true; };
	const resetInput = function () { touchZoom.reset(); acquiredTargetId = undefined; touchDrive.reset(); touchTargeting.clear(); clearTouchFacing(); trackingMarker.hidden = true; keys.clear(); pending.clear(); held.clear(); mouseButtons.clear(); runtimeInput.clear(); combatRuntime.setEnabled(false); padInput.requireNeutral(); void feedback.stop(); };
	const battlefieldActive = function () { return !navigation.transitioning && navigation.screen === 'playing' && !navigation.auxiliary && !campaignConflict && !contextLost && !document.hidden && focused; };
	const playing = function () { return battlefieldActive() && sortieEnding?.owner !== state; };
	const infoButton = element('touch-info');
	let indicatorInfo = false;
	const toggleIndicatorInfo = function () {
		indicatorInfo = !indicatorInfo;
		container.classList.toggle('show-indicator-info', indicatorInfo);
		infoButton.setAttribute('aria-pressed', String(indicatorInfo));
	};
	infoButton.addEventListener('click', function () { if (playing()) toggleIndicatorInfo(); }, listenerOptions);
	facingMarker.addEventListener('pointerdown', function (event) {
		if (event.button !== 0 || !playing() || aimMode !== 'touch') return;
		event.preventDefault();
		clearTouchFacing();
	}, listenerOptions);
	const touchZoom = mountTouchZoom(element('zoom-hold'), element('zoom-panel'), element('zoom-value'), element('zoom-track'), portrait, abort.signal, playing, presentation);
	const touchDrive = mountTouchDrive(element('touch-drive'), element('touch-drive-knob'), abort.signal, playing, element('touch-cruise'), element('touch-drive-hint'));
	const touchContacts = function () {
		const rect = canvas.getBoundingClientRect();
		return visibleTouchContacts(state, presentation.toScreen, rect.width, rect.height, hudObstructions);
	};
	for (const action of ['nearest', 'cycle'] as const) {
		element(action === 'nearest' ? 'touch-nearest' : 'touch-next').addEventListener('click', function () {
			if (!playing()) return;
			setInputMode('touch'); aimMode = 'touch'; pointer = undefined; clearTouchFacing();
			touchTargeting[action](touchContacts(), state.player);
		}, listenerOptions);
	}
	const selectTarget = function (action: 'nearest' | 'cycle') {
		if (!playing()) return;
		aimMode = 'target'; pointer = undefined; touchTargeting[action](touchContacts(), state.player);
	};
	for (const action of ['nearest', 'cycle'] as const) element(action === 'nearest' ? 'target-nearest' : 'target-next').addEventListener('click', function () { selectTarget(action); }, listenerOptions);
	const keyboardAction = function (code: string) { return ACTIONS.find(function (action) { return profile.settings.keyboard[action].includes(code); }); };
	const active = function (action: string) { return [...mouseButtons].some(function (button) { return keyboardAction(`Mouse${button}`) === action; }) || [...keys].some(function (code) { return keyboardAction(code) === action; }) || pending.has(action) || [...held.values()].includes(action); };
	const silenceAudio = function () {
		pauseLaunchClock();
		audio.update({ speed: 0, laser: false, heat: 0, active: false, theme: escape ? 'pursuit' : 'standard' });
	};
	const unlockSound = function () { void audio.unlock(); };
	const assignmentBack = function () {
		const deploy = element('deploy');
		return navigation.screen === 'deploy' && deploy.dataset['view'] === 'assignment' ? deploy.querySelector<HTMLButtonElement>('[data-close-assignment]') : null;
	};
	const titleDeck = element('title-deck');
	const titlePicker = element('title-picker');
	type TitleGroup = 'company' | 'simulator';
	let titleGroup: TitleGroup | undefined;
	const setTitleGroup = function (group: TitleGroup | undefined) {
		titleGroup = group;
		titleDeck.inert = Boolean(group);
		titlePicker.hidden = !group;
		for (const name of ['company', 'simulator'] as const) {
			element(`title-${name}-options`).hidden = name !== group;
			element(`title-${name}`).setAttribute('aria-expanded', String(name === group));
		}
		if (group) element('title-picker-heading').textContent = group === 'company' ? 'New company' : 'Simulator';
		screenRevision++;
	};
	const titleInitial = function () {
		if (titleGroup === 'company') return element('title-new-campaign');
		if (titleGroup === 'simulator') return element('title-situation');
		return element('title-continue');
	};
	const refreshTitleCompany = function () {
		const career = element('title-direct-career');
		const newCompany = element('title-company');
		const careerHadFocus = document.activeElement === career;
		newCompany.hidden = !returningCompany;
		career.hidden = returningCompany;
		element('title-company-label').textContent = !returningCompany ? 'New campaign' : campaign.introComplete ? 'Continue company' : 'Continue escape';
		element('title-save-status').textContent = !returningCompany ? 'No company started' : `${campaignSaved ? 'Local company' : 'Session only · storage unavailable'} / Day ${String(campaign.day).padStart(2, '0')} · ${getPlanet(campaign.planetId).name}`;
		if (careerHadFocus && returningCompany) newCompany.focus();
	};
	const updateMenuHint = function () {
		const device = promptDevice();
		refreshNavigationGlyphs(container, device);
		for (const node of container.querySelectorAll<HTMLElement>('[data-controller-bindings]')) {
			const names = node.dataset['controllerBindings']?.split(' ') ?? [];
			const bindings = names.flatMap(function (name) {
				switch (name) { case 'target-nearest': case 'target-next': case 'stop': case 'coolant': case 'mount-0': case 'mount-1': case 'mount-2': case 'mount-3': return [profile.settings.controller[name]]; default: return []; }
			});
			render(html`${bindings.map(function (index) { return renderControllerButton(controllerFamily, index); })}`, node);
		}
		for (const node of container.querySelectorAll<HTMLElement>('[data-controller-button]')) render(renderControllerButton(controllerFamily, Number(node.dataset['controllerButton'])), node);
		const root = menu();
		const focusedElement = document.activeElement;
		if (root && focusedElement instanceof HTMLElement && root.contains(focusedElement) && focusedElement.matches('button, input, select, a')) lastMenuTarget = focusedElement;
		const target = root && lastMenuTarget?.isConnected && root.contains(lastMenuTarget) && availableMenuControl(lastMenuTarget) ? lastMenuTarget : undefined;
		const onCompany = companyOpen();
		const pick = root === squadOrdersRoot ? root.querySelector<HTMLElement>('.squad-map')?.dataset['pick'] : undefined;
		const pickingOrder = pick === 'move' || pick === 'attack';
		const slider = target instanceof HTMLInputElement && target.type === 'range';
		const directionLabel = slider ? '↑↓ Move · ←→ Adjust' : pickingOrder && target?.matches('.squad-map-confirm')
			? pick === 'move' ? 'Move cursor' : 'Choose target' : 'Navigate';
		const toggling = target?.matches('input[type="checkbox"], input[type="radio"]');
		const canSelect = target && (target.matches('button, a') || toggling);
		const popoverId = root?.matches('.planet-popover:popover-open') ? root.id : nothing;
		const companyShortcuts = companyNavigationReady();
		const canGoBack = choicePicker.root || (navigation.auxiliary ? navigation.auxiliary !== 'save-conflict'
			: root === titlePicker || onCompany || ['intro', 'rig-bay', 'escape-result', 'pause-panel', 'training-setup', 'training-result', 'situation-setup', 'situation-result'].includes(navigation.screen));
		const backLabel = choicePicker.root || capture || pickingOrder ? 'Cancel' : navigation.auxiliary ? 'Back' : navigation.screen === 'pause-panel' ? 'Resume'
			: companyShortcuts && !workspaceBackTarget(element(navigation.screen)) ? 'Title' : 'Back';
		render(html`
			${root && device !== 'touch' && !capture && menuControls(root).length > 1 ? html`<span class="menu-key">${renderGlyph(device, 'move')}<span class="key-label">${directionLabel}</span></span>` : ''}
			${root && inputMode === 'gamepad' && !capture && menuScrollArea(root) ? html`<span class="menu-key">${renderScrollGlyph()}<span class="key-label">Scroll</span></span>` : ''}
			${canSelect && !capture ? html`<button class="menu-key" popovertarget=${popoverId} popovertargetaction="show" @click=${function (event: MouseEvent) {
				event.preventDefault();
				if (root && root === menu() && availableMenuControl(target)) { focusMenuControl(target); selectMenuControl(root, target); }
			}}>${device === 'keyboard' && toggling ? renderKeyboardBindings(['Space']) : renderGlyph(device, 'confirm')}<span class="key-label">Select</span></button>` : ''}
			${canGoBack ? html`<button class="menu-key" popovertarget=${popoverId} popovertargetaction="show" @click=${function (event: MouseEvent) { event.preventDefault(); back(); }}>${renderGlyph(device, 'back')}<span class="key-label">${backLabel}</span></button>` : ''}
			${companyShortcuts ? html`<button class="menu-key" @click=${function () { showAuxiliary('handbook'); }}>${renderGlyph(device, 'help')}<span class="key-label">Button guide</span></button>` : ''}
			${companyShortcuts && hasRefitDraft() ? html`<button class="menu-key" @click=${discardDraft}>${renderGlyph(device, 'discard')}<span class="key-label">Discard draft</span></button>` : ''}
		`, element('menu-input-hint'));
	};
	const setInputMode = function (value: typeof inputMode) {
		const touchLayout = value === 'touch' || value === 'keyboard' && profile.settings.touchControls;
		if (container.classList.contains('touch-enabled') === touchLayout && inputMode === value && container.dataset['input'] === value && container.dataset['promptDevice'] === promptDevice() && container.classList.contains('couch-ui') === (value === 'gamepad' || profile.settings.couchUI)) return;
		if (!touchLayout) touchZoom.reset();
		if (inputMode === 'gamepad' && value !== 'gamepad' && menu()) padInput.requireNeutral();
		if (inputMode !== value && (value === 'touch' || inputMode === 'touch')) {
			aimMode = value === 'keyboard' ? 'pointer' : value;
			pointer = undefined; acquiredTargetId = undefined; clearTouchFacing();
			if (value === 'touch') touchTargeting.clear();
		}
		if (value !== 'touch') { touchTargeting.clear(); touchDrive.reset(); held.forEach(function (action, id) { if (action === 'touch-fire') held.delete(id); }); pending.delete('touch-fire'); }
		if (container.classList.contains('touch-enabled') !== touchLayout) { held.clear(); pending.clear(); }
		container.classList.toggle('touch-enabled', touchLayout);
		lastHud = 0;
		inputMode = value; container.dataset['input'] = value; container.dataset['promptDevice'] = promptDevice();
		container.classList.toggle('using-gamepad', value === 'gamepad');
		container.classList.toggle('couch-ui', value === 'gamepad' || profile.settings.couchUI);
		render(touchLayout ? '' : renderGlyph(promptDevice(), inputMode === 'keyboard' ? 'back' : 'settings'), element('pause-prompt'));
		element('weapon-hint').textContent = touchLayout ? 'TAP TO ARM / HOLD FIRE' : 'HOLD TO FIRE · COMBINE MOUNTS';
		renderControllerMappings();
		updateMenuHint();
		updateWorkspaceLayout(); updateDialogLayout();
	};
	const save = function () {
		if (situationSim) return;
		element('storage-status').textContent = sessionOnly ? 'Preferences last for this session.' : saveProfile(profile) ? 'Preferences are saved on this device.' : 'Device storage is unavailable. You can keep playing; records will last for this session.';
	};
	const updateSettings = function () {
		audio.setMix(profile.settings);
		for (const name of ['master', 'music', 'effects'] as const) {
			inputElement(`${name}-volume`).value = String(Math.round(profile.settings[name] * 100));
			element(`${name}-output`).textContent = `${Math.round(profile.settings[name] * 100)}%`;
		}
		inputElement('show-touch').checked = profile.settings.touchControls;
		inputElement('large-interface').checked = profile.settings.couchUI;
		inputElement('controller-vibration').checked = profile.settings.vibration;
		element('leg-controls').textContent = `LEG CONTROLS: ${profile.settings.legControls.toUpperCase()}`;
		element('torso-aim').textContent = `CONTROLLER TORSO AIM: ${profile.settings.torsoAim.toUpperCase()}`;
		setInputMode(inputMode);
	};
	const menu = function () {
		if (choicePicker.root) return choicePicker.root;
		if (navigation.auxiliary) return element(navigation.auxiliary);
		if (navigation.screen === 'title') return titleGroup ? titlePicker : titleDeck;
		if (navigation.screen === 'playing') return undefined;
		const screen = element(navigation.screen);
		return navigation.screen === 'starmap' ? screen.querySelector<HTMLElement>('.planet-popover:popover-open') ?? screen : screen;
	};
	const syncScreen = function (focus = true) {
		screenRevision++;
		if (capture && navigation.auxiliary !== 'settings') { capture = undefined; renderMappings(); }
		const ordersWasOpen = !squadOrdersRoot.hidden;
		const practice = training?.stage === 'range';
		const finishingSortie = sortieEnding?.owner === state && sortieEnding.reveal !== undefined;
		element('reset').hidden = finishingSortie || !training && !escape && !situationSim;
		element('reset').textContent = situationSim ? 'RESTART SIMULATION' : escape ? 'RESTART ESCAPE' : practice ? 'RESET RANGE' : 'RESTART DRILLS';
		element('pause-training-loadout').hidden = !training;
		element('pause-squad-orders').hidden = !canIssueSquadOrders();
		element('leave').hidden = finishingSortie;
		element('leave').textContent = situationSim ? 'RETURN TO SIM SETUP' : trialSeed !== undefined ? 'FIELD BRIEFING' : escape ? 'RETURN TO TITLE' : state.mission && !training ? 'ABORT CONTRACT & RETURN TO SHIP' : trainingOrigin === 'title' && training ? 'RETURN TO TITLE' : 'RETURN TO SHIP';
		element('training-deploy').hidden = !campaign.active && !campaign.operations?.length;
		element('training-briefing').textContent = trainingOrigin === 'title' ? 'RETURN TO TITLE' : 'RETURN TO SHIP';
		if (navigation.screen === 'pause-panel') {
			const contract = state.mission?.contract;
			const operation = escape ? 'Stolen Freedom' : training ? 'Wayfarer training' : contract ? `${getPlanet(contract.planetId).name} / ${getFaction(contract.employer).shortName} · ${MISSION_NAMES[contract.kind]}` : 'Relay 09';
			const detail = training && training.stage !== 'range' && inputMode === 'touch'
				? trainingCopy(training.stage, false, { ...profile.settings, touch: true }).instruction : ui.status.textContent;
			const squad = state.squadmates.map(function (mate) { return `${mate.callsign} ${mate.hp > 0 ? Math.ceil(mate.hp) + '%' : 'DOWN'}`; });
			element('pause-mission').textContent = [operation, ui.phase.textContent, detail, ui.speed.textContent, element('weight-value').textContent, ...squad].filter(Boolean).join(' · ');
			updateRadar();
		}
		element('pause-copy').textContent = finishingSortie ? sortieEnding?.kind === 'pickup' ? 'Extraction in progress. Resume to finish the pickup.' : 'Your rig was disabled. Resume to finish the sortie.'
			: defensePacing ? 'Resume this run, or return to the briefing to replay the same sortie.'
			: trialSeed !== undefined ? 'Resume this run, or return to the briefing to start the field again or generate another layout.'
			: situationSim ? 'Restart to replay this situation with fresh rigs, or return to setup to change the mission and squad.'
			: escape ? 'The escape is paused. Resume when ready. This borrowed rig does not affect your company.'
			: practice ? 'Change loadout to start a fresh run. Reset Range refills your selected ammunition and coolant.'
			: training ? 'Resume the drills or change loadout to practice in the range.'
			: 'Your throttle and mission are preserved. Aborting or reloading returns the squad with its current damage.';
		for (const id of ['title', 'intro', 'rig-bay', 'escape-result', 'bridge', 'starmap', 'mechbay', 'market', 'engineering', 'pilots', 'deploy', 'jump', 'launch', 'pause-panel', 'squad-orders', 'result', 'training-setup', 'training-result', 'situation-setup', 'situation-result', 'field-trial', 'settings', 'handbook', 'confirm', 'save-conflict']) {
			const node = element(id); const visible = navigation.auxiliary ? id === navigation.auxiliary : id === navigation.screen;
			node.hidden = !visible; node.inert = !visible;
		}
		if (navigation.screen !== 'rig-bay') clearRigPreviews();
		const modal = navigation.screen !== 'playing' || Boolean(navigation.auxiliary);
		if (modal) touchZoom.reset();
		container.classList.toggle('training-active', Boolean(training && !practice));
		container.classList.toggle('menu-open', modal); container.dataset['screen'] = navigation.auxiliary ?? navigation.screen;
		if (!ordersWasOpen && !squadOrdersRoot.hidden) squadOrders.open(state);
		else if (ordersWasOpen && squadOrdersRoot.hidden) squadOrders.close();
		if (navigation.screen === 'title') refreshTitleCompany();
		updateMenuHint();
		element('hud').inert = modal; canvas.inert = modal;
		resetInput(); lastHud = 0;
		updateWorkspaceLayout(); updateDialogLayout();
		if (!focus) return;
		const root = menu();
		if (root === squadOrdersRoot) {
			if (!root.contains(document.activeElement)) menuControls(root)[0]?.focus();
			updateMenuHint(); updateDialogLayout();
			return;
		}
		const initial = navigation.auxiliary === 'save-conflict' ? element('reload-company') : navigation.auxiliary === 'settings' ? element('master-volume') : navigation.auxiliary === 'handbook' ? root?.querySelector<HTMLElement>('[data-dialog-tab][aria-pressed="true"]') : navigation.auxiliary === 'confirm' ? element('confirm-cancel') : navigation.screen === 'title' ? titleInitial() : navigation.screen === 'intro' ? element(narrativeWaiting ? 'intro-begin' : 'intro') : navigation.screen === 'escape-result' ? element('escape-retry') : navigation.screen === 'bridge' ? element('bridge') : navigation.screen === 'pause-panel' ? element('resume') : navigation.screen === 'result' ? element('restart') : navigation.screen === 'field-trial' ? element('field-deploy') : navigation.screen === 'training-setup' ? element('training-frame') : navigation.screen === 'training-result' ? element('result-training-loadout') : navigation.screen === 'situation-setup' ? element('situation-mission') : root?.querySelector<HTMLElement>('[aria-current="page"]') ?? root?.querySelector<HTMLElement>('button');
		if (root?.classList.contains('workspace')) focusWorkspace(root);
		else focusMenuControl(initial ?? canvas);
		updateMenuHint(); updateDialogLayout();
	};
	let stopped = false;
	const transition = function (operation: Promise<void>, after: () => void = syncScreen) {
		choicePicker.close(false); pauseLaunchClock();
		screenRevision++; resetInput();
		void operation.then(function () { if (!stopped) after(); }).catch(function (error: unknown) {
			console.error(error); const node = element('error'); node.textContent = 'Could not change screen. Reload to recover.'; node.hidden = false;
		});
	};
	const updateDifficulty = function () {
		for (const input of container.querySelectorAll<HTMLInputElement>('input[data-difficulty]')) input.checked = input.value === profile.settings.difficulty;
	};
	const startLaunch = function () {
		launchElapsed = 0;
		presentation.setLaunchTime(0);
		audio.beginSortie(); transition(navigation.setScreen('launch')); unlockSound();
	};
	const finishLaunch = function () {
		if (navigation.screen !== 'launch' || navigation.transitioning || navigation.auxiliary || campaignConflict || contextLost || document.hidden || !focused) return;
		transition(navigation.setScreen('playing'));
	};
	world.onScreenExit('launch', function () {
		presentation.setLaunchTime(undefined);
		audio.reset();
	});
	const launchLive = function (next: Campaign) {
		if (contextLost || navigation.auxiliary) return;
		if (next === campaign || !next.active || !next.deployed) return;
		const mech = getOwnedMech(next, next.deployed.frameId);
		if (!mech) return;
		const squadmates: SquadmateOptions[] = [];
		for (const member of next.deployed.wing) {
			const rig = getOwnedMech(next, member.frameId);
			const { callsign, specialty } = getPilot(member.pilotId);
			if (!rig || specialty === 'commander') return;
			squadmates.push({ pilotId: member.pilotId, callsign, specialty, frameId: rigFrameId(rig.frameId), loadout: rig.loadout, reserves: rig.reserves, integrity: member.integrity });
		}
		if (!replaceCampaign(next)) return;
		presentation.resetZoom(); training = undefined;
		state = combatRuntime.attach(createMissionState(next.active, { difficulty: profile.settings.difficulty, frame: rigFrameId(mech.frameId), loadout: mech.loadout, reserves: mech.reserves, integrity: mech.integrity, coolantCharges: next.deployed.coolantCharges, squadmates }));
		gaits = createGaits(state); aimMode = defaultAimMode();
		aim = state.mission ? { ...state.mission.map.objective } : { ...state.player };
		pointer = undefined;
		message = squadmates.length ? '' : `${rigName(mech.frameId)} ON SURFACE · ${MISSION_NAMES[next.active.kind].toUpperCase()}`;
		messageUntil = message ? 5 : 0;
		terminalUntil = 0; startLaunch();
	};
	const start = function () {
		if (navigation.screen === 'deploy') launchLive(beginDeployment(campaign));
	};
	const showTrainingSetup = function () {
		if (navigation.transitioning || navigation.auxiliary || campaignConflict) return;
		const screen = navigation.screen;
		if (screen === 'title' || screen === 'bridge' || screen === 'starmap') {
			trainingOrigin = screen;
			if (screen !== 'title') rememberWorkspaceFocus(element(screen));
		}
		resetAudioForMenuEntry(); transition(navigation.setScreen('training-setup'));
	};
	const startTraining = function (setup?: TrainingSetup) {
		if (contextLost) return;
		escape = false;
		presentation.resetZoom();
		training = createTraining(setup); state = combatRuntime.attach(training.state, training); gaits = createGaits(state);
		aimMode = defaultAimMode(); pointer = undefined; aim = { x: state.player.x, y: 450 };
		message = ''; messageUntil = 0; terminalUntil = 0;
		audio.beginSortie(); transition(navigation.setScreen('playing', true)); unlockSound();
	};
	const showSituationSetup = function () {
		if (!situationSim) {
			situationSim = { settings: profile.settings, storageStatus: element('storage-status').textContent ?? '' };
			profile.settings = structuredClone(profile.settings);
			element('storage-status').textContent = 'Preference changes apply only while Situation Sim is open.';
		}
		resetAudioForMenuEntry(); transition(navigation.setScreen('situation-setup'));
	};
	const startSituation = function (replay = false) {
		if (!situationSim || contextLost) return;
		const run = replay && situationSim.run ? situationSim.run : {
			seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0, difficulty: profile.settings.difficulty,
		};
		situationSim.run = run;
		training = undefined; escape = false;
		presentation.resetZoom(); state = combatRuntime.attach(createSituationMission(situationSetup(), run.seed, run.difficulty));
		gaits = createGaits(state); aim = { ...(state.mission?.map.objective ?? state.player) }; pointer = undefined;
		aimMode = defaultAimMode();
		message = ''; messageUntil = 0; terminalUntil = 0;
		startLaunch();
	};
	const showFieldTrial = function (seed: number, outcome: 'playing' | 'won' | 'lost' = 'playing') {
		if (!defensePacing) {
			const url = new URL(location.href);
			url.searchParams.set('field-trial', String(seed)); history.replaceState(history.state, '', url);
		}
		trialSeed = seed;
		transition(navigation.setScreen('field-trial'), function () {
			state = combatRuntime.attach(createFieldTrial(seed, defensePacing));
			if (!state.mission) throw new Error('Missing field trial mission');
			const map = state.mission.map;
			gaits = createGaits(state); presentation.resetZoom();
			pointer = undefined; aim = { ...map.objective };
			aimMode = defaultAimMode();
			audio.reset(); message = ''; messageUntil = 0; terminalUntil = 0;
			const titles = defensePacing ? { playing: 'Long approach', won: 'Relay secured', lost: 'Sortie failed' }
				: { playing: 'Courier recovery', won: 'Recorder extracted', lost: 'Frame disabled' };
			element('field-trial-title').textContent = titles[outcome];
			element('field-trial-kicker').textContent = defensePacing ? 'GALEWARD / DEFENSE TRIAL' : 'CINDER / FIELD TRIAL';
			element('field-trial-objective').textContent = defensePacing ? 'R · Relay' : 'R · Recorder';
			element('field-trial-contacts').hidden = !defensePacing;
			element('field-defense-orders').hidden = !defensePacing;
			element('field-recovery-orders').hidden = defensePacing;
			element('field-generate').hidden = defensePacing;
			element('field-deploy').textContent = outcome === 'playing' ? 'DEPLOY →' : 'REPLAY FIELD →';
			element('field-trial-seed').textContent = `SEED ${seed} · ${(map.width / 1000).toFixed(2)} × ${(map.height / 1000).toFixed(2)} KM`;
			drawFieldSurvey(element('field-survey-map'), map);
			syncScreen();
		});
	};
	const startIntro = function (replay = false) {
		replayingEscape = replay;
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
			aimMode = defaultAimMode(); pointer = undefined;
			aim = state.mission ? { ...state.mission.map.extraction } : { ...state.player };
			message = ''; messageUntil = 0; terminalUntil = 0;
			audio.reset(); syncScreen(); unlockSound();
		});
	};
	const setPaused = function (paused: boolean) {
		if (campaignConflict) return;
		if (paused) silenceAudio();
		if (paused && navigation.screen === 'playing') transition(navigation.pause());
		else if (!paused && navigation.screen === 'pause-panel' && !contextLost) { aimMode = defaultAimMode(); transition(navigation.resume()); unlockSound(); }
	};
	const showAuxiliary = function (value: RuntimeAuxiliary) {
		const root = menu();
		const current = document.activeElement;
		returnFocus = current instanceof HTMLElement && root?.contains(current) ? current : lastMenuTarget;
		transition(navigation.showAuxiliary(value));
	};
	const closeAuxiliary = function () {
		if (campaignConflict) return;
		capture = undefined; renderMappings();
		confirmedAction = undefined;
		transition(navigation.closeAuxiliary(), function () {
			syncScreen(false);
			if (returnFocus && menu()?.contains(returnFocus)) {
				revealWorkspaceElement(returnFocus);
				updateDialogLayout(returnFocus);
			}
			if (returnFocus && menu()?.contains(returnFocus) && !returnFocus.closest('[hidden], [inert]') && !returnFocus.matches(':disabled')) focusMenuControl(returnFocus);
			else syncScreen();
		});
	};
	const openSquadOrders = function () {
		if (navigation.auxiliary || campaignConflict || contextLost || !canIssueSquadOrders()) return;
		returnFocus = element('pause-squad-orders');
		silenceAudio();
		transition(navigation.openSquadOrders());
	};
	const backFromSquadOrders = function () {
		if (navigation.auxiliary === 'squad-orders' && !navigation.transitioning && !squadOrders.cancelPick()) closeAuxiliary();
	};
	const confirm = function (action: () => void, label: string, copy = 'The current operation will be lost. Your recorded results and settings will be kept.', title = 'ABANDON THIS RUN?') {
		element('confirm-cancel').textContent = isShipScreen(navigation.screen) ? 'KEEP BROWSING' : 'CANCEL';
		confirmedAction = action; element('confirm-action').textContent = label; element('confirm-copy').textContent = copy; element('confirm-title').textContent = title; showAuxiliary('confirm');
	};
	const stopForConflict = function () {
		campaignConflict = true; silenceAudio(); padInput.suspend(); transition(navigation.showAuxiliary('save-conflict'));
	};
	const persistCampaign = function (): boolean {
		if (situationSim) return false;
		if (sessionOnly) return true;
		if (campaignConflict) return false;
		const current = savedSnapshot();
		if (current !== undefined && campaignSnapshot !== undefined && current !== campaignSnapshot) { stopForConflict(); return false; }
		campaignSaved = saveCampaign(campaign);
		if (campaignSaved) campaignSnapshot = JSON.stringify(campaign);
		return true;
	};
	const checkpoint = function () {
		if (campaignConflict || situationSim || trialSeed !== undefined || training || escape || !state.mission || !campaign.deployed) return;
		const next = checkpointDeployment(campaign, state.player.hp, state.coolantCharges, state.squadmates.flatMap(function (mate) {
			const rig = campaign.deployed?.wing.find(function (member) { return member.pilotId === mate.pilotId; });
			return rig ? [{ frameId: rig.frameId, hp: mate.hp }] : [];
		}));
		if (next !== campaign) { if (!replaceCampaign(next)) return; }
	};
	const resetEditor = function (notice = '') {
		editor = { loadout: [...(getOwnedMech(campaign)?.loadout ?? [])], reserves: [...(getOwnedMech(campaign)?.reserves ?? [])], slot: null, notice };
	};
	const replaceCampaign = function (next: Campaign): boolean {
		if (situationSim || replayingEscape) return false;
		const current = getOwnedMech(campaign); const upcoming = getOwnedMech(next);
		const installedChanged = current?.frameId !== upcoming?.frameId || current?.loadout.some(function (weapon, index) { return weapon !== upcoming?.loadout[index]; }) || current?.reserves.some(function (rounds, index) { return rounds !== upcoming?.reserves[index]; });
		campaign = next;
		if (installedChanged) resetEditor();
		const persisted = persistCampaign();
		if (persisted) {
			returningCompany = true;
			if (navigation.screen === 'title') refreshTitleCompany();
		}
		return persisted;
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
	const openOperations = function () {
		destination = campaign.planetId;
		navigateShip('bridge', 'operations');
	};
	const removeStagedOperation = function (id: string) {
		const operation = getPlannedOperation(campaign, id);
		if (!operation) return;
		confirm(function () {
			const next = removeOperation(campaign, id);
			if (next === campaign || !replaceCampaign(next)) return;
			editedOperation = undefined;
			openOperations();
		}, 'REMOVE FROM DAY', `${operation.contract.title} returns to the board and its pilots and rigs become available.`, 'REMOVE STAGED CONTRACT?');
	};
	const refreshCompany = function () {
		if (!isShipScreen(navigation.screen) || navigation.screen === 'bridge' || navigation.screen === 'starmap') return;
		const root = element(navigation.screen); const previousFocus = document.activeElement;
		const focusIndex = menuControls(root).findIndex(function (item) { return item === previousFocus; });
		const operation = getPlannedOperation(campaign, editedOperation) ?? campaign.operations?.[0];
		const lineup = operation?.lineup ?? campaign.preferredLineup ?? campaign.lineup;
		renderCompany(root, campaign, navigation.screen, editor, campaignSaved, {
			picker: choicePicker,
			skin: profile.settings.mechSkin,
			operation, openOperations,
			removeOperation: function () { if (operation) removeStagedOperation(operation.contract.id); },
			selectSkin: function (skin, focusFaction) {
				if (campaign.deployed) return;
				profile.settings.mechSkin = skin;
				presentation.setSkin(skin);
				save();
				refreshCompany();
				focusCompany(focusFaction ? `[data-livery-faction="${focusFaction}"]` : `[data-mech-skin="${skin}"]`);
			},
			navigate: navigateShip,
			selectFrame: function (id) { const select = function () { updateCompany(selectFrame(campaign, id), 'Rig selected.'); }; if (hasRefitDraft() && id !== campaign.selectedFrame) confirm(select, 'DISCARD & SELECT RIG', 'Changing rigs discards this unqueued refit. Installed equipment is unchanged.', 'DISCARD REFIT DRAFT?'); else select(); },
			editSlot: function (slot) {
				if (!getHardpoints(rigFrameId(campaign.selectedFrame))[slot]) return;
				editor = { ...editor, slot }; refreshCompany(); focusCompany('.equipment-choice[aria-pressed="true"]:not(:disabled)', '.equipment-choice:not(:disabled)');
			},
			setWeapon: function (weapon) {
				if (editor.slot === null || !getHardpoints(rigFrameId(campaign.selectedFrame))[editor.slot]) return;
				const slot = editor.slot;
				if (weapon !== null && !canEquipWeapon(rigFrameId(campaign.selectedFrame), slot, weapon)) {
					editor = { ...editor, notice: 'This weapon does not fit the selected hardpoint.' }; refreshCompany(); return;
				}
				editor = { ...editor, reserves: editor.reserves.map(function (rounds, index) { return index !== slot || editor.loadout[slot] === weapon ? rounds : weapon === null ? 0 : getWeapon(weapon).ammunition?.defaultLoad ?? 0; }), loadout: editor.loadout.map(function (current, index) { return index === slot ? weapon : current; }), slot: null, notice: 'Refit staged. Queue the work order to fit these weapons.' }; refreshCompany();
				focusCompany(`[data-loadout-slot="${slot}"]`);
			},
			closePicker: function () { const slot = editor.slot; editor = { ...editor, slot: null }; refreshCompany(); focusCompany(`[data-loadout-slot="${slot}"]`, '[data-loadout-slot]'); },
			discardRefit: discardDraft,
			setReserve: function (slot, rounds) {
				const weapon = editor.loadout[slot];
				if (!weapon || !isReserve(weapon, rounds) || campaign.deployed) return;
				const focused = document.activeElement;
				const choice = focused instanceof HTMLElement ? focused.dataset['ammoChoice'] : undefined;
				editor = { ...editor, reserves: editor.reserves.map(function (current, index) { return index === slot ? rounds : current; }), notice: 'Ammunition staged. Apply the draft before deployment.' };
				refreshCompany();
				focusCompany(`[data-ammo-choice="${choice ?? ''}"]:not(:disabled)`, `[data-ammunition-slot="${slot}"] button:not(:disabled)`);
			},
			queueRefit: function () {
				const days = refitDays(getOwnedMech(campaign)?.loadout ?? [], editor.loadout);
				if (days === 0) { updateCompany(queueRefit(campaign, campaign.selectedFrame, editor.loadout, editor.reserves), 'Ammunition load saved. 0 CR · no calendar time.', undefined, true); return; }
				confirm(function () { updateCompany(queueRefit(campaign, campaign.selectedFrame, editor.loadout, editor.reserves), 'Refit queued. Advance the calendar to finish installation.', 'engineering', true); }, 'QUEUE REFIT', `${days} calendar days. Ready day ${campaign.day + days}. ${loadSummary(rigFrameId(campaign.selectedFrame), editor.loadout, editor.reserves)} The frame cannot deploy until work finishes.`, 'QUEUE THIS REFIT?');
			},
			buyFrame: function (id) { confirm(function () { updateCompany(buyFrame(campaign, id), `${rigName(id)} purchased with its displayed weapon package. Select it in the Mech Bay.`); }, 'BUY RIG', `${getFrameOffer(campaign, id).price.toLocaleString()} CR. Includes this complete package: ${getFrameOffer(campaign, id).loadout.map(function (weapon) { return getWeapon(weapon).name; }).join(', ')}. Standard ammunition included; arrives ready to deploy.`, `BUY ${rigName(id)}?`); },
			buyWeapon: function (id) { confirm(function () { updateCompany(buyWeapon(campaign, id), `${getWeapon(id).name} purchased. Fit it in the Mech Bay.`); }, 'BUY WEAPON', `${WEAPON_PRICES[id].toLocaleString()} CR. Delivered to stores. Installation requires a separate refit.`, `BUY ${getWeapon(id).name}?`); },
			repair: function (id) { const days = repairDays(getOwnedMech(campaign, id)?.integrity ?? 100); confirm(function () { updateCompany(queueRepair(campaign, id), 'Repair queued. The mech remains unavailable until its completion day.', 'engineering'); }, 'SCHEDULE REPAIR', `${days} calendar days · 0 CR. Ready day ${campaign.day + days}. The frame cannot deploy during repairs.`, `REPAIR ${rigName(id)}?`); },
			cancelWork: function (id) { confirm(function () { updateCompany(cancelWorkOrder(campaign, id), 'Work order cancelled. Original equipment and condition retained.'); }, 'CANCEL WORK ORDER', 'Installed weapons and current integrity are retained. Reserved equipment returns to stores; elapsed calendar time remains spent.', `CANCEL ${rigName(id)} WORK?`); },
			advanceDays: function (days) { confirm(function () { updateCompany(advanceDays(campaign, days), `${days} calendar ${days === 1 ? 'day' : 'days'} elapsed. Due work orders are complete.`); }, `ADVANCE ${days} ${days === 1 ? 'DAY' : 'DAYS'}`, `Move from day ${campaign.day} to day ${campaign.day + days}. All work orders progress. No credit fee; contract postings remain unchanged.`, 'ADVANCE SHIP CALENDAR?'); },
			hire: function (id) {
				const pilot = getPilot(id);
				confirm(function () { updateCompany(hirePilot(campaign, id), `${pilot.callsign} joined the roster.`); }, 'HIRE PILOT', `${pilot.name} · ${pilot.price.toLocaleString()} CR one-time fee. Assign a rig on the Deploy screen.`, `HIRE ${pilot.callsign.toUpperCase()}?`);
			},
			dismiss: function (id) {
				const pilot = getPilot(id);
				confirm(function () { updateCompany(dismissPilot(campaign, id), `${pilot.callsign} left the roster.`); }, 'DISMISS PILOT', `${pilot.callsign} leaves the company and frees their rig assignment. The hiring fee is spent.`, `DISMISS ${pilot.callsign.toUpperCase()}?`);
			},
			assignPilot: function (slot, id) {
				const assignment = { pilotId: id, frameId: id ? lineup[slot]?.frameId ?? null : null };
				const next = campaign.active ? assignPilot(campaign, slot, id) : assignOperationSlot(campaign, operation?.contract.id, slot, assignment);
				updateCompany(next, id ? `${getPilot(id).callsign} assigned.` : 'Squad slot cleared.');
			},
			assignRig: function (slot, id) {
				const next = campaign.active ? assignRig(campaign, slot, id) : assignOperationSlot(campaign, operation?.contract.id, slot, { pilotId: lineup[slot]?.pilotId ?? null, frameId: id });
				updateCompany(next, id ? `${rigName(id)} assigned.` : 'Rig assignment cleared.');
			},
			assignLead: function (id) {
				if (operation) updateCompany(assignOperationLead(campaign, operation.contract.id, id), `${getPilot(id).callsign} will lead this sortie.`);
			},
			deploy: function () {
				if (!canDeploySquad(campaign)) return;
				if (hasRefitDraft() && campaign.lineup.some(function (slot) { return slot.frameId === campaign.selectedFrame; })) {
					confirm(function () { navigateShip('mechbay', 'loadout'); }, 'OPEN MECH BAY', 'Queue or discard the staged loadout before deploying that rig.', 'REFIT DRAFT PENDING'); return;
				}
				const squad = campaign.lineup.flatMap(function (slot) { return slot.pilotId && slot.frameId ? [`${getPilot(slot.pilotId).callsign} / ${rigName(slot.frameId)}`] : []; });
				confirm(start, 'DEPLOY SQUAD', `${squad.join(' · ')}. Rigs load their selected ammunition and retain damage after the sortie.`, 'DEPLOY ON THIS CONTRACT?');
			},
			settings: function () { showAuxiliary('settings'); },
			handbook: function () { showAuxiliary('handbook'); },
		});
		if (focusIndex >= 0 && (!(previousFocus instanceof HTMLElement) || !previousFocus.isConnected || previousFocus.matches(':disabled'))) {
			const items = menuControls(root); items[Math.min(focusIndex, items.length - 1)]?.focus({ preventScroll: true });
		}
	};
	const refreshCampaign = function () {
		const actions: BridgeActions = {
			picker: choicePicker,
			navigate: navigateShip,
			openBoard: function () { destination = campaign.planetId; navigateShip('bridge', 'board'); },
			editOperation: function (id) { editedOperation = id; navigateShip('deploy', 'squad'); },
			commitDay: function () {
				if (contextLost || navigation.screen !== 'bridge' || navigation.auxiliary) return;
				const { entries, issues } = reviewOperations(campaign);
				if (!entries.length || issues.length) return;
				if (hasRefitDraft() && entries.some(function (entry) { return entry.operation.lineup.some(function (seat) { return seat.frameId === campaign.selectedFrame; }); })) {
					confirm(function () { navigateShip('mechbay', 'loadout'); }, 'OPEN MECH BAY', 'Queue or discard the staged loadout before deploying that rig.', 'REFIT DRAFT PENDING'); return;
				}
				const live = entries.find(function (entry) { return entry.live; })?.operation.contract;
				const stakes = entries.map(function ({ operation: { contract } }) { return `${getFaction(contract.opponent).name} −${contract.hostility}`; }).join(' · ');
				const orders = live ? `Play ${live.title}. The shared debrief follows after the sortie.` : 'The commander stays aboard. Crew results appear in the shared debrief.';
				confirm(function () {
					if (contextLost) return;
					const next = commitOperations(campaign);
					if (next === campaign) return;
					editedOperation = undefined;
					if (next.deployed) launchLive(next);
					else if (replaceCampaign(next) && next.lastOperationDay) showDayDebrief(next.lastOperationDay, performance.now());
				}, live ? 'COMMIT & PLAY' : 'COMMIT & ADVANCE', `${orders} Advance to day ${campaign.day + 1}. Opposition standing on commitment. ${stakes}.`, `COMMIT DAY ${campaign.day}?`);
			},
			openLastReport: function () { if (campaign.lastOperationDay) showDayDebrief(campaign.lastOperationDay, performance.now()); },
			selectPlanet: function (id) {
				if (campaign.active) return;
				if (id !== destination) guidedCourse = undefined;
				destination = id; selectedContract = undefined;
				refreshCampaign();
			},
			previewContract: function (id) { selectedContract = id; },
			selectContract: function (id, origin, opener) {
				if (getTransmission(campaign)?.offers.some(function (step) { return step.contract.id === id; })) destination = campaign.planetId;
				selectedContract = id;
				briefingOrigin = origin;
				refreshCampaign();
				const bridge = element('bridge');
				inspectWorkspacePane(bridge, 'briefing', opener);
			},
			plotStoryCourse: function (planet) {
				if (campaign.active) return;
				guidedCourse = planet;
				destination = planet; selectedContract = undefined;
				navigateShip('starmap', 'route', true);
			},
			travel: function () {
				if (navigation.screen !== 'starmap' || navigation.auxiliary || contextLost) return;
				const target = destination;
				const transmission = guidedCourse === target;
				// The plotted course is consumed by this confirmation, even if cancelled.
				guidedCourse = undefined;
				confirm(function () {
					const origin = getPlanet(campaign.planetId); const next = travelTo(campaign, target); if (next === campaign) return;
					if (!replaceCampaign(next)) return;
					element('jump-destination').textContent = getPlanet(campaign.planetId).name.toUpperCase();
					element('jump-copy').textContent = `${origin.name} → ${getPlanet(campaign.planetId).name} · DAY ${campaign.day} · APPROACHING ORBIT`;
					jumpArrival = { until: performance.now() + 2200, transmission };
					transition(navigation.setScreen('jump'), function () { syncScreen(); element('jump').focus({ preventScroll: true }); });
				}, 'CONFIRM JUMP', `One calendar day · 0 CR. Arrive at ${getPlanet(target).name} on day ${campaign.day + 1}. Work orders progress and contract postings change.`, 'CONFIRM TRANSIT?');
			},
			stage: function (contract) {
				if (navigation.screen !== 'bridge' || navigation.auxiliary || destination !== campaign.planetId) return;
				const next = stageOperation(campaign, contract.id);
				if (next === campaign || !replaceCampaign(next)) return;
				editedOperation = contract.id;
				navigateShip('deploy', 'squad');
			},
			deploy: function () { navigateShip('deploy', 'squad'); },
			abandon: function () { confirm(abortSortie, 'ABORT & RETURN TO SHIP', 'No payment, employer favor, or company reputation will be earned. The opposition reputation penalty from acceptance remains, and the opposition gains local influence.', 'ABORT THIS CONTRACT?'); },
			training: showTrainingSetup,
			title: back,
			settings: function () { showAuxiliary('settings'); },
			handbook: function () { showAuxiliary('handbook'); },
		};
		renderBridge(element('bridge'), campaign, destination, selectedContract, campaignSaved, actions, briefingOrigin);
		renderStarmap(element('starmap'), campaign, destination, campaignSaved, actions);
	};
	const navigateShip = function (target: ShipScreen, view?: ShipView, focusRoute = false, reveal?: string) {
		if (campaignConflict || navigation.auxiliary || navigation.transitioning || editor.slot !== null) return;
		if (target !== 'starmap') guidedCourse = undefined;
		if (isShipScreen(navigation.screen)) rememberWorkspaceFocus(element(navigation.screen));
		training = undefined; escape = false; state = combatRuntime.attach(createState({ difficulty: profile.settings.difficulty })); gaits = createGaits(state);
		editor = { ...editor, slot: null };
		pointer = undefined; presentation.resetZoom(); resetAudioForMenuEntry();
		transition(navigation.setScreen(target), function () {
			if (target === 'bridge' || target === 'starmap') refreshCampaign();
			else refreshCompany();
			syncScreen();
			const root = element(target);
			if (view) selectWorkspacePane(root, view, view === 'transmission' || view === 'loadout' || view === 'operations');
			if (view === 'transmission') root.querySelector<HTMLElement>('[data-pane="transmission"] .pane-actions button')?.focus({ preventScroll: true });
			const action = reveal ? root.querySelector<HTMLElement>(reveal) : undefined;
			if (action) { revealWorkspaceElement(action); action.focus({ preventScroll: true }); }
			if (focusRoute) {
				focusTerritoryMap(root, destination);
				if (destination !== campaign.planetId) {
					root.querySelector<HTMLButtonElement>(`[data-system="${destination}"]`)?.click();
					root.querySelector<HTMLElement>('.planet-popover:popover-open .planet-actions .primary')?.focus({ preventScroll: true });
				}
			}
		});
	};
	const toShip = function () { guidedCourse = undefined; destination = campaign.planetId; selectedContract = undefined; navigateShip('starmap', 'route', true); };
	const toTransmission = function () { destination = campaign.planetId; selectedContract = undefined; navigateShip('bridge', 'transmission'); };
	const toTitle = function (focusId?: 'title-training' | 'title-situation' | 'title-intro') {
		guidedCourse = undefined;
		replayingEscape = false;
		training = undefined; escape = false; state = combatRuntime.attach(createState({ difficulty: profile.settings.difficulty })); gaits = createGaits(state); resetAudioForMenuEntry();
		transition(navigation.setScreen('title'), function () {
			setTitleGroup(focusId ? 'simulator' : undefined);
			syncScreen(!focusId);
			if (focusId) element(focusId).focus();
		});
	};
	const leaveEscape = function () { toTitle(replayingEscape ? 'title-intro' : undefined); };
	const leaveTraining = function () { if (trainingOrigin === 'title') toTitle('title-training'); else navigateShip(trainingOrigin); };
	const leaveSituation = function () {
		if (!situationSim) return;
		profile.settings = situationSim.settings;
		element('storage-status').textContent = situationSim.storageStatus;
		situationSim = undefined;
		updateSettings(); updateDifficulty(); renderMappings(); syncControllerMappings();
		const current = savedSnapshot();
		if (!sessionOnly && current !== undefined && campaignSnapshot !== undefined && current !== campaignSnapshot) { stopForConflict(); return; }
		toTitle('title-situation');
	};
	const back = function () {
		if (navigation.transitioning || choicePicker.close()) return;
		if (capture) { cancelKeyCapture(); return; }
		if (navigation.auxiliary === 'squad-orders') { backFromSquadOrders(); return; }
		if (navigation.auxiliary) { closeAuxiliary(); return; }
		if (navigation.screen === 'title' && titleGroup) {
			const opener = element(`title-${titleGroup}`);
			setTitleGroup(undefined);
			opener.focus();
			return;
		}
		if (navigation.screen === 'launch') { finishLaunch(); return; }
		const planetPopover = element('starmap').querySelector<HTMLElement>('.planet-popover:popover-open');
		if (navigation.screen === 'starmap' && planetPopover) {
			planetPopover.hidePopover();
			element('starmap').querySelector<HTMLElement>('.system-marker[aria-pressed="true"]')?.focus({ preventScroll: true });
			return;
		}
		if (navigation.screen === 'intro' || navigation.screen === 'rig-bay' || navigation.screen === 'escape-result') { confirm(leaveEscape, 'RETURN TO TITLE', 'The escape will restart from the beginning when you return. Company progress is untouched.', 'LEAVE THE ESCAPE?'); return; }
		if (navigation.screen === 'mechbay' && editor.slot !== null) { const slot = editor.slot; editor = { ...editor, slot: null }; refreshCompany(); focusCompany(`[data-loadout-slot="${slot}"]`); return; }
		const closeAssignment = assignmentBack();
		if (closeAssignment) { closeAssignment.click(); return; }
		if (navigation.screen === 'training-setup' || navigation.screen === 'training-result') { leaveTraining(); return; }
		if (navigation.screen === 'situation-setup') { leaveSituation(); return; }
		if (navigation.screen === 'situation-result') { showSituationSetup(); return; }
		const detailBack = companyOpen() && workspaceBackTarget(element(navigation.screen));
		if (detailBack) { detailBack(); return; }
		if (isShipScreen(navigation.screen)) { confirm(toTitle, 'RETURN TO TITLE', hasRefitDraft() ? 'Company progress is saved. Your unqueued refit draft is kept while this session remains open.' : 'Company progress is saved on this device.', 'RETURN TO TITLE?'); return; }
		setPaused(navigation.screen === 'playing');
	};
	const listen = function (id: string, callback: () => void) { element(id).addEventListener('click', function () { if (!navigation.transitioning) callback(); }, listenerOptions); };
	for (const group of ['company', 'simulator'] as const) {
		listen(`title-${group}`, function () {
			setTitleGroup(group);
			titleInitial().focus();
		});
	}
	listen('title-picker-back', back);
	listen('title-continue', function () {
		if (!returningCompany) startCompany(false);
		else if (!campaign.introComplete) startIntro();
		else if (campaign.deployed) {
			// Recover an interrupted company sortie when the player resumes it.
			const recovered = recoverInterruptedDeployment(campaign);
			if (recovered.lastResult && replaceCampaign(recovered)) {
				if (recovered.lastOperationDay) showDayDebrief(recovered.lastOperationDay, performance.now());
				else showDebrief(recovered.lastResult, performance.now());
			}
		}
		else if (campaign.active) navigateShip('deploy');
		else if (campaign.operations?.length) openOperations();
		else if (getTransmission(campaign)?.offers.length) toTransmission();
		else toShip();
	});
	const startCompany = function (career: boolean) {
		const start = function () {
			if (!replaceCampaign(createCampaign(undefined, career ? 'career' : 'campaign'))) return;
			destination = campaign.planetId; selectedContract = undefined;
			resetEditor();
			if (career) toShip(); else startIntro();
		};
		if (!returningCompany) { start(); return; }
		const mode = career ? 'CAREER' : 'CAMPAIGN';
		confirm(start, `START NEW ${mode}`, 'This replaces your current company on this device, including its contracts, rigs, credits, reputation, and progress. This cannot be undone. Your settings are kept.', `START A NEW ${mode}?`);
	};
	listen('title-new-campaign', function () { startCompany(false); });
	listen('title-new-career', function () { startCompany(true); });
	listen('title-direct-career', function () { startCompany(true); });
	listen('title-situation', showSituationSetup);
	listen('situation-launch', function () { startSituation(); });
	listen('situation-back', leaveSituation);
	listen('situation-replay', function () { startSituation(true); });
	listen('situation-edit', showSituationSetup);
	listen('situation-exit', leaveSituation);
	listen('title-training', showTrainingSetup);
	listen('training-launch', function () { startTraining(trainingSetup()); });
	listen('training-guided', function () { startTraining(); });
	listen('training-back', leaveTraining);
	listen('field-deploy', function () { if (trialSeed !== undefined && !contextLost) startLaunch(); });
	listen('skip-launch', finishLaunch);
	listen('field-generate', function () { if (!defensePacing && trialSeed !== undefined) showFieldTrial((trialSeed + 0x9e3779b9) >>> 0); });
	listen('pause-training-loadout', showTrainingSetup);
	listen('result-training-loadout', showTrainingSetup);
	listen('title-intro', function () { startIntro(true); });
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
	listen('training-deploy', function () { if (campaign.active || campaign.operations?.length) navigateShip('deploy'); });
	listen('training-briefing', leaveTraining);
	listen('restart', function () {
		const contract = campaign.lastResult?.contract;
		if (contract && getAuthoredStep(campaign.story, contract)) toTransmission();
		else if (campaign.lastOperationDay) openOperations();
		else toShip();
	});
	listen('toggle-radar', function () { toggleRadar(); canvas.focus({ preventScroll: true }); });
	listen('pause-radar', function () { if (toggleRadar()) setPaused(false); });
	listen('resume', function () { setPaused(false); });
	listen('pause', function () { setPaused(true); });
	listen('open-squad-orders', openSquadOrders);
	listen('pause-squad-orders', openSquadOrders);
	listen('reset', function () {
		if (situationSim) confirm(function () { startSituation(true); }, 'RESTART SIMULATION', 'Start this situation again with fresh rigs and the same terrain.', 'RESTART THIS SIMULATION?');
		else if (escape) confirm(startEscape, 'RESTART ESCAPE');
		else if (training?.stage === 'range') startTraining(trainingSetup());
		else if (training) confirm(startTraining, 'RESTART DRILLS');
	});
	listen('leave', function () {
		if (situationSim) confirm(showSituationSetup, 'RETURN TO SIM SETUP', 'The current run ends. Your mission and squad selections are kept for the next deployment.', 'LEAVE THIS SIMULATION?');
		else if (trialSeed !== undefined) showFieldTrial(trialSeed);
		else if (escape) confirm(leaveEscape, 'RETURN TO TITLE', 'The escape can be restarted from the title screen. Company progress is untouched.', 'LEAVE THE ESCAPE?');
		else if (state.mission && !training) confirm(abortSortie, 'ABORT & RETURN TO SHIP', `The squad returns with its current damage. The aborted mission earns no payment or favor. The day advances once.${campaign.committedCrew?.length ? ' Other crews finish their contracts.' : ''}`, 'ABORT THIS CONTRACT?');
		else confirm(leaveTraining, trainingOrigin === 'title' ? 'RETURN TO TITLE' : 'RETURN TO SHIP', 'Leave the simulator? Company progress is untouched.', 'LEAVE TRAINING?');
	});
	listen('result-company', function () {
		const reports = campaign.lastOperationDay ?? (campaign.lastResult ? [campaign.lastResult] : []);
		if (reports.some(function (result) { return result.squad?.some(function (member) { return member.integrity < 100; }); })) navigateShip('engineering', 'condition');
		else navigateShip('mechbay', 'loadout');
	});
	listen('result-starmap', toShip);
	listen('confirm-action', function () {
		const action = confirmedAction; confirmedAction = undefined;
		transition(navigation.closeAuxiliary(), function () { syncScreen(false); action?.(); if (!navigation.transitioning) { const root = menu(); if (root?.classList.contains('workspace')) focusWorkspace(root); updateMenuHint(); } });
	});
	listen('confirm-cancel', closeAuxiliary);
	listen('reload-company', function () { window.location.reload(); });
	window.addEventListener('storage', function (event) {
		if (sessionOnly || situationSim) return;
		if ((event.key === CAMPAIGN_STORAGE_KEY || event.key === null) && savedSnapshot() !== campaignSnapshot) stopForConflict();
	}, listenerOptions);
	for (const id of ['pause-settings']) listen(id, function () { showAuxiliary('settings'); });
	for (const id of ['pause-controls']) listen(id, function () { showAuxiliary('handbook'); });
	const renderMappings = function () {
		const root = element('keyboard-mappings'); const focusedAction = root.querySelector('button:focus')?.getAttribute('data-action'); root.replaceChildren();
		for (const action of ACTIONS) {
			const button = document.createElement('button'); button.className = 'secondary'; button.type = 'button';
			button.dataset['action'] = action;
			const arcadeLabels: Partial<Record<Action, string>> = { forward: 'Move up', back: 'Move down', left: 'Move left', right: 'Move right' };
			button.textContent = `${profile.settings.legControls === 'arcade' ? arcadeLabels[action] ?? LABELS[action] : LABELS[action]}: ${capture === action ? 'PRESS KEY / MOUSE · ESC CANCEL' : profile.settings.keyboard[action].map(keyLabel).join(' / ') || 'Unbound'}`;
			button.addEventListener('click', function () { capture = action; renderMappings(); }); root.append(button); if (capture === action || focusedAction === action) button.focus();
		}
	};
	const cancelKeyCapture = function () {
		if (!capture) return;
		capture = undefined; renderMappings(); updateMenuHint();
	};
	element('settings').addEventListener('focusin', function (event) {
		if (event.target instanceof HTMLElement && event.target.dataset['action'] !== capture) cancelKeyCapture();
	}, listenerOptions);
	const assignKey = function (code: string) {
		if (!capture) return;
		for (const action of ACTIONS) profile.settings.keyboard[action] = profile.settings.keyboard[action].filter(function (key) { return key !== code; });
		profile.settings.keyboard[capture] = [code]; capture = undefined; resetInput(); save(); renderMappings();
	};
	element('keyboard-mappings').addEventListener('mousedown', function (event) {
		const row = event.target instanceof Element ? event.target.closest<HTMLElement>('button[data-action]') : null;
		if (!capture || row?.dataset['action'] !== capture || navigation.auxiliary !== 'settings') return;
		event.preventDefault(); event.stopPropagation(); consumedMouseButtons.add(event.button); assignKey(`Mouse${event.button}`);
	}, listenerOptions);
	const controllerActions = ['target-nearest', 'target-next', 'stop', 'coolant', 'mount-0', 'mount-1', 'mount-2', 'mount-3'] as const;
	const assignableButtons = Array.from({ length: 17 }, function (_, index) { return index + 1; }).filter(function (index) { return index !== 9; });
	const renderControllerMappings = function () {
		render(controllerActions.map(function (action) {
			const options = assignableButtons.map(function (index) {
				const assigned = controllerActions.filter(function (other) { return other !== action && profile.settings.controller[other] === index; });
				return { value: index, label: controllerButtonLabel(controllerFamily, index), detail: assigned.length ? `Swap with ${assigned.map(function (other) { return LABELS[other]; }).join(', ')}` : '' };
			});
			return choicePicker.field(`mapping-${action}`, LABELS[action], profile.settings.controller[action], options, function (next) {
				const previous = profile.settings.controller[action];
				for (const other of controllerActions) {
					if (other !== action && profile.settings.controller[other] === next) profile.settings.controller[other] = previous;
				}
				profile.settings.controller[action] = next;
				resetInput(); save(); syncControllerMappings();
			});
		}), element('controller-mappings'));
	};
	const syncControllerMappings = function () { renderControllerMappings(); updateMenuHint(); };
	const applyControlSettings = function () {
		capture = undefined; resetInput(); aimMode = defaultAimMode(); save(); renderMappings(); updateSettings();
	};
	listen('leg-controls', function () {
		profile.settings.legControls = profile.settings.legControls === 'arcade' ? 'tank' : 'arcade';
		applyControlSettings();
	});
	listen('torso-aim', function () {
		profile.settings.torsoAim = profile.settings.torsoAim === 'point' ? 'rotate' : 'point';
		applyControlSettings();
	});
	listen('reset-keyboard', function () { capture = undefined; profile.settings.keyboard = defaultKeyboard(); resetInput(); save(); renderMappings(); });
	listen('reset-controller', function () { profile.settings.controller = defaultController(); resetInput(); save(); syncControllerMappings(); });
	renderMappings();
	for (const tab of element('settings').querySelectorAll('[data-dialog-tab]')) tab.addEventListener('click', function () { capture = undefined; renderMappings(); }, listenerOptions);
	listen('close-settings', function () { capture = undefined; renderMappings(); closeAuxiliary(); }); listen('close-handbook', closeAuxiliary);
	listen('sound', function () {
		if (audio.status() !== 'running') { muted = false; audio.setMuted(false); unlockSound(); }
		else { muted = !muted; audio.setMuted(muted); }
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
	window.addEventListener('resize', function () { if (inputMode === 'touch') resetInput(); if (navigation.screen === 'bridge') refreshCampaign(); else if (navigation.screen === 'market') refreshCompany(); }, listenerOptions);
	const rigReport = function (member: DeployedPilot, earnedWin: boolean) {
		const condition = member.integrity <= 0 ? 'disabled' : member.integrity < 100 ? 'damaged' : 'intact';
		const integrity = `${Math.ceil(member.startingIntegrity)}% → ${Math.ceil(member.integrity)}%`;
		const repair = condition !== 'intact' && (getOwnedMech(campaign, member.frameId)?.integrity ?? 100) < 100 && !workOrderFor(campaign, member.frameId);
		return html`<article class="sortie-rig" data-condition=${condition}>
			<div><strong>${getPilot(member.pilotId).callsign}</strong><small>${rigName(member.frameId)} · ${condition === 'disabled' ? 'DISABLED / RECOVERED' : 'RETURNED'}</small>${earnedWin && member.pilotId !== 'player' ? html`<small>+1 successful sortie</small>` : ''}</div>
			<output>${integrity}</output>${repair ? html`<button class="secondary" @click=${function () { navigateShip('engineering', 'condition', false, `[data-repair-frame="${member.frameId}"]`); }}>REPAIR →</button>` : ''}
		</article>`;
	};
	const reportContent = function (content: ReturnType<typeof html> | null) {
		const anchor = element('result-operations');
		if (anchor.parentElement) render(content, anchor.parentElement, { renderBefore: anchor });
	};
	const saveReportCopy = function () {
		element('record-feedback').textContent = campaignSaved ? 'CAMPAIGN SAVED ON THIS DEVICE' : 'STORAGE UNAVAILABLE · CAMPAIGN CONTINUES FOR THIS SESSION';
	};
	const fieldLeadReport = function ({ fieldLead, won }: CampaignResult) {
		if (!fieldLead) return '';
		const name = getPilot(fieldLead.pilotId).callsign;
		const fee = `${fieldLead.fee.toLocaleString()} CR`;
		const payment = !won ? 'no fee earned' : fieldLead.pilotId === 'player' ? `${fee} fee included in company pay` : `${fee} personal fee paid`;
		return html`<p class="day-report-checks" data-field-lead-report data-dialog-text>Field lead ${name} · ${payment}</p>`;
	};
	const showDayDebrief = function (results: readonly CampaignResult[], now: number, fieldReport?: ReturnType<typeof getOperationReport>) {
		const first = results[0];
		if (!first) return;
		const step = getAuthoredStep(campaign.story, first.contract);
		const won = results.filter(function (mission) { return mission.won; }).length;
		const payment = results.reduce(function (total, mission) { return total + mission.payout; }, 0);
		const reputation = results.reduce(function (total, mission) { return total + mission.companyReputation; }, 0);
		const damage = results.some(function (mission) { return mission.squad?.some(function (member) { return member.integrity < 100; }); });
		terminalUntil = now + 1600;
		element('result-title').textContent = `DAY ${first.day} DEBRIEF`;
		element('result-story').hidden = !step;
		element('result-story').textContent = step ? first.won ? step.success : `${step.contact} is holding the job for you. Retry from the Bridge when ready.` : '';
		element('result-copy').textContent = `${won} of ${results.length} contracts completed. All pilots recovered.`;
		element('result-difficulty').textContent = '';
		element('result-score').textContent = `${payment.toLocaleString()} CR`;
		element('result-rank').textContent = `${won}/${results.length}`;
		const heading = element('result-score').previousElementSibling; if (heading) heading.textContent = 'TOTAL COMPANY PAY';
		element('result-stats').hidden = true;
		element('result-stats').replaceChildren();
		reportContent(html`${results.map(function (mission) {
			const { contract, crew, squad } = mission;
			const rollText = function (check: NonNullable<CampaignResult['crew']>['objective']) { return `${check.passed ? 'passed' : 'failed'} · rolled ${check.roll} / needed ${check.chance} or less`; };
			return html`<article class="day-report-line" data-operation-result=${contract.id} data-outcome=${mission.won ? 'won' : 'lost'}>
				<div><span class="eyebrow">${crew ? 'Crew only' : 'Player-led'} · ${getPlanet(contract.planetId).name}</span><h3>${contract.title}</h3></div>
				<strong>${mission.won ? 'Complete' : mission.aborted ? 'Aborted' : 'Failed'}</strong>
				<small>${mission.payout.toLocaleString()} CR · +${mission.favor} favor with ${getFaction(contract.employer).shortName} · +${mission.companyReputation} company reputation</small>
			</article>
			${fieldLeadReport(mission)}
			${crew ? html`<p class="day-report-checks" data-dialog-text>Objective ${rollText(crew.objective)}. Extraction ${rollText(crew.extraction)}.</p>`
				: fieldReport ? html`<p class="day-report-checks" data-dialog-text>${fieldReport.kills} eliminated · ${formatTime(fieldReport.time)} field time</p>` : ''}
			${squad?.map(function (member) { return rigReport(member, mission.won); })}`;
		})}`);
		element('result-upgrades').textContent = `+${reputation} COMPANY REPUTATION · RANK ${companyRank(campaign)} / 15`;
		element('restart').textContent = step ? 'BRIDGE / SIGNAL →' : 'OPERATIONS →';
		element('result-company').hidden = !damage;
		element('result-company').textContent = 'ENGINEERING →';
		element('result-starmap').hidden = true;
		saveReportCopy();
		transition(navigation.setScreen('result'));
	};
	const showDebrief = function (result: CampaignResult, now: number, report?: ReturnType<typeof getOperationReport>) {
		const { contract, won, aborted, payout, favor, companyReputation } = result;
		const step = getAuthoredStep(campaign.story, contract);
		const squad = result.squad ?? [];
		const damage = squad.some(function (member) { return member.integrity < 100; });
		terminalUntil = now + 1600;
		element('result-title').textContent = won ? 'CONTRACT COMPLETE.' : aborted ? 'CONTRACT ABORTED.' : 'CONTRACT FAILED.';
		element('result-story').hidden = !step;
		element('result-story').textContent = step ? won ? step.success : `${step.contact} is holding the job for you. Retry from the Bridge when ready.` : '';
		const failure = aborted ? 'The company withdrew.' : state.mission?.acquisitionTime === 0 ? 'The targeting deadline expired.' : 'The sortie was lost.';
		element('result-copy').textContent = won
			? `${getPlanet(contract.planetId).name} extraction complete. ${getFaction(contract.employer).name} released payment and strengthened its local influence.`
			: `${failure} ${getFaction(contract.opponent).name} gained local influence.`;
		element('result-difficulty').textContent = report ? state.difficulty.toUpperCase() : '';
		element('result-score').textContent = `${payout.toLocaleString()} CR`;
		element('result-rank').textContent = won ? '✓' : '×';
		const heading = element('result-score').previousElementSibling; if (heading) heading.textContent = 'COMPANY PAYMENT';
		const stats = [...(report ? [[String(report.kills), 'ELIMINATED'], [formatTime(report.time), 'FIELD TIME']] : []), [`+${favor}`, 'EMPLOYER FAVOR']];
		element('result-stats').hidden = false;
		element('result-stats').replaceChildren(...stats.map(function ([value, label]) { const node = document.createElement('div'); const strong = document.createElement('b'); const small = document.createElement('small'); strong.textContent = value ?? ''; small.textContent = label ?? ''; node.append(strong, small); return node; }));
		const upgrades = element('result-upgrades');
		reportContent(html`${fieldLeadReport(result)}${squad.map(function (member) { return rigReport(member, won); })}`);
		const funds = step ? `COMPANY FUNDS ${campaign.credits.toLocaleString()} CR · ` : '';
		upgrades.textContent = `${funds}DAY ${campaign.day} · +${companyReputation} COMPANY REPUTATION · RANK ${companyRank(campaign)} / 15. ${getFaction(contract.opponent).name}: −${contract.hostility} reputation applied on acceptance.`;
		element('restart').textContent = step ? 'BRIDGE / SIGNAL →' : 'RETURN TO SHIP →';
		element('result-company').hidden = !step && !damage;
		element('result-company').textContent = damage ? 'ENGINEERING →' : 'MECH BAY →';
		element('result-starmap').hidden = !step;
		saveReportCopy();
		transition(navigation.setScreen('result'));
	};
	const afterSortieEnding = function (now: number, reveal: (now: number) => void) {
		if (sortieEnding?.owner === state) sortieEnding.reveal = reveal;
		else reveal(now);
	};
	const showResult = function (now: number) {
		if (situationSim || training || escape || !state.mission) return;
		checkpoint();
		const next = settleContract(campaign, state.outcome === 'won');
		if (next === campaign || !next.lastResult || !replaceCampaign(next)) return;
		const report = getOperationReport(state);
		const result = next.lastResult;
		afterSortieEnding(now, function (at) {
			if (next.lastOperationDay) showDayDebrief(next.lastOperationDay, at, report);
			else showDebrief(result, at, report);
		});
	};
	const showSituationResult = function (now: number) {
		const mission = state.mission;
		if (!mission) return;
		const report = getOperationReport(state);
		terminalUntil = now + 1600;
		const won = state.outcome === 'won';
		element('situation-result-title').textContent = won ? 'MISSION COMPLETE' : 'MISSION FAILED';
		element('situation-result-copy').textContent = won ? 'Objective secured. Extraction complete.'
			: mission.acquisitionTime === 0 ? 'The targeting deadline expired.'
			: mission.contract.kind === 'defend' && state.relay <= 0 ? 'The relay was destroyed.' : 'Your rig was disabled.';
		element('situation-kills').textContent = String(report.kills);
		element('situation-time').textContent = formatTime(report.time);
		transition(navigation.setScreen('situation-result'));
	};
	const abortSortie = function () {
		const report = campaign.deployed && state.mission ? getOperationReport(state) : undefined;
		checkpoint();
		const next = abandonContract(campaign);
		if (next === campaign || !replaceCampaign(next)) return;
		const result = next.lastResult;
		if (next.lastOperationDay) showDayDebrief(next.lastOperationDay, performance.now(), report);
		else if (result && (result.squad || getAuthoredStep(next.story, result.contract))) showDebrief(result, performance.now(), report);
		else toShip();
	};
	container.addEventListener('focusin', function (event) { if (event.target instanceof HTMLElement && !event.target.closest('.menu-controls')) updateMenuHint(); }, listenerOptions);
	container.addEventListener('workspacechange', updateMenuHint, listenerOptions);
	const stepMenu = function (root: HTMLElement, section: 'topic' | 'page', delta: number) {
		if (root === squadOrdersRoot && section === 'topic') return squadOrders.stepContact(delta);
		if (root.classList.contains('modal')) return stepDialogNavigation(root, section, delta);
		if (!root.classList.contains('workspace') || !companyNavigationReady() || !isShipScreen(navigation.screen)) return false;
		if (section === 'topic') navigateShip(adjacentShipScreen(navigation.screen, delta));
		else cycleWorkspaceView(root, delta);
		return true;
	};
	const directMenu = function (root: HTMLElement, direction: MenuDirection) {
		if (root === squadOrdersRoot && squadOrders.moveCursor(direction)) return;
		const current = document.activeElement;
		if ((direction === 'left' || direction === 'right') && current instanceof HTMLInputElement && current.type === 'range' && root.contains(current)) {
			const steps = inputMode === 'gamepad' ? 5 : 1;
			if (direction === 'right') current.stepUp(steps); else current.stepDown(steps);
			current.dispatchEvent(new Event('input', { bubbles: true }));
		} else if (root.classList.contains('workspace')) moveWorkspaceFocus(root, direction);
		else moveMenuFocus(root, direction);
		if (current !== document.activeElement) audio.cue('focus');
	};
	const rigCode = ['ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
	let rigCodeInput: string[] = [];
	window.addEventListener('keydown', function (event) {
		if (rigTestEnabled && event.target instanceof Element && event.target.closest('#rig-test-panel')) return;
		if (capture) rigCodeInput = [];
		setInputMode('keyboard'); if (event.isTrusted) unlockSound();
		if (capture) {
			const row = document.activeElement;
			if (navigation.auxiliary === 'settings' && row instanceof HTMLElement && row.dataset['action'] === capture && availableMenuControl(row)) {
				event.preventDefault();
				if (event.code === 'Escape') { if (!event.repeat) cancelKeyCapture(); }
				else if (!event.repeat && validKey(event.code)) assignKey(event.code);
				return;
			}
			cancelKeyCapture();
		}
		if (capture || navigation.auxiliary || campaignConflict || trialSeed !== undefined || situationSim || training || navigation.screen === 'training-setup' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLElement && event.target.isContentEditable) {
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
		if (root) {
			const direction = event.code === 'ArrowUp' ? 'up' : event.code === 'ArrowDown' ? 'down'
				: event.code === 'ArrowLeft' ? 'left' : event.code === 'ArrowRight' ? 'right' : undefined;
			if (direction) { event.preventDefault(); directMenu(root, direction); return; }
			if (['KeyQ', 'KeyE', 'KeyZ', 'KeyC'].includes(event.code)) {
				event.preventDefault();
				if (!event.repeat) stepMenu(root, event.code === 'KeyQ' || event.code === 'KeyE' ? 'topic' : 'page', event.code === 'KeyQ' || event.code === 'KeyZ' ? -1 : 1);
				return;
			}
			if (companyNavigationReady() && ['KeyH', 'F1', 'KeyX'].includes(event.code)) {
				event.preventDefault();
				if (!event.repeat) {
					if (event.code === 'KeyH') showAuxiliary('handbook');
					else if (event.code === 'F1') showAuxiliary('settings');
					else if (hasRefitDraft()) discardDraft();
				}
				return;
			}
			if (event.code === 'Enter' && event.target instanceof HTMLInputElement && event.target.matches('[type="radio"], [type="checkbox"]')) {
				event.preventDefault(); if (!event.repeat) event.target.click(); return;
			}
		}
		// Purchases and work orders require a fresh confirmation press.
		if (root && event.repeat && (event.code === 'Enter' || event.code === 'Space')) { event.preventDefault(); return; }
		if (root && event.code === 'Tab') {
			const items = root.classList.contains('workspace') ? workspaceControls(root) : menuControls(root); const first = items[0]; const last = items.at(-1);
			if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
			return;
		}
		if (!playing()) return;
		if (event.target instanceof HTMLInputElement) return;
		const action = keyboardAction(event.code); if (!action) return;
		event.preventDefault();
		if (action === 'indicator-info') { if (!event.repeat) toggleIndicatorInfo(); return; }
		if (action === 'target-nearest' || action === 'target-next') { if (!event.repeat) selectTarget(action === 'target-nearest' ? 'nearest' : 'cycle'); return; }
		if (event.repeat && !keys.has(event.code)) return;
		keys.add(event.code); if (!event.repeat) pending.add(action);
	}, listenerOptions);
	window.addEventListener('keyup', function (event) { const action = keyboardAction(event.code); if (action) keys.delete(event.code); }, listenerOptions);
	let menuPointer: { id: number; device: 'touch' | 'keyboard'; control: Element } | undefined;
	const finishMenuPointer = function () {
		if (!menuPointer) return;
		const { device } = menuPointer;
		menuPointer = undefined;
		setInputMode(device);
	};
	container.addEventListener('pointerdown', function (event) {
		if (event.isTrusted) unlockSound();
		// The battlefield picks the displayed scene before a touch reveals its dock.
		if (event.target === canvas && event.pointerType === 'touch') return;
		const target = event.target instanceof Element ? event.target : undefined;
		const device = event.pointerType === 'touch' || target?.closest('#touch, #touch-zoom') ? 'touch' : 'keyboard';
		const control = target?.closest('button, input, select, a, label');
		menuPointer = undefined;
		// Changing the couch layout between down and up can move a different row
		// under the pointer. Let a tap finish against the layout the player saw.
		if (device !== inputMode && control && menu() && event.button === 0) {
			menuPointer = { id: event.pointerId, device, control }; return;
		}
		setInputMode(device);
	}, { ...listenerOptions, capture: true });
	container.addEventListener('click', function (event) {
		if (event.isTrusted && event.detail > 0) finishMenuPointer();
	}, listenerOptions);
	window.addEventListener('pointercancel', function (event) { if (menuPointer?.id === event.pointerId) finishMenuPointer(); }, listenerOptions);
	window.addEventListener('pointerup', function (event) {
		if (menuPointer?.id === event.pointerId && (!(event.target instanceof Node) || !menuPointer.control.contains(event.target))) finishMenuPointer();
	}, listenerOptions);
	container.addEventListener('click', function (event) {
		const button = event.target instanceof Element ? event.target.closest('button') : null;
		const root = menu();
		if (!button || !root) return;
		// Some touch browsers activate a button without giving it focus.
		if (event.detail > 0 && root.contains(button) && document.activeElement !== button) button.focus({ preventScroll: true });
		audio.cue(button.matches('#close-settings, #close-handbook, #confirm-cancel') ? 'back' : 'confirm');
	}, { ...listenerOptions, capture: true });
	window.addEventListener('pagehide', checkpoint, listenerOptions);
	window.addEventListener('blur', function () { checkpoint(); focused = false; padInput.suspend(); resetInput(); setPaused(true); }, listenerOptions);
	window.addEventListener('focus', function () { focused = true; padInput.suspend(); }, listenerOptions);
	document.addEventListener('visibilitychange', function () { padInput.suspend(); if (document.hidden) { checkpoint(); silenceAudio(); resetInput(); setPaused(true); } }, listenerOptions);
	canvas.addEventListener('webglcontextlost', function (event) {
		event.preventDefault(); contextLost = true; padInput.suspend(); resetInput(); setPaused(true);
		const error = element('error'); error.textContent = 'Graphics interrupted. Waiting for recovery…'; error.hidden = false;
	}, listenerOptions);
	canvas.addEventListener('webglcontextrestored', function () { contextLost = false; presentation.resetTerrainBake(); padInput.suspend(); element('error').hidden = true; previous = 0; }, listenerOptions);
	const updatePointer = function (event: PointerEvent) {
		if (!playing()) return;
		const rect = canvas.getBoundingClientRect(); const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		if (event.pointerType === 'touch') {
			// A browser may deliver the touch to the canvas when the marker has
			// just moved. Still use the actual box, before picking a new aim.
			if (event.type === 'pointerdown' && aimMode === 'touch' && !facingMarker.hidden) {
				const box = facingMarker.getBoundingClientRect();
				if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
					clearTouchFacing();
					return;
				}
			}
			// Pick the scene the player actually tapped before revealing the dock
			// changes its viewport. Carry world position/identity across takeover.
			const contacts = event.type === 'pointerdown' ? touchContacts() : undefined;
			const ground = presentation.toGround(point);
			const revealingDock = !container.classList.contains('touch-enabled');
			setInputMode('touch'); aimMode = 'touch'; pointer = undefined;
			if (revealingDock) { const next = canvas.getBoundingClientRect(); refreshHudObstructions(); presentation.resize(state, next.width, next.height); }
			if (contacts) {
				clearTouchFacing();
				if (touchTargeting.select(point, contacts) === 'ground' && ground) {
					touchAimPointer = event.pointerId;
					touchFacing.select(ground, state.player, Boolean(mortarProfile(state.frame)));
				}
			} else if (touchAimPointer === event.pointerId && ground) touchFacing.select(ground, state.player, Boolean(mortarProfile(state.frame)));
			return;
		}
		setInputMode('keyboard');
		const field = canvas.getBoundingClientRect();
		pointer = { x: event.clientX - field.left, y: event.clientY - field.top }; aimMode = 'pointer';
	};
	canvas.addEventListener('pointermove', updatePointer, listenerOptions);
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, function (event) {
		if (touchAimPointer === event.pointerId) touchAimPointer = undefined;
	}, listenerOptions);
	canvas.addEventListener('wheel', function (event) {
		if (!playing() || event.ctrlKey || event.metaKey) return;
		event.preventDefault(); presentation.zoomWithWheel(event); setInputMode('keyboard');
	}, { ...listenerOptions, passive: false });
	// Keep native long-press menus, selection, and dragging off the game UI.
	for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
		container.addEventListener(type, function (event) {
			if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return;
			event.preventDefault();
		}, listenerOptions);
	}
	canvas.addEventListener('auxclick', function (event) { event.preventDefault(); }, listenerOptions);
	canvas.addEventListener('pointerdown', function (event) {
		if (!playing()) return;
		updatePointer(event); canvas.focus({ preventScroll: true });
		if (event.pointerType === 'touch') { event.preventDefault(); canvas.setPointerCapture(event.pointerId); }
	}, listenerOptions);
	// Pointerdown only fires for the first mouse button in a chord. Mouse events
	// report every press/release, so all four mounts remain independent.
	canvas.addEventListener('mousedown', function (event) {
		const binding = keyboardAction(`Mouse${event.button}`);
		if (!binding || !playing()) return;
		event.preventDefault();
		if (binding === 'indicator-info') { consumedMouseButtons.add(event.button); toggleIndicatorInfo(); return; }
		if (binding === 'target-nearest' || binding === 'target-next') { selectTarget(binding === 'target-nearest' ? 'nearest' : 'cycle'); return; }
		mouseButtons.add(event.button); consumedMouseButtons.add(event.button); pending.add(binding);
	}, listenerOptions);
	window.addEventListener('mouseup', function (event) {
		// Chromium handles side-button history on mouseup, before auxclick.
		if (consumedMouseButtons.has(event.button) || event.target === canvas) event.preventDefault();
		mouseButtons.delete(event.button); consumedMouseButtons.delete(event.button);
	}, listenerOptions);
	const release = function (event: PointerEvent) { const action = held.get(event.pointerId); held.delete(event.pointerId); if (event.type === 'pointercancel') { mouseButtons.clear(); if (action) pending.delete(action); } };
	window.addEventListener('pointerup', release, listenerOptions); window.addEventListener('pointercancel', release, listenerOptions);
	for (const button of container.querySelectorAll<HTMLButtonElement>('[data-control]')) {
		const action = button.dataset['control']; if (!action) continue;
		button.addEventListener('pointerdown', function (event) {
			if (!playing() || event.button !== 0) return;
			event.preventDefault();
			const slot = weaponButtons.indexOf(button);
			if (slot >= 0 && container.classList.contains('touch-enabled')) {
				if (armedTouchMounts.has(slot)) armedTouchMounts.delete(slot); else armedTouchMounts.add(slot);
				lastHud = 0; return;
			}
			button.setPointerCapture(event.pointerId); held.set(event.pointerId, action); pending.add(action);
		}, listenerOptions);
		button.addEventListener('click', function (event) { if (event.detail === 0 && playing()) {
			const slot = weaponButtons.indexOf(button);
			if (slot >= 0 && container.classList.contains('touch-enabled')) { if (armedTouchMounts.has(slot)) armedTouchMounts.delete(slot); else armedTouchMounts.add(slot); lastHud = 0; return; }
			pending.add(action); canvas.focus({ preventScroll: true });
		} }, listenerOptions);
		button.addEventListener('lostpointercapture', release, listenerOptions);
	}
	const keysForPrompt = function (action: Action) {
		const bindings = profile.settings.keyboard[action].filter(function (code) { return keyboardAction(code) === action; });
		const mouse = bindings.find(function (code) { return code.startsWith('Mouse'); });
		const key = bindings.find(function (code) { return code.startsWith('Digit'); }) ?? bindings.find(function (code) { return !code.startsWith('Mouse'); });
		return [key, mouse].filter(function (code) { return code !== undefined; });
	};
	const combatPrompt = function (action: keyof ControllerBindings) {
		return inputMode === 'gamepad' ? renderControllerButton(controllerFamily, profile.settings.controller[action]) : renderKeyboardBindings(keysForPrompt(action));
	};
	const drivePrompts = function (arcade: boolean) {
		const device = promptDevice();
		const row = function (glyph: ReturnType<typeof renderGlyph>, label: string) {
			return html`<span class="drive-prompt">${glyph}<span>${label}</span></span>`;
		};
		const directions = function (actions: readonly Action[]) {
			return renderKeyboardBindings(actions.flatMap(function (action) { return keysForPrompt(action).slice(0, 1); }));
		};
		const controller = inputMode === 'gamepad';
		return html`
			${controller ? row(renderGlyph(device, 'move'), arcade ? 'Move' : '↑↓ Throttle · ←→ Steer')
				: arcade ? row(directions(['forward', 'left', 'back', 'right']), 'Move')
					: html`${row(directions(['forward', 'back']), 'Throttle')}${row(directions(['left', 'right']), 'Steer')}`}
			${row(renderAimGlyph(device), controller && profile.settings.torsoAim === 'rotate' ? 'Rotate turret' : 'Aim')}
			${row(controller ? renderControllerButton(controllerFamily, 0) : renderZoomGlyph(), controller ? 'Cycle zoom' : 'Zoom')}
		`;
	};
	const updateHud = function () {
		const squad = state.squadmates;
		ui.squad.hidden = squad.length === 0;
		render(html`${squad.map(function (member) {
			return html`<div class="squad-contact" data-disabled=${member.hp <= 0}><span>${member.callsign}</span><strong>${member.hp <= 0 ? 'DOWN' : `${Math.ceil(member.hp)}%`}</strong></div>`;
		})}`, ui.squad);
		const p = state.player;
		const touchLayout = container.classList.contains('touch-enabled');
		if (touchLoadout !== state.loadout) { armedTouchMounts.clear(); state.loadout.forEach(function (mount, index) { armedTouchMounts.add(mount.slot ?? index); }); touchLoadout = state.loadout; }
		const showRelay = !training && (!state.mission || state.mission.contract.kind === 'defend');
		element('relay-readout').hidden = !showRelay;
		element('relay-name').textContent = state.mission ? 'CONTRACT RELAY' : 'RELAY 09';
		const pickup = sortieEnding?.owner === state && sortieEnding.kind === 'pickup' ? sortieEnding : undefined;
		container.classList.toggle('pickup-active', pickup !== undefined);
		const drill = training && training.stage !== 'range' ? training.stage : undefined;
		const drillSlot = trainingFireSlot(drill);
		const practice = training?.stage === 'range';
		if (training) container.dataset['trainingStage'] = training.stage;
		else delete container.dataset['trainingStage'];
		const prompts = { ...profile.settings, device: inputMode, buttonLabel: function (index: number) { return controllerButtonLabel(controllerFamily, index); }, touch: inputMode === 'touch' };
		const drillCopy = drill ? trainingCopy(drill, inputMode === 'gamepad', prompts) : undefined;
		const task = combatTask(state, {
			pickupTime: pickup?.elapsed, escapeGuide: escape ? escapeMessage(state.time, prompts) : undefined,
			drill: drillCopy, practice,
		});
		ui.phase.textContent = task.title;
		ui.status.textContent = drill && inputMode === 'touch' ? touchDrillCue[drill] : task.detail;
		ui.armor.textContent = `${Math.max(0, Math.ceil(p.hp))}%`; ui.armorFill.style.width = `${Math.max(0, p.hp)}%`; ui.armorFill.style.background = p.hp < 30 ? 'var(--danger)' : 'var(--cyan)';
		ui.relay.textContent = `${Math.max(0, Math.ceil(state.relay))}%`; ui.relayFill.style.width = `${Math.max(0, state.relay)}%`; ui.relayFill.style.background = state.relay < 30 ? 'var(--danger)' : 'var(--cyan)';
		ui.heat.textContent = p.overheated ? 'LOCKOUT' : `${Math.ceil(p.heat)}%`; ui.heatFill.style.width = `${p.heat}%`; ui.heatFill.style.background = p.heat > 80 ? 'var(--danger)' : 'var(--amber)';
		const backing = p.arcadeBacking || p.throttle < 0;
		ui.drive.textContent = `${Math.abs(p.throttle) < 0.005 ? 'N' : backing ? 'REV' : 'FWD'} ${Math.round(Math.abs(p.throttle) * 100)}%`;
		ui.stripHull.textContent = ui.armor.textContent;
		ui.stripHullFill.style.width = ui.armorFill.style.width;
		ui.stripHeat.textContent = ui.heat.textContent;
		ui.stripHeatFill.style.width = ui.heatFill.style.width;
		ui.stripHeatFill.style.background = ui.heatFill.style.background;
		ui.stripDrive.textContent = ui.drive.textContent;
		ui.stripRelay.hidden = !showRelay;
		if (showRelay) ui.stripRelay.textContent = `Relay ${ui.relay.textContent}`;
		const definition = getFrame(state.frame);
		const weight = frameWeight(state.frame, state.loadout);
		element('combat-frame-name').textContent = `${definition.chassisName} ${definition.variant}`;
		const arcadeMovement = inputMode === 'touch' || profile.settings.legControls === 'arcade';
		element('combat-control-mode').textContent = arcadeMovement ? 'ARCADE' : 'TANK';
		element('drive-behavior').textContent = arcadeMovement ? 'RELEASE TO SLOW' : 'RELEASE TO CRUISE';
		render(touchLayout ? '' : combatPrompt('stop'), element('stop-prompt'));
		render(touchLayout ? '' : drivePrompts(arcadeMovement), element('drive-prompts'));
		container.classList.toggle('reactor-locked', p.overheated);
		container.classList.toggle('hull-critical', p.hp < 30);
		ui.throttleFill.style.left = `${backing ? 50 - Math.abs(p.throttle) * 50 : 50}%`; ui.throttleFill.style.width = `${Math.abs(p.throttle) * 50}%`; ui.speed.textContent = `${Math.abs(p.speed).toFixed(0)} / ${(p.arcadeBacking || p.speed < 0 ? definition.reverseSpeed * weight.modifier : weight.speed).toFixed(0)} m/s`;
		element('weight-value').textContent = `${massLabel(weight.total)} / ${massLabel(weight.recommended)} REC · ${weight.modifier < .9999 ? 'OVERLOAD' : weight.modifier > 1.0001 ? 'LIGHT' : 'NOMINAL'}`;
		const hardpoints = getHardpoints(state.frame);
		element('weapon-bank').style.setProperty('--hardpoint-columns', String(hardpoints.length));
		element('weapon-bank').style.setProperty('--hardpoint-mobile-columns', String(Math.min(2, hardpoints.length)));
		for (const [index, button] of weaponButtons.entries()) {
			const hardpoint = hardpoints[index];
			button.hidden = hardpoint === undefined;
			if (!hardpoint) { button.disabled = true; continue; }
			const mortar = mortarProfile(state.frame, index);
			const family = mortar ? 'ARTILLERY' : WEAPON_FAMILY_LABELS[hardpoint.family];
			const mount = state.loadout.find(function (entry, position) { return (entry.slot ?? position) === index; }); const binding = MOUNTS[index]; if (!binding) continue;
			const weapon = mount ? getWeapon(mount.weapon) : undefined;
			button.hidden = !hardpoint || touchLayout && !mount;
			button.classList.toggle('armed', touchLayout && armedTouchMounts.has(index));
			button.setAttribute('aria-pressed', String(touchLayout && armedTouchMounts.has(index)));
			const touchFiring = touchLayout && armedTouchMounts.has(index) && active('touch-fire');
			button.disabled = !mount || Boolean(drill && drill !== 'combined' && index !== drillSlot);
			const dry = Boolean(mount && !usableMount(mount));
			const mortarAim = mortar && (state.enemies.find(function (enemy) { return enemy.id === p.targetId && enemy.hp > 0; })
				?? missionStructures(state.mission).find(function (target) { return target.id === p.targetId && target.body.hp > 0; })?.body ?? aim);
			const mortarStatus = mortarAim ? artilleryAimStatus(state, mortarAim) : undefined;
			const weaponName = weapon && (mortar ? `${mortar.name}${touchLayout ? '' : ` · T${weapon.tier}`}` : touchLayout ? weapon.name.replace(` · T${weapon.tier}`, '') : weapon.name);
			const firing = Boolean(mount && !dry && !button.disabled && !p.overheated && playing() && (mount.firing || active(binding.action) || currentPad?.fire[index] || touchFiring));
			button.classList.toggle('empty', !mount || dry); button.classList.toggle('firing', firing); button.classList.toggle('locked', p.overheated);
			const mapped = touchLayout ? '' : ` ${profile.settings.keyboard[binding.action].map(keyLabel).join(' / ') || 'Unbound'}; controller ${controllerButtonLabel(controllerFamily, profile.settings.controller[binding.action])}.`;
			button.setAttribute('aria-label', mount && weapon ? `${touchLayout ? 'Arm' : 'Fire'} mount ${index + 1}, ${hardpoint.name}, ${family}: ${weaponName}, ${weapon.ammunition ? `${mount.rounds} rounds remaining` : 'no ammunition required'}.${dry ? ' Empty ammunition.' : p.overheated ? ' Heat locked.' : ''}${mapped}` : `Mount ${index + 1}, ${hardpoint.name}, ${family}, empty. ${practice ? 'Pause to change loadout.' : 'Equip compatible purchased weapons in the Mech Bay.'}`);
			const location = button.querySelector('.weapon-mount'); if (location) location.textContent = `${hardpoint.name}${!touchLayout && mount ? ` · ${weapon?.ammunition ? `${mount.rounds} RDS` : 'ENERGY'}` : ''}`;
			button.title = `${hardpoint.name} · ${family}${weapon ? ` · ${mortar ? `${HARROW_MIN_RANGE}–${HARROW_MAX_RANGE} M · AC rounds` : weapon.type}` : ' · Empty'}`;
			const title = button.querySelector('b');
			if (title) title.textContent = weaponName ?? 'EMPTY';
			const icon = button.querySelector('.weapon-icon'); if (icon) icon.textContent = `${String(index + 1).padStart(2, '0')}`;
			const prompt = button.querySelector<HTMLElement>('.weapon-prompt');
			if (prompt) render(touchLayout || button.disabled ? '' : combatPrompt(binding.action), prompt);
			const ammunitionLabel = !mount || !weapon ? '' : weapon.ammunition ? `${mount.rounds}${touchLayout ? '' : ' RDS'}` : 'ENERGY';
			const ammunition = button.querySelector('.weapon-ammo'); if (ammunition) ammunition.textContent = ammunitionLabel && touchLayout && weapon ? `${ammunitionLabel} T${weapon.tier}` : ammunitionLabel;
			const status = !mount ? 'EMPTY' : button.disabled ? 'DRILL LOCK' : dry ? 'NO AMMO' : p.overheated ? 'HEAT LOCK' : mortarStatus ?? (mount.cooldown > 0 ? `CD ${mount.cooldown.toFixed(1)}s` : firing ? 'FIRING' : 'READY');
			button.dataset['resourceState'] = dry ? 'dry' : p.overheated ? 'heat' : mount && mount.cooldown > 0 ? 'cooldown' : 'ready';
			const label = button.querySelector('em'); if (label) label.textContent = status;
			const fill = button.querySelector('i'); if (fill) fill.style.width = `${mount && weapon ? Math.max(0, 1 - mount.cooldown / Math.max(.01, mountInterval(state.frame, index, weapon))) * 100 : 0}%`;
			button.style.setProperty('--weapon-color', weapon?.color ?? 'var(--muted)');
		}
		const coolantLocked = state.coolantCharges <= 0 || Boolean(drill && drill !== 'coolant');
		element('coolant').toggleAttribute('disabled', coolantLocked);
		element('touch-coolant').toggleAttribute('disabled', coolantLocked);
		element('touch-coolant-value').textContent = `${state.coolantCharges} LEFT`;
		const touchFiring = touchLayout && active('touch-fire') && !p.overheated && state.loadout.some(function (mount, index) { return usableMount(mount) && armedTouchMounts.has(mount.slot ?? index); });
		element('touch-fire').classList.toggle('firing', touchFiring);
		element('touch-fire').toggleAttribute('disabled', p.overheated || !weaponButtons.some(function (button, index) { return !button.hidden && !button.disabled && button.dataset['resourceState'] !== 'dry' && armedTouchMounts.has(index); }));
		ui.coolant.textContent = `${state.coolantCharges} ${state.coolantCharges === 1 ? 'CHARGE' : 'CHARGES'}`;
		element('open-squad-orders').hidden = !canIssueSquadOrders();
		ui.message.textContent = !playing() ? '' : inputMode === 'gamepad' && currentPad?.connected && !currentPad.ready ? 'RELEASE CONTROLLER INPUTS TO ARM CONTROLS' : p.overheated ? 'REACTOR LOCKOUT / VENT COOLANT OR CEASE FIRE' : showRelay && state.relay < 30 ? 'RELAY INTEGRITY CRITICAL' : !drill && !escape && state.time < messageUntil ? message : '';
		for (const action of ['target-nearest', 'target-next', 'coolant'] as const) {
			const prompt = element(action).querySelector<HTMLElement>('.combat-prompt');
			if (prompt) render(touchLayout ? '' : combatPrompt(action), prompt);
		}
		updateRadar();
		refreshHudObstructions();
		const audioState = audio.status(); const needsGesture = audioState === 'locked' || audioState === 'pending';
		const soundState = audioState === 'unavailable' ? 'UNAVAILABLE' : needsGesture ? 'ENABLE SOUND' : muted ? 'SOUND OFF' : 'SOUND ON';
		if (lastSoundState !== soundState) { lastSoundState = soundState; ui.sound.textContent = soundState; ui.sound.setAttribute('aria-label', needsGesture ? 'Click to enable audio' : audioState === 'unavailable' ? 'Retry audio' : muted ? 'Unmute sound' : 'Mute sound'); ui.sound.setAttribute('aria-pressed', String(muted)); }
		const audioStatus = needsGesture && inputMode === 'gamepad' ? 'Audio needs a click or key press in this browser.' : audioState === 'unavailable' ? 'Audio device unavailable. Click or press a key to retry.' : '';
		if (element('audio-status').textContent !== audioStatus) element('audio-status').textContent = audioStatus;
	};
	const audioFrame = function (now: number) {
		const combat = playing();
		const finishing = sortieEnding?.owner === state && battlefieldActive();
		const result = finishing || navigation.screen === 'result' || navigation.screen === 'situation-result';
		const launching = navigation.screen === 'launch';
		const briefing = usesMenuScore(navigation.screen);
		const audibleMenu = (launching && !navigation.transitioning && !navigation.auxiliary) || briefing || (result && (finishing || now < terminalUntil + 30000));
		return { speed: combat ? state.player.speed : 0, laser: combat && !!state.beam, heat: state.player.heat,
			theme: escape ? 'pursuit' as const : 'standard' as const,
			alarm: combat && escape,
			launchTime: launching && launchStartedAt !== undefined ? launchTimeNow() : undefined,
			jogTime: navigation.screen === 'intro' && narrativePart === 'before' && !narrativeWaiting && !navigation.transitioning && !navigation.auxiliary && [1, 2].includes(narrativeFrame(INTRO_LINES, narrativeElapsed).index)
				? narrativeElapsed - (INTRO_LINES[0].length / 10 + 3) : undefined,
			jogDuration: INTRO_LINES.slice(1, 3).reduce(function (sum, line) { return sum + line.length / 10 + 3; }, 0) - 0.05,
			hatchTime: navigation.screen === 'intro' && narrativePart === 'after' && !narrativeWaiting && !navigation.transitioning && !navigation.auxiliary
				? narrativeElapsed : undefined,
			active: !contextLost && focused && !document.hidden && !campaignConflict && (combat || audibleMenu), uiActive: !contextLost && focused && !document.hidden,
			phase: launching ? 'launch' as const : briefing ? 'briefing' as const : result ? 'result' as const : 'combat' as const,
			intensity: Math.min(1, state.enemies.length / 5 + (state.wave - 1) * 0.08), danger: Math.max(0, 1 - Math.min(state.player.hp, state.relay) / 50), victory: state.outcome === 'won' };
	};
	let frameTime = 0;
	let makeInput = function (): Controls { return { drive: 0, stop: false, turn: 0, aim, fire: [false, false, false, false], coolant: false }; };
	world.addSystem('mission-launch').inScreens(['launch']).inPhase('preUpdate').setProcess(function () {
		if (navigation.transitioning || !focused || document.hidden || contextLost || campaignConflict) return;
		if (launchStartedAt === undefined) {
			// Start the soundtrack before drawing the first shot. Both use foreground real time.
			launchStartedAt = performance.now() - launchElapsed * 1000;
			audio.update(audioFrame(frameTime));
		}
		const elapsed = launchTimeNow();
		const dockHeight = portrait.matches && container.classList.contains('touch-enabled') ? touchDock.offsetHeight : 0;
		presentation.setLaunchTime(launchSceneTime(elapsed), dockHeight);
		if (elapsed >= LAUNCH_DURATION) finishLaunch();
	});
	world.addSystem('intro-narrative').inScreens(['intro']).inPhase('preUpdate').setProcess(function ({ dt }) {
		if (narrativeWaiting || navigation.transitioning || navigation.auxiliary || !focused || document.hidden || contextLost) return;
		const lines = narrativePart === 'before' ? INTRO_LINES : SADDLE_LINES;
		const previousNarrative = narrativeFrame(lines, narrativeElapsed);
		narrativeElapsed += dt;
		const narrative = narrativeFrame(lines, narrativeElapsed);
		const line = element('intro-line');
		const fullText = lines[narrative.index] ?? '';
		// Invisible characters reserve the final wrapping and height throughout typing.
		if (line.textContent !== fullText) line.replaceChildren(...Array.from(fullText, function (character, index) {
			const sarcasmStart = fullText.indexOf('gracious');
			const sarcastic = sarcasmStart >= 0 && index >= sarcasmStart && index < sarcasmStart + 'gracious'.length;
			const span = document.createElement(sarcastic ? 'em' : 'span');
			span.textContent = character;
			return span;
		}));
		let characterOffset = 0;
		for (const span of line.children) {
			if (!(span instanceof HTMLElement)) continue;
			characterOffset += span.textContent.length;
			span.style.visibility = characterOffset <= narrative.text.length ? 'visible' : 'hidden';
		}
		line.style.opacity = String(narrative.opacity);
		const revealed = narrative.text.slice(previousNarrative.index === narrative.index ? previousNarrative.text.length : 0);
		if (revealed) { audio.update(audioFrame(frameTime)); audio.typeText(revealed); }
		if (narrative.done) {
			if (narrativePart === 'before') transition(navigation.setScreen('rig-bay'));
			else startEscape();
		}
	});
	world.addSystem('browser-input').inPhase('preUpdate').setProcess(function ({ dt }) {
		const now = frameTime;
		if (!navigation.transitioning && navigation.screen === 'jump' && focused && !document.hidden && jumpArrival && now >= jumpArrival.until) {
			const { transmission } = jumpArrival;
			jumpArrival = undefined;
			if (transmission && getTransmission(campaign)?.offers.some(function (step) { return step.contract.planetId === campaign.planetId; })) toTransmission();
			else toShip();
		}
		const revisionAtFrame = screenRevision;
		const rect = canvas.getBoundingClientRect(); const width = rect.width; const height = rect.height;
		presentation.resize(state, width, height);
		let pads: readonly (Gamepad | null)[] = [];
		try { pads = navigator.getGamepads?.() ?? []; } catch { /* Gamepad access can be restricted by an embedding policy. */ }
		if (!focused || document.hidden || contextLost) padInput.suspend();
		const pad = padInput.read(pads, now, profile.settings.controller);
		const rotateAim = profile.settings.torsoAim === 'rotate';
		currentPad = pad;
		mobileFullscreen.update(container.classList.contains('touch-enabled') && hasTouch(), pads.some(function (candidate) { return Boolean(candidate?.connected); }));
		if (pad.lost) { controllerLost = true; setInputMode(primaryPointer.matches ? 'touch' : 'keyboard'); setPaused(true); }
		feedback.update(pads.find(function (candidate) { return candidate?.index === pad.index; }) ?? undefined, playing() && profile.settings.vibration && inputMode === 'gamepad');
		if (pad.claimed) { controllerLost = false; audio.cue('confirm'); }
		if (pad.promptActivity && focused && !document.hidden) {
			controllerFamily = detectControllerFamily(pad.id ?? '');
			if (rotateAim && pad.claimed) aimMode = 'gamepad';
			setInputMode('gamepad');
		}
		container.dataset['controllerState'] = pad.connected ? 'connected' : controllerLost ? 'disconnected' : pad.available ? 'available' : 'none';
		const controllerStatus = pad.connected ? 'CONTROLLER CONNECTED' : controllerLost ? 'CONTROLLER LOST · PRESS ANY BUTTON TO RECONNECT' : 'PRESS ANY CONTROLLER BUTTON TO CONNECT';
		if (element('controller-status').textContent !== controllerStatus) element('controller-status').textContent = controllerStatus;
		for (const status of container.querySelectorAll<HTMLElement>('.ship-controller-status')) {
			status.hidden = pad.connected || !pad.available && !controllerLost;
			if (status.textContent !== controllerStatus) status.textContent = controllerStatus;
		}
		if (pad.pause && !navigation.transitioning && focused && !document.hidden && !contextLost) {
			audio.cue('back');
			if (choicePicker.root || capture || navigation.auxiliary) back();
			else if (companyNavigationReady()) showAuxiliary('settings');
			else setPaused(navigation.screen === 'playing');
			return;
		}
		const root = menu();
		if (root && !navigation.transitioning && inputMode === 'gamepad' && pad.connected && screenRevision === revisionAtFrame && focused && !document.hidden && !contextLost) {
			if (pad.back) { audio.cue('back'); back(); return; }
			if (capture) return;
			if (pad.department && stepMenu(root, 'topic', pad.department)) return;
			if (pad.page && stepMenu(root, 'page', pad.page)) return;
			if (pad.help && companyNavigationReady()) { showAuxiliary('handbook'); return; }
			if (pad.discard && companyNavigationReady() && hasRefitDraft()) { discardDraft(); return; }
			if (pad.direction) directMenu(root, pad.direction);
			else if (pad.confirm) {
				const current = document.activeElement;
				if (!(current instanceof HTMLElement) || !selectMenuControl(root, current)) {
					if (root.classList.contains('workspace')) focusWorkspace(root);
					else { const first = menuControls(root)[0]; if (first) focusMenuControl(first); }
				}
			} else if (pad.scroll) scrollMenu(root, pad.scroll, dt);
		}
		const combatInput = playing() && screenRevision === revisionAtFrame;
		if (combatInput && pad.ready && pad.confirm) presentation.cycleZoom();
		if (combatInput && pad.indicatorInfo) toggleIndicatorInfo();
		// Apply zoom and drift before all mouse, touch and controller ground picking.
		presentation.updateCamera(state, aimMode === 'pointer' ? pointer : undefined, hudObstructions);
		if (combatInput) {
			if (pad.targetNearest) selectTarget('nearest');
			if (pad.targetNext) selectTarget('cycle');
			const aimTargets = combatTargets(state).map(function ({ id, body }) { return { id, point: body }; });
			const mortar = mortarProfile(state.frame);
			const stickAim = !rotateAim && Math.hypot(pad.aimX, pad.aimY) > 0.2;
			const reticleAcquisition = Boolean(mortar) || state.frame === 'specter-c';
			const assistRange = pad.connected ? Math.max(missileLockRange(state.frame, state.loadout), mortar ? HARROW_MAX_RANGE : 0) : 0;
			const inStickRange = function (point: Point, assistDistance: number) {
				if (assistDistance < 850) return true;
				if (!withinWeaponRange(distance(point, state.player), assistRange)) return false;
				return isContactVisible(presentation.toScreen(point, targetElevation(point)), width, height, hudObstructions);
			};
			if (!aimTargets.some(function (target) { return target.id === acquiredTargetId; })) acquiredTargetId = undefined;
			if (aimMode === 'target') {
				const locked = touchTargeting.resolve(touchContacts()); acquiredTargetId = locked?.id;
				if (locked) aim = { ...locked.point };
			}
			if (rotateAim && pad.aimX !== 0) {
				aimMode = 'gamepad';
			} else if (stickAim) {
				aimMode = 'gamepad';
				const origin = presentation.toScreen(state.player); const length = Math.hypot(pad.aimX, pad.aimY);
				const projected = presentation.toGround({ x: origin.x + pad.aimX / length * 380, y: origin.y + pad.aimY / length * 380 });
				if (projected) aim = projected;
				const targets = aimTargets.map(function (target) {
					const at = presentation.toScreen(target.point, targetElevation(target.point));
					const dx = at.x - origin.x; const dy = at.y - origin.y;
					return { ...target, alignment: (dx * pad.aimX + dy * pad.aimY) / Math.max(1, Math.hypot(dx, dy) * length) };
				}).filter(function (target) { return target.alignment > 0.975 && inStickRange(target.point, distance(target.point, state.player)); })
					.sort(function (a, b) { return b.alignment - a.alignment; });
				const target = targets[0];
				acquiredTargetId = target?.id;
				if (target) aim = { x: target.point.x, y: target.point.y };
			} else if (pointer && aimMode === 'pointer') {
				aim = presentation.toGround(pointer) ?? aim;
				const cursor = pointer;
				const targetScreen = function (target: Point) { return presentation.toScreen(target, targetElevation(target)); };
				const picked = aimTargets.sort(function (a, b) { return distance(targetScreen(a.point), cursor) - distance(targetScreen(b.point), cursor); })[0];
				const target = picked && distance(targetScreen(picked.point), cursor) < 42 * viewScale(width, height) ? picked : undefined;
				if (reticleAcquisition) acquiredTargetId = target?.id;
				else acquiredTargetId ??= target?.id;
				if (target) aim = { x: target.point.x, y: target.point.y };
			}
			if (rotateAim && aimMode === 'gamepad') {
				const forwardX = Math.cos(state.player.turret); const forwardY = Math.sin(state.player.turret);
				aim = { x: state.player.x + forwardX * 600, y: state.player.y + forwardY * 600 };
				const target = aimTargets.map(function (candidate) {
					const dx = candidate.point.x - state.player.x; const dy = candidate.point.y - state.player.y;
					return { ...candidate, along: dx * forwardX + dy * forwardY, across: Math.abs(dx * forwardY - dy * forwardX) };
				}).filter(function (candidate) { return candidate.along > 0 && candidate.across <= 25 && inStickRange(candidate.point, candidate.along); })
					.sort(function (a, b) { return a.along - b.along; })[0];
				if (reticleAcquisition) acquiredTargetId = target?.id;
				else acquiredTargetId ??= target?.id;
			}
			makeInput = function (): Controls {
				let centerTorso = !rotateAim && !stickAim
					&& (aimMode === 'gamepad' || inputMode === 'gamepad' && aimMode === 'pointer' && !pointer);
				if (aimMode === 'touch') {
					// Visibility gates picking, not retention. Feet follow the live lock.
					const locked = touchTargeting.resolve(aimTargets);
					acquiredTargetId = locked?.id;
					const touchAim = locked?.point ?? touchFacing.resolve(state.player);
					centerTorso = touchAim === undefined;
					if (touchAim) aim = { x: touchAim.x, y: touchAim.y };
				}
				if (centerTorso) {
					acquiredTargetId = undefined;
					aim = touchAimPoint(state.player, state.player.angle);
				}
				const arcade = profile.settings.legControls === 'arcade' || inputMode === 'touch';
				if (active('stop') || pad.stop) touchDrive.stop();
				const touch = touchDrive.read();
				const touchFire = container.classList.contains('touch-enabled') && active('touch-fire');
				const x = Math.max(-1, Math.min(1, Number(active('right')) - Number(active('left')) + pad.turn + touch.turn));
				const y = Math.max(-1, Math.min(1, Number(active('back')) - Number(active('forward')) - pad.drive - touch.drive));
				const length = Math.hypot(x, y);
				const origin = presentation.toScreen(state.player);
				const destination = arcade && length > 0 ? presentation.toGround({ x: origin.x + x / length * 380, y: origin.y + y / length * 380 }) : undefined;
				return {
					...(arcade ? { throttleTarget: Math.min(1, length), ...(destination ? { heading: Math.atan2(destination.y - state.player.y, destination.x - state.player.x) } : {}) } : {}),
					...(aimMode === 'touch' && !centerTorso || aimMode === 'gamepad' && stickAim ? { faceAim: true } : {}),
					...(rotateAim && aimMode === 'gamepad' ? { turretTurn: pad.aimX } : {}),
					...(centerTorso ? { centerTorso } : {}),
					drive: -y, stop: active('stop') || pad.stop, turn: x, aim, ...(acquiredTargetId !== undefined ? { targetId: acquiredTargetId } : {}),
					fire: [active('mount-0') || pad.fire[0] || touchFire && armedTouchMounts.has(0), active('mount-1') || pad.fire[1] || touchFire && armedTouchMounts.has(1), active('mount-2') || pad.fire[2] || touchFire && armedTouchMounts.has(2), active('mount-3') || pad.fire[3] || touchFire && armedTouchMounts.has(3)], coolant: active('coolant') || pad.coolant,
				};
			};
			runtimeInput.sample(makeInput());
		}
		combatRuntime.setEnabled(playing() && screenRevision === revisionAtFrame);
	});
	world.addSystem('combat-feedback').setEventHandlers({
		combatStepFinished: function ({ data }) {
			audio.update(audioFrame(frameTime)); audio.play(data.events, data.weaponCues);
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
			if (rigTestEnabled) { state.spawnIn = Infinity; state.intermission = 0; }
			previousGaits = gaits; previousStage = training?.stage;
			previousFrame = state.frame; previousMissionStage = state.mission?.stage;
		},
		afterStep: function () {
			const now = frameTime;
			gaits = state.frame !== previousFrame || training?.stage === 'evade' && previousStage !== 'evade' ? createGaits(state) : advanceGaits(gaits, state);
			presentation.stepMechCadence(state, gaits);
			pending.clear();
			if (training && previousStage !== training.stage) {
				audio.cue('confirm');
				// A drill can unlock a different armed mount; require a fresh trigger
				// press so a held touch cannot fire through the next instruction.
				held.forEach(function (action, id) { if (action === 'touch-fire') held.delete(id); });
				pending.delete('touch-fire'); runtimeInput.clear();
			}

			for (const index of [0, 1] as const) if (previousGaits.player.feet[index].lift > 0 && gaits.player.feet[index].lift === 0) audio.footstep(index === 0 ? -1 : 1);
			if (state.mission?.stage === 'extract' && previousMissionStage !== 'extract') { message = 'OBJECTIVE COMPLETE · REACH EXTRACTION AND HOLD FOR 3 SECONDS'; messageUntil = state.time + 7; }
			if (state.events.includes('coolant')) { message = 'COOLANT PURGE / REACTOR STABILIZING'; messageUntil = state.time + 2; }
			const playerDown = state.outcome === 'lost' && state.player.hp <= 0;
			if (playerDown || state.events.includes('rig-defeat')) armorBursts.start(state, state.time);
			if (playerDown) {
				sortieEnding = { owner: state, kind: 'fall', startedAt: frameTime, elapsed: 0 };
				resetInput();
			}
			if (!escape && !training && state.mission && state.outcome === 'won') {
				sortieEnding = { owner: state, kind: 'pickup', startedAt: frameTime, elapsed: 0 };
				resetInput();
			}
			if (escape && state.outcome === 'won') {
				if (replayingEscape) { leaveEscape(); return; }
				const opening = !campaign.introComplete && campaign.mode === 'campaign';
				if (!campaign.introComplete && !replaceCampaign({ ...campaign, introComplete: true })) return;
				if (opening) toTransmission();
				else toShip();
			}
			else if (escape && state.outcome === 'lost') afterSortieEnding(now, function () { audio.reset(); transition(navigation.setScreen('escape-result')); });
			else if (training?.stage === 'complete') transition(navigation.setScreen('training-result'));
			else if (trialSeed !== undefined && state.outcome !== 'playing') {
				const seed = trialSeed, outcome = state.outcome;
				afterSortieEnding(now, function () { showFieldTrial(seed, outcome); });
			}
			else if (situationSim && state.outcome !== 'playing') afterSortieEnding(now, showSituationResult);
			else if (!training && state.outcome !== 'playing') showResult(now);
			else checkpoint();
		},
	});
	const battlefieldVisible = function () {
		return !contextLost && (navigation.screen === 'launch' || navigation.screen === 'playing' || navigation.screen === 'pause-panel' || navigation.screen === 'escape-result' || navigation.screen === 'result' || navigation.screen === 'training-result' || navigation.screen === 'situation-result' || navigation.screen === 'field-trial');
	};
	// The terminal combat tick settles the campaign. Only the final shot and
	// result reveal run on foreground frame time after combat has stopped.
	const advanceSortieEnding = function (dt: number) {
		if (sortieEnding?.owner !== state) sortieEnding = undefined;
		if (!sortieEnding) return 0;
		if (battlefieldActive() && frameTime > sortieEnding.startedAt) {
			const duration = sortieEnding.kind === 'pickup' ? PICKUP_DURATION : RIG_DEFEAT_SECONDS;
			const previous = sortieEnding.elapsed;
			sortieEnding.elapsed = Math.min(duration, previous + dt);
			if (sortieEnding.kind === 'pickup') {
				if (previous < PICKUP_LAND_AT && sortieEnding.elapsed >= PICKUP_LAND_AT) audio.launchCue('land');
				if (previous < PICKUP_LIFT_AT && sortieEnding.elapsed >= PICKUP_LIFT_AT) audio.launchCue('lift');
			}
			if (sortieEnding.elapsed === duration && sortieEnding.reveal) {
				const reveal = sortieEnding.reveal;
				delete sortieEnding.reveal;
				reveal(frameTime);
			}
		}
		return sortieEnding.elapsed;
	};
	world.addSystem('battlefield-presentation').inPhase('postUpdate').before(transform3DSystems.propagate).setProcess(function ({ dt }) {
		if (battlefieldVisible()) {
			world.enableSystemGroup('renderer3d');
			const elapsed = advanceSortieEnding(dt);
			const pickupElapsed = sortieEnding?.kind === 'pickup' ? elapsed : undefined;
			const defeatElapsed = sortieEnding?.kind === 'fall' ? elapsed : 0;
			presentation.prepare(state, aim, gaits, false, hudObstructions, inputMode === 'gamepad' || profile.settings.couchUI, false, defeatElapsed, pickupElapsed);
			if (navigation.screen === 'launch') return;
			const contacts = touchContacts();
			const touchTracking = aimMode === 'touch' && acquiredTargetId !== undefined;
			const locked = touchTracking ? contacts.find(function (contact) { return contact.id === acquiredTargetId; })
				: aimMode === 'target' ? touchTargeting.resolve(contacts) : undefined;
			const groundAnchor = aimMode === 'touch' ? touchFacing.anchor() : undefined;
			const lockScreen = locked?.screen ?? (groundAnchor ? presentation.toScreen(groundAnchor) : undefined);
			const rect = canvas.getBoundingClientRect();
			const visible = playing() && lockScreen !== undefined && isContactVisible(lockScreen, rect.width, rect.height, hudObstructions);
			trackingMarker.hidden = !visible || !locked;
			facingMarker.hidden = !visible || Boolean(locked);
			if (visible && lockScreen) {
				const marker = locked ? trackingMarker : facingMarker;
				const field = container.getBoundingClientRect();
				marker.style.left = `${rect.left - field.left + lockScreen.x}px`;
				marker.style.top = `${rect.top - field.top + lockScreen.y}px`;
			}
			element('touch-target-status').textContent = locked ? `TRACKING / ${locked.label}` : touchTracking ? 'TRACKING / OFF SCREEN'
				: aimMode === 'touch' ? touchFacing.active() ? 'FACING LOCK / TAP BOX' : 'FORWARD / TAP TO AIM' : 'MANUAL / TAP A HOSTILE';
			for (const action of ['target-nearest', 'target-next', 'touch-nearest', 'touch-next'] as const) element(action).toggleAttribute('disabled', contacts.length === 0);
		} else world.disableSystemGroup('renderer3d');
	});
	world.addSystem('browser-feedback').inPhase('render').setPriority(-100).setProcess(function () {
		const now = frameTime;
		audio.update(audioFrame(now));
		if (battlefieldActive()) {
			const elapsed = sortieEnding?.owner === state && sortieEnding.kind === 'fall' ? sortieEnding.elapsed : 0;
			const cue = armorBursts.advance(state, state.time + elapsed);
			if (cue) audio.armorBurst(cue);
		}
		if (navigation.screen === 'rig-bay' && !navigation.auxiliary && focused && !document.hidden) {
			for (const id of INTRO_FRAMES) {
				const modelCanvas = element(`intro-${id}`).querySelector('canvas');
				if (!modelCanvas || modelCanvas.dataset['hangarFailed'] === 'true') continue;
				let view = rigPreviews.get(id);
				if (!view) {
					try { view = createHangarPreview(modelCanvas); rigPreviews.set(id, view); }
					catch (error: unknown) { view?.dispose(); view = undefined; modelCanvas.dataset['hangarFailed'] = 'true'; console.warn('Rig preview unavailable', error); }
				}
				view?.setFrame(id, undefined, profile.settings.mechSkin); view?.render();
			}
		}
		if (navigation.screen === 'mechbay' && !navigation.auxiliary && focused && !document.hidden) {
			const modelCanvas = element('mechbay').querySelector<HTMLCanvasElement>('[data-hangar-frame]');
			if (modelCanvas && modelCanvas.clientWidth > 0 && modelCanvas.clientHeight > 0) {
				const view = hangar.forCanvas(modelCanvas);
				const bay = element('mechbay');
				const slot = editor.slot ?? Number(bay.dataset['inspectionSlot'] ?? 0);
				view?.setFrame(rigFrameId(campaign.selectedFrame), editor.loadout.flatMap(function (weapon, index) { return weapon === null ? [] : [index]; }), profile.settings.mechSkin);
				view?.render(bay.dataset['view'] === 'loadout' && slot < editor.loadout.length ? slot : null);
			}
		}
		if (navigation.screen === 'market' && !navigation.auxiliary && focused && !document.hidden) {
			marketPreview.releaseDetached();
			const canvas = element('market').querySelector<HTMLCanvasElement>('canvas[data-market-model]');
			const model = canvas?.dataset['marketModel'];
			if (canvas && canvas.clientWidth && canvas.clientHeight && isFrameId(model)) {
				const view = marketPreview.forCanvas(canvas);
				view?.setFrame(model, undefined, profile.settings.mechSkin);
				view?.render();
			}
		}
		if (battlefieldVisible()) presentation.drawOverlay(indicatorInfo);
		if (now - lastHud > 80 || lastHud === 0) { updateHud(); lastHud = now; }
	});
	const tick = function (now: number) {
		if (stopped) return;
		const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0; previous = now;
		frameTime = now;
		world.update(elapsed);
		frame = requestAnimationFrame(tick);
	};
	updateSettings(); updateDifficulty(); refreshCampaign();
	if (rigTestEnabled) {
		const rigTest = mountRigTest(container, profile.settings, function (initial) {
			training = undefined; escape = false;
			state = combatRuntime.attach(initial); gaits = createGaits(state);
			presentation.resetZoom(); pointer = undefined; aim = { x: 900, y: 450 };
			aimMode = defaultAimMode();
			message = ''; messageUntil = 0; terminalUntil = 0;
			audio.reset(); transition(navigation.setScreen('playing', true));
		}, function () { return state; }, presentation);
		onCleanup(rigTest);
	} else if (trialSeed !== undefined) showFieldTrial(trialSeed);
	else syncScreen();
	frame = requestAnimationFrame(tick);
	return function () {
		if (stopped) return; stopped = true;
		checkpoint(); cancelAnimationFrame(frame); abort.abort(); resetInput();
	};
});
if (import.meta.hot) import.meta.hot.dispose(shutdown);
