import { html, render } from 'lit-html';
import { CONTRACT_COPY, MISSION_KINDS, PLANETS } from './campaign';
import { BIOME_NAMES, MISSION_NAMES } from './campaign-types';
import { PLAYABLE_FRAMES } from './frames';
import { getPilot, RECRUIT_IDS, SQUAD_SIZE } from './pilots';
import { MISSION_TIERS } from './reputation';
import type { SituationSetup } from './situation-sim';

interface Choice<T> { value: T; label: string; disabled?: boolean }

const select = function <T extends string | number | null>(id: string, label: string, value: T, choices: readonly Choice<T>[], choose: (chosen: T) => void) {
	return html`<label><span>${label}</span><select id=${id} @change=${function (event: Event) {
		if (!(event.target instanceof HTMLSelectElement)) return;
		const choice = choices[event.target.selectedIndex];
		if (choice && !choice.disabled) choose(choice.value);
	}}>${choices.map(function (choice) {
		return html`<option value=${choice.value ?? ''} ?selected=${choice.value === value} ?disabled=${Boolean(choice.disabled)}>${choice.label}</option>`;
	})}</select></label>`;
};

const missions = MISSION_KINDS.map(function (kind) { return { value: kind, label: MISSION_NAMES[kind] }; });
const locations = PLANETS.filter(function (world) {
	return !world.id.startsWith('system-');
}).map(function ({ id, name, biome }) { return { value: id, label: `${name} · ${BIOME_NAMES[biome]}` }; });
const tiers = MISSION_TIERS.map(function ({ tier, name }) { return { value: tier, label: `${tier} · ${name}` }; });
const frames = PLAYABLE_FRAMES.map(function ({ id, name }) { return { value: id, label: name }; });

export const mountSituationSetup = function (root: HTMLElement) {
	let setup: SituationSetup = {
		kind: 'defend', planetId: 'meridian', tier: 1, frame: 'warden',
		wing: Array.from({ length: SQUAD_SIZE - 1 }, function () { return { pilotId: null, frame: 'kestrel' }; }),
	};
	const update = function (changes: Partial<SituationSetup>) {
		setup = { ...setup, ...changes };
		refresh();
	};
	const updateSlot = function (slot: number, changes: Partial<SituationSetup['wing'][number]>) {
		update({ wing: setup.wing.map(function (member, index) { return index === slot ? { ...member, ...changes } : member; }) });
	};
	const refresh = function () {
		render(html`
			<div class="situation-plan">
				<div class="situation-conditions">
					${select('situation-mission', 'Mission type', setup.kind, missions, function (kind) { update({ kind }); })}
					${select('situation-location', 'Location', setup.planetId, locations, function (planetId) { update({ planetId }); })}
					${select('situation-tier', 'Threat tier', setup.tier, tiers, function (tier) { update({ tier }); })}
				</div>
				<p class="situation-briefing">${CONTRACT_COPY[setup.kind].briefing}</p>
			</div>
			<div class="situation-lineup">
				${select('situation-player', 'Player rig', setup.frame, frames, function (frame) { update({ frame }); })}
				${setup.wing.map(function (member, slot) {
					const number = slot + 1;
					const pilots = [{ value: null, label: 'Empty slot' }, ...RECRUIT_IDS.map(function (id) {
						const { callsign, specialty } = getPilot(id);
						return { value: id, label: `${callsign} · ${specialty}`, disabled: setup.wing.some(function (other, index) { return other.pilotId === id && index !== slot; }) };
					})];
					return html`<div class="situation-seat">
						${select(`situation-pilot-${number}`, `Squadmate ${number} pilot`, member.pilotId, pilots, function (pilotId) { updateSlot(slot, { pilotId }); })}
						${member.pilotId ? select(`situation-rig-${number}`, `Squadmate ${number} rig`, member.frame, frames, function (frame) { updateSlot(slot, { frame }); }) : ''}
					</div>`;
				})}
			</div>
			<p class="training-fit-summary">Rigs deploy with stock loadouts. This mode keeps no saved progress.</p>
		`, root);
	};
	refresh();
	return function () { return setup; };
};
