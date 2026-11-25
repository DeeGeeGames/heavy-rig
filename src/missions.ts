import { getMissionTier } from './reputation';
import { getPlanet, randomSource } from './universe';
import { terrainPathClear, terrainPointClear, type TerrainObstacle } from './field-terrain';
import { ENEMY_RADIUS, RIG_RADIUS } from './combat-spatial';
import { SQUAD_SIZE } from './pilots';
import { isAuthoredContract } from './contract-chains';
import { PLAYABLE_FRAMES, type FrameId } from './frames';
import { createBiomeLayout, type TerrainMap } from './biome-layout';
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

export interface MissionSpawn extends Point { kind: EnemyKind; commander?: boolean; frameId?: FrameId; formation?: number }
export const missionHostileCount = function (contract: Contract): number {
	const level = getMissionTier(contract.tier);
	return contract.kind === 'defend' || contract.kind === 'clearance' ? level.assault : level.patrol;
};
const legacyRosters: Readonly<Record<Contract['tier'], readonly EnemyKind[]>> = {
	1: ['scout', 'helicopter', 'scout', 'scout'],
	2: ['scout', 'helicopter', 'striker', 'scout'],
	3: ['striker', 'tank', 'scout', 'vtol', 'striker', 'helicopter'],
	4: ['striker', 'tank', 'siege', 'vtol', 'helicopter', 'scout'],
	5: ['siege', 'tank', 'striker', 'vtol', 'siege'],
	6: ['siege', 'tank', 'siege', 'vtol', 'striker', 'siege'],
};
// Every section starts with two rigs. The third contact supports the section
// and is omitted if the contract quota ends before its slot.
const formations: Readonly<Record<Contract['tier'], readonly EnemyKind[]>> = {
	1: ['scout', 'scout', 'helicopter'],
	2: ['scout', 'striker', 'helicopter'],
	3: ['striker', 'scout', 'tank', 'striker', 'scout', 'helicopter'],
	4: ['striker', 'siege', 'tank', 'scout', 'striker', 'vtol'],
	5: ['siege', 'striker', 'tank', 'striker', 'siege', 'vtol'],
	6: ['siege', 'striker', 'vtol', 'siege', 'scout', 'tank'],
};
const catalogFrame = function (contract: Contract, role: EnemyKind, random: () => number): FrameId | undefined {
	if (role === 'tank' || role === 'helicopter' || role === 'vtol') return undefined;
	const eligible = PLAYABLE_FRAMES.filter(function (frame) {
		return (contract.tier > 1 || frame.variant === 'A') && (contract.tier >= 4 || frame.mass < 95);
	});
	const preferred = eligible.filter(function (frame) {
		return role === (frame.mass < 50 ? 'scout' : frame.mass >= 95 ? 'siege' : 'striker');
	});
	const pool = preferred.length ? preferred : eligible;
	return pool[Math.floor(random() * pool.length)]?.id;
};
export const missionSpawn = function (contract: Contract, map: MissionMap, index: number): MissionSpawn {
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
	const kind: EnemyKind = commander ? contract.tier === 1 ? 'scout' : contract.tier < 4 ? 'striker' : 'siege' : roster[index % roster.length] ?? 'scout';
	const frameId = legacy ? undefined : catalogFrame(contract, kind, random);
	const atBearing = function (bearing: number): Point {
		return { x: Math.max(100, Math.min(map.width - 100, site.x + Math.cos(bearing) * radius)),
			y: Math.max(100, Math.min(map.height - 100, site.y + Math.sin(bearing) * radius)) };
	};
	let at = atBearing(angle);
	const terrain = map.terrain;
	const clearance = frameId ? RIG_RADIUS : ENEMY_RADIUS;
	if (terrain && !commander && !terrainPointClear(terrain, at, clearance)) {
		// Try nearby points on the spawn ring, then both axes. Every site
		// has an open bearing leading away from the cut on its own bank.
		for (const bearing of [angle + .5, angle - .5, angle + 1, angle - 1, angle + 1.5, angle - 1.5, 0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
			const candidate = atBearing(bearing);
			if (terrainPointClear(terrain, candidate, clearance)) { at = candidate; break; }
		}
	}
	return { ...at, kind, ...(commander ? { commander: true } : {}), ...(frameId ? { frameId } : {}), ...(!legacy ? { formation } : {}) };
};

const missionCover = function (contract: Contract, map: TerrainMap, lanes = map.terrain.roads) {
	const obstacles = [...map.terrain.obstacles];
	const slots = Array.from({ length: SQUAD_SIZE - 1 }, function (_, index) { return missionDeploymentSlot(map, index); });
	const guards = Array.from({ length: missionHostileCount(contract) }, function (_, index) { return missionSpawn(contract, map, index); });

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
			|| lanes.some(function (lane) {
				return lane.some(function (at, i) { const before = lane[i - 1]; return before && !terrainPathClear(footprint, before, at, 45); });
			})) return;
		obstacles.push(candidate);
	};
	return { obstacles, addCover };
};

const addLandmarks = function (map: TerrainMap, obstacles: readonly TerrainObstacle[], random: () => number): MissionMap {
	const terrain = { obstacles, roads: map.terrain.roads };
	const landmarks: Landmark[] = [];
	const reserved = [map.drop, map.extraction, ...map.sites];
	const between = function (min: number, max: number) { return Math.round(min + random() * (max - min)); };
	for (let i = 0; i < 180 && landmarks.length < 56; i++) {
		const at = { x: between(160, map.width - 160), y: between(160, map.height - 160) };
		const radius = between(35, 135);
		if (reserved.some(function (site) { return separation(at, site) < radius + 155; })
			|| !terrainPointClear(terrain, at, radius)) continue;
		landmarks.push({ ...at, radius, rotation: random() * Math.PI * 2, kind: i % 7 === 0 ? 'depot' : i % 3 === 0 ? 'crater' : 'rocks' });
	}
	return { ...map, landmarks, terrain };
};

export const generateMissionMap = function (contract: Contract): MissionMap {
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
		return addLandmarks(map, obstacles, random);
	}
	// Shared Cinder Recovery seeds retain the survey orientation from the trial.
	const eastWestCut = (contract.planetId !== 'cinder' || contract.kind !== 'recovery') && dimensions() < .5;
	const acrossSpan = eastWestCut ? height : width;
	const alongSpan = eastWestCut ? width : height;
	const across = random() < .5 ? -1 : 1;
	const along = random() < .5 ? -1 : 1;
	const acrossOrigin = acrossSpan / 2 + between(-220, 220);
	const back = between(alongSpan * .34, alongSpan * .40);
	const alongOrigin = along === 1 ? back : alongSpan - back;
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
	const approach = between(335, 410); const departure = between(940, 1190);
	const flank = between(455, 610);
	const approachStart = point(-approach, between(-32, 24));
	const siteOffset = between(-55, 45);
	const mainSite = point(departure, siteOffset + (contract.kind === 'assassination' ? -245 : contract.kind === 'demolition' ? 195 : 0));
	const serviceEntry = point(-approach - 85, 285);
	const serviceFork = point(-approach - 30, flank);
	const cutWidth = biome === 'badlands' ? 230 : 204;
	const pickupClearance = cutWidth / 2 + 28 + EXTRACTION_RADIUS + RIG_RADIUS;
	const servicePickup = point(Math.min(-approach + 50, -pickupClearance), flank + between(215, 290));
	const crossingRoads = [
		[approachStart, point(0, 0), mainSite],
		[approachStart, serviceEntry, serviceFork, point(0, flank), point(departure - 310, flank + between(35, 65)), mainSite],
	];
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

	const defense = contract.kind === 'defend';
	const drop = defense ? point(525, -410) : approachStart;
	const objective = defense ? point(760, 20) : mainSite;
	const extraction = defense ? point(670, flank + 315) : servicePickup;
	const multiSite = hasMultipleSites(contract.kind);
	const nearSite = point(-approach - 245, flank + 155);
	const farSite = point(departure - 385, -480);
	const sites = multiSite ? [nearSite, farSite, objective] : [objective];
	const roads = defense ? [
		[point(-approach, 0), point(0, 0), objective],
		[point(-approach, 0), serviceFork, point(0, flank), point(430, flank), objective],
		[drop, objective, extraction],
	] : crossingRoads;
	if (multiSite) roads.push([serviceFork, nearSite], [objective, farSite]);
	const lanes = defense ? roads : [...roads, [serviceFork, extraction]];
	const map: TerrainMap = { seed: contract.seed, biome, width, height, drop, objective, extraction, sites,
		landmarks: [], terrain: { obstacles: cuts, roads } };
	const { obstacles, addCover } = missionCover(contract, map, lanes);
	for (const building of buildings) addCover(building);
	// Keep cover on the approaches even when objective and spawn reservations
	// displace the original shed candidates.
	for (const [x, y] of [[-450, -255], [470, -265], [450, flank + 270], [-625, 205], [800, -255]] as const) {
		if (obstacles.length - cuts.length >= 3) break;
		addCover(shed(x, y, 135));
	}
	if (biome === 'tundra') {
		for (const [x, y] of [[-790, 310], [-690, 430], [330, -660], [460, -740], [790, flank + 500], [920, flank + 450]] as const) {
			addCover({ ...point(x + between(-30, 30), y + between(-30, 30)), kind: 'tree', width: 36, depth: 36, height: between(58, 74) });
		}
	}
	return addLandmarks(map, obstacles, random);
};

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
