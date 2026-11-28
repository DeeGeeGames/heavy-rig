import { expect, test } from 'bun:test';
import { createCampaign, parseSavedCompany, travelTo } from '../src/campaign';
import { changeRelationship, retireCouple } from '../src/pilot-relationships';
import { dismissPilot, getPilot, getRecruitOffers, hirePilot } from '../src/pilots';
import { PLANETS } from '../src/universe';

test('ports keep distinct applicants, and a dismissed hire can be rehired only at home after reloading', function () {
	const company = { ...createCampaign(317, 'career'), credits: 20_000 };
	const boards = PLANETS.map(function ({ id }) { return getRecruitOffers({ ...company, planetId: id }); });
	const pilots = boards.flat();
	expect(boards.every(function (board) { return board.length >= 3 && board.length <= 5; })).toBe(true);
	expect(new Set(pilots.map(function (pilot) { return pilot.id; })).size).toBe(pilots.length);
	expect(new Set(pilots.map(function (pilot) { return pilot.name; })).size).toBe(pilots.length);
	expect(new Set(pilots.map(function (pilot) { return pilot.callsign; })).size).toBe(pilots.length);
	const home = getRecruitOffers(company);
	const [pilot] = home;
	if (!pilot) throw new Error('Missing applicant');
	expect(getRecruitOffers(createCampaign(318)).map(function (entry) { return entry.name; })).not.toEqual(home.map(function (entry) { return entry.name; }));
	const away = travelTo(hirePilot(company, pilot.id), 'cinder');
	expect(away.planetId).toBe('cinder');
	const released = dismissPilot(away, pilot.id);
	expect(hirePilot(released, pilot.id)).toBe(released);
	const loaded = parseSavedCompany(JSON.parse(JSON.stringify(released)));
	if (!loaded) throw new Error('Dismissal corrupted the company save');
	const returned = travelTo(loaded, 'meridian');
	expect(getRecruitOffers(returned)).toEqual(home);
	expect(getPilot(pilot.id)).toEqual(pilot);
	expect(hirePilot(returned, pilot.id).pilots).toContain(pilot.id);
});

test('a retiring couple permanently frees one local recruiting place on each home world', function () {
	const start = { ...createCampaign(1, 'career'), credits: 20_000 };
	const homeBoard = getRecruitOffers(start);
	const first = homeBoard.find(function (candidate) { return candidate.gender === 'male'; });
	if (!first) throw new Error('Expected a male Meridian recruit for this company');
	const arrival = travelTo(hirePilot(start, first.id), 'cinder');
	const nextBoard = getRecruitOffers(arrival);
	const second = nextBoard.find(function (candidate) { return candidate.gender === 'female'; });
	if (!second) throw new Error('Expected a female Cinder recruit for this company');
	const hired = hirePilot(arrival, second.id);
	const dating = changeRelationship(hired, first.id, second.id, 1, 'dating');
	const committed = changeRelationship(dating, first.id, second.id, 1, 'committed');
	const retired = retireCouple(committed, first.id, second.id);
	const saved = parseSavedCompany(JSON.parse(JSON.stringify(retired)));
	if (!saved) throw new Error('Could not reload the retired couple');
	expect(saved.pilots).toEqual(['player']);
	expect(getRecruitOffers(saved)).toHaveLength(nextBoard.length);
	expect(getRecruitOffers(saved)).toEqual(expect.arrayContaining(nextBoard.filter(function (pilot) { return pilot.id !== second.id; })));
	expect(hirePilot(saved, second.id)).toBe(saved);
	const home = travelTo(saved, 'meridian');
	expect(getRecruitOffers(home)).toHaveLength(homeBoard.length);
	expect(getRecruitOffers(home)).toEqual(expect.arrayContaining(homeBoard.filter(function (pilot) { return pilot.id !== first.id; })));
	expect(hirePilot(home, first.id)).toBe(home);
});

test('fresh hiring boards draw about one female applicant in ten across campaign seeds', function () {
	let female = 0;
	let total = 0;
	for (let index = 0; index < 64; index++) {
		const company = createCampaign(Math.imul(index, 0x9e3779b1) >>> 0);
		for (const { id } of PLANETS) {
			const offers = getRecruitOffers({ ...company, planetId: id });
			female += offers.filter(function (pilot) { return pilot.gender === 'female'; }).length;
			total += offers.length;
		}
	}
	expect(female / total).toBeCloseTo(.10, 2);
});

test('an older company keeps its prior replacements and partners, then fills new vacancies under the new odds', function () {
	const a = 'recruit:317:meridian:3';
	const b = 'recruit:317:meridian:4'; // A replacement already offered before the update.
	const oldSave = {
		...createCampaign(317, 'career'), legacyRecruitSlots: undefined, credits: 20_000, pilots: ['player', a, b],
		relationships: [
			{ a: 'recruit:317:meridian:0', b: 'recruit:317:meridian:1', affinity: 2, romance: 'retired' },
			{ a, b, affinity: 2, romance: 'committed' },
		],
	};
	const company = parseSavedCompany(JSON.parse(JSON.stringify(oldSave)));
	if (!company) throw new Error('Could not load a company with a previously retired couple');
	expect(getPilot(b)).toMatchObject({ name: 'Petra Lau', gender: 'female' });
	expect(getRecruitOffers(dismissPilot(company, b))).toContainEqual(getPilot(b));
	expect(getRecruitOffers({ ...company, planetId: 'cinder' })[0]).toMatchObject({ name: 'Priya Tan', gender: 'female' });
	const retired = retireCouple(company, a, b);
	const offers = getRecruitOffers(retired);
	expect(offers.map(function ({ id, gender }) { return [id, gender]; })).toEqual([
		['recruit:317:meridian:2', 'female'], ['recruit:317:meridian:5', 'male'],
		['recruit-v2:317:meridian:6', 'male'], ['recruit-v2:317:meridian:7', 'male'],
	]);
	const reloaded = parseSavedCompany(JSON.parse(JSON.stringify(retired)));
	if (!reloaded) throw new Error('Could not reload the updated board');
	expect(getRecruitOffers(reloaded)).toEqual(offers);
});

test('a dismissed pilot from a legacy save can rejoin their partner at home, including before their first win', function () {
	const company = { ...createCampaign(317, 'career'), pilots: ['player', 'kite', 'flint'] as const, credits: 10_000 };
	const dating = changeRelationship(company, 'kite', 'flint', 1, 'dating');
	const released = dismissPilot(travelTo(dating, 'cinder'), 'flint');
	expect(hirePilot(released, 'flint')).toBe(released);
	const loaded = parseSavedCompany(JSON.parse(JSON.stringify(released)));
	if (!loaded) throw new Error('Dismissed veteran could not reload');
	const home = travelTo(loaded, 'meridian');
	expect(getRecruitOffers(home).some(function (pilot) { return pilot.id === 'flint'; })).toBe(true);
	const reunited = hirePilot(home, 'flint');
	const committed = changeRelationship(reunited, 'flint', 'kite', 1, 'committed');
	expect(retireCouple(committed, 'flint', 'kite').pilots).toEqual(['player']);
});
