import type { Biome, Contract } from './campaign-types';
import type { TerrainObstacle } from './field-terrain';

interface CompoundDefinition {
	readonly name: string;
	readonly buildings: readonly TerrainObstacle[];
}

type Building = readonly [
	kind: 'shed' | 'housing' | 'hangar' | 'tank-bank' | 'wall',
	x: number, y: number, width: number, depth: number, height: number,
];

const compound = function (name: string, buildings: readonly Building[]): CompoundDefinition {
	return { name, buildings: buildings.map(function ([kind, x, y, width, depth, height]) {
		return { kind, x, y, width, depth, height };
	}) };
};

// Offsets in metres from the objective. The yard stays open around the
// target, with building frontages grouped into banks instead of a closed ring.
const raid = [
	compound('Tank farm', [
		// Twin tank rows share the north apron. Workshops sit across the yard.
		['tank-bank', -174, -225, 164, 76, 80], ['tank-bank', 154, -225, 172, 82, 88],
		['tank-bank', -345, 137, 78, 126, 72], ['tank-bank', 294, 136, 76, 126, 76],
		['shed', -160, 201, 131, 81, 56], ['hangar', 148, 295, 176, 66, 78],
	]),
	compound('Freight depot', [
		// Long loading sheds flank the haul route, with an offset dispatch wing.
		['hangar', -188, -199, 202, 82, 86], ['hangar', 161, -215, 216, 88, 90],
		['hangar', -162, 226, 195, 94, 81], ['shed', 209, 239, 124, 90, 66],
		['housing', 319, -31, 88, 98, 90], ['wall', -304, 104, 94, 18, 32],
	]),
	compound('Isolated transfer station', [
		// The L-shaped service spine leaves most of the site open to the field.
		['hangar', 43, -221, 159, 88, 73], ['shed', 249, -221, 118, 74, 56],
		['tank-bank', 268, -33, 86, 121, 66], ['housing', -174, 186, 94, 79, 80],
	]),
] as const;

const evacuationDispatch = compound('Evacuation dispatch', [
	// Habitation and reception face the relay square. A pair of vaulted
	// shelters makes a separate staging wing with an open lane between them.
	['housing', -184, -220, 102, 94, 102], ['housing', 54, -225, 123, 88, 88],
	['shed', 285, -149, 100, 89, 72], ['hangar', 218, 169, 94, 168, 83],
	['hangar', -199, 210, 95, 175, 83], ['tank-bank', 116, 355, 103, 72, 58],
]);

const defense: Readonly<Record<Biome, CompoundDefinition>> = {
	badlands: compound('Frontier relay yard', [
		['housing', -181, -206, 130, 86, 89], ['shed', 62, -213, 145, 81, 62],
		['tank-bank', 284, -88, 82, 135, 72], ['shed', 192, 189, 141, 83, 65],
		['wall', -241, 174, 127, 21, 31],
	]),
	volcanic: compound('Ashfall service post', [
		['hangar', -165, -218, 193, 102, 84], ['shed', 166, -209, 121, 81, 72],
		['tank-bank', -266, -8, 89, 106, 71], ['tank-bank', -251, 176, 86, 116, 77],
		['housing', 161, 199, 107, 85, 89],
	]),
	tundra: compound('Listening post', [
		// A compact heated row and short windbreaks leave the east apron clear.
		['housing', -171, -212, 106, 82, 106], ['shed', 125, -205, 125, 80, 71],
		['hangar', -247, -40, 87, 115, 78], ['tank-bank', -182, 185, 122, 82, 59],
		['wall', 265, -212, 18, 110, 37], ['wall', 149, 197, 113, 18, 32],
	]),
	wetlands: compound('Pump station', [
		// Raised pump sheds and overflow tanks form two banks along a dry lane.
		['shed', -170, -217, 141, 91, 82], ['shed', 121, -205, 120, 78, 75],
		['tank-bank', -183, 194, 149, 78, 74], ['tank-bank', 72, 223, 136, 79, 74],
		['shed', 284, 114, 99, 82, 66],
	]),
	forest: compound('Timber yard', [
		// The mill and timber barns look inward over a broad log-handling yard.
		['shed', -162, -208, 169, 98, 75], ['shed', 114, -229, 163, 102, 72],
		['hangar', -179, 227, 181, 85, 71], ['housing', 117, 218, 104, 83, 81],
		['shed', 294, -32, 92, 119, 65],
	]),
	steppe: compound('Wind service yard', [
		['hangar', -218, -97, 92, 196, 76], ['hangar', 222, -142, 91, 169, 83],
		['housing', -216, 151, 90, 111, 84], ['tank-bank', 222, 155, 79, 113, 64],
		['wall', 30, -267, 124, 17, 29],
	]),
	crystal: compound('Quartz survey camp', [
		['housing', 183, -198, 119, 101, 96], ['hangar', 269, 12, 84, 157, 73],
		['tank-bank', 164, 232, 135, 89, 64], ['housing', -131, 204, 126, 79, 82],
		['wall', -203, -152, 106, 19, 33],
	]),
};

const demolition: Readonly<Record<Biome, CompoundDefinition>> = {
	badlands: compound('Water treatment works', [
		['tank-bank', -161, -193, 142, 81, 84], ['tank-bank', 137, -196, 156, 88, 89],
		['shed', -255, 18, 111, 112, 75], ['hangar', 183, 182, 175, 83, 78],
		['tank-bank', -152, 232, 147, 81, 71], ['wall', 300, -148, 18, 125, 31],
	]),
	volcanic: compound('Smelter service yard', [
		['hangar', -184, -239, 211, 98, 95], ['tank-bank', 155, -231, 183, 94, 86],
		['shed', -266, -39, 103, 107, 80], ['shed', -266, 147, 107, 120, 77],
		['hangar', 137, 202, 174, 85, 91], ['tank-bank', 324, 202, 72, 72, 66],
	]),
	tundra: compound('Polar relay works', [
		['hangar', -163, -224, 185, 83, 91], ['shed', 137, -232, 151, 86, 76],
		['shed', 291, -84, 82, 76, 76], ['tank-bank', 276, 101, 83, 116, 74],
		['housing', -173, 193, 121, 87, 95], ['wall', 101, 201, 104, 19, 34],
	]),
	wetlands: compound('Tidal filtration works', [
		['shed', -233, -123, 104, 132, 91], ['shed', -233, 118, 104, 114, 84],
		['tank-bank', 219, -129, 91, 139, 81], ['tank-bank', 219, 78, 88, 144, 81],
		['hangar', -126, 292, 148, 84, 76], ['wall', 167, 270, 110, 18, 32],
	]),
	forest: compound('Sawmill works', [
		['shed', -155, -219, 208, 107, 87], ['shed', 153, -221, 192, 101, 79],
		['hangar', -246, -20, 94, 158, 79], ['shed', -246, 190, 92, 126, 73],
		['tank-bank', 166, 191, 144, 82, 67], ['housing', 363, -102, 100, 90, 82],
	]),
	steppe: compound('Grid substation', [
		['tank-bank', -174, -196, 156, 76, 79], ['tank-bank', 145, -193, 159, 74, 79],
		['hangar', -175, 201, 179, 85, 76], ['tank-bank', 241, 149, 85, 127, 71],
		['wall', 302, -116, 17, 151, 37], ['wall', 117, 285, 117, 20, 32],
	]),
	crystal: compound('Quartz grading works', [
		['hangar', -200, -142, 91, 188, 84], ['hangar', -192, 151, 87, 190, 79],
		['hangar', 165, -210, 176, 96, 87], ['tank-bank', 232, 141, 101, 145, 68],
		['housing', 357, -109, 81, 98, 87], ['wall', 114, 297, 105, 19, 33],
	]),
};

export const compoundFor = function (contract: Contract, biome: Biome, index: number): CompoundDefinition | undefined {
	if (contract.kind === 'raid') return raid[index];
	if (index !== 0) return undefined;
	if (contract.kind === 'defend' && contract.planetId !== 'meridian') {
		return contract.planetId === 'cinder' ? evacuationDispatch : defense[biome];
	}
	if (contract.kind === 'demolition' && contract.planetId !== 'cinder') return demolition[biome];
	return undefined;
};
