import { html } from 'lit-html';
import { getPlanet, reviewOperations, type Campaign } from './campaign';
import { MISSION_NAMES, type MissionKind } from './campaign-types';
import { isAuthoredContract } from './contract-chains';
import { getPilot, SQUAD_SIZE } from './pilots';
import { rigName } from './rigs';
import type { WorkspacePane } from './workspace';

export interface OperationsActions {
	editOperation: (contractId: string) => void;
	commitDay: () => void;
	openBoard: () => void;
}

type OperationEntry = ReturnType<typeof reviewOperations>['entries'][number];
const SHIP_NAMES = { wayfarer: 'HRV Wayfarer' } as const;
const MISSION_MARKS: Readonly<Record<MissionKind, string>> = {
	defend: '◉', demolition: '▧', assassination: '⊕', clearance: '⌖', raid: '▥', recovery: '▣', acquisition: '◈',
};

const shipLabel = function (ship: string, location: string) {
	return html`<div class="operation-ship"><span class="operation-ship-mark" aria-hidden="true"></span><b>${ship}</b><span class="operation-orbit-mark" aria-hidden="true"></span>${location}</div>`;
};

const operationCard = function (entry: OperationEntry, actions: OperationsActions) {
	const { operation: { contract, lineup }, live, issues, forecast } = entry;
	const assigned = lineup.filter(function (slot) { return slot.pilotId !== null; });
	const readyRigs = assigned.filter(function (slot) { return slot.frameId !== null; }).length;
	const story = isAuthoredContract(contract);
	const mode = live ? 'Player-led' : story ? 'Commander required' : assigned.length ? 'Crew-only' : '';
	return html`<article class="operation-entry" data-operation=${contract.id} data-live=${String(live)} data-blocked=${String(issues.length > 0)}>
		<button type="button" class="operation-card" data-edit-operation=${contract.id} @click=${function () { actions.editOperation(contract.id); }}>
			<span class="operation-mark" aria-hidden="true">${MISSION_MARKS[contract.kind]}</span>
			<span class="operation-description">
				<span class="operation-kind">${story ? html`<em>Story</em> / ` : ''}${MISSION_NAMES[contract.kind]}</span>
				<strong class="operation-name">${contract.title}</strong>
				<span class="operation-pilots">${assigned.length ? assigned.map(function ({ pilotId, frameId }) {
					return pilotId ? html`<span><b>${getPilot(pilotId).callsign}</b> / ${frameId ? rigName(frameId) : 'Rig needed'}</span>` : '';
				}) : 'No squad assigned'}</span>
				<span class="operation-status">${mode ? html`<span class="operation-mode">${mode}</span>` : ''}<span class="operation-seats" role="img" aria-label=${`${readyRigs} of ${SQUAD_SIZE} rigs assigned`}>${lineup.map(function (_, index) { return html`<i data-filled=${String(index < readyRigs)}></i>`; })}</span>${issues.length ? html`<span class="operation-held">On hold</span>` : forecast ? html`<span>${Math.round(forecast.successChance)}% success</span>` : ''}</span>
				${issues[0] ? html`<span class="operation-blocker">${issues[0]}</span>` : ''}
			</span>
			<span class="operation-card-end"><span class="operation-pay">${contract.reward.toLocaleString()} <small>CR</small></span><span class="operation-edit">Edit lineup ↗</span></span>
		</button>
	</article>`;
};

const ordersLeg = function (label: string, value: string, detail?: string, live = false) {
	return html`<li data-live=${String(live)}><span class="operation-kind">${label}</span><strong>${value}</strong>${detail ? html`<span>${detail}</span>` : ''}</li>`;
};

export const operationPanes = function (campaign: Campaign, actions: OperationsActions): WorkspacePane[] {
	const { entries, issues } = reviewOperations(campaign);
	const planet = getPlanet(campaign.planetId);
	const groups = new Map<string, OperationEntry[]>();
	for (const entry of entries) {
		const key = `${entry.operation.shipId}/${entry.operation.contract.planetId}`;
		const group = groups.get(key);
		if (group) group.push(entry);
		else groups.set(key, [entry]);
	}
	const count = entries.length;
	const live = entries.find(function (entry) { return entry.live; });
	const crewCount = entries.filter(function (entry) { return !entry.live; }).length;
	const blocked = entries.filter(function (entry) { return entry.issues.length > 0; });
	const ready = count > 0 && issues.length === 0 && blocked.length === 0;
	const pay = entries.reduce(function (total, entry) { return total + entry.operation.contract.reward; }, 0);
	const commitLabel = ready ? (live ? 'Commit & play' : 'Commit & advance') : 'Commit day';
	const state = count === 0 ? 'Empty plan' : ready ? 'All squads ready' : 'On hold';
	const manifest: WorkspacePane = {
		id: 'operations', label: 'Staged contracts', scrollable: true,
		items: [
			html`<header class="operations-pane-heading"><h3>Staged contracts</h3>${count ? html`<span class="operation-count">${count}</span><button class="operation-open-board" type="button" @click=${actions.openBoard}>Contract board ↗</button>` : ''}</header>`,
			...[...groups.values()].flatMap(function ([first, ...rest]) {
				if (!first) return [];
				return [shipLabel(SHIP_NAMES[first.operation.shipId], getPlanet(first.operation.contract.planetId).name), operationCard(first, actions), ...rest.map(function (entry) { return operationCard(entry, actions); })];
			}),
			...(!count ? [shipLabel(SHIP_NAMES.wayfarer, planet.name), html`<div class="operations-empty"><h3>No contracts staged</h3><p>Choose a local contract and assign its pilots and rigs in Deploy.</p><button class="secondary" type="button" @click=${actions.openBoard}>Open contract board →</button></div>`] : []),
		],
	};
	const orders: WorkspacePane = {
		id: 'day-orders', label: 'Day orders', scrollable: true,
		items: [
			html`<header class="operations-pane-heading"><h3>Day orders</h3><span class="operation-state" data-state=${ready ? 'ready' : count ? 'held' : 'empty'}>${state}</span></header>`,
			...(!count ? [html`<p class="operations-note">Stage a contract to plan the day.</p>`] : ready ? [html`<ol class="operation-route">
				${live ? ordersLeg('You play', live.operation.contract.title, undefined, true) : ordersLeg('Commander', 'Stays aboard')}
				${crewCount ? ordersLeg('Crew-only', `${crewCount} ${crewCount === 1 ? 'sortie' : 'sorties'}`, 'Objective and extraction checks') : ''}
			${ordersLeg('Shared debrief', `Day ${campaign.day + 1}`, `${count} contract ${count === 1 ? 'result' : 'results'}`)}
			</ol>`] : [
				...issues.filter(function (issue) { return !blocked.some(function (entry) { return entry.issues.includes(issue); }); }).map(function (issue) { return html`<p class="operations-note operation-blocker">${issue}</p>`; }),
				...blocked.map(function ({ operation: { contract }, issues: blockers }) {
					return html`<button class="operation-issue" type="button" @click=${function () { actions.editOperation(contract.id); }}><b>${contract.title} ↗</b><span>${blockers.join(' ')}</span></button>`;
				}),
			]),
		],
		actions: html`
			${count ? html`<div class="operations-total"><span>${count === 1 ? 'Pay on success' : 'Pay if all succeed'}</span><strong>${pay.toLocaleString()} <small>CR</small></strong></div>` : ''}
			<button id="operations-commit" class="primary" type="button" ?disabled=${!ready} @click=${actions.commitDay}><span>${commitLabel}</span><span aria-hidden="true">${ready && live ? '↘' : '→'}</span></button>
			${ready ? html`<p class="operations-note">${live && crewCount ? 'Locks all lineups. Crew sorties finish even if you abort.' : live ? 'Locks the lineup and opens the live mission.' : 'Locks all lineups and advances one campaign day.'}</p>` : ''}
		`,
	};
	return [
		{ id: 'operations-heading', label: 'Operations', scrollable: true, items: [html`<header class="operations-hero" style=${`--orbit-color:${planet.color}`}>
			<div class="operations-title"><span class="eyebrow">Bridge / Day ${campaign.day}</span><h2>Operations</h2></div>
			<div class="operations-orbit" aria-hidden="true"><span class="operations-globe"></span><span class="operations-ring"></span></div>
			<div class="operations-location"><span class="operation-kind">In orbit</span><strong>${planet.name}</strong></div>
		</header>`] },
		manifest,
		orders,
	];
};
