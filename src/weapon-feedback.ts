import type { SpatialPoint } from './weapon-rig';

// Player is 0, enemies use positive combat IDs, squadmates use pilot IDs.
// Unattributed hostile ordnance uses -1.
export type FeedbackActor = number | string;
export type FeedbackFamily = 'bullet' | 'cannon' | 'missile' | 'rocket' | 'artillery';
export type ImpactSurface = 'armor' | 'concrete' | 'ground' | 'wood';

interface WeaponContact {
	family: FeedbackFamily;
	heavy: boolean;
	time: number;
	shooter: FeedbackActor;
	/** Unit vector in simulation coordinates (x, y on the ground, elevation up). */
	direction: SpatialPoint;
}
export type WeaponCue = WeaponContact & (
	| { type: 'fire'; slot: number }
	| { type: 'impact'; surface: ImpactSurface; target?: FeedbackActor; normal?: SpatialPoint; affected?: readonly FeedbackActor[]; scuff?: true }
);
