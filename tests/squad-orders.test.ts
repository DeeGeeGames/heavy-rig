import { expect, test } from 'bun:test';
import { getWeapon } from '../src/arsenal';
import type { Contract } from '../src/campaign-types';
import { RIG_RADIUS } from '../src/combat-spatial';
import type { FieldTerrain } from '../src/field-terrain';
import { generateMissionMap } from '../src/missions';
import { createMissionState, distance, projectilesStep, squadmatesStep, squadMoveDestinations, type SquadmateOptions, type State, type Unit } from '../src/simulation';

const contract: Contract = { id: 'squad-orders', seed: 123, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Clear', briefing: 'Clear the site', reward: 100, favor: 8, hostility: 5, tier: 1, requiredReputation: -100 };
const mate: SquadmateOptions = { pilotId: 'rook', callsign: 'Rook', specialty: 'marksman', frameId: 'warden', loadout: [null, null, 'stream-rockets-4', null], reserves: [0, 0, 4, 0], integrity: 100 };
const dt = 1 / 60;

const advanceSquad = function (state: State) {
	state.time += dt;
	squadmatesStep(state, dt);
	projectilesStep(state, dt);
};

test('Hold Fire stops a live salvo and permits fire at only the designated contact until it is destroyed', function () {
	const map = { ...generateMissionMap(contract), terrain: { obstacles: [], roads: [] } };
	const state = createMissionState(contract, { map, squadmates: [mate] });
	const wing = state.squadmates[0];
	const mount = wing?.loadout[0];
	if (!wing || !mount) throw new Error('Missing armed squadmate');
	Object.assign(state.player, { x: 1000, y: 1000, angle: 0 });
	Object.assign(wing, { x: 880, y: 915, angle: 0, turret: 0 });
	const close: Unit = { id: state.nextId++, x: 1100, y: wing.y, hp: 1000, maxHp: 1000, kind: 'scout', heavy: false, angle: 0, cooldown: 3600 };
	const designated: Unit = { ...close, id: state.nextId++, x: wing.x + getWeapon(mount.weapon).range + 180 };
	state.enemies = [close, designated];
	advanceSquad(state);
	expect(wing.shotsFired).toBe(1);
	expect(mount.rocketVolley).toBeDefined();

	wing.fireDiscipline = 'hold';
	for (let tick = 0; tick < 120; tick++) advanceSquad(state);
	expect(wing.shotsFired).toBe(1);
	expect(mount.rocketVolley).toBeUndefined();
	close.y += 140;
	const originalCloseHp = close.hp;
	const initialDistance = distance(wing, designated);
	wing.order = { kind: 'attack', targetId: designated.id };
	advanceSquad(state);
	expect(wing.shotsFired).toBe(1);
	expect(wing.targetId).toBeUndefined();
	for (let tick = 0; tick < 600 && wing.shotsFired === 1; tick++) advanceSquad(state);
	expect(distance(wing, designated)).toBeLessThan(initialDistance);
	expect(wing.shotsFired).toBe(2);
	expect(wing.targetId).toBe(designated.id);
	expect(mount.rocketVolley).toBeDefined();

	designated.hp = 0;
	for (let tick = 0; tick < 120; tick++) advanceSquad(state);
	expect(wing.order).toBeUndefined();
	expect(wing.fireDiscipline).toBe('hold');
	expect(wing.shotsFired).toBe(2);
	expect(mount.rounds).toBe(2);
	expect(mount.rocketVolley).toBeUndefined();
	expect(close.hp).toBe(originalCloseHp);
});

test('a group waypoint routes around cover, stays clear of its other arrival slot, and holds through extraction', function () {
	const terrain: FieldTerrain = { obstacles: [{ kind: 'shed', x: 750, y: 500, width: 180, depth: 300, height: 120 }], roads: [] };
	const map = { ...generateMissionMap(contract), terrain };
	const state = createMissionState(contract, { map, squadmates: [mate, { ...mate, pilotId: 'kite', callsign: 'Kite' }] });
	const [wing, partner] = state.squadmates;
	const mission = state.mission;
	if (!wing || !partner || !mission) throw new Error('Missing squad or mission');
	state.enemies = [];
	Object.assign(wing, { x: 500, y: 490, angle: 0 });
	Object.assign(partner, { x: 500, y: 560, angle: 0 });
	const pilots = [wing.pilotId, partner.pilotId];
	expect(squadMoveDestinations(state, pilots, { x: 750, y: 500 })).toBeUndefined();
	expect(squadMoveDestinations(state, pilots, { x: 12, y: 500 })).toBeUndefined();
	const waypoint = { x: 1030, y: 500 };
	const destinations = squadMoveDestinations(state, pilots, waypoint);
	const first = destinations?.get(wing.pilotId);
	const second = destinations?.get(partner.pilotId);
	if (!first || !second) throw new Error('Expected distinct arrival slots');
	expect(first).toEqual(waypoint);
	expect(distance(first, second)).toBeGreaterThan(2 * RIG_RADIUS);
	wing.order = { kind: 'move', point: first };
	partner.order = { kind: 'move', point: second };
	mission.stage = 'extract';
	for (let tick = 0; tick < 1800; tick++) advanceSquad(state);
	expect(distance(wing, first)).toBeLessThan(20);
	expect(distance(partner, second)).toBeLessThan(20);
	expect(distance(wing, partner)).toBeGreaterThan(2 * RIG_RADIUS);
	expect(wing.speed).toBeLessThan(.01);
	expect(partner.speed).toBeLessThan(.01);
});

test('a move order lets an armed pilot clear cover within its waypoint radius and return when the contact is gone', function () {
	const terrain: FieldTerrain = { obstacles: [{ kind: 'shed', x: 970, y: 710, width: 42, depth: 56, height: 120 }], roads: [] };
	const state = createMissionState(contract, { map: { ...generateMissionMap(contract), terrain }, squadmates: [
		{ ...mate, frameId: 'morrow', loadout: ['cluster-missiles', 'cluster-missiles'], reserves: [12, 12] },
	] });
	const wing = state.squadmates[0];
	if (!wing) throw new Error('Missing missile squadmate');
	const point = { x: 900, y: 700 };
	Object.assign(wing, point, { angle: 0, turret: 0 });
	const target: Unit = { id: state.nextId++, x: 1120, y: 700, hp: 1000, maxHp: 1000, kind: 'scout', heavy: false, angle: 0, cooldown: 3600 };
	state.enemies = [target];

	wing.order = { kind: 'hold', point };
	for (let tick = 0; tick < 180; tick++) advanceSquad(state);
	expect(distance(wing, point)).toBe(0);
	expect(wing.shotsFired).toBe(0);
	wing.order = { kind: 'move', point };
	wing.fireDiscipline = 'hold';
	for (let tick = 0; tick < 180; tick++) advanceSquad(state);
	expect(distance(wing, point)).toBe(0);
	expect(wing.shotsFired).toBe(0);

	wing.fireDiscipline = 'free';
	let furthest = 0;
	for (let tick = 0; tick < 600; tick++) {
		advanceSquad(state);
		furthest = Math.max(furthest, distance(wing, point));
	}
	expect(furthest).toBeGreaterThan(20);
	expect(furthest).toBeLessThanOrEqual(2 * RIG_RADIUS + 1e-6);
	expect(target.hp).toBeLessThan(target.maxHp);
	expect(wing.order).toEqual({ kind: 'move', point });

	state.enemies = [];
	for (let tick = 0; tick < 600; tick++) advanceSquad(state);
	expect(distance(wing, point)).toBeLessThan(20);
	expect(wing.speed).toBeLessThan(.01);
});

test('an ordered missile rig moves around a blocking contact to acquire its designated target', function () {
	const map = { ...generateMissionMap(contract), terrain: { obstacles: [], roads: [] } };
	const state = createMissionState(contract, { map, squadmates: [
		{ ...mate, frameId: 'morrow', loadout: ['cluster-missiles', 'cluster-missiles'], reserves: [12, 12] },
	] });
	const wing = state.squadmates[0];
	if (!wing) throw new Error('Missing missile squadmate');
	Object.assign(wing, { x: 900, y: 700, angle: 0, turret: 0, fireDiscipline: 'hold' });
	const blocker: Unit = { id: state.nextId++, x: 1030, y: 700, hp: 1000, maxHp: 1000, kind: 'scout', heavy: false, angle: 0, cooldown: 3600 };
	const target: Unit = { ...blocker, id: state.nextId++, x: 1200 };
	state.enemies = [blocker, target];
	wing.order = { kind: 'attack', targetId: target.id };
	for (let tick = 0; tick < 600 && wing.shotsFired === 0; tick++) advanceSquad(state);
	expect(Math.abs(wing.y - 700)).toBeGreaterThan(RIG_RADIUS);
	expect(wing.shotsFired).toBeGreaterThan(0);
	expect(wing.targetId).toBe(target.id);
	expect(state.shots.filter(function (shot) { return shot.kind === 'missile'; }).map(function (shot) { return shot.target; })).not.toContain(blocker.id);
});
