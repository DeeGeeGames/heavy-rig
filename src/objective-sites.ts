import type { Contract } from './campaign-types';
import type { ObjectiveSite, TerrainObstacle } from './field-terrain';
import type { Point } from './simulation';

// Survey coordinates in metres relative to the relay or processor. The main
// approach arrives from the west and the second crossing is to the south.
type Position = readonly [east: number, south: number];
type Street = readonly Position[];
type Building = readonly [kind: 'housing' | 'shed' | 'hangar' | 'tank-bank' | 'wall', east: number, south: number, width: number, depth: number, height: number];
interface SitePlan {
	kind: ObjectiveSite['kind'];
	bounds: { west: number; north: number; width: number; depth: number };
	buildings: readonly Building[];
	avenue: Street;
	service: Street;
	streets: readonly Street[];
	defenseStreet?: Street;
}

const city: SitePlan = {
	kind: 'city', bounds: { west: -1024, north: -560, width: 1832, depth: 1104 },
	buildings: [
		// The north blocks leave a two-block landing square on the relay's street.
		['housing', -909, -409, 147, 96, 79], ['shed', -645, -395, 132, 92, 51],
		['housing', 123, -406, 119, 112, 95], ['housing', 359, -399, 130, 77, 81],
		['shed', 668, -411, 160, 88, 50],
		// Shop fronts and apartments line both sides of the main avenue.
		['housing', -908, -127, 145, 85, 87], ['shed', -907, 128, 144, 97, 53],
		['housing', -650, -137, 132, 99, 91], ['housing', -651, 125, 133, 91, 74],
		['housing', -408, -131, 148, 85, 86], ['shed', -409, 122, 143, 93, 51],
		['housing', -171, -134, 84, 126, 102], ['housing', -145, 159, 133, 56, 83],
		['shed', 130, -167, 112, 68, 58], ['housing', 132, 154, 114, 50, 94],
		['housing', 336, -122, 80, 126, 89], ['shed', 337, 128, 82, 107, 48],
		['housing', 658, -128, 153, 99, 86], ['housing', 674, 128, 141, 88, 102],
		// A second residential street wraps around the south side of the square.
		['shed', -903, 369, 140, 89, 48], ['housing', -648, 369, 122, 105, 82],
		['housing', -399, 382, 110, 89, 91], ['shed', -139, 368, 142, 91, 53],
		['housing', 125, 370, 121, 107, 75], ['housing', 361, 377, 132, 98, 96],
		['shed', 667, 381, 159, 98, 55],
	],
	avenue: [[-1000, 0], [-531, 0], [0, 0]],
	service: [[-1000, 505], [-773, 505], [-773, 238], [0, 238], [0, 0]],
	defenseStreet: [[-267, -252], [0, -252], [0, 0], [0, 505]],
	streets: [
		[[-773, -525], [-773, 238]], [[-531, -525], [-531, 505]],
		[[-267, -252], [-267, 505]], [[0, -525], [0, -252]],
		[[237, -525], [237, 505]], [[490, -525], [490, 505]],
		[[-1000, -252], [-267, -252]], [[0, -252], [780, -252]],
		[[0, 0], [780, 0]], [[0, 238], [780, 238]], [[-773, 505], [780, 505]],
	],
};

const garrison: SitePlan = {
	kind: 'garrison', bounds: { west: -909, north: -516, width: 1398, depth: 1076 },
	buildings: [
		// A motor pool flanks the west gate. A second apron serves the north gate.
		['hangar', -716, -129, 194, 94, 82], ['hangar', -705, 150, 187, 99, 80],
		['tank-bank', -696, -385, 157, 82, 70], ['hangar', -316, -390, 197, 88, 81],
		['shed', -38, -390, 147, 77, 54], ['tank-bank', 349, -389, 91, 78, 66],
		['hangar', -242, 102, 192, 84, 83], ['shed', -254, -131, 170, 96, 62],
		['tank-bank', 29, -171, 153, 74, 72], ['shed', 169, 79, 70, 106, 45],
		['hangar', 283, -139, 164, 86, 76], ['tank-bank', 325, 174, 123, 77, 68],
		// Stores and maintenance bays line the service road behind the processor.
		['shed', -745, 432, 160, 73, 53], ['hangar', -311, 438, 180, 84, 79],
		['shed', -35, 441, 140, 78, 49], ['tank-bank', 281, 435, 152, 72, 72],
		['wall', -873, -284, 18, 408, 36], ['wall', -873, 310, 18, 444, 36],
		['wall', -394, -488, 976, 18, 32], ['wall', 381, -488, 182, 18, 32],
		['wall', 463, -295, 18, 386, 36], ['wall', 463, 310, 18, 444, 36],
		['wall', -745, 532, 274, 18, 34], ['wall', 18, 532, 908, 18, 34],
	],
	avenue: [[-951, 0], [-520, 0], [0, 0]],
	service: [[-951, 609], [-523, 609], [-523, 339], [50, 339], [50, 129], [0, 0]],
	streets: [[[-520, 0], [-520, -280], [195, -280], [195, -485]]],
};

export const objectiveSitePlan = function (contract: Contract) {
	return contract.planetId === 'meridian' && contract.kind === 'defend' ? city
		: contract.planetId === 'cinder' && contract.kind === 'demolition' ? garrison : undefined;
};

export const placeObjectiveSite = function (plan: SitePlan, point: (east: number, south: number) => Point,
	size: (width: number, depth: number) => Pick<TerrainObstacle, 'width' | 'depth'>) {
	const street = function (positions: Street) { return positions.map(function ([x, y]) { return point(x, y); }); };
	const { west, north, width, depth } = plan.bounds;
	const site: ObjectiveSite = { kind: plan.kind, ...point(west + width / 2, north + depth / 2), ...size(width, depth) };
	const buildings = plan.buildings.map(function ([kind, x, y, width, depth, height]): TerrainObstacle {
		return { kind, ...point(x, y), ...size(width, depth), height };
	});
	return { site, buildings, avenue: street(plan.avenue), service: street(plan.service), streets: plan.streets.map(street),
		defenseStreet: plan.defenseStreet && street(plan.defenseStreet) };
};
