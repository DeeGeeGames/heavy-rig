import type { Biome, MissionMap } from './campaign-types';
import { terrainPathClear, type FieldTerrain, type ObstacleField, type TerrainObstacle } from './field-terrain';
import type { Point } from './simulation';
import { groundHeight } from './terrain-elevation';
import { LAUNCH_TIMING } from './launch-timing';
import { sceneryFlightBounds } from './scenery-flight';
import { hasBiomeGround } from './biome-ground';
import { DROPSHIP_DECK, DROPSHIP_WIDTH } from './launch-berths';

interface FlightClearance { arrival: number; departure: number; clearHeight: number; padContacts: number }
export interface LandingSite {
	heading: number;
	at: (side: number, aft: number) => Point;
	aftAt: (point: Point) => number;
	flight: FlightClearance;
}

export const approachRun = 550, approachDescent = 150;
// The transport banks ten degrees on departure. Allow for the outside pod
// dipping and the roof swinging beyond the level hull.
const bankClearance = Math.ceil(DROPSHIP_WIDTH / 2 * Math.sin(Math.PI / 18));

const { touchdown, lift, end: handoff } = LAUNCH_TIMING;
const between = function (time: number, start: number, end: number) { return Math.max(0, Math.min(1, (time - start) / (end - start))); };
const ease = function (v: number) { return v * v * (3 - 2 * v); };

export const altitude = function (time: number) {
	return 54 * (1 - ease(between(time, touchdown, touchdown + .5)))
		+ 95 * ease(between(time, lift, lift + 1)) + 400 * between(time, lift + 1, handoff) ** 1.5;
};
export const flightPosition = function (time: number) {
	const inbound = (1 - between(time, LAUNCH_TIMING.approach, touchdown)) ** 2;
	const departure = 45 * ease(between(time, lift, lift + 1)) + 980 * between(time, lift + .95, handoff) ** 1.6;
	return { aft: approachRun * inbound - departure, height: altitude(time) + approachDescent * inbound };
};

const flight = Array.from({ length: Math.round((handoff - LAUNCH_TIMING.approach) * 8) + 1 }, function (_, i) {
	return flightPosition(LAUNCH_TIMING.approach + i / 8);
});
const landingAirspace = function (biome: Biome, obstacles: readonly TerrainObstacle[]) {
	if (!hasBiomeGround(biome)) return [];
	return obstacles.filter(function (o) { return o.height > 0; }).map(function (obstacle) {
		const o = sceneryFlightBounds(obstacle);
		let departure = 0, arrival = 0;
		for (const [i, end] of flight.entries()) {
			const start = flight[i - 1];
			if (!start || Math.min(start.height, end.height) > o.height + bankClearance) continue;
			departure = Math.max(departure, -start.aft, -end.aft);
			arrival = Math.max(arrival, start.aft, end.aft);
		}
		return { ...o, departure, arrival };
	});
};

// Tall scenery beside a pad may allow a steeper approach even when there is
// no full-length flight corridor. Keep the ship inside the clearing until
// it climbs above the highest obstruction, then let it leave at full speed.
const flightClearance = function (origin: Point, heading: number, airspace: ReturnType<typeof landingAirspace>): FlightClearance {
	const cos = Math.cos(heading), sin = Math.sin(heading);
	let arrival = 1, departure = 1, clearHeight = 0, padContacts = 0;
	for (const o of airspace) {
		const x = o.x - origin.x, y = o.y - origin.y;
		const side = Math.abs(x * sin - y * cos) - (Math.abs(sin) * o.width + Math.abs(cos) * o.depth) / 2;
		if (side >= DROPSHIP_WIDTH / 2 + bankClearance) continue;
		const along = x * cos + y * sin, span = (Math.abs(cos) * o.width + Math.abs(sin) * o.depth) / 2;
		const near = along - span, far = along + span;
		if (near > 215) {
			if (o.arrival > 0) arrival = Math.min(arrival, (near - 215) / o.arrival);
			if (side < DROPSHIP_DECK.halfWidth + 5 && near < DROPSHIP_DECK.toe + 5) padContacts++;
		} else if (far < -233) {
			if (o.departure > 0 && -233 - far < o.departure) {
				departure = Math.min(departure, (-233 - far) / o.departure);
				clearHeight = Math.max(clearHeight, o.height + bankClearance);
			}
		} else padContacts++;
	}
	return { arrival, departure, clearHeight, padContacts };
};

export const flightClearanceFor = function (biome: Biome, obstacles: readonly TerrainObstacle[]) {
	const airspace = landingAirspace(biome, obstacles);
	return function (origin: Point, heading: number) { return flightClearance(origin, heading, airspace); };
};
export const landingFootprint = function (point: Point, radius: number) {
	return { x: point.x, y: point.y, width: 2 * radius, depth: 2 * radius };
};

// The wide lift pods and the lip of the ramp must share the touchdown plane.
export const supportRange = function (terrain: FieldTerrain | undefined, site: Pick<LandingSite, 'at'>, aft = 0) {
	if (!terrain?.elevation) return { low: 0, high: 0 };
	let low = Infinity, high = -Infinity;
	for (const along of [-233, -120, 0, 110, DROPSHIP_DECK.hinge, 280, DROPSHIP_DECK.toe]) {
		const half = along > DROPSHIP_DECK.hinge ? DROPSHIP_DECK.halfWidth : DROPSHIP_WIDTH / 2;
		for (const side of [-half, -half * .5, 0, half * .5, half]) {
			const h = groundHeight(terrain, site.at(side, aft + along));
			low = Math.min(low, h); high = Math.max(high, h);
		}
	}
	return { low, high };
};

// Look at the whole touchdown envelope. A narrow shoulder can lie between
// the support samples used to fly across the terrain during the approach.
const touchdownVariation = function (terrain: FieldTerrain | undefined, site: LandingSite) {
	const grid = terrain?.elevation;
	if (!grid) return 0;
	const center = site.at(0, (DROPSHIP_DECK.toe - 233) / 2), along = (DROPSHIP_DECK.toe + 233) / 2, across = DROPSHIP_WIDTH / 2;
	const cos = Math.cos(site.heading), sin = Math.sin(site.heading), absCos = Math.abs(cos), absSin = Math.abs(sin);
	const spanX = absCos * along + absSin * across, spanY = absSin * along + absCos * across;
	let low = Infinity, high = -Infinity;
	for (let row = 0; row + 1 < grid.ys.length; row++) {
		const y = grid.ys[row] ?? 0, nextY = grid.ys[row + 1] ?? y;
		if (y > center.y + spanY) break;
		if (nextY < center.y - spanY) continue;
		const halfY = (nextY - y) / 2, dy = y + halfY - center.y;
		for (let col = 0; col + 1 < grid.xs.length; col++) {
			const x = grid.xs[col] ?? 0, nextX = grid.xs[col + 1] ?? x;
			if (x > center.x + spanX) break;
			if (nextX < center.x - spanX) continue;
			const halfX = (nextX - x) / 2, dx = x + halfX - center.x;
			if (Math.abs(dx * cos + dy * sin) > along + absCos * halfX + absSin * halfY
				|| Math.abs(dx * sin - dy * cos) > across + absSin * halfX + absCos * halfY) continue;
			const stride = grid.xs.length, i = row * stride + col;
			const nw = grid.heights[i] ?? 0, ne = grid.heights[i + 1] ?? 0;
			const sw = grid.heights[i + stride] ?? 0, se = grid.heights[i + stride + 1] ?? 0;
			low = Math.min(low, nw, ne, sw, se); high = Math.max(high, nw, ne, sw, se);
		}
	}
	return Math.max(0, high - low);
};

export const landingSites = function* (map: MissionMap, terrain: ObstacleField, formation: readonly Point[], facing: number,
	clearance: (origin: Point, heading: number) => FlightClearance, ground?: FieldTerrain, pickup = false): Generator<LandingSite> {
	// Keep the ramp facing the camera. Where terrain permits, point it toward
	// the trailing formation so early arrivals can walk straight to their stations.
	const away = facing + Math.PI;
	const preferred = [0, 90, 30, 60, -22.5, 112.5].map(function (degrees) { return degrees * Math.PI / 180; })
		.sort(function (a, b) { return Math.cos(b - away) - Math.cos(a - away); });
	const candidates = [...preferred, ...[15, 45, 75].map(function (degrees) { return degrees * Math.PI / 180; })];
	const placement = function (heading: number, shift: number, runout: number) {
		const dx = Math.cos(heading), dz = Math.sin(heading);
		const back = pickup ? -120 : Math.min(...formation.map(function (actor) { return (actor.x - map.drop.x) * dx + (actor.y - map.drop.y) * dz; }));
		const offset = back - DROPSHIP_DECK.toe - runout;
		const at = function (side: number, aft: number): Point {
			return { x: map.drop.x + dx * (offset + aft) + dz * (side + shift), y: map.drop.y + dz * (offset + aft) - dx * (side + shift) };
		};
		const aftAt = function (p: Point) { return (p.x - map.drop.x) * dx + (p.y - map.drop.y) * dz - offset; };
		return { heading, at, aftAt, flight: clearance(at(0, 0), heading) };
	};
	let fallback = placement(0, 0, 106), best = Infinity;
	const inField = function (p: Point) { return p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height; };
	const offsets = [0, -120, 120, -240, 240, -350, 350, -490, 490, -630, 630];
	const score = function (site: ReturnType<typeof placement>) {
		const fits = [-1, 1].every(function (side) {
			return inField(site.at(side * DROPSHIP_WIDTH / 2, -233)) && inField(site.at(side * DROPSHIP_WIDTH / 2, DROPSHIP_DECK.hinge))
				&& inField(site.at(side * 160, DROPSHIP_DECK.toe));
		});
		// Overlapping strips cover the whole hull and its wide nacelles.
		const occupied = [-.4, -.2, 0, .2, .4].filter(function (fraction) {
			const side = DROPSHIP_WIDTH * fraction;
			return !terrainPathClear(terrain, site.at(side, -190), site.at(side, DROPSHIP_DECK.hinge), DROPSHIP_WIDTH * .105);
		}).length;
		const blocked = formation.filter(function (actor) { return !terrainPathClear(terrain, site.at(0, DROPSHIP_DECK.toe), actor, 30); }).length;
		const ramp = terrainPathClear(terrain, site.at(0, DROPSHIP_DECK.hinge), site.at(0, DROPSHIP_DECK.toe), DROPSHIP_DECK.halfWidth);
		const shortenedFlight = (2 - site.flight.arrival - site.flight.departure) * .25;
		const obstructions = occupied + site.flight.padContacts + (fits ? 0 : 1) + (ramp ? 0 : 1);
		const variation = pickup && obstructions > 0 ? 0 : touchdownVariation(ground, site);
		const uneven = variation > .01 ? 1 + variation / 20 : 0;
		// Once the hull and ramp are clear, curved disembarkation paths can
		// route individual rigs around obstructions between the ramp and formation.
		if (pickup) return obstructions * 1000 + 10 * uneven + blocked * 8 + shortenedFlight;
		return (obstructions + uneven) * (formation.length + 1) + blocked + shortenedFlight;
	};
	// Try a longer straight walk or a broadside before making everyone walk
	// several rig widths sideways from a distant landing site.
	const angles = function (degrees: number[]) { return degrees.map(function (angle) { return angle * Math.PI / 180; }); };
	const views = [candidates, angles([-45, 135, -60, 150]), angles([-75, 165, -90, 180])];
	if (pickup) {
		const headings = Array.from({ length: 24 }, function (_, i) { return i * Math.PI / 12; })
			.sort(function (a, b) {
				// Rear three-quarter view keeps the open hatch and boarding lane visible.
				return Math.cos(b - Math.PI / 4) - Math.cos(a - Math.PI / 4);
			});
		const choices: { site: LandingSite; cost: number }[] = [];
		for (const runout of [36, 128, 240, 380]) for (const shift of [0, -120, 120, -260, 260, -450, 450, -650, 650]) for (const heading of headings) {
			const site = placement(heading, shift, runout);
			const merit = score(site);
			const cost = merit + Math.hypot(runout, shift) / 140;
			choices.push({ site, cost });
		}
		choices.sort(function (a, b) { return a.cost - b.cost; });
		for (const choice of choices) yield choice.site;
		return;
	}
	for (const shifts of [offsets.slice(0, 3), offsets.slice(3)]) {
		for (const headings of views) {
			for (const runout of [106, 180, 250]) for (const shift of shifts) for (const heading of headings) {
				const site = placement(heading, shift, runout), cost = score(site);
				if (cost === 0) yield site;
				if (cost < best) { fallback = site; best = cost; }
			}
		}
	}
	if (best > 0) yield fallback;
};

interface LandingPad extends Point { c: number; s: number; halfLength: number; halfWidth: number }

// Grade representative clear touchdown sites before adding relief. Survey the
// same camera-facing approaches used by the transport for each squad size.
export const surveyLandingPads = function (map: MissionMap, obstacles: readonly TerrainObstacle[], formation: readonly Point[], reserves: ObstacleField['obstacles'] = []): LandingPad[] {
	const facing = Math.atan2(map.objective.y - map.drop.y, map.objective.x - map.drop.x);
	const field = { obstacles: [...obstacles, ...reserves] };
	const clearance = flightClearanceFor(map.biome, obstacles);
	const pads: LandingPad[] = [];
	for (let count = 1; count <= formation.length; count++) {
		const sites = landingSites(map, field, formation.slice(0, count), facing, clearance);
		let surveyed = 0;
		for (const site of sites) {
			const center = site.at(0, (DROPSHIP_DECK.toe - 233) / 2);
			const c = Math.cos(site.heading), s = Math.sin(site.heading);
			if (!pads.some(function (pad) { return Math.hypot(pad.x - center.x, pad.y - center.y) < 64 && c * pad.c + s * pad.s > .96; })) {
				pads.push({ ...center, c, s, halfLength: (233 + DROPSHIP_DECK.toe) / 2 + 32, halfWidth: DROPSHIP_WIDTH / 2 + 32 });
			}
			if (++surveyed >= 3) break;
		}
	}
	const pickups = landingSites({ ...map, drop: map.extraction }, field, [map.extraction], facing, clearance, undefined, true);
	let pickupCount = 0;
	for (const site of pickups) {
		const center = site.at(0, (DROPSHIP_DECK.toe - 233) / 2);
		const c = Math.cos(site.heading), s = Math.sin(site.heading);
		if (pads.some(function (pad) { return Math.hypot(pad.x - center.x, pad.y - center.y) < 110 && c * pad.c + s * pad.s > .85; })) continue;
		pads.push({ ...center, c, s, halfLength: (233 + DROPSHIP_DECK.toe) / 2 + 32, halfWidth: DROPSHIP_WIDTH / 2 + 32 });
		if (++pickupCount >= 3) break;
	}
	return pads;
};
