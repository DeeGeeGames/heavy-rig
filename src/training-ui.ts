import { html, render } from 'lit-html';
import { keyed } from 'lit-html/directives/keyed.js';
import { getWeapon, WEAPONS, WEAPON_SIZE_LABELS, type WeaponId } from './arsenal';
import type { ChoicePicker } from './choice-picker';
import { defaultReserves } from './combat-resources';
import { PLAYABLE_FRAMES, type FrameId } from './frames';
import { canEquipWeapon, stockPackage, getHardpoints } from './hardpoints';
import { loadSummary, weaponClassLabel } from './loadout-ui';
import type { TrainingSetup } from './training';

export const mountTrainingSetup = function (root: HTMLElement, picker: ChoicePicker) {
	let frame: FrameId = 'warden';
	const drafts = new Map<FrameId, TrainingSetup>();
	const current = function (): TrainingSetup {
		const draft = drafts.get(frame);
		if (draft) return draft;
		return { frame, ...stockPackage(frame) };
	};
	const refresh = function () {
		const setup = current();
		render(html`
			${picker.field('training-frame', 'Frame', frame, PLAYABLE_FRAMES.map(function (rig) {
				return { value: rig.id, label: rig.name };
			}), function (choice) { frame = choice; refresh(); })}
			${keyed(frame, html`<div class="training-mounts">${getHardpoints(frame).map(function (hardpoint, slot) {
				const weapons = WEAPONS.filter(function (weapon) { return canEquipWeapon(frame, slot, weapon.id); }).map(function (weapon) {
					return { value: weapon.id, label: `${weapon.name} · ${WEAPON_SIZE_LABELS[weapon.size]}` };
				});
				const weaponId = setup.loadout[slot] ?? null;
				const ammunition = weaponId ? getWeapon(weaponId).ammunition : null;
				const mountLabel = `${slot + 1} · ${hardpoint.name} · ${weaponClassLabel(hardpoint.family, hardpoint.maxSize)}`;
				return html`<div class="training-mount">
					${picker.field(`training-mount-${slot}`, mountLabel, weaponId, [{ value: null, label: 'Empty' }, ...weapons], function (weapon) {
						const loadout = setup.loadout.map(function (id, index): WeaponId | null { return index === slot ? weapon : id; });
						const reserves = defaultReserves(loadout).map(function (value, index) { return index === slot ? value : setup.reserves[index] ?? value; });
						drafts.set(frame, { frame, loadout, reserves }); refresh();
					})}
					${ammunition ? picker.field(`training-ammo-${slot}`, 'Rounds', setup.reserves[slot] ?? 0,
						[...new Set([0, setup.reserves[slot] ?? 0, ammunition.defaultLoad, ammunition.capacity])].sort(function (a, b) { return a - b; }).map(function (amount) { return { value: amount, label: String(amount) }; }),
						function (amount) {
							const reserves = setup.reserves.map(function (value, index) { return index === slot ? amount : value; });
							drafts.set(frame, { ...setup, reserves }); refresh();
						}, `${hardpoint.name} ammunition`) : ''}
				</div>`;
			})}</div>`)}
			<p class="training-fit-summary">${loadSummary(frame, setup.loadout, setup.reserves)}</p>
		`, root);
	};
	refresh();
	return current;
};
