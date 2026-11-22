import { html, render } from 'lit-html';
import { keyed } from 'lit-html/directives/keyed.js';
import { getWeapon, WEAPONS, type WeaponId } from './arsenal';
import { defaultReserves } from './combat-resources';
import { PLAYABLE_FRAMES, type FrameId } from './frames';
import { canEquipWeapon, createStarterLoadout, getHardpoints } from './hardpoints';
import { loadSummary } from './loadout-ui';
import type { TrainingSetup } from './training';

export const mountTrainingSetup = function (root: HTMLElement) {
	let frame: FrameId = 'warden';
	const drafts = new Map<FrameId, TrainingSetup>();
	const current = function (): TrainingSetup {
		const draft = drafts.get(frame);
		if (draft) return draft;
		const loadout = createStarterLoadout(frame);
		return { frame, loadout, reserves: defaultReserves(loadout) };
	};
	const refresh = function () {
		const setup = current();
		render(html`
			<label class="training-frame-choice"><span>Frame</span>
				<select id="training-frame" @change=${function (event: Event) {
					if (!(event.target instanceof HTMLSelectElement)) return;
					const choice = PLAYABLE_FRAMES[event.target.selectedIndex];
					if (choice) { frame = choice.id; refresh(); }
				}}>${PLAYABLE_FRAMES.map(function (option) {
					return html`<option value=${option.id} ?selected=${frame === option.id}>${option.name}</option>`;
				})}</select>
			</label>
			${keyed(frame, html`<div class="training-mounts">${getHardpoints(frame).map(function (hardpoint, slot) {
				const weapons = WEAPONS.filter(function (weapon) { return canEquipWeapon(frame, slot, weapon.id); });
				const weaponId = setup.loadout[slot];
				const ammunition = weaponId ? getWeapon(weaponId).ammunition : null;
				const rounds = ammunition ? [0, ammunition.defaultLoad, ammunition.capacity] : [];
				return html`<div class="training-mount">
					<label><span>${slot + 1} · ${hardpoint.name}</span>
						<select data-training-mount=${slot} @change=${function (event: Event) {
							if (!(event.target instanceof HTMLSelectElement)) return;
							const weapon = weapons[event.target.selectedIndex - 1]?.id ?? null;
							const loadout = setup.loadout.map(function (id, index): WeaponId | null { return index === slot ? weapon : id; });
							const reserves = defaultReserves(loadout).map(function (value, index) { return index === slot ? value : setup.reserves[index] ?? value; });
							drafts.set(frame, { frame, loadout, reserves }); refresh();
						}}><option value="" ?selected=${weaponId === null}>Empty</option>${weapons.map(function (weapon) {
							return html`<option value=${weapon.id} ?selected=${weapon.id === weaponId}>${weapon.name}</option>`;
						})}</select>
					</label>
					${ammunition ? keyed(weaponId, html`<label><span>Rounds</span>
						<select data-training-ammo=${slot} aria-label=${`${hardpoint.name} ammunition`} @change=${function (event: Event) {
							if (!(event.target instanceof HTMLSelectElement)) return;
							const amount = rounds[event.target.selectedIndex];
							if (amount === undefined) return;
							const reserves = setup.reserves.map(function (value, index) { return index === slot ? amount : value; });
							drafts.set(frame, { ...setup, reserves }); refresh();
						}}>${rounds.map(function (amount) {
							return html`<option value=${amount} ?selected=${amount === setup.reserves[slot]}>${amount}</option>`;
						})}</select>
					</label>`) : ''}
				</div>`;
			})}</div>`)}
			<p class="training-fit-summary">${loadSummary(frame, setup.loadout, setup.reserves)}</p>
		`, root);
	};
	refresh();
	return current;
};
