import type { MissionMap } from './campaign-types';
import { RIG_RADIUS } from './combat-spatial';
import { terrainPathClear, type FieldTerrain, type ObstacleField } from './field-terrain';
import { landingFootprint, supportRange, type LandingSite } from './landing-site';
import { DROPSHIP_DECK, DROPSHIP_WIDTH } from './launch-berths';
import { PERIMETER_RIDGE_HEIGHT, sceneryFlightBounds } from './scenery-flight';
import type { Point } from './simulation';
import { groundHeight } from './terrain-elevation';

export interface DropFlight {
	readonly origin: Point;
	readonly heading: number;
	readonly startedAt: number;
	readonly padHeight: number;
	readonly field: DropField;
	readonly cruiseElevation: number;
	readonly turn: number;
	readonly arrival: FlightLeg;
	readonly departure: FlightLeg;
	readonly lastExit: number;
}
interface FlightLeg {
	readonly glide: number;
	readonly traverse: number;
}
export interface DropPassenger {
	readonly flight: DropFlight;
	readonly lane: number;
	readonly delay: number;
}

const berth = 116, exit = DROPSHIP_DECK.toe + 74;
const approachSeconds = 2.8, openSeconds = .8, walkSeconds = 3.6;
const firstExit = approachSeconds + openSeconds + walkSeconds, wingDelay = .65;
const clearOfPad = .30, onCourse = .66, bankMargin = 40;
export const rigReleaseTime = function (passenger: DropPassenger) {
	return firstExit + passenger.delay;
};
const fraction = function (value: number) { return Math.max(0, Math.min(1, value)); };
const ease = function (value: number) { const t = fraction(value); return t * t * (3 - 2 * t); };
const localPoint = function (origin: Point, heading: number, side: number, aft: number): Point {
	const c = Math.cos(heading), s = Math.sin(heading);
	return { x: origin.x + c * aft + s * side, y: origin.y + s * aft - c * side };
};

export const dropShipPose = function (flight: DropFlight, time: number, viewWidth = 0) {
	const age = time - flight.startedAt;
	const inbound = fraction(1 - age / approachSeconds);
	const close = age - flight.lastExit - .15;
	const outbound = fraction((close - openSeconds) / approachSeconds);
	const leg = inbound > 0 ? flight.arrival : flight.departure;
	const travel = inbound + outbound;
	// Glide straight over the surveyed strip while low. Once above cover,
	// blend that motion into a level pass across the isometric view.
	const climb = ease(travel / clearOfPad);
	const glide = leg.glide * ease(travel / onCourse);
	const at = localPoint(flight.origin, flight.heading, 0, glide);
	const cruise = fraction((travel - clearOfPad) / (1 - clearOfPad));
	// Extend only the outer part of the route past the widest camera view.
	const traverse = leg.traverse * cruise ** 2 + Math.sign(leg.traverse) * viewWidth * Math.SQRT1_2 * cruise ** 6;
	const turn = ease((travel - clearOfPad) / (onCourse - clearOfPad));
	const heading = flight.heading + flight.turn * turn;
	const bank = (inbound > 0 ? 1 : -1) * flight.turn * .08 * Math.sin(Math.PI * turn);
	const position = { x: at.x + traverse, y: at.y - traverse };
	// Perimeter ridges stand outside the navigation map. Get the entire
	// hull above their crest before banking over the edge in either direction.
	const inset = fieldInset(flight.field, position);
	const nearRidges = flight.field.biome ? 1 - ease((inset - DROPSHIP_WIDTH * .75) / DROPSHIP_WIDTH) : 0;
	const crest = nearRidges * Math.max(0, PERIMETER_RIDGE_HEIGHT + bankMargin - flight.cruiseElevation);
	const elevation = flight.padHeight + (flight.cruiseElevation + crest - flight.padHeight) * climb;
	const ramp = ease((age - approachSeconds) / openSeconds) * (1 - ease(close / openSeconds));
	return { ...position, elevation, heading, bank,
		ramp, thrust: .16 + .84 * ease(travel * 5), done: outbound >= 1 };
};

export const dropSurfaceHeight = function (drop: DropPassenger, at: Point) {
	const { origin, heading } = drop.flight;
	const aft = (at.x - origin.x) * Math.cos(heading) + (at.y - origin.y) * Math.sin(heading);
	const deck = DROPSHIP_DECK.height * fraction((DROPSHIP_DECK.toe - aft) / (DROPSHIP_DECK.toe - DROPSHIP_DECK.hinge));
	const runout = ease((aft - DROPSHIP_DECK.toe) / (exit - DROPSHIP_DECK.toe));
	const ground = groundHeight(drop.flight.field.terrain, at);
	return Math.max(ground, drop.flight.padHeight + deck + (ground - drop.flight.padHeight) * runout);
};
export const dropRigPose = function (drop: DropPassenger, time: number) {
	const elapsed = time - drop.flight.startedAt - approachSeconds - openSeconds - drop.delay;
	const progress = fraction(elapsed / walkSeconds);
	const at = localPoint(drop.flight.origin, drop.flight.heading, drop.lane, berth + (exit - berth) * progress);
	return { ...at, elevation: dropSurfaceHeight(drop, at),
		visible: time >= drop.flight.startedAt + approachSeconds, walking: elapsed > 0 && progress < 1 };
};

interface DropField {
	readonly width: number;
	readonly height: number;
	readonly biome?: MissionMap['biome'];
	readonly terrain?: FieldTerrain;
}

const fieldInset = function (field: DropField, at: Point) {
	return Math.min(at.x, at.y, field.width - at.x, field.height - at.y);
};
const hullInField = function (at: LandingSite['at'], field: DropField, glide: number) {
	for (const side of [-DROPSHIP_WIDTH / 2, DROPSHIP_WIDTH / 2]) {
		if (fieldInset(field, at(side, glide - 233)) < 0 || fieldInset(field, at(side, glide + DROPSHIP_DECK.hinge)) < 0) return false;
	}
	return true;
};
const clearHullSweep = function (at: LandingSite['at'], clear: ObstacleField, glide: number) {
	for (const fraction of [-.4, -.2, 0, .2, .4]) {
		const side = fraction * DROPSHIP_WIDTH;
		if (!terrainPathClear(clear, at(side, -233 + Math.min(0, glide)), at(side, DROPSHIP_DECK.hinge + Math.max(0, glide)), DROPSHIP_WIDTH * .105)) return false;
	}
	return true;
};

const planFlightLeg = function (at: LandingSite['at'], field: DropField, clear: ObstacleField, sign: number, side: number): FlightLeg {
	const glide = sign * ([420, 280, 140, 70].find(function (run) {
		return hullInField(at, field, sign * run) && clearHullSweep(at, clear, sign * run);
	}) ?? 0);
	const bend = at(0, glide);
	// The far corners bound every in-field pilot's screen-right coordinate
	// (x-y)/sqrt(2). Fly past that whole span, including on corner landings.
	const corner = side > 0 ? field.width : -field.height;
	return { glide, traverse: (corner - (bend.x - bend.y)) / 2 + side * DROPSHIP_WIDTH };
};

const surveyPad = function (goal: Point, heading: number, lanes: readonly number[], field: DropField, clear: ObstacleField) {
	const origin = localPoint(goal, heading, 0, -exit);
	const at = function (side: number, aft: number) { return localPoint(origin, heading, side, aft); };
	if (!hullInField(at, field, 0)) return;
	for (const sign of [-1, 1]) {
		if (fieldInset(field, at(sign * DROPSHIP_DECK.halfWidth, DROPSHIP_DECK.toe)) < 0) return;
	}
	if (!lanes.every(function (lane) { return fieldInset(field, at(lane, exit)) >= 35 + RIG_RADIUS; })
		|| !terrainPathClear(clear, at(0, DROPSHIP_DECK.hinge), at(0, exit), DROPSHIP_DECK.halfWidth)) return;
	if (!clearHullSweep(at, clear, 0)) return;
	const support = supportRange(field.terrain, { at });
	const rampGap = Math.max(...lanes.map(function (lane) { return Math.abs(support.high - groundHeight(field.terrain, at(lane, DROPSHIP_DECK.toe))); }));
	// A VTOL can hold level on a slight grade. Keep the toe of the
	// physical ramp against the ground where passengers actually step off.
	if (rampGap > 5) return;
	return { origin, heading, at, padHeight: support.high, unevenness: support.high - support.low };
};

interface ReleasePolicy {
	accepts: (at: Point) => boolean;
	separation: (at: Point) => number;
	preferredSeparation: number;
}

export const planRigDrop = function (preferred: Point, objective: Point, field: DropField, occupied: readonly Point[], count: number, startedAt: number,
	releasePolicy?: ReleasePolicy): DropPassenger[] | undefined {
	const terrain = field.terrain;
	const scenery = terrain?.obstacles.map(sceneryFlightBounds) ?? [];
	const clear: ObstacleField = { obstacles: [...scenery, landingFootprint(objective, 72),
		...occupied.map(function (at) { return landingFootprint(at, 72); })] };
	const range = Math.hypot(preferred.x - objective.x, preferred.y - objective.y);
	const lanes = count === 1 ? [0] : [-82, 82];
	const lastExit = firstExit + (lanes.length - 1) * wingDelay;
	const embark = function (pad: NonNullable<ReturnType<typeof surveyPad>>) {
		const side = Math.cos(pad.heading) >= Math.sin(pad.heading) ? 1 : -1;
		const crossHeading = side > 0 ? -Math.PI / 4 : 3 * Math.PI / 4;
		const turn = Math.atan2(Math.sin(crossHeading - pad.heading), Math.cos(crossHeading - pad.heading));
		const highest = scenery.reduce(function (height, o) { return Math.max(height, groundHeight(terrain, o) + o.height); },
			Math.max(terrain?.elevation?.maxHeight ?? 0, groundHeight(terrain, objective) + 180));
		const flight: DropFlight = { origin: pad.origin, heading: pad.heading, padHeight: pad.padHeight, field,
			cruiseElevation: Math.max(pad.padHeight + 210, highest + bankMargin), turn,
			arrival: planFlightLeg(pad.at, field, clear, 1, side), departure: planFlightLeg(pad.at, field, clear, -1, -side),
			startedAt, lastExit };
		return lanes.map(function (lane, i) { return { flight, lane, delay: i * wingDelay }; });
	};
	let best: ReturnType<typeof surveyPad>;
	let roomyFallback: { pad: NonNullable<ReturnType<typeof surveyPad>>; separation: number } | undefined;
	const tryAt = function (goal: Point) {
		const bearing = Math.atan2(objective.y - goal.y, objective.x - goal.x);
		const facing = Math.round(bearing / (Math.PI / 12)) * Math.PI / 12;
		for (const yaw of [0, 1, -1, 2, -2, 3, -3, 4]) {
			const pad = surveyPad(goal, facing + yaw * Math.PI / 4, lanes, field, clear);
			if (!pad) continue;
			if (releasePolicy) {
				const points = lanes.map(function (lane) { return pad.at(lane, exit); });
				if (!points.every(releasePolicy.accepts)) continue;
				const separation = Math.min(...points.map(releasePolicy.separation));
				if (separation < releasePolicy.preferredSeparation) {
					// A scattered squad can cover every suitable pad. Preserve relay
					// standoff and pick the most distant safe release from those rigs.
					if (!roomyFallback || separation > roomyFallback.separation
						|| separation === roomyFallback.separation && pad.unevenness < roomyFallback.pad.unevenness) roomyFallback = { pad, separation };
					continue;
				}
			}
			if (pad.unevenness <= 16) return embark(pad);
			if (!best || pad.unevenness < best.unevenness) best = pad;
		}
		return undefined;
	};
	const scheduled = tryAt(preferred);
	if (scheduled) return scheduled;
	// Favor clearings near the scheduled approach and at the same distance
	// from the relay. Search the whole map when the front is congested.
	const candidates: (Point & { cost: number })[] = [];
	for (let y = 100; y < field.height - 60; y += 180) for (let x = 100; x < field.width - 60; x += 180) {
		const rangeError = Math.abs(Math.hypot(x - objective.x, y - objective.y) - range);
		candidates.push({ x, y, cost: Math.hypot(x - preferred.x, y - preferred.y) + 2 * rangeError });
	}
	candidates.sort(function (a, b) { return a.cost - b.cost; });
	for (const candidate of candidates) {
		const drop = tryAt(candidate);
		if (drop) return drop;
	}
	return best ? embark(best) : roomyFallback && embark(roomyFallback.pad);
};
