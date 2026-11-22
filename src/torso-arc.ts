export const TORSO_LIMIT = 115 * Math.PI / 180;
const headingStep = Math.PI / 6;

export const snapMechHeading = function (angle: number): number {
	return Math.round(angle / headingStep) * headingStep;
};

const delta = function (from: number, to: number) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); };
const clamp = function (value: number, limit: number) { return Math.max(-limit, Math.min(limit, value)); };

export const inFiringArc = function (body: { x: number; y: number }, legs: number, target: { x: number; y: number }): boolean {
	if (target.x === body.x && target.y === body.y) return true;
	return Math.abs(delta(legs, Math.atan2(target.y - body.y, target.x - body.x))) <= TORSO_LIMIT + 1e-9;
};

// Clamp before aiming so leg motion carries the torso at its mechanical stops.
// Interpolate in leg-relative space: switching sides must pass through the front.
export const turnTorso = function (legs: number, torso: number, target: number, travel: number, manual?: number): number {
	const current = clamp(delta(legs, torso), TORSO_LIMIT);
	if (manual !== undefined) return legs + clamp(current + clamp(manual, 1) * travel, TORSO_LIMIT);
	const requested = delta(legs, target);
	// A target anywhere in the blind sector stays on the current side, even as
	// it crosses the rear centerline. A centered torso initially picks its side.
	const destination = Math.abs(requested) <= TORSO_LIMIT + 1e-9 ? clamp(requested, TORSO_LIMIT)
		: (Math.sign(current) || Math.sign(requested) || 1) * TORSO_LIMIT;
	return legs + clamp(current + clamp(destination - current, travel), TORSO_LIMIT);
};
