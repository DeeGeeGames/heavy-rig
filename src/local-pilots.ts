import type { PlanetId } from './campaign-types';
import type { Pilot, PilotId } from './pilots';
import { isPlanetId, mixSeed, PLANETS, randomSource } from './universe';

// This registration format and its name tables identify the same person in saved rosters and reports.
type Registry = 'recruit' | 'recruit-v2';
export type LocalPilotId = `${Registry}:${number}:${PlanetId}:${number}`;
interface Registration { id: LocalPilotId; registry: Registry; seed: number; planetId: PlanetId; index: number }
/** Number of registrations already issued at each port when an older company first loads. */
export type LegacyRecruitSlots = Readonly<Partial<Record<PlanetId, number>>>;

const registrationId = function (registry: Registry, seed: number, planetId: PlanetId, index: number): LocalPilotId {
	return `${registry}:${seed}:${planetId}:${index}`;
};
export const readRegistration = function (value: unknown): Registration | undefined {
	if (typeof value !== 'string' || value.length > 54) return undefined;
	const [registry, seedText, planetId, indexText] = value.split(':');
	if ((registry !== 'recruit' && registry !== 'recruit-v2') || !isPlanetId(planetId)) return undefined;
	const seed = Number(seedText);
	const index = Number(indexText);
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(index) || index < 0 || index > 0xffffffff) return undefined;
	const id = registrationId(registry, seed, planetId, index);
	return id === value ? { id, registry, seed, planetId, index } : undefined;
};

const firstNames = {
	female: ['Adela', 'Anika', 'Bernice', 'Celia', 'Clara', 'Dalia', 'Elise', 'Farah', 'Frida', 'Hana', 'Ida', 'Imani', 'Iris', 'Jana', 'Leila', 'Lucia', 'Mae', 'Mei', 'Nadia', 'Noemi', 'Orla', 'Petra', 'Priya', 'Rosa', 'Selma', 'Sofia', 'Tess', 'Vera', 'Yara', 'Zora'],
	male: ['Alden', 'Andres', 'Arun', 'Bastian', 'Caleb', 'Dario', 'Elias', 'Enzo', 'Felix', 'Gabriel', 'Galen', 'Hadi', 'Hugo', 'Isaak', 'Jae', 'Jonas', 'Kian', 'Lev', 'Luca', 'Malik', 'Mateo', 'Micah', 'Nico', 'Omar', 'Pavel', 'Ronan', 'Sami', 'Tariq', 'Theo', 'Viktor'],
} as const;
const surnames = ['Abadi', 'Ahn', 'Alvarez', 'Bauer', 'Bell', 'Bishop', 'Carden', 'Chen', 'Costa', 'Das', 'Doyle', 'Ellis', 'Faure', 'Ferrer', 'Frey', 'Gale', 'Hart', 'Hassan', 'Holt', 'Ivanov', 'Jensen', 'Kim', 'Kline', 'Lau', 'Marin', 'Mercer', 'Mori', 'Navarro', 'Ortiz', 'Park', 'Patel', 'Petrov', 'Price', 'Quinn', 'Reyes', 'Shah', 'Tan', 'Torres', 'Vale', 'Ward'];
const radioPrefixes = ['Ash', 'Black', 'Blue', 'Brass', 'Cold', 'Copper', 'Dust', 'Frost', 'Gold', 'Grey', 'Iron', 'Jade', 'Night', 'Red', 'Slate', 'Wild'];
const radioNouns = ['Arrow', 'Bell', 'Blade', 'Bolt', 'Comet', 'Crest', 'Crow', 'Drum', 'Finch', 'Flare', 'Fox', 'Gale', 'Ghost', 'Gull', 'Hare', 'Hawk', 'Heron', 'Jackal', 'Jay', 'Kite', 'Lark', 'Lynx', 'Moth', 'Pike', 'Quill', 'Rail', 'Ray', 'Rook', 'Tern', 'Thorn', 'Torch', 'Wren'];
const word = function (pool: readonly string[], index: number): string {
	const item = pool[index % pool.length];
	if (!item) throw new Error('Missing pilot name');
	return item;
};

// Universe chart indices also seed saved contract terrain and are stable across visits.
const homeIndices = new Map(PLANETS.map(function (planet, index) { return [planet.id, index] as const; }));
const homeIndex = function (planetId: PlanetId) {
	const index = homeIndices.get(planetId);
	if (index === undefined) throw new RangeError(`Unknown recruitment board: ${planetId}`);
	return index;
};
const largestBoard = 5;
const boardSeed = function (seed: number, home: number): number { return mixSeed(seed ^ 0x43524557, home); };
const boardSize = function (seed: number, planetId: PlanetId): number { return 3 + boardSeed(seed, homeIndex(planetId)) % 3; };
export const registryForSlot = function (index: number, legacyCount = 0): Registry { return index < legacyCount ? 'recruit' : 'recruit-v2'; };

export const isLegacyRecruitSlots = function (value: unknown): value is LegacyRecruitSlots {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(function ([planet, count]) {
		return isPlanetId(planet) && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 0x100000000;
	});
};

export const snapshotLegacyRecruitSlots = function (seed: number, retired: ReadonlySet<PilotId>): LegacyRecruitSlots {
	const slots: Partial<Record<PlanetId, number>> = {};
	for (const { id } of PLANETS) {
		let issued = boardSize(seed, id);
		// Each past retirement opened one more registration on the original board.
		for (let index = 0; index < issued; index++) {
			if (retired.has(registrationId('recruit', seed, id, index))) issued++;
		}
		slots[id] = issued;
	}
	return slots;
};

export const localApplicants = function (seed: number, planetId: PlanetId, retired: ReadonlySet<PilotId>, legacySlots: LegacyRecruitSlots): readonly LocalPilotId[] {
	const count = boardSize(seed, planetId);
	const applicants: LocalPilotId[] = [];
	// A retired pilot frees a place at home. Active hires still occupy their original place.
	for (let index = 0; applicants.length < count; index++) {
		const id = registrationId(registryForSlot(index, legacySlots[planetId]), seed, planetId, index);
		if (!retired.has(id)) applicants.push(id);
	}
	return applicants;
};

export const registeredPilot = function ({ id, registry, seed, planetId, index }: Registration): Pilot {
	const home = homeIndex(planetId);
	const localSeed = boardSeed(seed, home);
	const random = randomSource(mixSeed(localSeed, index));
	const femaleChance = registry === 'recruit' ? .5 : .1;
	const gender = random() < femaleChance ? 'female' : 'male';
	const specialty = random() < .5 ? 'marksman' : 'skirmisher';
	// Permute names and radio identifiers across the chart. Each board reserves five distinct positions per intake.
	const series = Math.floor(index / largestBoard);
	const position = home * largestBoard + index % largestBoard;
	const nameCode = position * 53 + mixSeed(seed ^ 0x4e414d45, series);
	const name = `${word(firstNames[gender], Math.floor(nameCode / surnames.length))} ${word(surnames, nameCode)}`;
	const radioSeed = mixSeed(seed ^ 0x52414449, series);
	const stride = 2 * (radioSeed >>> 24) + 1;
	const radio = position * stride + radioSeed;
	const callsign = `${word(radioPrefixes, Math.floor(radio / radioNouns.length))} ${word(radioNouns, radio)}${series ? ` ${series + 1}` : ''}`;
	return {
		id, name, callsign, home: planetId, gender, specialty, leadership: 1 + Math.floor(random() * 5), price: 500,
		description: specialty === 'marksman' ? 'Tracks targets carefully and takes steadier shots.' : 'Moves more readily while engaging targets.',
	};
};
