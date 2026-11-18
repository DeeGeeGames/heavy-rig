import { rigName } from './rigs';
import { companyRank, getMissionTier, MISSION_TIERS, reputationProgress, unlockedMissionTier } from './reputation';
import { ACQUISITION_SECONDS, missionHostileCount } from './missions';
import { getSystemIntel } from './universe';
import { renderTerritoryMap } from './territory-map';
import { selectWorkspacePane } from './workspace';
import { html } from 'lit-html';
import { renderWorkspace, textItems, type WorkspacePane } from './workspace';
import { canAcceptContract, FACTIONS, getContracts, getFaction, getPlanet, getTransmission, reputationLabel, travelTo, type Campaign } from './campaign';
import type { Contract, MissionKind, PlanetId } from './campaign-types';
import { getAuthoredStep } from './contract-chains';
import { getOwnedMech, workOrderFor } from './company';
import { renderShipHeader, type ShipScreen } from './company-ui';

export const MISSION_NAMES: Readonly<Record<MissionKind, string>> = {
	defend: 'Garrison defense', demolition: 'Facility demolition', assassination: 'Priority target', clearance: 'Area clearance',
	raid: 'Raid', recovery: 'Recovery', acquisition: 'Target acquisition',
};
export type ShipView = 'board' | 'transmission' | 'route' | 'system' | 'loadout' | 'condition' | 'calendar' | 'squad';
const OBJECTIVES: Readonly<Record<MissionKind, string>> = {
	defend: 'Hold the relay against the assault. Keep its integrity above zero, then return to extraction.',
	demolition: 'Find and destroy the marked installation. Its garrison is optional; extraction is required.',
	assassination: 'Track down the marked command frame. Destroy it and reach extraction alive.',
	raid: 'Destroy all three marked installations in any order, then extract. Defenders are optional.',
	recovery: 'Hold the cache zone for five uninterrupted seconds, then extract with the data. Guards are optional.',
	acquisition: `Activate three beacons within ${ACQUISITION_SECONDS / 60} minutes: hold each zone for three seconds. Activated beacons stay active. Then extract.`,
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
	const forecast = destination === campaign.planetId ? campaign : travelTo(campaign, destination);
	const intel = getSystemIntel(forecast, destination);
	const local = destination === campaign.planetId;
	const active = campaign.active;
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
		<p class="planet-summary">${planet.description}</p>
		<div class="planet-transit">${local ? 'Current location' : 'TRANSIT · 1 DAY · 0 CR'}</div>
		<div class="planet-actions">${local && storyHere ? html`<button class="primary" @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); openTransmission(); }}>OPEN SIGNAL →</button>` : html`<button class="primary" ?disabled=${local || Boolean(active)} @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); actions.travel(); }}>${local ? 'ORBIT ESTABLISHED' : active ? 'CONTRACT ACTIVE' : 'JUMP HERE →'}</button>`}<button @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); actions.navigate('bridge', 'board'); }}>CONTRACTS →</button></div>
		<button class="planet-full-intel" @click=${function () { root.querySelector<HTMLElement>('.planet-popover')?.hidePopover(); selectWorkspacePane(root, 'system'); }}>FULL SYSTEM INTEL →</button>`;
	const panes: WorkspacePane[] = [
		{ id: 'route', label: 'Starmap', items: [renderTerritoryMap(root, campaign, destination, actions.selectPlanet, details, storyPlanets)] },
		{ id: 'system', label: 'System intel', items: [
			html`<span class="eyebrow">${local ? 'WAYFARER / IN ORBIT' : `ARRIVAL FORECAST / DAY ${forecast.day}`}</span><h3>${planet.name}</h3><p class="system-control">${intel.owner ? getFaction(intel.owner).name : 'Unclaimed space'}</p>`,
			...(storyHere ? [html`<p class="system-transmission">◆ CAMPAIGN SIGNAL</p>`] : []),
			html`<p class=${intel.conflict ? 'system-conflict' : 'system-quiet'}>${intel.conflict ? '◌ ACTIVE CONFLICT ZONE' : 'NO ACTIVE CONFLICT'}</p>`,
			...textItems(intel.conflict ? intel.participants.map(function (id) { return getFaction(id).name; }).join(' / ') : 'No ordinary contracts posted.'),
			...textItems(planet.description),
			...textItems('Fronts move with calendar days. Victories strengthen the employer locally; defeat or abort strengthens the opposition.'),
			...textItems(order ? `Player rig in Engineering until day ${order.readyDay}.` : mech ? `${rigName(mech.frameId)} · ${Math.ceil(mech.integrity)}% integrity. Transit: one day, no fuel cost.` : 'Assign a rig to the player pilot before deploying.'),
		], actions: html`${local && storyHere ? html`<button class="primary" @click=${openTransmission}>OPEN SIGNAL →</button>` : html`<button id="bridge-travel" class="primary" ?disabled=${local || Boolean(active)} @click=${actions.travel}>${local ? 'ORBIT ESTABLISHED' : active ? 'CONTRACT ACTIVE' : `JUMP TO ${planet.name.toUpperCase()} →`}</button>`}<button @click=${function () { actions.navigate('bridge', 'board'); }}>CONTRACTS →</button>` },
	];
	renderWorkspace(root, renderShipHeader(campaign, 'starmap', actions.navigate), panes, renderCampaignFooter(saved, actions), 'route', [
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
			...(choice ? textItems('Accept one offer to commit to that contact. Both offers stay open while you take other work.') : []),
			...offers.map(function ({ contract, contact, label, pitch }) {
				return html`<article class="signal-contact"><span class="eyebrow">${contact}</span>${choice ? html`<h3>${label}</h3>` : ''}${opening?.contract.id === contract.id ? '' : html`<p class="workspace-copy">${pitch}</p>`}<small>${getPlanet(contract.planetId).name} · ${contract.reward.toLocaleString()} CR</small></article>`;
			}),
			...(!last && !committed ? textItems('Optional contract. Take ordinary work from the Board whenever you like.') : []),
		],
		actions: active ? html`<button class="primary" @click=${function () { actions.selectContract(active.id); }}>ACTIVE CONTRACT →</button>`
			: offers.length ? html`${offers.map(function ({ contract, label }) {
				const local = contract.planetId === campaign.planetId;
				const button = local ? choice ? `REVIEW ${label.toUpperCase()}` : retry ? 'RETRY BRIEFING' : 'REVIEW BRIEFING' : `PLOT COURSE TO ${getPlanet(contract.planetId).name.toUpperCase()}`;
				if (!local && offers.find(function (offer) { return offer.contract.planetId === contract.planetId; })?.contract.id !== contract.id) return '';
				return html`<button class="primary" data-story-offer=${contract.id} @click=${function () { if (local) actions.selectContract(contract.id); else actions.plotStoryCourse(contract.planetId); }}>${button} →</button>`;
			})}${retry && damaged ? html`<button @click=${function () { actions.navigate('engineering', 'condition'); }}>ENGINEERING →</button>` : ''}`
			: html`<button class="primary" @click=${board}>CONTRACT BOARD →</button><button @click=${function () { actions.navigate('starmap', 'route'); }}>STARMAP →</button>`,
	};
};

export const renderBridge = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, selection: string | undefined, saved: boolean, actions: BridgeActions) {
	const compact = window.matchMedia('(max-width: 560px) and (max-height: 700px)').matches;
	const planet = getPlanet(destination);
	const forecast = destination === campaign.planetId ? campaign : travelTo(campaign, destination);
	const contracts = getContracts(forecast, destination);
	const transmission = getTransmission(campaign);
	const storyOffer = transmission?.offers.find(function ({ contract }) { return contract.id === selection && contract.planetId === destination; });
	const selected = campaign.active ?? storyOffer?.contract ?? contracts.find(function (contract) { return contract.id === selection; }) ?? contracts.find(function (contract) { return canAcceptContract(campaign, contract); }) ?? contracts[0];
	const local = destination === campaign.planetId;
	const active = campaign.active;
	const storyStep = selected ? getAuthoredStep(campaign.story, selected) : undefined;
	const localSignal = transmission?.offers.some(function ({ contract }) { return contract.planetId === campaign.planetId; });
	const signalCopy = `A campaign contract is available at ${getPlanet(campaign.planetId).name}. Open Signal to review the offer.`;
	const signalAction = localSignal ? html`<button class="primary" @click=${function () { actions.navigate('bridge', 'transmission'); }}>OPEN LOCAL SIGNAL →</button>` : undefined;
	const emptyBoard = !active && !contracts.length;
	const panes: WorkspacePane[] = [
		...(transmission ? [transmissionPane(root, campaign, transmission, actions)] : []),
		{ id: 'board', label: 'Contracts', items: [
			...(emptyBoard ? textItems(localSignal ? `No ordinary postings at ${planet.name}. ${signalCopy}` : `No contracts at ${planet.name}. Use the Starmap to find a conflict zone and travel there for work.`) : []),
			...(active ? [active] : contracts.filter(function (contract) { return contract.tier === selected?.tier; })).map(function (contract) {
				const employer = getFaction(contract.employer); const locked = companyRank(campaign) < getMissionTier(contract.tier).rank; const factionLocked = campaign.reputation[contract.employer] < contract.requiredReputation;
				return html`<button class="contract-card" aria-pressed=${contract.id === selected?.id} @click=${function () { actions.selectContract(contract.id); }} data-contract=${contract.kind}><span class="contract-type">${MISSION_NAMES[contract.kind]} <em>TIER ${contract.tier}</em></span><b>${contract.title}</b><span class="contract-employer" style="color:${employer.color}">${employer.name}</span><span class="contract-bottom"><strong>${contract.reward.toLocaleString()} CR</strong><small>${active ? 'ACCEPTED' : locked ? `NEEDS RANK ${getMissionTier(contract.tier).rank}` : factionLocked ? `NEEDS ${signed(contract.requiredReputation)} FACTION` : `+${contract.favor} FAVOR / −${contract.hostility} OPPOSITION`}</small></span></button>`;
			}),
			...(!emptyBoard ? textItems(active ? `${getFaction(active.opponent).name}: −${active.hostility} reputation applied on acceptance. Assign pilots and rigs before deployment.` : `Current postings on ${planet.name}. ${local ? 'Local uplink.' : `Arrival-day ${forecast.day} forecast; travel here to accept work.`}`) : []),
			...textItems('Postings follow the factions on the local front and change after a contract or jump. Company reputation unlocks mission tiers. Faction favor controls employer access and payment; local contracts stay available at hostile standings.'),
		], actions: emptyBoard ? signalAction ?? html`<button @click=${function () { actions.navigate('starmap', 'route'); }}>FIND CONFLICT ZONE →</button>` : !active ? html`<div class="market-tiers mission-tiers"><span class="eyebrow">MISSION TIER / ${selected ? getMissionTier(selected.tier).name.toUpperCase() : 'LOCAL'}</span><div>${MISSION_TIERS.map(function (entry) { return html`<button data-mission-tier=${entry.tier} style="--tier-color:var(--amber)" aria-pressed=${entry.tier === selected?.tier} @click=${function () { const posting = contracts.find(function (contract) { return contract.tier === entry.tier; }); if (posting) actions.selectContract(posting.id); }}>T${entry.tier}${companyRank(campaign) < entry.rank ? ` / R${entry.rank}` : ''}</button>`; })}</div></div>` : html`` },
		{ id: 'briefing', label: 'Briefing', items: selected ? [
			html`<span class="eyebrow">${getPlanet(selected.planetId).name.toUpperCase()} / ${MISSION_NAMES[selected.kind].toUpperCase()}</span><h2>${selected.title}</h2>`,
			...(storyStep ? [html`<span class="eyebrow">${storyStep.contact}</span>`, ...textItems(storyStep.pitch)] : []),
			...textItems(selected.briefing),
			...textItems(`TIER ${selected.tier} / ${getMissionTier(selected.tier).name} · Requires company rank ${getMissionTier(selected.tier).rank}. ${missionHostileCount(selected)} hostiles. ${getMissionTier(selected.tier).opposition}`),
			...textItems(`SUCCESS: +${getMissionTier(selected.tier).reputation} company reputation. ${reputationProgress(campaign)}.`),
			...textItems('Success expands employer influence around this system. Failure or abort strengthens the opposition. Repeated victories can move the border and end a local conflict.'),
			...(storyStep ? [] : [html`<span class="eyebrow">SURFACE OBJECTIVE</span>`, ...textItems(OBJECTIVES[selected.kind])]),
			...(storyOffer && transmission && transmission.offers.length > 1 ? textItems('Accepting this offer commits your company to this contact.') : []),
			html`<p class="stake-line"><small>EMPLOYER</small>${getFaction(selected.employer).name}<br><strong class="positive">+${selected.favor} on success</strong></p>`,
			html`<p class="stake-line"><small>OPPOSITION</small>${getFaction(selected.opponent).name}<br><strong class="negative">−${selected.hostility} ${active ? 'applied on acceptance' : 'on acceptance'}</strong></p>`,
			html`<p class="stake-line"><small>PAYMENT AFTER EXTRACTION</small>${selected.reward.toLocaleString()} CR</p>`,
			...textItems('Damage carries over for every deployed rig. Failure or abort keeps the opposition penalty. Leaving or reloading a deployed sortie records an abort and retains damage.'),
		] : textItems(localSignal ? signalCopy : 'Select a contract to review its briefing, or find an active conflict zone on the Starmap.'), actions: selected ? active ? html`<button id="bridge-deploy" class="primary" @click=${actions.deploy}>PREPARE SQUAD ↘</button><button class="text-button" @click=${actions.abandon}>ABORT</button>` : html`<button id="bridge-accept" class="primary" ?disabled=${!local || !canAcceptContract(campaign, selected)} @click=${function () { actions.accept(selected); }}>${!local ? 'TRAVEL HERE TO ACCEPT' : companyRank(campaign) < getMissionTier(selected.tier).rank ? `NEEDS COMPANY RANK ${getMissionTier(selected.tier).rank}` : campaign.reputation[selected.employer] < selected.requiredReputation ? `NEEDS ${signed(selected.requiredReputation)} FACTION` : `ACCEPT · −${selected.hostility} OPPOSITION`} →</button>${!local ? html`<button @click=${function () { actions.navigate('starmap', 'system'); }}>STARMAP / JUMP →</button>` : ''}` : signalAction ?? html`` },
		{ id: 'factions', label: 'Reputation', secondary: true, items: [
			html`<span class="eyebrow">COMPANY REPUTATION</span><h2>RANK ${companyRank(campaign)} / 15</h2>`,
			...textItems(reputationProgress(campaign)),
			...textItems(`Available: mission tiers 1–${unlockedMissionTier(campaign).tier} and weapon tiers 0–${unlockedMissionTier(campaign).weaponTier}. Only successful extractions earn company reputation. Failures and aborts retain your earned rank.`),
			...MISSION_TIERS.flatMap(function (entry) { return textItems(`RANK ${entry.rank}: ${entry.name} missions T${entry.tier} · weapons T${entry.weaponTier}${companyRank(campaign) >= entry.rank ? ' · UNLOCKED' : ''}`); }),
			...FACTIONS.map(function (faction) { const value = campaign.reputation[faction.id]; return html`<div class="faction-standing" style="--faction-color:${faction.color}"><div><b>${faction.name}</b><strong>${signed(value)}</strong></div><span>${reputationLabel(value)}</span><div class="reputation-track"><i style="left:${value < 0 ? 50 + value / 2 : 50}%;width:${Math.abs(value) / 2}%"></i></div></div>`; }),
			...(campaign.lastResult ? textItems(`${campaign.lastResult.aborted ? 'ABORTED' : campaign.lastResult.won ? 'COMPLETED' : 'FAILED'}: ${campaign.lastResult.contract.title} · ${campaign.lastResult.payout.toLocaleString()} CR · ${signed(campaign.lastResult.favor)} employer favor · +${campaign.lastResult.companyReputation} company reputation`) : []),
		] },
	];
	renderWorkspace(root, renderShipHeader(campaign, 'bridge', actions.navigate), panes, renderCampaignFooter(saved, actions), 'board', [
		...(transmission ? [{ id: 'transmission', label: 'Signal', panes: ['transmission'] }] : []),
		{ id: 'board', label: 'Board', panes: compact ? ['board'] : ['board', 'briefing'] },
		...(compact ? [{ id: 'briefing', label: 'Briefing', panes: ['briefing'] }] : []),
		{ id: 'factions', label: 'Reputation', panes: ['factions'] },
	]);
};
