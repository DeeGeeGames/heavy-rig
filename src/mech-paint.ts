import type { FactionId } from './campaign-types';

export const PAINT_LAYOUTS = [
	{ id: 'field', label: 'Field Issue', colors: { freeholds: ['#72865D'], combine: ['#AB5851'], accord: ['#5F7F9E'] } },
	{ id: 'caps', label: 'Shoulder Caps', colors: { freeholds: ['#2B6046', '#DEBF72'], combine: ['#833E3D', '#E9AB4F'], accord: ['#33496D', '#D4E4ED'] } },
	{ id: 'pale', label: 'Pale Hull', colors: { freeholds: ['#DDD7B4', '#447553'], combine: ['#E6DCCA', '#B4544E'], accord: ['#DDE7EC', '#4265A6'] } },
	{ id: 'beacon', label: 'Beacon Hull', colors: { freeholds: ['#363C41', '#8CC9A1'], combine: ['#363C41', '#E78B40'], accord: ['#363C41', '#98ACE5'] } },
	{ id: 'flank', label: 'Split Flank', colors: { freeholds: ['#9BAE82', '#99594E'], combine: ['#D59F49', '#454C52'], accord: ['#6389B0', '#E6BE5A'] } },
] as const satisfies readonly { id: string; label: string; colors: Record<FactionId, readonly [string, string?]> }[];

export type PaintLayoutId = typeof PAINT_LAYOUTS[number]['id'];
export type PaintZone = 'hull' | 'shoulder' | 'arm' | 'leg' | 'pelvis';
export type PaintSide = 'left' | 'right' | 'center';
export interface SolidMechPaint {
	readonly layout: PaintLayoutId;
	readonly primary: string;
	readonly secondary: string;
}

// The same paint assignment works on fixed armor, interchangeable housings and
// procedural fallback models. Each chassis identifies its own physical panels.
export const paintColorForZone = function (paint: SolidMechPaint, zone: PaintZone, side: PaintSide): string {
	switch (paint.layout) {
		case 'field': return paint.primary;
		case 'caps': return zone === 'shoulder' ? paint.secondary : paint.primary;
		case 'pale': return zone === 'hull' || zone === 'shoulder' ? paint.primary : paint.secondary;
		case 'beacon': return zone === 'hull' ? paint.secondary : paint.primary;
		case 'flank': return side === 'right' ? paint.secondary : paint.primary;
	}
};
