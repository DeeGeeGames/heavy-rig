import { getSystemIntel } from './universe';
import { renderTerritoryMap } from './territory-map';
import { selectWorkspacePane } from './workspace';
import { html } from 'lit-html';
import { renderWorkspace, textItems, type WorkspacePane } from './workspace';
import { canAcceptContract, FACTIONS, getContracts, getFaction, getPlanet, reputationLabel, travelTo, type Campaign } from './campaign';
import type { Contract, MissionKind, PlanetId } from './campaign-types';
import { getOwnedMech, workOrderFor } from './company';
import { renderShipHeader, type ShipScreen } from './company-ui';
import { getFrame } from './frames';

export const MISSION_NAMES: Readonly<Record<MissionKind, string>> = {
	defend: 'Garrison defense', demolition: 'Facility demolition', assassination: 'Priority target', clearance: 'Area clearance',
};
const OBJECTIVES: Readonly<Record<MissionKind, string>> = {
	defend: 'Hold the relay against the assault. Keep its integrity above zero, then return to extraction.',
	demolition: 'Find and destroy the marked installation. Its garrison is optional; extraction is required.',
	assassination: 'Track down the marked command frame. Destroy it and reach extraction alive.',
	clearance: 'Sweep the marked sectors and eliminate every hostile. Extract once the area is clear.',
};
const signed = function (value: number) { return `${value > 0 ? '+' : ''}${value}`; };

export interface BridgeActions {
	selectPlanet: (planetId: PlanetId) => void;
	selectContract: (id: string) => void;
	travel: () => void;
	accept: (contract: Contract) => void;
	deploy: () => void;
	abandon: () => void;
	training: () => void;
	title: () => void;
	navigate: (screen: ShipScreen, view?: 'board' | 'route' | 'system') => void;
	settings: () => void;
	handbook: () => void;
}

const renderCampaignFooter = function (saved: boolean, actions: BridgeActions) {
	return html`<footer class="bridge-footer"><div><button @click=${actions.training}>TRAINING</button><button @click=${actions.handbook}>HANDBOOK</button><button @click=${actions.settings}>SETTINGS</button></div><span class="ship-controller-status" hidden></span><span class=${saved ? 'save-notice' : 'save-notice storage-warning'} role="status">${saved ? 'COMPANY SAVED' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span><a href="https://deegeegames.com/">← DEEGEE GAMES</a></footer>`;
};

export const renderStarmap = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, saved: boolean, actions: BridgeActions) {
	const planet = getPlanet(destination);
	const forecast = destination === campaign.planetId ? campaign : travelTo(campaign, destination);
	const intel = getSystemIntel(forecast, destination);
	const local = destination === campaign.planetId;
	const active = campaign.active;
	const mech = getOwnedMech(campaign);
	const order = mech ? workOrderFor(campaign, mech.frameId) : undefined;
	const details = html`
		<span class="eyebrow">${local ? 'WAYFARER / IN ORBIT' : `ARRIVAL / DAY ${forecast.day}`}</span>
		<h3>${planet.name}</h3>
		<p class="system-control">${intel.owner ? getFaction(intel.owner).name : 'Unclaimed space'}</p>
		<p class=${intel.conflict ? 'system-conflict' : 'system-quiet'}>${intel.conflict ? '◌ ACTIVE CONFLICT ZONE' : 'NO ACTIVE CONFLICT'}</p>
		<p class="planet-summary">${intel.conflict ? intel.participants.map(function (id) { return getFaction(id).name; }).join(' / ') : 'No military contracts posted.'}</p>
		<p class="planet-summary">${planet.description}</p>
		<div class="planet-transit">${local ? 'Current location' : 'TRANSIT · 1 DAY · 0 CR'}</div>
		<div class="planet-actions"><button class="primary" ?disabled=${local || Boolean(active)} @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); actions.travel(); }}>${local ? 'ORBIT ESTABLISHED' : active ? 'CONTRACT ACTIVE' : 'JUMP HERE →'}</button><button @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); actions.navigate('bridge', 'board'); }}>CONTRACTS →</button></div>
		<button class="planet-full-intel" @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); selectWorkspacePane(root, 'system'); }}>FULL SYSTEM INTEL →</button>`;
	const panes: WorkspacePane[] = [
		{ id: 'route', label: 'Starmap', items: [renderTerritoryMap(root, campaign, destination, actions.selectPlanet, details)] },
		{ id: 'system', label: 'System intel', items: [
			html`<span class="eyebrow">${local ? 'WAYFARER / IN ORBIT' : `ARRIVAL FORECAST / DAY ${forecast.day}`}</span><h3>${planet.name}</h3><p class="system-control">${intel.owner ? getFaction(intel.owner).name : 'Unclaimed space'}</p>`,
			html`<p class=${intel.conflict ? 'system-conflict' : 'system-quiet'}>${intel.conflict ? '◌ ACTIVE CONFLICT ZONE' : 'NO ACTIVE CONFLICT'}</p>`,
			...textItems(intel.conflict ? intel.participants.map(function (id) { return getFaction(id).name; }).join(' / ') : 'No military contracts posted. Select a conflict zone on the Starmap.'),
			...textItems(planet.description),
			...textItems('Fronts move with calendar days. Victories strengthen the employer locally; defeat or abort strengthens the opposition.'),
			...textItems(order ? `Frame in Engineering until day ${order.readyDay}.` : mech ? `${getFrame(mech.frameId).name} · ${Math.ceil(mech.integrity)}% integrity. Transit: one day, no fuel cost.` : 'Select a company frame before deployment.'),
		], actions: html`<button id="bridge-travel" class="primary" ?disabled=${local || Boolean(active)} @click=${actions.travel}>${local ? 'ORBIT ESTABLISHED' : active ? 'CONTRACT ACTIVE' : `JUMP TO ${planet.name.toUpperCase()} →`}</button><button @click=${function () { actions.navigate('bridge', 'board'); }}>CONTRACTS →</button>` },
	];
	renderWorkspace(root, renderShipHeader(campaign, 'starmap', actions.navigate), panes, renderCampaignFooter(saved, actions), 'route', [
		{ id: 'route', label: 'Map', panes: ['route'] },
		{ id: 'system', label: 'Intel', panes: ['system'] },
	]);
};

export const renderBridge = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, selection: string | undefined, saved: boolean, actions: BridgeActions) {
	const planet = getPlanet(destination);
	const forecast = destination === campaign.planetId ? campaign : travelTo(campaign, destination);
	const contracts = getContracts(forecast, destination);
	const selected = campaign.active ?? contracts.find(function (contract) { return contract.id === selection; }) ?? contracts.find(function (contract) { return canAcceptContract(campaign, contract); }) ?? contracts[0];
	const local = destination === campaign.planetId;
	const active = campaign.active;
	const panes: WorkspacePane[] = [
		{ id: 'board', label: 'Contracts', items: [
			...(!active && !contracts.length ? textItems(`No contracts at ${planet.name}. Use the Starmap to find a conflict zone and travel there for work.`) : []),
			...(active ? [active] : contracts).map(function (contract) {
				const employer = getFaction(contract.employer); const locked = campaign.reputation[contract.employer] < contract.requiredReputation;
				return html`<button class="contract-card" aria-pressed=${contract.id === selected?.id} @click=${function () { actions.selectContract(contract.id); }} data-contract=${contract.kind}><span class="contract-type">${MISSION_NAMES[contract.kind]} <em>TIER ${contract.tier}</em></span><b>${contract.title}</b><span class="contract-employer" style="color:${employer.color}">${employer.name}</span><span class="contract-bottom"><strong>${contract.reward.toLocaleString()} CR</strong><small>${active ? 'ACCEPTED' : locked ? `NEEDS ${signed(contract.requiredReputation)} REP` : `+${contract.favor} FAVOR / −${contract.hostility} OPPOSITION`}</small></span></button>`;
			}),
			...textItems(active ? `${getFaction(active.opponent).name}: −${active.hostility} reputation applied on acceptance. Review your owned frame and equipment before deployment.` : `Current postings on ${planet.name}. ${local ? 'Local uplink.' : `Arrival-day ${forecast.day} forecast; travel here to accept work.`}`),
			...textItems('Postings follow the factions on the local front and change after a contract or jump. Favor unlocks higher-tier work and better rates; entry contracts stay available.'),
		], actions: !active && !contracts.length ? html`<button @click=${function () { actions.navigate('starmap', 'route'); }}>FIND CONFLICT ZONE →</button>` : html`` },
		{ id: 'briefing', label: 'Briefing', items: selected ? [
			html`<span class="eyebrow">${getPlanet(selected.planetId).name.toUpperCase()} / ${MISSION_NAMES[selected.kind].toUpperCase()}</span><h2>${selected.title}</h2>`,
			...textItems(selected.briefing),
			...textItems('Success expands employer influence around this system. Failure or abort strengthens the opposition. Repeated victories can move the border and end a local conflict.'),
			html`<span class="eyebrow">SURFACE OBJECTIVE</span>`, ...textItems(OBJECTIVES[selected.kind]),
			html`<p class="stake-line"><small>EMPLOYER</small>${getFaction(selected.employer).name}<br><strong class="positive">+${selected.favor} on success</strong></p>`,
			html`<p class="stake-line"><small>OPPOSITION</small>${getFaction(selected.opponent).name}<br><strong class="negative">−${selected.hostility} ${active ? 'applied on acceptance' : 'on acceptance'}</strong></p>`,
			html`<p class="stake-line"><small>PAYMENT AFTER EXTRACTION</small>${selected.reward.toLocaleString()} CR</p>`,
			...textItems('Persistent frame damage · installed company loadout. Failure or abort keeps the opposition penalty. Leaving or reloading a deployed sortie records an abort and retains damage.'),
		] : textItems('Select a contract to review its briefing, or find an active conflict zone on the Starmap.'), actions: selected ? active ? html`<button id="bridge-deploy" class="primary" @click=${actions.deploy}>PREPARE MECH ↘</button><button class="text-button" @click=${actions.abandon}>ABORT</button>` : html`<button id="bridge-accept" class="primary" ?disabled=${!local || !canAcceptContract(campaign, selected)} @click=${function () { actions.accept(selected); }}>${!local ? 'TRAVEL HERE TO ACCEPT' : campaign.reputation[selected.employer] < selected.requiredReputation ? `NEEDS ${signed(selected.requiredReputation)} REP` : `ACCEPT · −${selected.hostility} OPPOSITION`} →</button>${!local ? html`<button @click=${function () { actions.navigate('starmap', 'system'); }}>STARMAP / JUMP →</button>` : ''}` : html`` },
		{ id: 'factions', label: 'Factions', secondary: true, items: [
			...FACTIONS.map(function (faction) { const value = campaign.reputation[faction.id]; return html`<div class="faction-standing" style="--faction-color:${faction.color}"><div><b>${faction.name}</b><strong>${signed(value)}</strong></div><span>${reputationLabel(value)}</span><div class="reputation-track"><i style="left:${value < 0 ? 50 + value / 2 : 50}%;width:${Math.abs(value) / 2}%"></i></div></div>`; }),
			...(campaign.lastResult ? textItems(`${campaign.lastResult.aborted ? 'ABORTED' : campaign.lastResult.won ? 'COMPLETED' : 'FAILED'}: ${campaign.lastResult.contract.title} · ${campaign.lastResult.payout.toLocaleString()} CR · ${signed(campaign.lastResult.favor)} employer favor`) : []),
		] },
	];
	renderWorkspace(root, renderShipHeader(campaign, 'bridge', actions.navigate), panes, renderCampaignFooter(saved, actions), 'board', [
		{ id: 'board', label: 'Board', panes: ['board', 'briefing'] },
		{ id: 'factions', label: 'Factions', panes: ['factions'] },
	]);
};
