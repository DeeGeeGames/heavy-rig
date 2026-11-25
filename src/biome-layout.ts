import type { Biome, Contract, MissionMap } from './campaign-types';
import type { FieldTerrain, TerrainObstacle } from './field-terrain';
import type { Point } from './simulation';

type Region = Exclude<Biome, 'badlands' | 'volcanic' | 'tundra'>;
type Site = readonly [number, number];
type Road = readonly Site[];
type Between = (low: number, high: number) => number;
export type TerrainMap = MissionMap & { terrain: FieldTerrain };

// Survey coordinates run west to east. Each seed turns, reflects, stretches
// and translates the survey together with its roads, crossings and cover.
const approach: Site = [-835, -180];
const relay: Site = [845, 80];
const defenseDrop: Site = [845, -365];
const westFork: Site = [-825, 470];
const extraction: Site = [-900, 860];
const sideSite: Site = [-1050, 625];
const farSite: Site = [1005, -700];

const feature = function (kind: TerrainObstacle['kind'], x: number, y: number, width: number, depth: number, height: number): TerrainObstacle {
	return { kind, x, y, width, depth, height };
};
interface Survey {
	roads: Road[];
	barriers: TerrainObstacle[];
	cover: TerrainObstacle[];
}

const wetlands = function (between: Between, defense: boolean): Survey {
	const west = between(-485, -430), east = between(355, 405);
	const westHaul = between(-315, -190), eastHaul = between(-475, -300);
	const westLevee = between(400, 540), eastLevee = between(235, 370);
	const channel = function (x: number, start: number, end: number) {
		return feature('channel', x + between(-20, 20), (start + end) / 2, between(230, 310), end - start, 0);
	};
	const branch = function (x: number, upper: number, lower: number) {
		const first = between(100, 130), second = between(105, 140);
		return [channel(x, -1410, upper - first), channel(x, upper + first, lower - second), channel(x, lower + second, 1340)];
	};
	const pumpSites: readonly Site[] = [[-840, 90], [-1100, -455], [-190, -540], [40, 150], [100, 540], [670, -165], [1080, -285], [1060, 380]];
	return {
		roads: [
			[approach, [-745, westHaul], [-170, westHaul], [95, eastHaul], [660, eastHaul], relay],
			[approach, westFork, [-735, westLevee], [-170, westLevee], [100, eastLevee], [660, eastLevee], relay],
		],
		barriers: [
			...branch(west, westHaul, westLevee), ...branch(east, eastHaul, eastLevee),
			feature('channel', -36, 0, between(250, 295), between(110, 160), 0),
			feature('channel', -36, -875, between(230, 295), between(150, 245), 0),
		],
		cover: [
			...(defense ? [feature('shed', 1105, -15, 130, 105, 85)] : []),
			...pumpSites.map(function ([x, y]) {
				return feature('shed', x, y, between(108, 154), between(90, 118), between(65, 91));
			}),
		],
	};
};

const forest = function (between: Between, defense: boolean): Survey {
	const bend = between(-235, -120), clearing = between(280, 415);
	const roads: Road[] = [
		[approach, [-420, bend], [-140, bend], [220, 80], [590, 120], relay],
		[approach, [-820, 190], westFork, [-365, clearing], [125, 475], [495, clearing], relay],
	];
	const groves: readonly Site[] = [[-775, -460], [-635, 60], [-1070, 55], [-220, 100], [120, -310], [610, -265],
		[1025, -125], [290, 265], [310, 690], [-515, 745], [-1080, 905], [650, -680], [970, 430], [-230, -670]];
	const trunks = groves.flatMap(function ([x, y], i) {
		return [0, 1].map(function (neighbor) {
			const diameter = between(70, 105);
			return feature('tree', x + neighbor * 178 + between(-24, 24), y + neighbor * (i % 2 ? 90 : -90) + between(-24, 24),
				diameter, diameter, between(148, 210));
		});
	});
	const cutovers: readonly Site[] = [[-515, -320], [-425, -360], [425, -35], [1080, 230]];
	const stumps = cutovers.map(function ([x, y]) {
		const diameter = between(69, 93);
		return feature('tree', x, y, diameter, diameter, between(32, 46));
	});
	return { roads, barriers: [], cover: [
		...(defense ? [feature('shed', 1110, 75, 182, 99, 79)] : []),
		feature('shed', 620, 300, 155, 83, 71), feature('shed', -385, -620, 185, 95, 73), ...stumps, ...trunks,
	] };
};

const steppe = function (between: Between): Survey {
	const row = between(110, 170);
	const turbines: readonly Site[] = [[-625, row], [-215, row + 18], [195, row + 36], [605, row + 54], [1015, row + 72],
		[-340, -585], [130, -545], [600, -505], [1070, -465]];
	const ridges: readonly Site[] = [[-650, -440], [-955, 170], [-40, 370], [710, -200], [1035, 490], [390, 790]];
	return {
		roads: [
			[approach, [-265, -190], [315, -110], relay],
			[approach, westFork, [-280, 635], [380, 555], relay],
		],
		barriers: [],
		cover: [...turbines.map(function ([x, y], index) {
			const width = between(80, 103);
			const foundation = index % 2 === 0 ? between(85, 98) : between(48, 61);
			return feature('turbine', x, y, width, width, foundation);
		}), ...ridges.map(function ([x, y]) {
			return feature('outcrop', x + between(-35, 35), y + between(-35, 35), between(125, 200), between(79, 128), between(55, 87));
		})],
	};
};

const crystal = function (between: Between): Survey {
	const fork: Site = [between(-480, -330), between(145, 235)];
	const northernPass: Site = [between(90, 260), between(-255, -125)];
	const pockets: readonly Site[] = [
		[-1090, 70], [-675, -525], [-340, 85], [60, -655], [480, 455],
		[565, -400], [1150, -40], [-200, 730], [-1280, -790], [1100, 705],
	];
	const formations = pockets.flatMap(function ([surveyX, surveyY]) {
		const x = surveyX + between(-85, 85), y = surveyY + between(-85, 85);
		const core = feature('crystal', x, y, between(108, 170), between(108, 170), between(105, 183));
		// Short ribs and satellite outcrops branch from local pockets. The gaps
		// between their individual footprints are usable by the whole squad.
		const bearing = between(0, 359) * Math.PI / 180;
		const distance = between(220, 330);
		const length = between(175, 292), breadth = between(74, 115);
		const eastWest = Math.abs(Math.cos(bearing)) > Math.abs(Math.sin(bearing));
		const rib = feature('crystal', x + Math.cos(bearing) * distance, y + Math.sin(bearing) * distance,
			eastWest ? length : breadth, eastWest ? breadth : length, between(81, 146));
		if (between(0, 3) === 0) return [core, rib];
		const branch = bearing + between(90, 245) * Math.PI / 180, gap = between(175, 285);
		const satellite = feature('crystal', x + Math.cos(branch) * gap, y + Math.sin(branch) * gap,
			between(62, 124), between(68, 119), between(54, 112));
		return [core, rib, satellite];
	});
	return {
		roads: [
			[approach, [-600, -65], fork, [35, 290], [505, 210], relay],
			[approach, [-470, -365], northernPass, [540, -115], relay],
			[fork, westFork],
		],
		barriers: [],
		// Leave room to walk around the outermost quartz even when the survey
		// turns onto the short axis of the smallest field.
		cover: formations.filter(function (o) {
			return Math.abs(o.x) + o.width / 2 <= 1440 && Math.abs(o.y) + o.depth / 2 <= 1440;
		}),
	};
};

const surveys = { wetlands, forest, steppe, crystal } satisfies Record<Region, (between: Between, defense: boolean) => Survey>;

export const createBiomeLayout = function (biome: Region, contract: Contract, width: number, height: number, multiSite: boolean, between: Between) {
	const swapAxes = between(0, 1) === 1;
	const scaleX = (between(0, 1) ? -1 : 1) * between(95, 105) / 100;
	const scaleY = (between(0, 1) ? -1 : 1) * between(94, 108) / 100;
	const ox = width / 2 + between(-90, 90), oy = height / 2 + between(-90, 90);
	const point = function ([x, y]: Site): Point {
		return { x: Math.round(ox + (swapAxes ? y * scaleY : x * scaleX)), y: Math.round(oy + (swapAxes ? x * scaleX : y * scaleY)) };
	};
	const footprint = function (obstacle: TerrainObstacle): TerrainObstacle {
		const w = Math.round(obstacle.width * Math.abs(scaleX)), d = Math.round(obstacle.depth * Math.abs(scaleY));
		return { ...obstacle, ...point([obstacle.x, obstacle.y]), width: swapAxes ? d : w, depth: swapAxes ? w : d };
	};
	const defense = contract.kind === 'defend';
	const survey = surveys[biome](between, defense);
	const roads: Road[] = [...survey.roads, [westFork, extraction]];
	if (defense) roads.push([defenseDrop, relay]);
	if (multiSite) roads.push([westFork, sideSite], [relay, farSite]);
	const objective = point(relay);
	const map: TerrainMap = { seed: contract.seed, biome, width, height, drop: point(defense ? defenseDrop : approach), objective,
		extraction: point(extraction), sites: multiSite ? [point(sideSite), point(farSite), objective] : [objective], landmarks: [],
		terrain: { roads: roads.map(function (route) { return route.map(point); }), obstacles: survey.barriers.map(footprint) } };
	return { map, cover: survey.cover.map(footprint) };
};
