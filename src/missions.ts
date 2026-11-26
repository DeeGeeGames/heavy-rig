import { getMissionTier } from './reputation';
import { getPlanet, mixSeed, randomSource } from './universe';
import { terrainPathClear, terrainPointClear, terrainWaypoint, type ObstacleField, type TerrainObstacle } from './field-terrain';
import { EMPLACEMENT_RADIUS, ENEMY_RADIUS, RIG_RADIUS } from './combat-spatial';
import { SQUAD_SIZE } from './pilots';
import { isAuthoredContract } from './contract-chains';
import { PLAYABLE_FRAMES, type FrameId } from './frames';
import { createBiomeLayout, type TerrainMap } from './biome-layout';
import { objectiveSitePlan, placeObjectiveSite } from './objective-sites';
import { generateElevation } from './mission-elevation';
import { landingFootprint } from './landing-site';
import { hasLevelFoundation, type TerrainElevation } from './terrain-elevation';
import type { Contract, Landmark, MissionMap, MissionRuntime, MissionStructure } from './campaign-types';
import type { EnemyKind, Point, CombatStateView } from './simulation';

export const EXTRACTION_RADIUS = 150;
export const EXTRACTION_SECONDS = 3;
export const FACILITY_RADIUS = 65;
export const FACILITY_TARGET_ID = -1;
export const CAPTURE_RADIUS = 100;
export const RECOVERY_SECONDS = 5;
export const BEACON_SECONDS = 3;
export const ACQUISITION_SECONDS = 240;

// Negative identities never collide with enemy IDs; demolition keeps its old ID.
export const missionStructures = function (mission: MissionRuntime | undefined): { id: number; body: MissionStructure }[] {
	return [
		...(mission?.structure ? [{ id: FACILITY_TARGET_ID, body: mission.structure }] : []),
		...(mission?.raidTargets ?? []).map(function (body, index) { return { id: -2 - index, body }; }),
	];
};

export const isPriorityTarget = function (state: CombatStateView, enemy: { id: number; commander?: boolean }): boolean {
	return Boolean(enemy.commander) || state.mission?.targetId === enemy.id;
};

const separation = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
const hasMultipleSites = function (kind: Contract['kind']) {
	return kind === 'clearance' || kind === 'raid' || kind === 'acquisition';
};

export const squadDestination = function (anchor: Point, heading: number, index: number, back: number, spread: number): Point {
	const side = index === 0 ? -spread : index === 1 ? spread : 0;
	const trail = index === 2 ? back + spread : back;
	return { x: anchor.x - Math.cos(heading) * trail - Math.sin(heading) * side, y: anchor.y - Math.sin(heading) * trail + Math.cos(heading) * side };
};
export const missionDeploymentSlot = function (map: MissionMap, index: number): Point {
	const heading = Math.atan2(map.objective.y - map.drop.y, map.objective.x - map.drop.x);
	return squadDestination(map.drop, heading, index, 80, 95);
};

type MobileEnemyKind = Exclude<EnemyKind, 'artillery'>;
export type MissionSpawn = Point & (
	{ kind: MobileEnemyKind; commander?: boolean; frameId?: FrameId; formation?: number }
	| { kind: EnemyKind; commander?: never; frameId?: never; formation?: never }
);
const mobileHostileCount = function (contract: Contract): number {
	const level = getMissionTier(contract.tier);
	const roster = contract.kind === 'defend' || contract.kind === 'clearance' ? level.assault : level.patrol;
	// Fortified garrisons already reserve one slot for fixed defenses, two
	// from Heavy tier up. The independent gun roll keeps their mobile strength.
	const reserved = artilleryPosting(contract) ? (contract.tier >= 4 ? 2 : 1) : 0;
	return roster - reserved;
};
const legacyRosters: Readonly<Record<Contract['tier'], readonly MobileEnemyKind[]>> = {
	1: ['scout', 'helicopter', 'scout', 'scout'],
	2: ['scout', 'helicopter', 'striker', 'scout'],
	3: ['striker', 'tank', 'scout', 'vtol', 'striker', 'helicopter'],
	4: ['striker', 'tank', 'siege', 'vtol', 'helicopter', 'scout'],
	5: ['siege', 'tank', 'striker', 'vtol', 'siege'],
	6: ['siege', 'tank', 'siege', 'vtol', 'striker', 'siege'],
};
// Every section starts with two rigs. The third contact supports the section
// and is omitted if the contract quota ends before its slot.
const formations: Readonly<Record<Contract['tier'], readonly MobileEnemyKind[]>> = {
	1: ['scout', 'scout', 'helicopter'],
	2: ['scout', 'striker', 'helicopter'],
	3: ['striker', 'scout', 'tank', 'striker', 'scout', 'helicopter'],
	4: ['striker', 'siege', 'tank', 'scout', 'striker', 'vtol'],
	5: ['siege', 'striker', 'tank', 'striker', 'siege', 'vtol'],
	6: ['siege', 'striker', 'vtol', 'siege', 'scout', 'tank'],
};
const catalogFrame = function (contract: Contract, role: EnemyKind, random: () => number): FrameId | undefined {
	if (role !== 'scout' && role !== 'striker' && role !== 'siege') return undefined;
	const eligible = PLAYABLE_FRAMES.filter(function (frame) {
		return (contract.tier > 1 || frame.variant === 'A') && (contract.tier >= 4 || frame.mass < 95);
	});
	const preferred = eligible.filter(function (frame) {
		return role === (frame.mass < 50 ? 'scout' : frame.mass >= 95 ? 'siege' : 'striker');
	});
	const pool = preferred.length ? preferred : eligible;
	return pool[Math.floor(random() * pool.length)]?.id;
};
const hasRigRoute = function (field: ObstacleField, from: Point, site: Point) {
	const next = terrainWaypoint(field, from, site, RIG_RADIUS);
	return next.x !== from.x || next.y !== from.y || (from.x === site.x && from.y === site.y);
};
const mobileSpawn = function (contract: Contract, map: MissionMap, index: number, navigation: ObstacleField | undefined = map.terrain): MissionSpawn {
	const random = randomSource((contract.seed + Math.imul(index + 1, 104729)) >>> 0);
	const commander = contract.kind === 'assassination' && index === 0;
	const legacy = isAuthoredContract(contract);
	const formation = Math.floor(index / 3);
	const siteIndex = legacy ? index : formation + (index % 3 === 1 ? 1 : 0);
	const site = hasMultipleSites(contract.kind) ? map.sites[siteIndex % map.sites.length] ?? map.objective : map.objective;
	const wingOffsets = [0, 0.65, -0.26];
	const angle = (legacy ? index * 2.399963 : formation * 2.399963 + (wingOffsets[index % 3] ?? 0)) + random() * (legacy ? .6 : .16);
	const radius = commander ? 0 : contract.kind === 'defend' ? 760 + random() * 160 + (!legacy && index % 3 === 2 ? 90 : 0) : 180 + random() * 250;
	const roster = (legacy ? legacyRosters : formations)[contract.tier];
	const kind = commander ? contract.tier === 1 ? 'scout' : contract.tier < 4 ? 'striker' : 'siege' : roster[index % roster.length] ?? 'scout';
	const frameId = legacy ? undefined : catalogFrame(contract, kind, random);
	const atBearing = function (bearing: number): Point {
		return { x: Math.max(100, Math.min(map.width - 100, site.x + Math.cos(bearing) * radius)),
			y: Math.max(100, Math.min(map.height - 100, site.y + Math.sin(bearing) * radius)) };
	};
	let at = atBearing(angle);
	// Everyone posted in a built-up site needs room to reach the rig lanes.
	const clearance = frameId || map.terrain?.site ? RIG_RADIUS : ENEMY_RADIUS;
	const clear = function (candidate: Point) {
		return !navigation || terrainPointClear(navigation, candidate, clearance)
			&& (map.terrain?.site?.kind !== 'garrison' || hasRigRoute(navigation, candidate, site));
	};
	if (!commander && !clear(at)) {
		// Try nearby points on the spawn ring, then both axes. Every site
		// has an open bearing leading away from the cut on its own bank.
		for (const bearing of [angle + .5, angle - .5, angle + 1, angle - 1, angle + 1.5, angle - 1.5, 0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
			const candidate = atBearing(bearing);
			if (clear(candidate)) { at = candidate; break; }
		}
	}
	return { ...at, kind, ...(commander ? { commander: true } : {}), ...(frameId ? { frameId } : {}), ...(!legacy ? { formation } : {}) };
};

const artilleryPosting = function (contract: Contract) {
	if (isAuthoredContract(contract)) return undefined;
	switch (contract.kind) {
		case 'demolition': return 'on the facility perimeter';
		case 'raid': return 'at the supply installations';
		case 'clearance': return 'on the approaches to the occupied sites';
		default: return undefined;
	}
};
export const missionArtilleryCount = function (contract: Contract, map?: MissionMap): number {
	if (!artilleryPosting(contract)) return 0;
	const roll = randomSource(mixSeed(contract.seed, 0x47554e53));
	const count = contract.tier + Math.floor(roll() * (contract.tier + 1));
	return map ? placeArtillery(contract, map, mobileSpawns(contract, map), count).length : count;
};
export const missionHostileCount = function (contract: Contract, map?: MissionMap) {
	return mobileHostileCount(contract) + missionArtilleryCount(contract, map);
};
export const missionOpposition = function (contract: Contract, map?: MissionMap) {
	const mobile = isAuthoredContract(contract) ? 'Light scouts and helicopters.' : getMissionTier(contract.tier).opposition;
	const posting = artilleryPosting(contract);
	const guns = missionArtilleryCount(contract, map);
	const garrison = posting ? ` ${guns} fixed artillery ${guns === 1 ? 'gun' : 'guns'} ${posting}.` : '';
	return `${mobileHostileCount(contract) + guns} hostiles. ${mobile}${garrison}`;
};
const roadsClear = function (footprint: ObstacleField, roads: readonly (readonly Point[])[]) {
	return roads.every(function (road) {
		return road.every(function (point, i) { const prev = road[i - 1]; return !prev || terrainPathClear(footprint, prev, point, 45); });
	});
};
const mobileSpawns = function (contract: Contract, map: MissionMap, navigation: ObstacleField | undefined = map.terrain) {
	return Array.from({ length: mobileHostileCount(contract) }, function (_, i) { return mobileSpawn(contract, map, i, navigation); });
};
const placeArtillery = function (contract: Contract, map: MissionMap, guards: readonly MissionSpawn[], count: number): Point[] {
	if (!count) return [];
	const random = randomSource(mixSeed(contract.seed, 0x41525459));
	const sites = contract.kind === 'demolition' || !map.sites.length ? [map.objective] : map.sites;
	const first = Math.floor(random() * sites.length);
	const guns: Point[] = [];
	const clear = function (at: Point, site: Point, allowDetour: boolean) {
		if (at.x < 100 || at.y < 100 || at.x > map.width - 100 || at.y > map.height - 100
			|| separation(at, map.drop) <= 300 || separation(at, map.extraction) <= EXTRACTION_RADIUS + EMPLACEMENT_RADIUS) return false;
		const range = separation(at, site);
		if (sites.some(function (other) { return other !== site && separation(at, other) < range; })
			|| map.landmarks.some(function (p) { return separation(at, p) < p.radius + EMPLACEMENT_RADIUS; })) return false;
		const pad = { obstacles: [landingFootprint(at, EMPLACEMENT_RADIUS)] };
		if (!terrainPointClear(pad, site, CAPTURE_RADIUS)
			|| guns.some(function (gun) { return !terrainPointClear(pad, gun, EMPLACEMENT_RADIUS + 2 * RIG_RADIUS); })
			|| guards.some(function (guard) { return !terrainPointClear(pad, guard, guard.frameId ? RIG_RADIUS : ENEMY_RADIUS); })) return false;
		const terrain = map.terrain;
		if (!terrain) return true;
		if (!terrainPointClear(terrain, at, EMPLACEMENT_RADIUS) || !roadsClear(pad, terrain.roads)
			|| !hasLevelFoundation(terrain, at, EMPLACEMENT_RADIUS)) return false;
		if (terrainPathClear(terrain, site, at, RIG_RADIUS)) return true;
		// A local service route can bend around cover. Both legs stay inside
		// the field, including on supplied maps with a barrier spanning an edge.
		if (!allowDetour) return false;
		if ([{ x: site.x, y: at.y }, { x: at.x, y: site.y }].some(function (bend) {
			return terrainPathClear(terrain, site, bend, RIG_RADIUS) && terrainPathClear(terrain, bend, at, RIG_RADIUS);
		})) return true;
		// The service gate may take several turns behind the hangar.
		return terrain.site?.kind === 'garrison' && hasRigRoute(terrain, at, site);
	};
	const findPost = function (site: Point, bearing: number, radius: number) {
		// Try the assigned shoulder first. Search nearby bearings on both sides
		// when a road, another foundation, or terrain occupies the intended post.
		const nearby = [radius, radius + 90, radius - 55, radius + 180];
		const outer = [...nearby, radius + 270, radius + 360];
		for (const allowDetour of [false, true]) for (let i = 0; i < 32; i++) {
			const angle = bearing + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 16;
			for (const r of allowDetour ? outer : nearby) {
				const at = { x: site.x + r * Math.cos(angle), y: site.y + r * Math.sin(angle) };
				if (clear(at, site, allowDetour)) return at;
			}
		}
		return undefined;
	};
	for (const [index, site] of [...sites.slice(first), ...sites.slice(0, first)].entries()) {
		const quota = Math.floor(count / sites.length) + Number(index < count % sites.length);
		const road = map.terrain?.roads.find(function (lane) { const end = lane.at(-1); return end && separation(end, site) < 1; });
		const from = road?.at(-2) ?? map.drop;
		const approach = Math.atan2(from.y - site.y, from.x - site.x);
		const phase = (random() - .5) * .28, shoulder = random() < .5 ? -1 : 1;
		for (let slot = 0; slot < quota; slot++) {
			const radius = 210 + random() * 48 + (contract.kind === 'demolition' ? 55 : 95 * Math.floor(slot / 2));
			const flank = (slot % 2 ? -shoulder : shoulder) * (.76 + .14 * Math.floor(slot / 2));
			const offset = contract.kind === 'demolition' ? Math.PI / 4 + slot * 2 * Math.PI / quota
				: contract.kind === 'raid' ? Math.PI + flank : flank;
			const gun = findPost(site, approach + phase + offset, radius);
			if (gun) guns.push(gun);
		}
	}
	return guns;
};
const missionGarrison = function (contract: Contract, map: MissionMap): MissionSpawn[] {
	if (contract.kind === 'defend') return [];
	const guards = mobileSpawns(contract, map);
	const guns = placeArtillery(contract, map, guards, missionArtilleryCount(contract));
	// A gun foundation can close a passage between otherwise reachable buildings.
	const posted = guns.length && map.terrain?.site?.kind === 'garrison' ? mobileSpawns(contract, map,
		{ obstacles: [...map.terrain.obstacles, ...guns.map(function (p) { return landingFootprint(p, EMPLACEMENT_RADIUS); })] }) : guards;
	return [...posted, ...guns.map(function (at): MissionSpawn { return { ...at, kind: 'artillery' }; })];
};
export const missionSpawn = function (contract: Contract, map: MissionMap, index: number): MissionSpawn {
	if (map.terrain?.site?.kind !== 'garrison' && Number.isInteger(index) && index >= 0 && index < mobileHostileCount(contract)) return mobileSpawn(contract, map, index);
	const spawn = missionGarrison(contract, map)[index];
	if (spawn) return spawn;
	throw new RangeError(`No hostile at deployment slot ${index} on this field`);
};

const missionCover = function (contract: Contract, map: TerrainMap, lanes = map.terrain.roads) {
	const obstacles = [...map.terrain.obstacles];
	const slots = Array.from({ length: SQUAD_SIZE - 1 }, function (_, index) { return missionDeploymentSlot(map, index); });
	const guards = mobileSpawns(contract, map);

	// Keep a rig-sized passage between pieces of cover; reserve deployment,
	// capture and extraction circles, patrols and the full width of each road.
	const addCover = function (candidate: TerrainObstacle) {
		const footprint = { obstacles: [candidate] };
		const footing = obstacles.every(function (other) {
			return Math.abs(other.x - candidate.x) > (other.width + candidate.width) / 2 + 60
				|| Math.abs(other.y - candidate.y) > (other.depth + candidate.depth) / 2 + 60;
		});
		if (!footing || !terrainPointClear(footprint, map.drop, 138)
			|| !terrainPointClear(footprint, map.extraction, EXTRACTION_RADIUS + RIG_RADIUS)
			|| map.sites.some(function (site) { return !terrainPointClear(footprint, site, 140); })
			|| guards.some(function (guard) { return !terrainPointClear(footprint, guard, ENEMY_RADIUS); })
			|| slots.some(function (slot) { return !terrainPathClear(footprint, slot, map.drop, RIG_RADIUS); })
			|| !roadsClear(footprint, lanes)) return;
		obstacles.push(candidate);
	};
	return { obstacles, addCover };
};

const surveyElevation = function (contract: Contract, map: TerrainMap, garrison: readonly MissionSpawn[]) {
	const slots = Array.from({ length: SQUAD_SIZE - 1 }, function (_, i) { return missionDeploymentSlot(map, i); });
	const guards = [], emplacements = [];
	for (const spawn of garrison) {
		const footprint = landingFootprint(spawn, spawn.kind === 'artillery' ? EMPLACEMENT_RADIUS : spawn.frameId ? RIG_RADIUS : ENEMY_RADIUS);
		guards.push(footprint);
		if (spawn.kind === 'artillery') emplacements.push(footprint);
	}
	const siteRadius = contract.kind === 'defend' ? 68 : contract.kind === 'demolition' || contract.kind === 'raid' ? FACILITY_RADIUS
		: contract.kind === 'acquisition' || contract.kind === 'recovery' ? 24 : 0;
	const sites = siteRadius ? map.sites.map(function (p) { return landingFootprint(p, siteRadius); }) : [];
	return generateElevation(map, map.terrain.obstacles, [map.drop, ...slots], [...guards, ...sites], emplacements);
};

const finishMissionField = function (contract: Contract, map: TerrainMap, obstacles: readonly TerrainObstacle[], random: () => number) {
	const terrain = { ...map.terrain, obstacles };
	const landmarkField = terrain.site ? { obstacles: [...obstacles, terrain.site] } : terrain;
	const landmarks: Landmark[] = [];
	const garrison = missionGarrison(contract, { ...map, terrain });
	const guns = garrison.filter(function (spawn) { return spawn.kind === 'artillery'; });
	const reserved = [map.drop, map.extraction, ...map.sites];
	const between = function (min: number, max: number) { return Math.round(min + random() * (max - min)); };
	for (let i = 0; i < 180 && landmarks.length < 56; i++) {
		const at = { x: between(160, map.width - 160), y: between(160, map.height - 160) };
		const radius = between(35, 135);
		if (reserved.some(function (site) { return separation(at, site) < radius + 155; })
			|| guns.some(function (gun) { return separation(at, gun) < radius + EMPLACEMENT_RADIUS; })
			|| !terrainPointClear(landmarkField, at, radius)) continue;
		landmarks.push({ ...at, radius, rotation: random() * Math.PI * 2, kind: i % 7 === 0 ? 'depot' : i % 3 === 0 ? 'crater' : 'rocks' });
	}
	// Board and survey callers can inspect the same map without constructing a
	// height mesh. Every consumer of a deployed field shares the first survey.
	const field = { ...map, landmarks, terrain };
	let elevation: TerrainElevation | undefined;
	return { map: { ...field, terrain: { ...terrain, get elevation() { return elevation ??= surveyElevation(contract, field, garrison); } } }, garrison };
};

export const generateMissionField = function (contract: Contract, suppliedMap?: MissionMap): { map: MissionMap; garrison: MissionSpawn[] } {
	if (suppliedMap) return { map: suppliedMap, garrison: missionGarrison(contract, suppliedMap) };
	const dimensions = randomSource(contract.seed);
	const width = 4200 + Math.floor(dimensions() * 3) * 300;
	const height = Math.round((3000 + Math.floor(dimensions() * 3) * 300) * 1.15);
	const biome = getPlanet(contract.planetId).biome;
	const random = randomSource(Math.imul(contract.seed, 0x9e3779b1) + 0x43494e44);
	const between = function (min: number, max: number) { return Math.round(min + random() * (max - min)); };
	if (biome !== 'badlands' && biome !== 'volcanic' && biome !== 'tundra') {
		const { map, cover } = createBiomeLayout(biome, contract, width, height, hasMultipleSites(contract.kind), between);
		const { obstacles, addCover } = missionCover(contract, map);
		for (const feature of cover) addCover(feature);
		return finishMissionField(contract, map, obstacles, random);
	}
	// Shared Cinder Recovery seeds retain the survey orientation from the trial.
	const eastWestCut = (contract.planetId !== 'cinder' || contract.kind !== 'recovery') && dimensions() < .5;
	const acrossSpan = eastWestCut ? height : width;
	const alongSpan = eastWestCut ? width : height;
	const across = random() < .5 ? -1 : 1;
	const along = random() < .5 ? -1 : 1;
	const surveyOrigin = acrossSpan / 2 + between(-220, 220);
	const back = between(alongSpan * .34, alongSpan * .40);
	const alongOrigin = along === 1 ? back : alongSpan - back;
	const approach = between(335, 410); const departure = between(940, 1190);
	const flank = between(455, 610);
	const approachOffset = between(-32, 24), siteOffset = between(-55, 45);
	const defense = contract.kind === 'defend';
	const plan = objectiveSitePlan(contract);
	// Start the district beyond the crossing, then reserve its full depth on
	// that bank even when the seed turns the cut across the shorter map axis.
	const frontage = 250 + (defense ? 0 : departure - 940);
	const bankDepth = plan ? frontage + plan.bounds.width + 160 : 0;
	const acrossOrigin = across === 1 ? Math.min(surveyOrigin, acrossSpan - bankDepth) : Math.max(surveyOrigin, bankDepth);
	const siteX = plan ? frontage - plan.bounds.west : defense ? 760 : departure;
	const siteY = defense ? 20 : siteOffset + (contract.kind === 'assassination' ? -245 : contract.kind === 'demolition' ? 195 : 0);
	const point = function (acrossCut: number, alongCut: number): Point {
		const acrossPosition = acrossOrigin + across * acrossCut;
		const alongPosition = alongOrigin + along * alongCut;
		return eastWestCut ? { x: alongPosition, y: acrossPosition } : { x: acrossPosition, y: alongPosition };
	};
	const footprintSize = function (acrossWidth: number, alongDepth: number) {
		return eastWestCut ? { width: alongDepth, depth: acrossWidth } : { width: acrossWidth, depth: alongDepth };
	};

	// Build both approaches in coordinates relative to their main crossing.
	// The flared entries and level crossings remain open as the cut moves.
	const approachStart = point(-approach, approachOffset);
	const sitePoint = function (east: number, south: number) { return point(siteX + east, siteY + south); };
	const objective = sitePoint(0, 0);
	const layout = plan && placeObjectiveSite(plan, sitePoint, footprintSize);
	const serviceEntry = point(-approach - 85, 285);
	const serviceFork = point(-approach - 30, flank);
	const cutWidth = biome === 'badlands' ? 230 : 204;
	const pickupClearance = cutWidth / 2 + 28 + EXTRACTION_RADIUS + RIG_RADIUS;
	const servicePickup = point(Math.min(-approach + 50, -pickupClearance), flank + between(215, 290));
	const serviceBend = point(departure - 310, flank + between(35, 65));
	const mainHalf = between(115, 150); const flankHalf = between(115, 145);
	const fissure = function (start: number, end: number): TerrainObstacle {
		return { ...point(between(-28, 28), (start + end) / 2), kind: 'fissure',
			...footprintSize(between(biome === 'badlands' ? 156 : 132, cutWidth), end - start), height: 0 };
	};
	const cuts = [fissure(-back + 210, -mainHalf), fissure(mainHalf, flank - flankHalf),
		fissure(flank + flankHalf, alongSpan - back - 210)];
	const shed = function (x: number, y: number, width: number): TerrainObstacle {
		return { ...point(x, y), kind: 'shed', ...footprintSize(width, between(90, 126)), height: between(92, 112) };
	};
	const buildings = [
		shed(between(-277, -252), between(232, 256), between(125, 153)),
		shed(between(260, 331), (random() < .72 ? 1 : -1) * between(150, 172), between(180, 226)),
		shed(departure - between(470, 525), flank - between(132, 148), between(148, 220)),
		...(random() < .45 ? [shed(between(445, 555), -between(390, 490), between(120, 155))] : []),
	];

	const drop = defense ? sitePoint(-235, -430) : approachStart;
	const extraction = defense ? sitePoint(-90, flank + 295) : servicePickup;
	const multiSite = hasMultipleSites(contract.kind);
	const nearSite = point(-approach - 245, flank + 155);
	const farSite = point(departure - 385, -480);
	const sites = multiSite ? [nearSite, farSite, objective] : [objective];
	const roadStart = defense ? point(-approach, 0) : approachStart;
	const roads = [
		[roadStart, point(0, 0), ...(layout ? [point(230, 0), ...layout.avenue] : [objective])],
		[roadStart, ...(defense ? [] : [serviceEntry]), serviceFork, point(0, flank),
			...(layout ? [point(230, flank), ...layout.service] : [defense ? point(430, flank) : serviceBend, objective])],
	];
	if (defense) roads.push([drop, ...(layout?.defenseStreet ?? [objective]), extraction]);
	if (layout) roads.push(...layout.streets);
	if (multiSite) roads.push([serviceFork, nearSite], [objective, farSite]);
	const lanes = defense ? roads : [...roads, [serviceFork, extraction]];
	const map: TerrainMap = { seed: contract.seed, biome, width, height, drop, objective, extraction, sites,
		landmarks: [], terrain: layout ? { obstacles: [...cuts, ...layout.buildings], roads, site: layout.site } : { obstacles: cuts, roads } };
	const { obstacles, addCover } = missionCover(contract, map, lanes);
	for (const building of buildings) addCover(building);
	// Keep cover on the approaches even when objective and spawn reservations
	// displace the original shed candidates.
	for (const [x, y] of [[-450, -255], [470, -265], [450, flank + 270], [-625, 205], [800, -255]] as const) {
		if (obstacles.length - map.terrain.obstacles.length >= 3) break;
		addCover(shed(x, y, 135));
	}
	if (biome === 'tundra') {
		for (const [x, y] of [[-790, 310], [-690, 430], [330, -660], [460, -740], [790, flank + 500], [920, flank + 450]] as const) {
			addCover({ ...point(x + between(-30, 30), y + between(-30, 30)), kind: 'tree', width: 36, depth: 36, height: between(58, 74) });
		}
	}
	return finishMissionField(contract, map, obstacles, random);
};
export const generateMissionMap = function (contract: Contract): MissionMap { return generateMissionField(contract).map; };

export const missionObjective = function (state: CombatStateView): string {
	const mission = state.mission;
	if (!mission) return 'Protect Relay 09';
	if (mission.stage === 'extract') {
		const range = separation(state.player, mission.map.extraction);
		if (mission.extractTime >= EXTRACTION_SECONDS) return `Extraction ready · reach pickup ${Math.round(range)} m`;
		if (mission.extractTime > 0) return range <= EXTRACTION_RADIUS
			? `Extraction ${Math.ceil(EXTRACTION_SECONDS - mission.extractTime)}s · hold the landing zone`
			: `Squad holding pickup · ${Math.round(range)} m to extraction`;
		return `Return to extraction · ${Math.round(range)} m`;
	}
	if (mission.contract.kind === 'raid') return `Destroy supply sites · ${mission.progress}/3 destroyed`;
	if (mission.contract.kind === 'recovery' || mission.contract.kind === 'acquisition') {
		const holding = mission.captureSites?.find(function (site) { return !site.complete && site.holdTime > 0; });
		const duration = mission.contract.kind === 'recovery' ? RECOVERY_SECONDS : BEACON_SECONDS;
		const action = holding ? ` · ${separation(state.player, holding) <= CAPTURE_RADIUS ? 'hold' : 'squad holding'} ${(duration - holding.holdTime).toFixed(1)}s` : ' · enter a marked zone';
		return mission.contract.kind === 'recovery' ? `Recover the data${action}`
			: (mission.acquisitionTime ?? 0) <= 0 ? 'Target acquisition failed · deadline expired'
			: `Beacons ${mission.progress}/3 · ${Math.ceil(mission.acquisitionTime ?? 0)}s remaining${action}`;
	}
	if (mission.contract.kind === 'defend') return `Protect the relay · ${mission.progress}/${mission.required} hostiles eliminated`;
	if (mission.contract.kind === 'demolition') return `Destroy the facility · ${Math.ceil(Math.max(0, mission.structure?.hp ?? 0) / (mission.structure?.maxHp ?? 1) * 100)}% integrity`;
	if (mission.contract.kind === 'assassination') return 'Hunt the marked command frame';
	return `Clear the three hostile sites · ${mission.progress}/${mission.required} eliminated`;
};
