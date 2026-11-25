import { getFrame, type FrameId } from './frames';
import type { Contract, FactionId } from './campaign-types';
import { PAINT_LAYOUTS, type PaintLayoutId, type SolidMechPaint } from './mech-paint';

export type MechSkinId = 'original' | 'freeholds' | 'accord';
export type MechFinish = MechSkinId | SolidMechPaint;
export type LiveryPresetId = MechSkinId | `${FactionId}-${PaintLayoutId}`;
interface LiveryPreset {
	readonly id: LiveryPresetId;
	readonly faction: FactionId | undefined;
	readonly layout: 'original' | 'camo' | PaintLayoutId;
	readonly label: string;
	readonly finish: MechFinish;
}

const makeFactionPresets = function (faction: FactionId): readonly LiveryPreset[] {
	const solid = PAINT_LAYOUTS.map(function ({ id, label, colors }): LiveryPreset {
		const [primary, secondary = primary] = colors[faction];
		return { id: `${faction}-${id}`, faction, layout: id, label, finish: { layout: id, primary, secondary } };
	});
	if (faction === 'combine') return solid;
	return [...solid, { id: faction, faction, layout: 'camo', label: 'Camo', finish: faction }];
};
const factionPresets = { freeholds: makeFactionPresets('freeholds'), combine: makeFactionPresets('combine'), accord: makeFactionPresets('accord') };
const original: LiveryPreset = { id: 'original', faction: undefined, layout: 'original', label: 'Original', finish: 'original' };
const byId = new Map<string, LiveryPreset>([original, ...Object.values(factionPresets).flat()].map(function (preset) { return [preset.id, preset]; }));
export const isLiveryPresetId = function (value: unknown): value is LiveryPresetId { return typeof value === 'string' && byId.has(value); };
export const getLiveryPreset = function (id: LiveryPresetId): LiveryPreset {
	const preset = byId.get(id);
	if (!preset) throw new Error(`Unknown mech livery: ${id}`);
	return preset;
};
export const liveryPresetsForFaction = function (faction: FactionId): readonly LiveryPreset[] { return factionPresets[faction]; };
export const factionLiveryPreset = function (faction: FactionId, layout: LiveryPreset['layout']): LiveryPreset {
	if (layout === 'original' || layout === 'camo') return getLiveryPreset(faction === 'combine' ? 'combine-field' : faction);
	return getLiveryPreset(`${faction}-${layout}`);
};

// A contract's opposing walkers wear one uniform through every wave and retry.
// Return a catalog entry's stable finish so rendering can reuse its models.
export const missionMechFinish = function (contract: Pick<Contract, 'opponent' | 'seed'> | undefined): MechFinish {
	if (!contract) return 'original';
	const presets = factionPresets[contract.opponent];
	return presets[(contract.seed >>> 8) % presets.length]?.finish ?? 'original';
};
export const SKIN_PALETTES = {
	freeholds: { primary: ['#303f2b', '#526c51', '#a18e6d'], secondary: ['#4b563d', '#b7a181', '#657955'], thresholds: [0.42, 0.59], secondaryThresholds: [0.41, 0.59] },
	accord: { primary: ['#263b58', '#62788f', '#17283d'], secondary: ['#d5dde3', '#91a3b7', '#bbc8d5'], thresholds: [0.51, 0.68], secondaryThresholds: [0.51, 0.68] },
} as const;
export const supportsMechSkin = function (frame: FrameId): boolean { return ['warden', 'kestrel', 'maul'].includes(getFrame(frame).chassisId); };
