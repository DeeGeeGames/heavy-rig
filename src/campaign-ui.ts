import { html } from 'lit-html';
import { renderWorkspace, textItems, type WorkspacePane } from './workspace';
import { canAcceptContract, FACTIONS, getContracts, getFaction, getPlanet, PLANETS, reputationLabel, travelTo, type Campaign } from './campaign';
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
	navigate: (screen: ShipScreen) => void;
	settings: () => void;
	handbook: () => void;
}

export const renderBridge = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, selection: string | undefined, saved: boolean, actions: BridgeActions) {
	const planet = getPlanet(destination);
	const contracts = getContracts(destination === campaign.planetId ? campaign : travelTo(campaign, destination), destination);
	const selected = campaign.active ?? contracts.find(function (contract) { return contract.id === selection; }) ?? contracts.find(function (contract) { return canAcceptContract(campaign, contract); }) ?? contracts[0];
	const local = destination === campaign.planetId;
	const active = campaign.active;
	const mech = getOwnedMech(campaign);
	const order = mech ? workOrderFor(campaign, mech.frameId) : undefined;
	const panes: WorkspacePane[] = [
		{ id: 'route', label: 'Route', items: [
			html`<div class="star-map" aria-label="Frontier destinations"><svg class="star-lanes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M 24 62 L 51 27 L 78 58 Z"/></svg>${PLANETS.map(function (world) { return html`<button class="planet-node ${world.id === campaign.planetId ? 'in-orbit' : ''}" style="left:${world.x}%;top:${world.y}%;--planet-color:${world.color}" aria-pressed=${world.id === destination} @click=${function () { actions.selectPlanet(world.id); }} ?disabled=${Boolean(active)} data-planet=${world.id}><span class="planet-orb" aria-hidden="true"></span><b>${world.name}</b><small>${world.id === campaign.planetId ? 'IN ORBIT' : world.biome.toUpperCase()}</small></button>`; })}</div>`,
			html`<span class="eyebrow">${local ? 'CURRENT ORBIT' : 'PLOTTED DESTINATION'}</span><h3>${planet.name}</h3>`,
			...textItems(planet.description), ...textItems('Transit takes one calendar day. No fuel cost. An accepted contract must be finished or aborted before traveling.'),
			html`<p class="workspace-copy">${mech ? `${getFrame(mech.frameId).name} · ${Math.ceil(mech.integrity)}% INTEGRITY` : 'NO FRAME SELECTED'}</p>`,
			...textItems(order ? `In Engineering until day ${order.readyDay}. Advance time or choose another frame.` : mech && mech.integrity <= 0 ? 'Frame disabled. Schedule repairs in Engineering before deployment.' : mech && !mech.loadout.some(function (weapon) { return weapon !== null; }) ? 'Frame unarmed. Fit a purchased weapon in the Mech Bay before deployment.' : 'Your company starts with a Kestrel. Earn credits from contracts to buy weapons and additional frames.'),
		], actions: html`<button id="bridge-travel" class="primary" ?disabled=${local || Boolean(active)} @click=${actions.travel}>${local ? 'ORBIT ESTABLISHED' : active ? 'CONTRACT ACTIVE' : `JUMP TO ${planet.name.toUpperCase()} →`}</button>` },
		{ id: 'board', label: 'Contracts', items: [
			...(active ? [active] : contracts).map(function (contract) {
				const employer = getFaction(contract.employer); const locked = campaign.reputation[contract.employer] < contract.requiredReputation;
				return html`<button class="contract-card" aria-pressed=${contract.id === selected?.id} @click=${function () { actions.selectContract(contract.id); }} data-contract=${contract.kind}><span class="contract-type">${MISSION_NAMES[contract.kind]} <em>TIER ${contract.tier}</em></span><b>${contract.title}</b><span class="contract-employer" style="color:${employer.color}">${employer.name}</span><span class="contract-bottom"><strong>${contract.reward.toLocaleString()} CR</strong><small>${active ? 'ACCEPTED' : locked ? `NEEDS ${signed(contract.requiredReputation)} REP` : `+${contract.favor} FAVOR / −${contract.hostility} OPPOSITION`}</small></span></button>`;
			}),
			...textItems(active ? `${getFaction(active.opponent).name}: −${active.hostility} reputation applied on acceptance. Review your owned frame and equipment before deployment.` : `Current postings on ${planet.name}. ${local ? 'Local uplink.' : 'Remote preview; travel here to accept work.'}`),
			...textItems('Postings change after a contract or jump. Favor unlocks higher-tier work and better rates; entry contracts stay available.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate(order || mech && mech.integrity <= 0 ? 'engineering' : 'mechbay'); }}>${order || mech && mech.integrity <= 0 ? 'VIEW ENGINEERING' : 'MANAGE MECH BAY'} →</button>` },
		{ id: 'briefing', label: 'Briefing', items: selected ? [
			html`<span class="eyebrow">${getPlanet(selected.planetId).name.toUpperCase()} / ${MISSION_NAMES[selected.kind].toUpperCase()}</span><h2>${selected.title}</h2>`,
			...textItems(selected.briefing),
			html`<span class="eyebrow">SURFACE OBJECTIVE</span>`, ...textItems(OBJECTIVES[selected.kind]),
			html`<p class="stake-line"><small>EMPLOYER</small>${getFaction(selected.employer).name}<br><strong class="positive">+${selected.favor} on success</strong></p>`,
			html`<p class="stake-line"><small>OPPOSITION</small>${getFaction(selected.opponent).name}<br><strong class="negative">−${selected.hostility} ${active ? 'applied on acceptance' : 'on acceptance'}</strong></p>`,
			html`<p class="stake-line"><small>PAYMENT AFTER EXTRACTION</small>${selected.reward.toLocaleString()} CR</p>`,
			...textItems('Persistent frame damage · installed company loadout. Failure or abort keeps the opposition penalty. Leaving or reloading a deployed sortie records an abort and retains damage.'),
		] : textItems('Select a contract to review its briefing.'), actions: selected ? active ? html`<button id="bridge-deploy" class="primary" @click=${actions.deploy}>PREPARE MECH ↘</button><button class="text-button" @click=${actions.abandon}>ABORT</button>` : html`<button id="bridge-accept" class="primary" ?disabled=${!local || !canAcceptContract(campaign, selected)} @click=${function () { actions.accept(selected); }}>${!local ? 'TRAVEL HERE TO ACCEPT' : campaign.reputation[selected.employer] < selected.requiredReputation ? `NEEDS ${signed(selected.requiredReputation)} REP` : `ACCEPT · −${selected.hostility} OPPOSITION`} →</button>` : html`` },
		{ id: 'factions', label: 'Factions', secondary: true, items: [
			...FACTIONS.map(function (faction) { const value = campaign.reputation[faction.id]; return html`<div class="faction-standing" style="--faction-color:${faction.color}"><div><b>${faction.name}</b><strong>${signed(value)}</strong></div><span>${reputationLabel(value)}</span><div class="reputation-track"><i style="left:${value < 0 ? 50 + value / 2 : 50}%;width:${Math.abs(value) / 2}%"></i></div></div>`; }),
			...(campaign.lastResult ? textItems(`${campaign.lastResult.aborted ? 'ABORTED' : campaign.lastResult.won ? 'COMPLETED' : 'FAILED'}: ${campaign.lastResult.contract.title} · ${campaign.lastResult.payout.toLocaleString()} CR · ${signed(campaign.lastResult.favor)} employer favor`) : []),
		] },
	];
	const footer = html`<footer class="bridge-footer"><div><button @click=${actions.training}>TRAINING</button><button @click=${actions.handbook}>HANDBOOK</button><button @click=${actions.settings}>SETTINGS</button><button @click=${actions.title}>TITLE</button></div><span class=${saved ? 'save-notice' : 'save-notice storage-warning'} role="status">${saved ? 'COMPANY SAVED' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span><a href="https://deegeegames.com/">← DEEGEE GAMES</a></footer>`;
	renderWorkspace(root, renderShipHeader(campaign, 'bridge', actions.navigate), panes, footer, 'board');
};
