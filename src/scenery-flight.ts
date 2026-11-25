import type { TerrainObstacle } from './field-terrain';

export const turbineHubHeight = function (o: TerrainObstacle) { return o.height + (o.width + o.depth) * .80; };
export const rotorRadius = function (hubHeight: number) { return hubHeight * .46; };

// Ground units can walk under branches and blades. Aircraft need the whole crown
// or swept rotor disk, including its offset from the concrete foundation.
export const sceneryFlightBounds = function (o: TerrainObstacle): TerrainObstacle {
	if (o.kind === 'tree' && o.height > 50) {
		const crown = Math.max(o.width, o.depth) * 3.5;
		return { ...o, width: crown, depth: crown, height: o.height * 1.06 };
	}
	if (o.kind === 'turbine') {
		const hub = turbineHubHeight(o), radius = rotorRadius(hub);
		const span = 2 * (radius + o.width * .41);
		return { ...o, width: span, depth: span, height: hub + radius };
	}
	return o;
};
