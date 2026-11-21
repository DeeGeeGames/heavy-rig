import type { Contract, MissionMap } from './campaign-types';
import { defaultReserves } from './combat-resources';
import { terrainPathClear, type TerrainObstacle } from './field-terrain';
import { createStarterLoadout } from './hardpoints';
import { generateMissionMap, missionHostileCount, missionSpawn } from './missions';
import { createMissionState, type Point, type State } from './simulation';
import { randomSource } from './universe';

const clearOf = function (point: Point, obstacle: TerrainObstacle, radius: number) {
	const x = Math.max(0, Math.abs(point.x - obstacle.x) - obstacle.width / 2);
	const y = Math.max(0, Math.abs(point.y - obstacle.y) - obstacle.depth / 2);
	return Math.hypot(x, y) >= radius;
};

const generateTrialMap = function (contract: Contract): MissionMap {
	const base = generateMissionMap(contract);
	const height = Math.round(base.height * 1.15);
	const random = randomSource(Math.imul(contract.seed, 0x9e3779b1) + 0x43494e44);
	const between = function (min: number, max: number) { return Math.round(min + random() * (max - min)); };
	const across = random() < .5 ? -1 : 1;
	const along = random() < .5 ? -1 : 1;
	const originX = base.width / 2 + between(-220, 220);
	const back = between(height * .34, height * .40);
	const originY = along === 1 ? back : height - back;
	const point = function (acrossCut: number, alongCut: number): Point {
		return { x: originX + across * acrossCut, y: originY + along * alongCut };
	};

	// Build both approaches in coordinates relative to their main crossing.
	// The flared entries and level crossings remain open as the cut moves.
	const approach = between(335, 410); const departure = between(940, 1190);
	const flank = between(455, 610);
	const drop = point(-approach, between(-32, 24));
	const objective = point(departure, between(-55, 45));
	const serviceEntry = point(-approach - 85, 285);
	const serviceFork = point(-approach - 30, flank);
	const extraction = point(-approach + 50, flank + between(215, 290));
	const roads = [
		[drop, point(0, 0), objective],
		[drop, serviceEntry, serviceFork, point(0, flank), point(departure - 310, flank + between(35, 65)), objective],
	];
	const mainHalf = between(115, 150); const flankHalf = between(115, 145);
	const fissure = function (start: number, end: number): TerrainObstacle {
		return { ...point(between(-28, 28), (start + end) / 2), kind: 'fissure',
			width: between(132, 204), depth: end - start, height: 0 };
	};
	const cuts = [fissure(-back + 210, -mainHalf), fissure(mainHalf, flank - flankHalf),
		fissure(flank + flankHalf, height - back - 210)];
	const shed = function (x: number, y: number, width: number): TerrainObstacle {
		return { ...point(x, y), kind: 'shed', width, depth: between(90, 126), height: between(92, 112) };
	};
	const buildings = [
		shed(between(-277, -252), between(232, 256), between(125, 153)),
		shed(between(260, 331), (random() < .72 ? 1 : -1) * between(150, 172), between(180, 226)),
		shed(departure - between(470, 525), flank - between(132, 148), between(148, 220)),
		...(random() < .45 ? [shed(between(445, 555), -between(390, 490), between(120, 155))] : []),
	];

	const map = { ...base, height, drop, objective, extraction, sites: [objective] };
	const guards = Array.from({ length: missionHostileCount(contract) }, function (_, index) { return missionSpawn(contract, map, index); });
	const lanes = [...roads, [serviceFork, extraction]];
	const obstacles = [...cuts];
	for (const building of buildings) {
		const footprint = { obstacles: [building], roads: [] };
		const footing = obstacles.every(function (other) {
			return Math.abs(other.x - building.x) > (other.width + building.width) / 2 + 12
				|| Math.abs(other.y - building.y) > (other.depth + building.depth) / 2 + 12;
		});
		if (footing && clearOf(drop, building, 138) && clearOf(objective, building, 140) && clearOf(extraction, building, 175)
			&& guards.every(function (guard) { return clearOf(guard, building, 52); })
			&& lanes.every(function (lane) {
				return lane.every(function (at, i) { const before = lane[i - 1]; return !before || terrainPathClear(footprint, before, at, 45); });
			})) obstacles.push(building);
	}
	const landmarks = base.landmarks.map(function (landmark) { return { ...landmark, y: landmark.y * height / base.height }; })
		.filter(function (landmark) {
			return obstacles.every(function (obstacle) { return clearOf(landmark, obstacle, landmark.radius); })
				&& [drop, objective, extraction].every(function (site) { return Math.hypot(landmark.x - site.x, landmark.y - site.y) > landmark.radius + 155; });
		});
	return { ...map, landmarks, terrain: { obstacles, roads } };
};

export const createFieldTrial = function (seed: number): State {
	const contract: Contract = {
		id: 'field-trial-cinder-recovery', seed: seed >>> 0, planetId: 'cinder', kind: 'recovery', employer: 'accord', opponent: 'combine',
		title: 'Cinder field trial', briefing: 'Recover the courier recorder and return to pickup.', tier: 1, requiredReputation: 0,
		reward: 0, favor: 0, hostility: 0,
	};
	const loadout = createStarterLoadout('kestrel');
	return createMissionState(contract, { map: generateTrialMap(contract), frame: 'warden-c', difficulty: 'story',
		squadmates: [{ pilotId: 'kite', callsign: 'Kite', specialty: 'skirmisher', frameId: 'kestrel', integrity: 100, loadout, reserves: defaultReserves(loadout) }] });
};
