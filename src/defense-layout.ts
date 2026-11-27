import type { TerrainMap } from './biome-layout';
import type { MissionMap } from './campaign-types';
import { RIG_RADIUS } from './combat-spatial';
import { hasTerrainRoute, terrainPathClear, terrainPointClear, terrainWaypoint, type ObstacleField } from './field-terrain';
import type { Point } from './simulation';
import { mixSeed, randomSource } from './universe';

export const DEFENSE_PACING = { arrivalRadius: 150, firstWaveDelay: 9, minimumStandoff: 1600 } as const;
export const DEFENSE_APPROACH_BRIEFING = 'Travel to the relay. Once your rig reaches it, you have nine seconds to set up before the first enemy section is dispatched.';

const distance = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
const bearing = function (from: Point, to: Point) { return Math.atan2(to.y - from.y, to.x - from.x); };
const offset = function (from: Point, angle: number, range: number): Point {
	return { x: from.x + Math.cos(angle) * range, y: from.y + Math.sin(angle) * range };
};

export const defenseLandingFootings = function (map: MissionMap): ObstacleField['obstacles'] {
	return map.defenseApproach?.staging.map(function (exit) {
		return { ...offset(exit, bearing(map.objective, exit), 240), width: 840, depth: 840 };
	}) ?? [];
};

const bearings = Array.from({ length: 72 }, function (_, index) {
	return Math.ceil(index / 2) * (index % 2 === 0 ? 1 : -1) * Math.PI / 36;
});

const lanes = function* (field: ObstacleField, objective: Point, angle: number, range: number,
	fits: (at: Point, direction: number) => boolean) {
	const candidates = bearings.map(function (turn) {
		const direction = angle + turn;
		return { at: offset(objective, direction, range), direction };
	}).filter(function ({ at, direction }) { return fits(at, direction); });
	const detours: typeof candidates = [];
	for (const candidate of candidates) {
		if (terrainPathClear(field, candidate.at, objective, 45)) yield candidate;
		else detours.push(candidate);
	}
	for (const candidate of detours) if (hasTerrainRoute(field, candidate.at, objective, RIG_RADIUS)) yield candidate;
};

const route = function (field: ObstacleField, from: Point, objective: Point): Point[] | undefined {
	const points = [from];
	let at = from;
	while (!terrainPathClear(field, at, objective, RIG_RADIUS)) {
		const next = terrainWaypoint(field, at, objective, RIG_RADIUS);
		if (points.some(function (p) { return distance(p, next) < 1; })) return undefined;
		points.push(next);
		at = next;
	}
	return [...points, objective];
};

const survey = function (map: TerrainMap) {
	const field = map.terrain;
	const objective = map.objective;
	const random = randomSource(mixSeed(map.seed, 0x4445464e));
	const approachRange = 2210 + random() * 180, turn = .24 + random() * .17;
	const firstRange = 1770 + random() * 100, secondRange = 1770 + random() * 100;
	const approaches = lanes(field, objective, bearing(objective, map.drop), approachRange,
		function (at) { return terrainPointClear(field, at, 360); });
	for (const approach of approaches) {
		const inbound = route(field, approach.at, objective);
		if (!inbound) continue;
		const opposing = approach.direction + Math.PI;
		const landings = function (angle: number, range: number, other?: Point) {
			return lanes(field, objective, angle, range, function (at, direction) {
				return Math.cos(direction - opposing) > .35 && (!other || distance(at, other) >= 660)
					&& terrainPointClear(field, at, 195) && terrainPointClear(field, offset(at, direction, 265), 320);
			});
		};
		for (const first of landings(opposing - turn, firstRange)) {
			const firstRoute = route(field, first.at, objective);
			if (!firstRoute) continue;
			for (const second of landings(opposing + turn, secondRange, first.at)) {
				const secondRoute = route(field, second.at, objective);
				if (secondRoute) return { drop: approach.at, staging: [first.at, second.at] as const, inbound, firstRoute, secondRoute };
			}
		}
	}
	throw new Error(`No extended defense lanes for seed ${map.seed} in ${map.biome}`);
};

export const extendDefenseField = function (map: TerrainMap): TerrainMap {
	const field = map.terrain;
	const { drop, staging, inbound, firstRoute, secondRoute } = survey(map);
	const zones = [drop, ...staging];
	const minX = Math.min(0, ...zones.map(function (at) { return at.x - 890; }));
	const minY = Math.min(0, ...zones.map(function (at) { return at.y - 890; }));
	const spanX = Math.max(map.width, ...zones.map(function (at) { return at.x + 890; })) - minX;
	const spanY = Math.max(map.height, ...zones.map(function (at) { return at.y + 890; })) - minY;
	const width = Math.max(6000, Math.ceil(spanX / 100) * 100), height = Math.max(4800, Math.ceil(spanY / 100) * 100);
	const left = -minX + (width - spanX) / 2, top = -minY + (height - spanY) / 2;
	const translate = function <T extends Point>(point: T): T { return { ...point, x: point.x + left, y: point.y + top }; };
	const translatedObstacles = new Map(field.obstacles.map(function (obstacle) { return [obstacle, translate(obstacle)] as const; }));
	const roads = [inbound, ...field.roads, firstRoute, secondRoute];
	return {
		...map, width, height, drop: translate(drop), objective: translate(map.objective), extraction: translate(map.extraction),
		sites: map.sites.map(translate), defenseApproach: { ...DEFENSE_PACING, staging: [translate(staging[0]), translate(staging[1])] },
		terrain: {
			roads: roads.map(function (path) { return path.map(translate); }), obstacles: Array.from(translatedObstacles.values()),
			...(field.site ? { site: translate(field.site) } : {}),
			...(field.compounds ? { compounds: field.compounds.map(function (compound) {
				return { ...compound, buildings: compound.buildings.map(function (building) { return translatedObstacles.get(building) ?? translate(building); }) };
			}) } : {}),
		},
	};
};
