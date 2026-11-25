import type { Point } from './simulation';
import { mixSeed, randomSource } from './universe';
import type { SpatialPoint } from './weapon-rig';

export const ARTILLERY_TARGETING_SECONDS = 2;
export const ARTILLERY_FLIGHT_SECONDS = 2;
const DISPERSION_RADIUS = 240;
export const EMPLACEMENT_BLAST_RADIUS = 64;

export interface ArtilleryAim { targetId: number; remaining: number }
export interface EmplacementShot { origin: SpatialPoint; direction: SpatialPoint; firedAt: number }

// The shot ID gives each shell its own repeatable sample, including shells
// fired by a battery on the same tick. Sample by area so the center stays sparse.
export const scatteredImpact = function (target: Point, bounds: { width: number; height: number }, seed: number, shotId: number): Point {
	const random = randomSource(mixSeed(seed, shotId));
	const heading = random() * Math.PI * 2;
	const radius = Math.sqrt(random()) * DISPERSION_RADIUS;
	// Fold misses back into the field at its edges instead of piling them on the boundary.
	const fold = function (position: number, limit: number) {
		return position < 0 ? -position : position > limit ? 2 * limit - position : position;
	};
	return { x: fold(target.x + Math.cos(heading) * radius, bounds.width), y: fold(target.y + Math.sin(heading) * radius, bounds.height) };
};
