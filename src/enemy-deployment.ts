import { RIG_RADIUS } from './combat-spatial';
import { terrainPathClear, type FieldTerrain, type ObstacleField } from './field-terrain';
import { landingFootprint, supportRange } from './landing-site';
import { DROPSHIP_DECK, DROPSHIP_WIDTH } from './launch-berths';
import { sceneryFlightBounds } from './scenery-flight';
import type { Point } from './simulation';
import { groundHeight } from './terrain-elevation';

export interface DropFlight {
	readonly origin: Point;
	readonly heading: number;
	readonly startedAt: number;
	readonly padHeight: number;
	readonly terrain?: FieldTerrain;
	readonly clearHeight: number;
	readonly lastExit: number;
}
export interface DropPassenger {
	readonly flight: DropFlight;
	readonly lane: number;
	readonly delay: number;
}

const berth = 116, exit = DROPSHIP_DECK.toe + 74;
const approachSeconds = 2.8, openSeconds = .8, walkSeconds = 3.6;
const firstExit = approachSeconds + openSeconds + walkSeconds, wingDelay = .65;
export const rigReleaseTime = function (passenger: DropPassenger) {
	return firstExit + passenger.delay;
};
const fraction = function (value: number) { return Math.max(0, Math.min(1, value)); };
const ease = function (value: number) { const t = fraction(value); return t * t * (3 - 2 * t); };
const localPoint = function (origin: Point, heading: number, side: number, aft: number): Point {
	const c = Math.cos(heading), s = Math.sin(heading);
	return { x: origin.x + c * aft + s * side, y: origin.y + s * aft - c * side };
};

// Hover over the highest skid support on rough ground. Horizontal flight
// takes place above the scenery so the same approach works on forest maps.
export const dropShipPose = function (flight: DropFlight, time: number) {
	const age = time - flight.startedAt;
	const inbound = fraction(1 - age / approachSeconds);
	const close = age - flight.lastExit - .15;
	const outbound = fraction((close - openSeconds) / 2.8);
	const travel = inbound ** 2 + outbound ** 2;
	const height = ease(inbound * 3 + outbound * 3) * flight.clearHeight + travel * 3500;
	const run = (fraction((inbound - 1 / 3) * 1.5) ** 2 - fraction((outbound - 1 / 3) * 1.5) ** 2) * 2800;
	const ramp = ease((age - approachSeconds) / openSeconds) * (1 - ease(close / openSeconds));
	return { ...localPoint(flight.origin, flight.heading, 0, run), elevation: flight.padHeight + height,
		ramp, thrust: .16 + .84 * ease((inbound + outbound) * 5), done: outbound >= 1 };
};

export const dropSurfaceHeight = function (drop: DropPassenger, at: Point) {
	const { origin, heading } = drop.flight;
	const aft = (at.x - origin.x) * Math.cos(heading) + (at.y - origin.y) * Math.sin(heading);
	const deck = DROPSHIP_DECK.height * fraction((DROPSHIP_DECK.toe - aft) / (DROPSHIP_DECK.toe - DROPSHIP_DECK.hinge));
	const runout = ease((aft - DROPSHIP_DECK.toe) / (exit - DROPSHIP_DECK.toe));
	const ground = groundHeight(drop.flight.terrain, at);
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
	readonly terrain?: FieldTerrain;
}

const surveyPad = function (goal: Point, heading: number, lanes: readonly number[], field: DropField, clear: ObstacleField) {
	const origin = localPoint(goal, heading, 0, -exit);
	const at = function (side: number, aft: number) { return localPoint(origin, heading, side, aft); };
	const fits = function (p: Point, margin = 0) {
		return Math.min(p.x, p.y, field.width - p.x, field.height - p.y) >= margin;
	};
	for (const sign of [-1, 1]) {
		const pod = sign * DROPSHIP_WIDTH / 2;
		if (!fits(at(pod, -233)) || !fits(at(pod, DROPSHIP_DECK.hinge)) || !fits(at(sign * DROPSHIP_DECK.halfWidth, DROPSHIP_DECK.toe))) return;
	}
	if (!lanes.every(function (lane) { return fits(at(lane, exit), 35 + RIG_RADIUS); })
		|| !terrainPathClear(clear, at(0, DROPSHIP_DECK.hinge), at(0, exit), DROPSHIP_DECK.halfWidth)) return;
	for (const fraction of [-.4, -.2, 0, .2, .4]) {
		const side = fraction * DROPSHIP_WIDTH;
		if (!terrainPathClear(clear, at(side, -233), at(side, DROPSHIP_DECK.hinge), DROPSHIP_WIDTH * .105)) return;
	}
	const support = supportRange(field.terrain, { at });
	const rampGap = Math.max(...lanes.map(function (lane) { return Math.abs(support.high - groundHeight(field.terrain, at(lane, DROPSHIP_DECK.toe))); }));
	// A VTOL can hold level on a slight grade. Keep the toe of the
	// physical ramp against the ground where passengers actually step off.
	if (rampGap > 5) return;
	return { origin, heading, padHeight: support.high, unevenness: support.high - support.low };
};

export const planRigDrop = function (preferred: Point, objective: Point, field: DropField, occupied: readonly Point[], count: number, startedAt: number): DropPassenger[] | undefined {
	const terrain = field.terrain;
	const scenery = terrain?.obstacles.map(sceneryFlightBounds) ?? [];
	const clear: ObstacleField = { obstacles: [...scenery, landingFootprint(objective, 72),
		...occupied.map(function (at) { return landingFootprint(at, 72); })] };
	const clearHeight = Math.max(0, terrain?.elevation?.maxHeight ?? 0) - Math.min(0, terrain?.elevation?.minHeight ?? 0)
		+ scenery.reduce(function (height, o) { return Math.max(height, o.height); }, 160);
	const range = Math.hypot(preferred.x - objective.x, preferred.y - objective.y);
	const lanes = count === 1 ? [0] : [-82, 82];
	const lastExit = firstExit + (lanes.length - 1) * wingDelay;
	const embark = function (pad: NonNullable<ReturnType<typeof surveyPad>>) {
		const flight: DropFlight = { origin: pad.origin, heading: pad.heading, padHeight: pad.padHeight,
			startedAt, clearHeight, lastExit, ...(terrain ? { terrain } : {}) };
		return lanes.map(function (lane, i) { return { flight, lane, delay: i * wingDelay }; });
	};
	let best: ReturnType<typeof surveyPad>;
	const tryAt = function (goal: Point) {
		const bearing = Math.atan2(objective.y - goal.y, objective.x - goal.x);
		const facing = Math.round(bearing / (Math.PI / 12)) * Math.PI / 12;
		for (const yaw of [0, 1, -1, 2, -2, 3, -3, 4]) {
			const pad = surveyPad(goal, facing + yaw * Math.PI / 4, lanes, field, clear);
			if (!pad) continue;
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
	return best && embark(best);
};
