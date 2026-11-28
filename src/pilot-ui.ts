import { rigName } from './rigs';
import { html } from 'lit-html';
import { getWeapon } from './arsenal';
import { fieldLeadFee, reviewOperations, type Campaign } from './campaign';
import { canDeploySquad, deploymentIssue, getOwnedMech, type OwnedMech } from './company';
import type { CompanyActions } from './company-ui';
import { getPilot, getPilotStats, getRecruitOffers, pilotExperienceMultiplier, type Pilot } from './pilots';
import { pilotCoordination, trustCoordination, trustLabel, type PilotCoordination, type PilotRelationship } from './pilot-relationships';
import { textItems, type WorkspacePane } from './workspace';
import { getPlanet } from './universe';

export interface AssignmentPicker { slot: number; kind: 'pilot' | 'rig' }

const pilotRole = function (pilot: Pilot) {
	return pilot.specialty === 'commander' ? 'Player pilot' : pilot.specialty === 'marksman' ? 'Marksman' : 'Skirmisher';
};

const personnelName = function (pilot: Pilot) {
	if (pilot.gender === 'unspecified') return pilot.name;
	return html`<span class="pilot-gender">${pilot.gender === 'female' ? '♀' : '♂'}</span> ${pilot.name}`;
};

const frameKit = function (mech: OwnedMech) {
	return mech.loadout.map(function (weapon) { return weapon ? getWeapon(weapon).name : 'Empty mount'; }).join(' · ');
};

const slotName = function (slot: number, planned: boolean) { return planned ? `Seat ${slot + 1}` : slot === 0 ? 'Player' : `Wing ${slot}`; };

const skillText = function (campaign: Campaign, pilot: Pilot, roster: boolean) {
	if (pilot.id === 'player') return '';
	const { gunnery, maneuver, leadership, wins, bonus, nextMilestone } = getPilotStats(campaign, pilot.id);
	const trackingGain = Math.round((pilotExperienceMultiplier(bonus) - 1) * 100);
	const experience = roster ? html`<br>${wins} successful ${wins === 1 ? 'sortie' : 'sorties'}${bonus ? ` · ${trackingGain}% faster target tracking · Tighter shot grouping · Better dispatch odds` : ''}${nextMilestone ? ` · Next bonus at ${nextMilestone} wins` : ''}` : '';
	return html`<p class="pilot-dispatch-stats">Gunnery ${gunnery}/5 · Maneuver ${maneuver}/5 · Leadership ${leadership}/5${experience}</p>`;
};

const romanceLabels: Readonly<Record<PilotRelationship['romance'], string>> = {
	none: '', dating: 'Dating', committed: 'Committed partners', exes: 'Former partners', retired: 'Married · Retired',
};
const coordinationText = function (percent: PilotCoordination): string { return `${percent > 0 ? '+' : ''}${percent}%`; };

const relationshipPanes = function (campaign: Campaign): WorkspacePane[] {
	if (!campaign.relationships?.length) return [];
	const roster = new Set(campaign.pilots);
	return [{ id: 'relationships', label: 'Relationships', scrollable: true, items: [
		...textItems('When pilots fly together, trust changes hired pilots’ tracking and shot grouping in live combat, and their effectiveness on crew-only sorties.'),
		...textItems('Each step of trust adds or subtracts 4%, up to 8% per pilot across the squad.'),
		...[...campaign.relationships].reverse().map(function ({ a, b, affinity, romance }) {
			const first = getPilot(a);
			const second = getPilot(b);
			const adjustment = trustCoordination(affinity);
			const away = [first, second].filter(function (pilot) { return !roster.has(pilot.id); });
			const status = romance === 'retired' ? 'Left the company together to start a family.'
				: away.length ? `Off roster · ${away.map(function (pilot) { return pilot.home ? `${pilot.callsign} on ${getPlanet(pilot.home).name}` : pilot.callsign; }).join(' and ')}` : 'Both aboard';
			return html`<article class="pilot-record" data-pilot-pair=${`${a}/${b}`}>
				<div><span class="eyebrow">${trustLabel(affinity)}</span><h3>${first.callsign} &amp; ${second.callsign}</h3><p>${first.name} · ${second.name}</p></div>
				<div>${romance !== 'none' ? html`<strong>${romanceLabels[romance]}</strong>` : ''}<p>${status}</p>
				${romance === 'retired' ? '' : html`<small>${coordinationText(adjustment)} coordination when deployed together</small>`}</div>
			</article>`;
		}),
	] }];
};

export const pilotPanes = function (campaign: Campaign, actions: CompanyActions): WorkspacePane[] {
	const locked = Boolean(campaign.deployed);
	const offers = getRecruitOffers(campaign);
	const port = getPlanet(campaign.planetId).name;
	return [
		{ id: 'roster', label: 'Roster', items: campaign.pilots.map(function (id) {
			const pilot = getPilot(id);
			const lineup = campaign.operations?.length
				? campaign.operations.find(function (operation) { return operation.lineup.some(function (seat) { return seat.pilotId === id; }); })?.lineup ?? []
				: campaign.active ? campaign.lineup : campaign.preferredLineup ?? campaign.lineup;
			const assignment = lineup.find(function (entry) { return entry.pilotId === id; });
			const frame = assignment?.frameId ? rigName(assignment.frameId) : undefined;
			const coordination = pilotCoordination(campaign, id, lineup);
			return html`<article class="pilot-record" data-roster-pilot=${id}>
				<div><span class="eyebrow">${pilotRole(pilot)}</span><h3>${pilot.callsign}</h3><p>${personnelName(pilot)}</p></div>
				<div><p>${pilot.description}</p>${skillText(campaign, pilot, true)}<small>${frame ? `ASSIGNED · ${frame}` : assignment ? 'AWAITING RIG' : 'ON THE BENCH'}${coordination ? ` · ${coordinationText(coordination)} coordination in this squad` : ''}</small></div>
				${id === 'player' ? '' : html`<button class="text-button" data-dismiss-pilot=${id} ?disabled=${locked} @click=${function () { actions.dismiss(id); }}>DISMISS ${pilot.callsign}</button>`}
			</article>`;
		}), actions: html`<button class="secondary" @click=${function () { actions.navigate('deploy'); }}>SQUAD LINEUP →</button>` },
		{ id: 'recruitment', label: 'Recruitment', items: offers.length ? offers.map(function (pilot) {
			const affordable = campaign.credits >= pilot.price;
			return html`<article class="pilot-record" data-recruit-pilot=${pilot.id}>
				<div><span class="eyebrow">${port} · ${pilotRole(pilot)}</span><h3>${pilot.callsign}</h3><p>${personnelName(pilot)}</p></div>
				<div><p>${pilot.description}</p>${skillText(campaign, pilot, false)}</div>
				<button class="secondary" data-hire-pilot=${pilot.id} ?disabled=${locked || !affordable} @click=${function () { actions.hire(pilot.id); }}>${affordable ? 'HIRE' : 'NEEDS'} · ${pilot.price.toLocaleString()} CR</button>
			</article>`;
		}) : textItems(`All available pilots on ${port} have signed on. Visit another planet to meet its pilots.`), actions: html`
			${!offers.length ? html`<button class="secondary" @click=${function () { actions.navigate('starmap'); }}>STARMAP →</button>` : ''}
			<button class="secondary" @click=${function () { actions.navigate('market'); }}>RIG MARKET →</button>` },
		...relationshipPanes(campaign),
	];
};

const squadPane = function (campaign: Campaign, actions: CompanyActions, pick: (picker: AssignmentPicker) => void): WorkspacePane {
	const operation = actions.operation;
	const planned = !campaign.active;
	const lineup = operation?.lineup ?? (planned ? campaign.preferredLineup : undefined) ?? campaign.lineup;
	const review = operation && reviewOperations(campaign).entries.find(function (entry) { return entry.operation === operation; });
	const contract = operation?.contract ?? campaign.active;
	const leadId = review?.leaderId ?? (campaign.active ? 'player' : undefined);
	const lead = leadId ? getPilot(leadId) : undefined;
	const forecast = review?.forecast;
	const live = lineup.some(function (entry) { return entry.pilotId === 'player'; });
	const extraction = forecast && (forecast.baseExtractionChance === forecast.extractionChance ? `${forecast.extractionChance}%` : `${forecast.baseExtractionChance}% → ${forecast.extractionChance}%`);
	const ready = canDeploySquad(campaign);
	const count = lineup.filter(function (entry) { return entry.pilotId && entry.frameId; }).length;
	return {
		id: 'squad', label: 'Squad lineup', scrollable: true,
		items: [html`<div class="sortie-context">
			<strong>${contract?.title ?? 'No contract staged'}</strong>
			<span>${count} / ${lineup.length} RIGS ASSIGNED</span>
		</div>`, html`<div class="squad-lineup">${lineup.map(function (entry, slot) {
			const pilot = entry.pilotId ? getPilot(entry.pilotId) : undefined;
			const mech = entry.frameId ? getOwnedMech(campaign, entry.frameId) : undefined;
			const issue = mech ? deploymentIssue(campaign, mech.frameId) : undefined;
			const isLead = Boolean(pilot && pilot.id === leadId);
			const coordination = pilot ? pilotCoordination(campaign, pilot.id, lineup) : 0;
			return html`<article class="squad-seat" data-squad-slot=${slot} data-squad-ready=${String(Boolean(mech && !issue))} data-squad-lead=${String(isLead)}>
				<span class="eyebrow">${isLead ? 'Field lead' : slotName(slot, planned)}</span>
				${slot === 0 && !planned ? html`<strong class="squad-player">${pilot?.callsign ?? 'Player'}</strong>` : html`<button class="squad-seat-choice" data-choose-pilot=${slot} aria-label=${pilot ? `${pilot.callsign} · change pilot` : `${slotName(slot, planned)} · add pilot`} ?disabled=${Boolean(campaign.deployed)} @click=${function () { pick({ slot, kind: 'pilot' }); }}><b>${pilot?.callsign ?? 'Add pilot'}</b><small>${pilot ? pilotRole(pilot) : 'EMPTY SLOT'}</small></button>`}
				${pilot ? html`
						<button class="squad-seat-choice squad-rig-choice" data-choose-rig=${slot} aria-label=${mech ? `${rigName(mech.frameId)} · change rig` : `${slotName(slot, planned)} · assign rig`} ?disabled=${Boolean(campaign.deployed)} @click=${function () { pick({ slot, kind: 'rig' }); }}><b>${mech ? rigName(mech.frameId) : 'Assign rig'}</b>${mech ? html`<small>${Math.ceil(mech.integrity)}% INTEGRITY</small>` : ''}</button>
					${mech ? html`<p>${frameKit(mech)}${coordination ? html`<br><strong>${coordinationText(coordination)} ${live ? 'wing tracking' : 'crew effectiveness'} from trust</strong>` : ''}</p>` : ''}
					${issue || !mech ? html`<p class="squad-readiness">${issue ?? 'Rig required or bench this pilot.'}</p>` : ''}
					${review && !review.live && mech ? html`<button class="squad-lead-choice" data-assign-lead=${pilot.id} aria-pressed=${isLead} @click=${function () { actions.assignLead(pilot.id); }}>${isLead ? 'Leading' : 'Make lead'} · ${pilot.leadership}/5</button>` : ''}
				` : ''}
			</article>`;
			})}</div>`, ...(contract ? [html`<div class="sortie-context"><strong>${lead ? `${lead.callsign} leads` : 'No field lead'}</strong>${forecast ? html`<span>${Math.round(forecast.successChance)}% CHANCE OF SUCCESS</span>` : html`<span>${leadId === 'player' ? 'YOU PLAY' : 'CREW ONLY'}</span>`}</div>`,
			...(forecast ? [`Objective ${forecast.objectiveChance}% · Extraction ${extraction} · Leadership ${lead?.leadership}/5`] : review?.issues ?? []).flatMap(textItems),
			...(lead ? textItems(`On success, ${fieldLeadFee(contract).toLocaleString()} CR lead fee ${lead.id === 'player' ? 'added to company funds' : `paid to ${lead.callsign}`}.`) : []),
			...(forecast?.factors ?? []).flatMap(textItems)] : [])],
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
		return html`<button class="equipment-choice" data-assign-pilot=${id} aria-label=${`Assign ${pilot.callsign}`} aria-pressed=${selected.pilotId === id} ?disabled=${other >= 0 || Boolean(elsewhere)} @click=${function () { close(); actions.assignPilot(slot, id); }}><span><b>${pilot.callsign}</b><small>${pilotRole(pilot)}${id === 'player' ? '' : ` · Leadership ${pilot.leadership}/5`}</small></span><small>${other >= 0 ? `Assigned to ${slotName(other, planned)}` : elsewhere?.contract.title ?? pilot.name}</small></button>`;
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
			${selectPilot && !choices.length ? html`<button class="secondary" @click=${function () { close(); actions.navigate('pilots'); }}>PILOTS →</button>` : ''}`,
	}];
};
