import { rigName } from './rigs';
import { companyRank, getContractTier, reputationProgress, unlockedMissionTier } from './reputation';
import { ACQUISITION_SECONDS, commandTargetName, missionOpposition } from './missions';
import { DEFENSE_APPROACH_BRIEFING } from './defense-layout';
import { getJumpRoute, getSystemIntel, JUMP_FARE_PER_LEG, JUMP_RANGE_LY } from './universe';
import { closePlanetDetails, renderTerritoryMap } from './territory-map';
import { html } from 'lit-html';
import { inspectWorkspacePane, renderWorkspace, selectWorkspacePane, textItems, workspaceBackTarget, type WorkspacePane } from './workspace';
import { canStageOperation, FACTIONS, forecastArrival, getContracts, getFaction, getPlanet, getPlannedOperation, getTransmission, reputationLabel, type Campaign } from './campaign';
import { BIOME_NAMES, MISSION_NAMES, type Contract, type MissionKind, type PlanetId } from './campaign-types';
import { getAuthoredStep } from './contract-chains';
import { getOwnedMech, newUpkeepDue, workOrderFor } from './company';
import { renderShipHeader, type ShipScreen } from './company-ui';
import { MissionSurvey } from './mission-survey';
import { live } from 'lit-html/directives/live.js';
import type { ChoicePicker } from './choice-picker';
import { operationPanes, type OperationsActions } from './operations-ui';

export type ShipView = 'rigs' | 'weapons' | 'board' | 'transmission' | 'operations' | 'route' | 'system' | 'loadout' | 'condition' | 'calendar' | 'squad';
export type BriefingOrigin = 'board' | 'transmission';
const OBJECTIVES: Readonly<Record<Exclude<MissionKind, 'assassination'>, string>> = {
	defend: 'Hold the relay against the assault. Keep its integrity above zero, then return to extraction.',
	demolition: 'Find and destroy the marked installation. Its garrison is optional; extraction is required.',
	raid: 'Destroy all three marked installations in any order, then extract. Defenders are optional.',
	recovery: 'Hold the cache zone for five uninterrupted seconds, then extract with the data. Guards are optional.',
	acquisition: `Activate three beacons within ${ACQUISITION_SECONDS / 60} minutes: hold each zone for three seconds. Activated beacons stay active. Then extract.`,
	clearance: 'Sweep the marked sectors and eliminate every hostile. Extract once the area is clear.',
};
const signed = function (value: number) { return `${value > 0 ? '+' : ''}${value}`; };

export interface BridgeActions extends OperationsActions {
	picker: ChoicePicker;
	previewContract: (id: string) => void;
	selectPlanet: (planetId: PlanetId) => void;
	selectContract: (id: string, origin: BriefingOrigin, opener: EventTarget | null) => void;
	travel: () => void;
	stage: (contract: Contract) => void;
	deploy: () => void;
	abandon: () => void;
	openLastReport: () => void;
	training: () => void;
	title: () => void;
	navigate: (screen: ShipScreen, view?: ShipView) => void;
	plotStoryCourse: (planet: PlanetId) => void;
	settings: () => void;
	handbook: () => void;
}

const renderCampaignFooter = function (saved: boolean, actions: BridgeActions) {
	return html`<footer class="bridge-footer"><div><button @click=${actions.training}>TRAINING</button><button @click=${actions.handbook}>HANDBOOK</button><button @click=${actions.settings}>SETTINGS</button></div><span class="ship-controller-status" hidden></span><span class=${saved ? 'save-notice' : 'save-notice storage-warning'} role="status">${saved ? 'COMPANY SAVED' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span><a href="https://deegeegames.com/">← DEEGEE GAMES</a></footer>`;
};

export const renderStarmap = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, saved: boolean, actions: BridgeActions) {
	const planet = getPlanet(destination);
	const forecast = forecastArrival(campaign, destination);
	const intel = getSystemIntel(forecast, destination);
	const local = destination === campaign.planetId;
	const { distanceLy, fare } = getJumpRoute(campaign.planetId, destination);
	const upkeep = forecast === campaign ? 0 : newUpkeepDue(campaign, 1);
	const transit = local ? 'Current location' : `${distanceLy} LY · 1 DAY · ${fare.toLocaleString()} CR${upkeep ? ` + ${upkeep.toLocaleString()} CR UPKEEP` : ''}`;
	const travelLock = campaign.active ? 'CONTRACT ACTIVE' : campaign.operations?.length ? 'OPERATIONS STAGED'
		: !local && forecast === campaign ? 'TRANSIT UNAVAILABLE'
		: campaign.credits < fare ? `NEED ${(fare - campaign.credits).toLocaleString()} CR MORE` : '';
	const playerFrame = campaign.lineup[0]?.frameId;
	const mech = playerFrame ? getOwnedMech(campaign, playerFrame) : undefined;
	const order = mech ? workOrderFor(campaign, mech.frameId) : undefined;
	const storyPlanets = getTransmission(campaign)?.offers.map(function (step) { return step.contract.planetId; }) ?? [];
	const storyHere = storyPlanets.includes(destination);
	const openTransmission = function () { actions.navigate('bridge', 'transmission'); };
	const details = html`
		<span class="eyebrow">${local ? 'WAYFARER / IN ORBIT' : `ARRIVAL / DAY ${forecast.day}`}</span>
		<h3>${planet.name}</h3>
		${storyHere ? html`<p class="system-transmission">◆ CAMPAIGN SIGNAL</p>` : ''}
		<p class="system-control">${intel.owner ? getFaction(intel.owner).name : 'Unclaimed space'}</p>
		<p class=${intel.conflict ? 'system-conflict' : 'system-quiet'}>${intel.conflict ? '◌ ACTIVE CONFLICT ZONE' : 'NO ACTIVE CONFLICT'}</p>
		<p class="planet-summary">${intel.conflict ? intel.participants.map(function (id) { return getFaction(id).name; }).join(' / ') : 'No ordinary contracts posted.'}</p>
		<p class="planet-summary"><b>${BIOME_NAMES[planet.biome]}</b> · ${planet.description}</p>
		<div class="planet-transit">${transit}</div>
		<div class="planet-actions">${local && storyHere ? html`<button class="primary" @click=${function () { closePlanetDetails(root); openTransmission(); }}>OPEN SIGNAL →</button>` : html`<button class="primary" ?disabled=${local || Boolean(travelLock)} @click=${function () { actions.travel(); closePlanetDetails(root); }}>${local ? 'ORBIT ESTABLISHED' : travelLock || 'JUMP HERE →'}</button>`}<button @click=${function () { closePlanetDetails(root); actions.navigate('bridge', 'board'); }}>CONTRACTS →</button></div>
		<button class="planet-full-intel" @click=${function (event: Event) { closePlanetDetails(root); inspectWorkspacePane(root, 'system', event.currentTarget); }}>FULL SYSTEM INTEL →</button>`;
	const panes: WorkspacePane[] = [
		{ id: 'route', label: 'Starmap', items: [renderTerritoryMap(root, campaign, destination, actions.selectPlanet, details, storyPlanets)] },
		{ id: 'system', label: 'System intel', items: [
			html`<span class="eyebrow">${local ? 'WAYFARER / IN ORBIT' : `ARRIVAL FORECAST / DAY ${forecast.day}`}</span><h3>${planet.name}</h3><p class="system-control">${intel.owner ? getFaction(intel.owner).name : 'Unclaimed space'}</p>`,
			...(storyHere ? [html`<p class="system-transmission">◆ CAMPAIGN SIGNAL</p>`] : []),
			html`<p class=${intel.conflict ? 'system-conflict' : 'system-quiet'}>${intel.conflict ? '◌ ACTIVE CONFLICT ZONE' : 'NO ACTIVE CONFLICT'}</p>`,
			...textItems(intel.conflict ? intel.participants.map(function (id) { return getFaction(id).name; }).join(' / ') : 'No ordinary contracts posted.'),
			...textItems(`${BIOME_NAMES[planet.biome]} · ${planet.description}`),
			html`<div class="planet-transit">${transit}</div>`,
			...textItems(`Each full or partial ${JUMP_RANGE_LY}-light-year leg costs ${JUMP_FARE_PER_LEG} CR.`),
			...textItems('Fronts move with calendar days. Victories strengthen the employer locally; defeat or abort strengthens the opposition.'),
			...textItems(order ? `Player rig in Engineering until day ${order.readyDay}.` : mech ? `${rigName(mech.frameId)} · ${Math.ceil(mech.integrity)}% integrity.` : 'Assign a rig to the player pilot before deploying.'),
		], actions: html`${local && storyHere ? html`<button class="primary" @click=${openTransmission}>OPEN SIGNAL →</button>` : html`<button id="bridge-travel" class="primary" ?disabled=${local || Boolean(travelLock)} @click=${actions.travel}>${local ? 'ORBIT ESTABLISHED' : travelLock || `JUMP TO ${planet.name.toUpperCase()} →`}</button>`}<button @click=${function () { actions.navigate('bridge', 'board'); }}>CONTRACTS →</button>` },
	];
	renderWorkspace(root, renderShipHeader(campaign, 'starmap', actions), panes, renderCampaignFooter(saved, actions), 'route', [
		{ id: 'route', label: 'Map', panes: ['route'] },
		{ id: 'system', label: 'Intel', panes: ['system'] },
	]);
};

const transmissionPane = function (root: HTMLElement, campaign: Campaign, transmission: NonNullable<ReturnType<typeof getTransmission>>, actions: BridgeActions): WorkspacePane {
	const { title, last, offers, committed } = transmission;
	const active = campaign.active;
	const retry = committed && !active;
	const playerFrame = campaign.lineup[0]?.frameId;
	const damaged = playerFrame ? (getOwnedMech(campaign, playerFrame)?.integrity ?? 100) < 100 : false;
	const choice = offers.length > 1;
	const opening = !last && !committed ? offers[0] : undefined;
	const board = function () { selectWorkspacePane(root, 'board', true); };
	return {
		id: 'transmission', label: 'Bridge transmission',
		items: [
			html`<div class="signal-heading"><span class="eyebrow">${offers.length ? 'WAYFARER / CAMPAIGN SIGNAL' : 'WAYFARER / SIGNAL CLOSED'}</span><h2>${title}</h2>${opening ? html`<p class="workspace-copy">${opening.pitch}</p>` : ''}</div>`,
			...(retry ? textItems(`The contact is holding the job for you. Retry when ready.${damaged ? ' Repair your frame in Engineering for 0 CR.' : ''}`) : last ? textItems(last.success) : []),
			...(choice ? textItems('Choose one offer when you commit the day. Both offers stay open while you take other work.') : []),
			...offers.map(function ({ contract, contact, label, pitch }) {
				return html`<article class="signal-contact"><span class="eyebrow">${contact}</span>${choice ? html`<h3>${label}</h3>` : ''}${opening?.contract.id === contract.id ? '' : html`<p class="workspace-copy">${pitch}</p>`}<small>${getPlanet(contract.planetId).name} · ${contract.reward.toLocaleString()} CR</small></article>`;
			}),
			...(!last && !committed ? textItems('Optional contract. Take ordinary work from the Board whenever you like.') : []),
		],
		actions: active ? html`<button class="primary" @click=${function (event: Event) { actions.selectContract(active.id, 'transmission', event.currentTarget); }}>ACTIVE CONTRACT →</button>`
			: offers.length ? html`${offers.map(function ({ contract, label }) {
				const local = contract.planetId === campaign.planetId;
				const button = local ? choice ? `REVIEW ${label.toUpperCase()}` : retry ? 'RETRY BRIEFING' : 'REVIEW BRIEFING' : `PLOT COURSE TO ${getPlanet(contract.planetId).name.toUpperCase()}`;
				if (!local && offers.find(function (offer) { return offer.contract.planetId === contract.planetId; })?.contract.id !== contract.id) return '';
				return html`<button class="primary" data-story-offer=${contract.id} @click=${function (event: Event) { if (local) actions.selectContract(contract.id, 'transmission', event.currentTarget); else actions.plotStoryCourse(contract.planetId); }}>${button} →</button>`;
			})}${retry && damaged ? html`<button @click=${function () { actions.navigate('engineering', 'condition'); }}>ENGINEERING →</button>` : ''}`
			: html`<button class="primary" @click=${board}>CONTRACT BOARD →</button><button @click=${function () { actions.navigate('starmap', 'route'); }}>STARMAP →</button>`,
	};
};

export const renderBridge = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, selection: string | undefined, saved: boolean, actions: BridgeActions, briefingOrigin: BriefingOrigin) {
	const planet = getPlanet(destination);
	const forecast = forecastArrival(campaign, destination);
	const unlocked = unlockedMissionTier(campaign);
	const postings = new Map<MissionKind, Contract>();
	for (const contract of getContracts(forecast, destination)) {
		if (contract.tier > unlocked.tier || campaign.reputation[contract.employer] < contract.requiredReputation) continue;
		if (contract.tier > (postings.get(contract.kind)?.tier ?? 0)) postings.set(contract.kind, contract);
	}
	const active = campaign.active;
	const contracts = active ? [active] : [...postings.values()];
	const transmission = getTransmission(campaign);
	const briefingParent = transmission ? briefingOrigin : 'board';
	const backFromBriefing = function () {
		const back = workspaceBackTarget(root);
		if (back) back();
		else selectWorkspacePane(root, briefingParent);
	};
	const storyOffer = transmission?.offers.find(function ({ contract }) { return contract.id === selection && contract.planetId === destination; });
	const selected = active ?? storyOffer?.contract ?? contracts.find(function (contract) { return contract.id === selection; }) ?? contracts[0];
	let inspected = selected;
	const previewPosting = function (contract: Contract) {
		if (inspected?.id === contract.id) return;
		inspected = contract;
		actions.previewContract(contract.id);
		for (const row of root.querySelectorAll<HTMLButtonElement>('.contract-card')) row.setAttribute('aria-pressed', String(row.value === contract.id));
		const survey = root.querySelector('mission-survey');
		if (survey instanceof MissionSurvey) survey.contract = contract;
	};
	const planned = getPlannedOperation(campaign, selected?.id);
	const local = destination === campaign.planetId;
	const storyStep = selected ? getAuthoredStep(campaign.story, selected) : undefined;
	const localSignal = transmission?.offers.some(function ({ contract }) { return contract.planetId === campaign.planetId; });
	const signalCopy = `A campaign contract is available at ${getPlanet(campaign.planetId).name}. Open Signal to review the offer.`;
	const signalAction = localSignal ? html`<button class="primary" @click=${function () { actions.navigate('bridge', 'transmission'); }}>OPEN LOCAL SIGNAL →</button>` : undefined;
	const emptyBoard = contracts.length === 0;
	const panes: WorkspacePane[] = [
		...(transmission ? [transmissionPane(root, campaign, transmission, actions)] : []),
		{ id: 'board', label: 'Contracts', items: [
			...(emptyBoard ? textItems(localSignal ? `No ordinary postings at ${planet.name}. ${signalCopy}` : `No contracts at ${planet.name}. Use the Starmap to find a conflict zone and travel there for work.`) : []),
			...contracts.map(function (contract) {
				const employer = getFaction(contract.employer);
				return html`<button class="contract-card" value=${contract.id} aria-pressed=${live(String(contract.id === selected?.id))}
					@focus=${function () { previewPosting(contract); }}
					@pointermove=${function (event: PointerEvent) {
						if (event.pointerType === 'mouse' && event.currentTarget instanceof HTMLButtonElement && event.currentTarget !== document.activeElement) event.currentTarget.focus({ preventScroll: true });
					}} @click=${function (event: Event) { actions.selectContract(contract.id, 'board', event.currentTarget); }} data-contract=${contract.kind}><span class="contract-type">${MISSION_NAMES[contract.kind]}</span><b>${contract.title}</b><span class="contract-employer">${employer.name}</span><span class="contract-bottom"><strong>${contract.reward.toLocaleString()} CR</strong><small>${active ? 'ACCEPTED' : getPlannedOperation(campaign, contract.id) ? 'STAGED' : `+${contract.favor} FAVOR / −${contract.hostility} OPPOSITION`}</small></span></button>`;
			}),
			...(!emptyBoard ? textItems(active ? `${getFaction(active.opponent).name}: −${active.hostility} reputation applied on acceptance. Assign pilots and rigs before deployment.` : `Current postings on ${planet.name}. ${local ? 'Local uplink.' : `Arrival-day ${forecast.day} forecast; travel here to accept work.`}`) : []),
		], ...(emptyBoard ? { actions: signalAction ?? html`<button @click=${function () { actions.navigate('starmap', 'route'); }}>FIND CONFLICT ZONE →</button>` } : {}) },
		{ id: 'briefing', label: 'Briefing', items: selected ? [
			html`<span class="eyebrow">${getPlanet(selected.planetId).name.toUpperCase()} / ${MISSION_NAMES[selected.kind].toUpperCase()}</span><h2>${selected.title}</h2>`,
			...(storyStep ? [html`<span class="eyebrow">${storyStep.contact} · COMMANDER REQUIRED</span>`, ...textItems(storyStep.pitch)] : []),
			...textItems(selected.briefing),
			...(selected.fieldLayout === 'extended-defense' ? textItems(DEFENSE_APPROACH_BRIEFING) : []),
			...textItems(missionOpposition(selected)),
			...textItems(`SUCCESS: +${getContractTier(selected).reputation} company reputation. ${reputationProgress(campaign)}.`),
			...textItems('Success expands employer influence around this system. Failure or abort strengthens the opposition. Repeated victories can move the border and end a local conflict.'),
			...(storyStep ? [] : [html`<span class="eyebrow">SURFACE OBJECTIVE</span>`, ...textItems(selected.kind === 'assassination' ? `Track down the marked ${commandTargetName(selected)}. Destroy it and reach extraction alive.` : OBJECTIVES[selected.kind])]),
			...(storyOffer && transmission && transmission.offers.length > 1 ? textItems('Committing the day with this offer closes the other signal.') : []),
			html`<p class="stake-line"><small>EMPLOYER</small>${getFaction(selected.employer).name}<br><strong class="positive">+${selected.favor} on success</strong></p>`,
			html`<p class="stake-line"><small>OPPOSITION</small>${getFaction(selected.opponent).name}<br><strong class="negative">−${selected.hostility} ${active ? 'applied on acceptance' : 'on day commitment'}</strong></p>`,
			html`<p class="stake-line"><small>PAYMENT AFTER EXTRACTION</small>${selected.reward.toLocaleString()} CR</p>`,
			...textItems('Rig damage carries over. Failure or abort keeps the standing penalty and strengthens the opposition.'),
		] : [], actions: selected ? html`${active ? html`<button id="bridge-deploy" class="primary" @click=${actions.deploy}>PREPARE SQUAD ↘</button><button class="text-button" @click=${actions.abandon}>ABORT</button>`
			: planned ? html`<button class="primary" @click=${function () { actions.editOperation(selected.id); }}>EDIT LINEUP ↗</button>`
				: html`<button id="bridge-accept" class="primary" ?disabled=${!local || !canStageOperation(campaign, selected)} @click=${function () { actions.stage(selected); }}>${!local ? 'TRAVEL HERE TO STAGE' : 'STAGE CONTRACT'} →</button>${!local ? html`<button @click=${function () { actions.navigate('starmap', 'system'); }}>STARMAP / JUMP →</button>` : ''}`}
			<button class="text-button" @click=${backFromBriefing}>← BACK TO ${briefingParent === 'transmission' ? 'SIGNAL' : 'BOARD'}</button>` : html`` },
		...(selected ? [{ id: 'survey', label: 'Field survey', scrollable: true, items: [html`<mission-survey .contract=${live(selected)}></mission-survey>`] }] : []),
		...operationPanes(campaign, actions),
		{ id: 'factions', label: 'Reputation', secondary: true, items: [
			html`<span class="eyebrow">COMPANY REPUTATION</span><h2>RANK ${companyRank(campaign)} / 15</h2>`,
			...textItems(reputationProgress(campaign)),
			...textItems('Successful extractions build company reputation. Higher rank opens tougher contracts and better weapons. Faction standing affects which jobs each employer offers.'),
			...FACTIONS.map(function (faction) { const value = campaign.reputation[faction.id]; return html`<div class="faction-standing" style="--faction-color:${faction.color}"><div><b>${faction.name}</b><strong>${signed(value)}</strong></div><span>${reputationLabel(value)}</span><div class="reputation-track"><i style="left:${value < 0 ? 50 + value / 2 : 50}%;width:${Math.abs(value) / 2}%"></i></div></div>`; }),
			...(campaign.lastResult ? textItems(`${campaign.lastResult.aborted ? 'ABORTED' : campaign.lastResult.won ? 'COMPLETED' : 'FAILED'}: ${campaign.lastResult.contract.title} · ${campaign.lastResult.payout.toLocaleString()} CR · ${signed(campaign.lastResult.favor)} employer favor · +${campaign.lastResult.companyReputation} company reputation`) : []),
		], ...(campaign.lastOperationDay ? { actions: html`<button class="secondary" @click=${actions.openLastReport}>OPEN LATEST DEBRIEF →</button>` } : {}) },
	];
	renderWorkspace(root, renderShipHeader(campaign, 'bridge', actions), panes, renderCampaignFooter(saved, actions), 'board', [
		{ id: 'board', label: 'Board', panes: emptyBoard ? ['board'] : ['board', 'survey'], select: function () {
			if (contracts[0] && storyOffer && !active) previewPosting(contracts[0]);
		} },
		...(transmission ? [{ id: 'transmission', label: 'Signal', panes: ['transmission'] }] : []),
		...(selected ? [{ id: 'briefing', label: 'Briefing', parentTab: briefingParent, panes: ['briefing', 'survey'] }] : []),
		{ id: 'operations', label: 'Operations', panes: ['operations-heading', 'operations', 'day-orders'] },
		{ id: 'factions', label: 'Reputation', panes: ['factions'] },
	]);
};
