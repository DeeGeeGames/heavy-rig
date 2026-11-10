import { getWeapon, WEAPON_FAMILY_LABELS, type WeaponDefinition } from './arsenal';
import { frameWeight, loadedMounts } from './combat-resources';
import type { Loadout } from './company';
import type { FrameId } from './frames';
import { getHardpoints } from './hardpoints';

export const MOUNTS = [
	{ action: 'mount-0', mouse: 'LEFT', pad: 'RT / R2', key: '1', button: 0 },
	{ action: 'mount-1', mouse: 'RIGHT', pad: 'LT / L2', key: '2', button: 2 },
	{ action: 'mount-2', mouse: 'MIDDLE', pad: 'RB / R1', key: '3', button: 1 },
	{ action: 'mount-3', mouse: 'THUMB', pad: 'LB / L1', key: '4', button: 3 },
] as const;
export const rankLabel = function (level: number) { return ['I', 'II', 'III'][level - 1] ?? 'I'; };
export const massLabel = function (mass: number) { return `${mass.toFixed(3).replace(/\.?0+$/, '')} t`; };
export const sustainedHeat = function (weapon: WeaponDefinition) { return weapon.kind === 'laser' ? weapon.heat : weapon.heat / weapon.interval; };
export const supplySummary = function (loadout: Loadout, reserves: readonly number[]): string {
	return loadout.flatMap(function (id, slot) {
		if (id === null) return [];
		const weapon = getWeapon(id);
		return [`M${slot + 1} ${weapon.name}: ${weapon.ammunition ? `${reserves[slot] ?? 0} rounds` : 'energy'} / ${sustainedHeat(weapon).toFixed(1)} heat/s`];
	}).join(' · ');
};
export const loadSummary = function (frame: FrameId, loadout: Loadout, reserves: readonly number[]): string {
	const weight = frameWeight(frame, loadedMounts(loadout, reserves));
	const status = Math.abs(weight.modifier - 1) < .0001 ? 'AT RECOMMENDATION' : weight.modifier < 1 ? 'OVERLOADED' : 'UNDERWEIGHT';
	return `${massLabel(weight.total)} / ${massLabel(weight.recommended)} recommended · ${status} · ${weight.speed.toFixed(1)} m/s (${weight.modifier >= 1 ? '+' : ''}${((weight.modifier - 1) * 100).toFixed(1)}%).`;
};

export const hardpointSummary = function (frame: FrameId): string {
	const hardpoints = getHardpoints(frame);
	const families = [...new Set(hardpoints.map(function (hardpoint) { return hardpoint.family; }))];
	return `${hardpoints.length} ${hardpoints.length === 1 ? 'hardpoint' : 'hardpoints'}: ${families.map(function (family) { return `${hardpoints.filter(function (hardpoint) { return hardpoint.family === family; }).length} ${WEAPON_FAMILY_LABELS[family].toLowerCase()}`; }).join(' / ')}.`;
};
