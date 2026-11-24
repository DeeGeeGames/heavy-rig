import { rigName } from './rigs';
import { html } from 'lit-html';
import { getWeapon } from './arsenal';
import { reviewOperations, type Campaign } from './campaign';
import { canDeploySquad, deploymentIssue, getOwnedMech, type OwnedMech } from './company';
import type { CompanyActions } from './company-ui';
import { getPilot, getPilotStats, getRecruitOffers, type Pilot } from './pilots';
import { textItems, type WorkspacePane } from './workspace';

export interface AssignmentPicker { slot: number; kind: 'pilot' | 'rig' }

const pilotRole = function (pilot: Pilot) {
	return pilot.specialty === 'commander' ? 'Player pilot' : pilot.specialty === 'marksman' ? 'Marksman' : 'Skirmisher';
};

const frameKit = function (mech: OwnedMech) {
	return mech.loadout.map(function (weapon) { return weapon ? getWeapon(weapon).name : 'Empty mount'; }).join(' · ');
};

const slotName = function (slot: number, planned: boolean) { return planned ? `Seat ${slot + 1}` : slot === 0 ? 'Player' : `Wing ${slot}`; };

const skillText = function (campaign: Campaign, pilot: Pilot, roster: boolean) {
	if (pilot.id === 'player') return '';
	const { gunnery, maneuver, wins, bonus, nextMilestone } = getPilotStats(campaign, pilot.id);
	return html`<p class="pilot-dispatch-stats">Gunnery ${gunnery}/5 · Maneuver ${maneuver}/5${roster ? html`<br>${wins} successful ${wins === 1 ? 'sortie' : 'sorties'}${bonus ? ` · +${bonus} dispatch bonus` : ''}${nextMilestone ? ` · Next bonus at ${nextMilestone}` : ''}` : ''}</p>`;
};

export const pilotPanes = function (campaign: Campaign, actions: CompanyActions): WorkspacePane[] {
	const locked = Boolean(campaign.deployed);
	const offers = getRecruitOffers(campaign);
	return [
		{ id: 'roster', label: 'Roster', items: campaign.pilots.map(function (id) {
			const pilot = getPilot(id);
			const lineup = campaign.operations?.length ? campaign.operations.flatMap(function (operation) { return operation.lineup; }) : campaign.preferredLineup ?? campaign.lineup;
			const assignment = lineup.find(function (entry) { return entry.pilotId === id; });
			const frame = assignment?.frameId ? rigName(assignment.frameId) : undefined;
			return html`<article class="pilot-record" data-roster-pilot=${id}>
				<div><span class="eyebrow">${pilotRole(pilot)}</span><h3>${pilot.callsign}</h3><p>${pilot.name}</p></div>
				<div><p>${pilot.description}</p>${skillText(campaign, pilot, true)}<small>${frame ? `ASSIGNED · ${frame}` : assignment ? 'AWAITING RIG' : 'ON THE BENCH'}</small></div>
				${id === 'player' ? '' : html`<button class="text-button" data-dismiss-pilot=${id} ?disabled=${locked} @click=${function () { actions.dismiss(id); }}>DISMISS ${pilot.callsign}</button>`}
			</article>`;
		}), actions: html`<button class="secondary" @click=${function () { actions.navigate('deploy'); }}>SQUAD LINEUP →</button>` },
		{ id: 'recruitment', label: 'Recruitment', items: offers.length ? offers.map(function (pilot) {
			const affordable = campaign.credits >= pilot.price;
			return html`<article class="pilot-record" data-recruit-pilot=${pilot.id}>
				<div><span class="eyebrow">${pilotRole(pilot)}</span><h3>${pilot.callsign}</h3><p>${pilot.name}</p></div>
				<div><p>${pilot.description}</p>${skillText(campaign, pilot, false)}</div>
				<button class="secondary" data-hire-pilot=${pilot.id} ?disabled=${locked || !affordable} @click=${function () { actions.hire(pilot.id); }}>${affordable ? 'HIRE' : 'NEEDS'} · ${pilot.price.toLocaleString()} CR</button>
			</article>`;
		}) : textItems('No recruits are available. Pilots already aboard are listed on the roster.'), actions: html`<button class="secondary" @click=${function () { actions.navigate('market'); }}>RIG MARKET →</button>` },
	];
};

const squadPane = function (campaign: Campaign, actions: CompanyActions, pick: (picker: AssignmentPicker) => void): WorkspacePane {
	const operation = actions.operation;
	const planned = !campaign.active;
	const lineup = operation?.lineup ?? (planned ? campaign.preferredLineup : undefined) ?? campaign.lineup;
	const review = operation && reviewOperations(campaign).entries.find(function (entry) { return entry.operation === operation; });
	const ready = canDeploySquad(campaign);
	const count = lineup.filter(function (entry) { return entry.pilotId && entry.frameId; }).length;
	return {
		id: 'squad', label: 'Squad lineup', scrollable: true,
		items: [html`<div class="sortie-context">
			<strong>${operation?.contract.title ?? campaign.active?.title ?? 'No contract staged'}</strong>
			<span>${count} / ${lineup.length} RIGS ASSIGNED</span>
		</div>`, html`<div class="squad-lineup">${lineup.map(function (entry, slot) {
			const pilot = entry.pilotId ? getPilot(entry.pilotId) : undefined;
			const mech = entry.frameId ? getOwnedMech(campaign, entry.frameId) : undefined;
			const issue = mech ? deploymentIssue(campaign, mech.frameId) : undefined;
			return html`<article class="squad-seat" data-squad-slot=${slot} data-squad-ready=${String(Boolean(mech && !issue))}>
				<span class="eyebrow">${slotName(slot, planned)}</span>
				${slot === 0 && !planned ? html`<strong class="squad-player">${pilot?.callsign ?? 'Player'}</strong>` : html`<button class="squad-seat-choice" data-choose-pilot=${slot} aria-label=${pilot ? `${pilot.callsign} · change pilot` : `${slotName(slot, planned)} · add pilot`} ?disabled=${Boolean(campaign.deployed)} @click=${function () { pick({ slot, kind: 'pilot' }); }}><b>${pilot?.callsign ?? 'Add pilot'}</b><small>${pilot ? pilotRole(pilot) : 'EMPTY SLOT'}</small></button>`}
				${pilot ? html`
						<button class="squad-seat-choice squad-rig-choice" data-choose-rig=${slot} aria-label=${mech ? `${rigName(mech.frameId)} · change rig` : `${slotName(slot, planned)} · assign rig`} ?disabled=${Boolean(campaign.deployed)} @click=${function () { pick({ slot, kind: 'rig' }); }}><b>${mech ? rigName(mech.frameId) : 'Assign rig'}</b>${mech ? html`<small>${Math.ceil(mech.integrity)}% INTEGRITY</small>` : ''}</button>
					${mech ? html`<p>${frameKit(mech)}</p>` : ''}
					${issue || !mech ? html`<p class="squad-readiness">${issue ?? 'Rig required or bench this pilot.'}</p>` : ''}
				` : ''}
			</article>`;
			})}</div>`, ...(review ? [html`<div class="sortie-context"><strong>${review.live ? 'Player-led' : 'Crew only · 1 campaign day'}</strong>${review.forecast ? html`<span>${Math.round(review.forecast.successChance)}% CHANCE OF SUCCESS</span>` : ''}</div>`,
			...(review.forecast ? [`Objective ${review.forecast.objectiveChance}% · Extraction ${review.forecast.extractionChance}%`, ...review.forecast.factors] : review.issues).flatMap(textItems)] : [])],
		actions: html`
			${operation ? html`<button class="primary" id="company-deploy" @click=${actions.openOperations}>DAY OPERATIONS →</button>` : campaign.active ? html`<button class="primary" id="company-deploy" ?disabled=${!ready} @click=${actions.deploy}>${count > 1 ? 'DEPLOY SQUAD' : 'DEPLOY SOLO'} ↘</button>` : html`<button class="primary" @click=${function () { actions.navigate('bridge'); }}>FIND CONTRACT →</button>`}
			${operation ? html`<button class="text-button" data-remove-operation @click=${actions.removeOperation}>REMOVE FROM DAY</button>` : ''}
			<button class="secondary" @click=${function () { actions.navigate('pilots'); }}>PILOTS →</button>
			<button class="secondary" @click=${function () { actions.navigate('mechbay'); }}>MECH BAY →</button>
		`,
	};
};

export const deploymentPanes = function (campaign: Campaign, actions: CompanyActions, picker: AssignmentPicker | undefined, pick: (picker: AssignmentPicker) => void, close: () => void): WorkspacePane[] {
	const lineup = squadPane(campaign, actions, pick);
	if (!picker) return [lineup];
	const slot = picker.slot;
	const operation = actions.operation;
	const planned = !campaign.active;
	const assignments = operation?.lineup ?? (planned ? campaign.preferredLineup : undefined) ?? campaign.lineup;
	const selected = assignments[slot];
	if (!selected) return [lineup];
	const selectPilot = picker.kind === 'pilot';
	const otherOperations = campaign.operations?.filter(function (entry) { return entry !== operation; }) ?? [];
	const choices = selectPilot ? campaign.pilots.filter(function (pilot) { return planned || pilot !== 'player'; }).map(function (id) {
		const pilot = getPilot(id);
		const other = assignments.findIndex(function (entry, index) { return index !== slot && entry.pilotId === id; });
		const elsewhere = otherOperations.find(function (entry) { return entry.lineup.some(function (seat) { return seat.pilotId === id; }); });
		return html`<button class="equipment-choice" data-assign-pilot=${id} aria-label=${`Assign ${pilot.callsign}`} aria-pressed=${selected.pilotId === id} ?disabled=${other >= 0 || Boolean(elsewhere)} @click=${function () { close(); actions.assignPilot(slot, id); }}><span><b>${pilot.callsign}</b><small>${pilotRole(pilot)}</small></span><small>${other >= 0 ? `Assigned to ${slotName(other, planned)}` : elsewhere?.contract.title ?? pilot.name}</small></button>`;
	}) : campaign.fleet.map(function (mech) {
		const id = mech.frameId;
		const other = assignments.find(function (entry, index) { return index !== slot && entry.frameId === id; });
		const elsewhere = otherOperations.find(function (entry) { return entry.lineup.some(function (seat) { return seat.frameId === id; }); });
		const issue = deploymentIssue(campaign, id);
		return html`<button class="equipment-choice" data-assign-rig=${id} aria-label=${`Assign ${rigName(id)}`} aria-pressed=${selected.frameId === id} ?disabled=${Boolean(other || elsewhere || issue)} @click=${function () { close(); actions.assignRig(slot, id); }}><span><b>${rigName(id)}</b><small>${frameKit(mech)}</small></span><small>${other?.pilotId ? `Assigned to ${getPilot(other.pilotId).callsign}` : elsewhere?.contract.title ?? issue ?? `${Math.ceil(mech.integrity)}% integrity`}</small></button>`;
	});
	return [lineup, {
			id: 'assignment', label: `${slotName(slot, planned)} / ${selectPilot ? 'Select pilot' : 'Select rig'}`, scrollable: true,
		items: choices.length ? choices : textItems('Hire squadmates in Pilots → Recruitment.'),
		actions: html`<button class="secondary" data-close-assignment @click=${close}>← LINEUP</button>
			${selectPilot && selected.pilotId ? html`<button class="text-button" data-bench-pilot @click=${function () { close(); actions.assignPilot(slot, null); }}>BENCH PILOT</button>` : ''}
			${!selectPilot && (planned || slot > 0) && selected.frameId ? html`<button class="text-button" data-unassign-rig @click=${function () { close(); actions.assignRig(slot, null); }}>UNASSIGN RIG</button>` : ''}
			${selectPilot && !choices.length ? html`<button class="secondary" @click=${function () { actions.navigate('pilots'); }}>PILOTS →</button>` : ''}`,
	}];
};
