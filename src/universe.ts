import type { Biome, FactionId, PlanetId } from './campaign-types';

export interface PlanetDefinition {
	id: PlanetId;
	name: string;
	description: string;
	biome: Biome;
	color: string;
	x: number;
	y: number;
}
export const FACTION_IDS: readonly FactionId[] = ['freeholds', 'combine', 'accord'];
export interface TerritoryInfluence { planetId: PlanetId; factionId: FactionId; value: number }
export interface UniverseState {
	influence: readonly TerritoryInfluence[];
	boardDay: number;
	boardVersion: 1 | 2;
}
export interface TerritoryContext { seed: number; day: number; universe: UniverseState }
export interface SystemIntel {
	owner: FactionId | undefined;
	participants: readonly FactionId[];
	conflict: boolean;
}
export const FACTION_CENTERS: Readonly<Record<FactionId, { x: number; y: number }>> = {
	freeholds: { x: 25, y: 32 }, combine: { x: 74, y: 32 }, accord: { x: 51, y: 76 },
};
const BIOMES: readonly Biome[] = ['badlands', 'volcanic', 'tundra'];
const COLORS: Readonly<Record<Biome, string>> = { badlands: '#d9ac78', volcanic: '#e77b5d', tundra: '#9bd6e6' };
export const randomSource = function (seed: number) {
	let value = seed >>> 0;
	return function () { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
};
const generateSystems = function (): readonly PlanetDefinition[] {
	const random = randomSource(0x48455659);
	const anchors: PlanetDefinition[] = [
		{ id: 'meridian', name: 'Meridian', description: 'Dust plains and relay yards on the contested water routes.', biome: 'badlands', color: COLORS.badlands, x: 40, y: 48 },
		{ id: 'cinder', name: 'Cinder', description: 'Volcanic flats and ore processors at the industrial frontier.', biome: 'volcanic', color: COLORS.volcanic, x: 61, y: 48 },
		{ id: 'borealis', name: 'Borealis', description: 'Frozen basins and listening posts above the southern marches.', biome: 'tundra', color: COLORS.tundra, x: 50, y: 62 },
	];
	const names = ['Ashfall', 'Vesper', 'Harrow', 'Solace', 'Redoubt', 'Kestrel', 'Nacre', 'Orison', 'Ember', 'Drift', 'Talus', 'Haven'];
	const suffixes = ['Reach', 'Gate', 'Crossing', 'Deep', 'Station', 'Fall'];
	const generated = Array.from({ length: 72 }, function (_, index): PlanetDefinition {
		const biome = BIOMES[Math.floor(random() * BIOMES.length)] ?? 'badlands';
		return {
			id: `system-${index}`, name: `${names[index % names.length]} ${suffixes[Math.floor(index / names.length)]}`,
			description: biome === 'badlands' ? 'Dry settlement belts, aquifers, and overland supply routes.' : biome === 'volcanic' ? 'Ore seams, foundry settlements, and exposed processing plants.' : 'Ice fields, isolated outposts, and long-range relay installations.',
			biome, color: COLORS[biome], x: 5 + index % 12 * 8 + random() * 4, y: 8 + Math.floor(index / 12) * 15 + random() * 6,
		};
	}).filter(function (world) { return !anchors.some(function (anchor) { return Math.hypot(anchor.x - world.x, anchor.y - world.y) < 6; }); });
	return [...anchors, ...generated];
};
// A shared seeded chart keeps names and surface biomes stable across companies.
// Each company's seed, calendar, and mission influence determine its frontiers.
export const PLANETS = generateSystems();
const planets = new Map(PLANETS.map(function (world) { return [world.id, world]; }));
export const isPlanetId = function (value: unknown): value is PlanetId { return typeof value === 'string' && PLANETS.some(function (world) { return world.id === value; }); };
export const getPlanet = function (id: PlanetId): PlanetDefinition {
	const planet = planets.get(id);
	if (!planet) throw new Error(`Unknown system: ${id}`);
	return planet;
};
export const createUniverse = function (): UniverseState { return { influence: [], boardDay: 1, boardVersion: 2 }; };

export const territoryScores = function (context: TerritoryContext, x: number, y: number): Readonly<Record<FactionId, number>> {
	const phase = context.seed / 0xffffffff * Math.PI * 2;
	const warpedX = x + 2.5 * Math.sin(y * .21 + phase) + 1.2 * Math.sin(y * .61 - x * .13);
	const warpedY = y + 2.5 * Math.sin(x * .19 - phase) + 1.2 * Math.cos(x * .54 + y * .16);
	const score = function (id: FactionId, index: number) {
		const center = FACTION_CENTERS[id];
		const local = context.universe.influence.filter(function (entry) { return entry.factionId === id; }).reduce(function (sum, entry) {
			const world = getPlanet(entry.planetId);
			return sum + entry.value * Math.exp(-((x - world.x) ** 2 + (y - world.y) ** 2) / 100);
		}, 0);
		// Calendar movement is bounded. Mission influence persists and is local.
		return 35 - Math.hypot(warpedX - center.x, warpedY - center.y)
			+ 3 * Math.sin((context.day - 1) / 12 + phase + index * 2.1)
			+ Math.max(-18, Math.min(18, local));
	};
	return { freeholds: score('freeholds', 0), combine: score('combine', 1), accord: score('accord', 2) };
};
export const getSystemIntel = function (context: TerritoryContext, planetId: PlanetId): SystemIntel {
	const world = getPlanet(planetId);
	const scores = territoryScores(context, world.x, world.y);
	const ranked = [...FACTION_IDS].sort(function (a, b) { return scores[b] - scores[a]; });
	const first = ranked[0] ?? 'freeholds'; const second = ranked[1] ?? 'combine';
	const owner = scores[first] >= 0 ? first : undefined;
	const conflict = scores[second] > -9 && scores[first] - scores[second] < 18;
	return { owner, conflict, participants: conflict ? [first, second] : owner ? [owner] : [] };
};
export const applyMissionInfluence = function (universe: UniverseState, planetId: PlanetId, employer: FactionId, opponent: FactionId, won: boolean): UniverseState {
	const changes = [{ factionId: employer, delta: won ? 6 : -3 }, { factionId: opponent, delta: won ? -6 : 3 }];
	const retained = universe.influence.filter(function (entry) { return entry.planetId !== planetId || !changes.some(function (change) { return change.factionId === entry.factionId; }); });
	return { ...universe, influence: [...retained, ...changes.map(function (change) {
		const prior = universe.influence.find(function (entry) { return entry.planetId === planetId && entry.factionId === change.factionId; })?.value ?? 0;
		return { planetId, factionId: change.factionId, value: Math.max(-18, Math.min(18, prior + change.delta)) };
	})] };
};
