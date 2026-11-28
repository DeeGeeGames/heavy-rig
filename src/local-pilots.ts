import type { PlanetId } from './campaign-types';
import type { Pilot, PilotId } from './pilots';
import { isPlanetId, mixSeed, PLANETS, randomSource } from './universe';

// This registration format and its name tables identify the same person in saved rosters and reports.
export type LocalPilotId = `recruit:${number}:${PlanetId}:${number}`;
interface Registration { id: LocalPilotId; seed: number; planetId: PlanetId; index: number }

const registrationId = function (seed: number, planetId: PlanetId, index: number): LocalPilotId {
	return `recruit:${seed}:${planetId}:${index}`;
};
export const readRegistration = function (value: unknown): Registration | undefined {
	if (typeof value !== 'string' || !value.startsWith('recruit:') || value.length > 54) return undefined;
	const [, seedText, planetId, indexText] = value.split(':');
	if (!isPlanetId(planetId)) return undefined;
	const seed = Number(seedText);
	const index = Number(indexText);
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(index) || index < 0 || index > 0xffffffff) return undefined;
	const id = registrationId(seed, planetId, index);
	return id === value ? { id, seed, planetId, index } : undefined;
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

export const localApplicants = function (seed: number, planetId: PlanetId, retired: ReadonlySet<PilotId>): readonly LocalPilotId[] {
	const count = 3 + boardSeed(seed, homeIndex(planetId)) % 3;
	const applicants: LocalPilotId[] = [];
	// A retired pilot frees a place at home. Active hires still occupy their original place.
	for (let index = 0; applicants.length < count; index++) {
		const id = registrationId(seed, planetId, index);
		if (!retired.has(id)) applicants.push(id);
	}
	return applicants;
};

export const registeredPilot = function ({ id, seed, planetId, index }: Registration): Pilot {
	const home = homeIndex(planetId);
	const localSeed = boardSeed(seed, home);
	const random = randomSource(mixSeed(localSeed, index));
	const gender = random() < .5 ? 'female' : 'male';
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
