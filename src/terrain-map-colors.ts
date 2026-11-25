import type { Biome } from './campaign-types';
import type { TerrainObstacle } from './field-terrain';

type MapColors = readonly [fill: string, edge: string];
const obstacleColors: Readonly<Record<TerrainObstacle['kind'], MapColors>> = {
	fissure: ['#35282a', '#9c6a54'], shed: ['#899190', '#b3bfbb'], tree: ['#496b62', '#83ac96'],
	channel: ['#194b53', '#7fc7bf'], turbine: ['#8a8461', '#e5d9ae'], outcrop: ['#595953', '#a6a294'],
	crystal: ['#635077', '#c4a5d8'],
};
const fissureColors: Partial<Record<Biome, MapColors>> = {
	badlands: ['#3d2922', '#bd9164'], tundra: ['#294657', '#abd2df'],
};

export const terrainMapColors = function (kind: TerrainObstacle['kind'], biome?: Biome): MapColors {
	if (kind === 'fissure' && biome) return fissureColors[biome] ?? obstacleColors.fissure;
	return obstacleColors[kind];
};
