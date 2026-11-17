import { getFrame, type FrameId } from './frames';
import type { FactionId } from './campaign-types';

export type MechSkinId = 'original' | 'freeholds' | 'accord';
export const MECH_SKINS: readonly { id: MechSkinId; name: string; label: string }[] = [
	{ id: 'freeholds', name: 'Frontier Freeholds', label: 'Freeholds' },
	{ id: 'accord', name: 'Signal Accord', label: 'Accord' },
	{ id: 'original', name: 'Original finish', label: 'Original' },
];
export const SKIN_PALETTES = {
	freeholds: { primary: ['#303f2b', '#526c51', '#a18e6d'], secondary: ['#4b563d', '#b7a181', '#657955'], thresholds: [0.42, 0.59], secondaryThresholds: [0.41, 0.59] },
	accord: { primary: ['#263b58', '#62788f', '#17283d'], secondary: ['#d5dde3', '#91a3b7', '#bbc8d5'], thresholds: [0.51, 0.68], secondaryThresholds: [0.51, 0.68] },
} as const;
export const isMechSkinId = function (value: unknown): value is MechSkinId { return value === 'original' || value === 'freeholds' || value === 'accord'; };
export const supportsMechSkin = function (frame: FrameId): boolean { return ['warden', 'kestrel', 'maul'].includes(getFrame(frame).chassisId); };
export const factionMechSkin = function (faction: FactionId | undefined): MechSkinId { return faction === 'freeholds' || faction === 'accord' ? faction : 'original'; };
