import { html, render } from 'lit-html';
import { CONTRACT_COPY, getPlanet, MISSION_KINDS } from './campaign';
import { MISSION_NAMES } from './campaign-types';
import type { ChoicePicker } from './choice-picker';
import { PLAYABLE_FRAMES } from './frames';
import { getPilot, RECRUIT_IDS, SQUAD_SIZE } from './pilots';
import { MISSION_TIERS } from './reputation';
import type { SituationSetup } from './situation-sim';

const missions = MISSION_KINDS.map(function (kind) { return { value: kind, label: MISSION_NAMES[kind] }; });
const locations = (['meridian', 'cinder', 'borealis'] as const).map(function (id) {
	const { name, biome } = getPlanet(id);
	return { value: id, label: `${name} · ${biome}` };
});
const tiers = MISSION_TIERS.map(function ({ tier, name }) { return { value: tier, label: `${tier} · ${name}` }; });
const frames = PLAYABLE_FRAMES.map(function ({ id, name }) { return { value: id, label: name }; });

export const mountSituationSetup = function (root: HTMLElement, picker: ChoicePicker) {
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
					${picker.field('situation-mission', 'Mission type', setup.kind, missions, function (kind) { update({ kind }); })}
					${picker.field('situation-location', 'Location', setup.planetId, locations, function (planetId) { update({ planetId }); })}
					${picker.field('situation-tier', 'Threat tier', setup.tier, tiers, function (tier) { update({ tier }); })}
				</div>
				<p class="situation-briefing">${CONTRACT_COPY[setup.kind].briefing}</p>
			</div>
			<div class="situation-lineup">
				${picker.field('situation-player', 'Player rig', setup.frame, frames, function (frame) { update({ frame }); })}
				${setup.wing.map(function (member, slot) {
					const number = slot + 1;
					const pilots = [{ value: null, label: 'Empty slot' }, ...RECRUIT_IDS.map(function (id) {
						const { callsign, specialty } = getPilot(id);
						return { value: id, label: `${callsign} · ${specialty}`, disabled: setup.wing.some(function (other, index) { return other.pilotId === id && index !== slot; }) };
					})];
					return html`<div class="situation-seat">
						${picker.field(`situation-pilot-${number}`, `Squadmate ${number} pilot`, member.pilotId, pilots, function (pilotId) { updateSlot(slot, { pilotId }); })}
						${member.pilotId ? picker.field(`situation-rig-${number}`, `Squadmate ${number} rig`, member.frame, frames, function (frame) { updateSlot(slot, { frame }); }) : ''}
					</div>`;
				})}
			</div>
			<p class="training-fit-summary">Rigs deploy with stock loadouts. This mode keeps no saved progress.</p>
		`, root);
	};
	refresh();
	return function () { return setup; };
};
