import * as v from 'valibot';
import type { WeaponMount } from './arsenal';
import type { Campaign } from './campaign';
import type { Contract, MissionRuntime, MissionStructure } from './campaign-types';
import { getOwnedMech, type Deployment, type OwnedMech } from './company';
import type { DropFlight } from './enemy-deployment';
import { ACQUISITION_SECONDS, BEACON_SECONDS, EXTRACTION_SECONDS, missionHostileCount, RECOVERY_SECONDS, type MissionSpawn } from './missions';
import { WAVES } from './operation';
import { getPilot, getPilotStats } from './pilots';
import { rigFrameId } from './rigs';
import { createMissionState, createState, type CombatStateView, type Point, type State, type Warning } from './simulation';
import { sortieSchema } from './sortie-checkpoint-schema';

export type SortieCheckpoint = v.InferOutput<typeof sortieSchema>;

export const captureSortie = function (state: CombatStateView, deployed?: Deployment): SortieCheckpoint {
	const mission = state.mission;
	if (!mission) throw new Error('A sortie checkpoint needs an active contract');
	const flights: DropFlight[] = [];
	const warnings = state.warnings.map(function (warning) {
		if (!warning.drop) return warning;
		const { flight, lane, delay } = warning.drop;
		let index = flights.indexOf(flight);
		if (index === -1) index = flights.push(flight) - 1;
		return { ...warning, drop: { flight: index, lane, delay } };
	});
	const { contract, map: _map, ...objective } = mission;
	// Read the ECS-backed getters at the fixed-step boundary. The map is seeded,
	// the single-beam getter is derived, and the event queue has already played.
	const { mission: _mission, beam: _beam, events: _events, ...combat } = state;
	const snapshot = {
		...combat, version: 1, contractId: contract.id, contractKind: contract.kind, mission: objective,
		...(deployed ? { rigs: { commander: deployed.frameId, wing: deployed.wing.map(function (member) { return member.frameId; }) } } : {}),
		warnings, flights: flights.map(function ({ field: _field, ...flight }) { return flight; }),
	};
	// JSON normalizes explicitly absent fields in component facades. The schema
	// owns a detached copy, including nested mounts, orders and animations.
	const json: unknown = JSON.parse(JSON.stringify(snapshot));
	return v.parse(sortieSchema, json);
};

// A failed checkpoint must leave the last durable transaction available. The
// browser can keep combat running and surface the failure at its save controls.
export const tryCaptureSortie = function (state: CombatStateView, deployed?: Deployment): SortieCheckpoint | undefined {
	try { return captureSortie(state, deployed); } catch { return undefined; }
};

const matchesLoadout = function (mounts: readonly WeaponMount[], mech: OwnedMech | undefined): boolean {
	if (!mech || mounts.length !== mech.loadout.filter(function (id) { return id !== null; }).length) return false;
	return mounts.every(function (mount, index) {
		const slot = mount.slot ?? index;
		const reserve = mech.reserves[slot];
		return mech.loadout[slot] === mount.weapon && reserve !== undefined && mount.rounds <= reserve;
	});
};

const matchesCompany = function (saved: SortieCheckpoint, company: Campaign): boolean {
	const deployed = company.deployed, rigs = saved.rigs;
	if (!deployed || !rigs || company.active?.id !== saved.contractId || company.active.seed !== saved.seed || saved.frame !== rigFrameId(deployed.frameId)
		|| saved.player.hp !== deployed.integrity || saved.coolantCharges !== deployed.coolantCharges
		|| saved.squadmates.length !== deployed.wing.length || !matchesLoadout(saved.loadout, getOwnedMech(company, deployed.frameId))) return false;
	if (rigs.commander !== deployed.frameId || rigs.wing.length !== deployed.wing.length) return false;
	return saved.squadmates.every(function (mate, index) {
		const wing = deployed.wing[index];
		if (!wing || wing.pilotId !== mate.pilotId || rigs.wing[index] !== wing.frameId
			|| mate.frameId !== rigFrameId(wing.frameId) || mate.hp !== wing.integrity) return false;
		const pilot = getPilot(wing.pilotId);
		return mate.specialty === pilot.specialty && mate.callsign === pilot.callsign && (mate.experienceBonus ?? 0) === getPilotStats(company, wing.pilotId).bonus
			&& matchesLoadout(mate.loadout, getOwnedMech(company, wing.frameId));
	});
};

const matchesContract = function (s: SortieCheckpoint, contract: Contract): boolean {
	const { mission, warnings } = s;
	const raid = contract.kind === 'raid', recovery = contract.kind === 'recovery', acquisition = contract.kind === 'acquisition';
	const defense = contract.kind === 'defend';
	const required = defense ? missionHostileCount(contract) : contract.kind === 'clearance' ? s.spawned : raid || acquisition ? 3 : 1;
	const loss = s.player.hp === 0 || (defense && s.relay === 0) || (acquisition && mission.acquisitionTime === 0);
	if (s.contractId !== contract.id || s.contractKind !== contract.kind || s.seed !== contract.seed || s.wave > WAVES.length
		|| loss !== (s.outcome === 'lost') || mission.required !== required || (defense && s.spawned > required)
		|| s.spawned !== s.enemies.length + s.kills + warnings.length || s.kills !== s.wrecks.length
		|| (s.outcome === 'won' && (mission.stage !== 'extract' || mission.extractTime !== EXTRACTION_SECONDS))
		|| mission.extractTime > EXTRACTION_SECONDS || (mission.stage === 'extract' && mission.progress < mission.required)) return false;
	if ((mission.structure !== undefined) !== (contract.kind === 'demolition') || mission.raidTargets?.length !== (raid ? 3 : undefined)
		|| mission.captureSites?.length !== (recovery ? 1 : acquisition ? 3 : undefined) || (mission.acquisitionTime !== undefined) !== acquisition
		|| (contract.kind === 'assassination' && mission.targetId === undefined)
		|| (!defense && (mission.defenseArrivalRadius !== undefined || warnings.length > 0))) return false;
	const hold = recovery ? RECOVERY_SECONDS : BEACON_SECONDS;
	if (mission.captureSites?.some(function (site) { return site.holdTime > hold || site.complete !== (site.holdTime === hold); })
		|| (mission.acquisitionTime !== undefined && mission.acquisitionTime > ACQUISITION_SECONDS)) return false;
	const ids = [...s.enemies, ...s.strikes].map(function (entity) { return entity.id; });
	if (new Set(ids).size !== ids.length || ids.some(function (id) { return id >= s.nextId; })
		|| new Set(s.squadmates.map(function (mate) { return mate.pilotId; })).size !== s.squadmates.length) return false;
	return warnings.every(function (warning) { return !warning.drop || warning.drop.flight < s.flights.length; });
};

const sameSite = function (site: Point | undefined, expected: Point | undefined): boolean {
	return site?.x === expected?.x && site?.y === expected?.y;
};
const sameStructure = function (site: MissionStructure | undefined, expected: MissionStructure | undefined): boolean {
	return site?.maxHp === expected?.maxHp && sameSite(site, expected);
};
const matchesBattlefield = function (saved: SortieCheckpoint, initial: State): boolean {
	const original = initial.mission, objective = saved.mission;
	if (!original || initial.frame !== saved.frame || initial.difficulty !== saved.difficulty
		|| (saved.contractKind !== 'defend' && saved.spawned !== initial.spawned)
		|| objective.required !== original.required || objective.targetId !== original.targetId
		|| (objective.defenseArrivalRadius !== undefined && objective.defenseArrivalRadius !== original.defenseArrivalRadius)
		|| !sameStructure(objective.structure, original.structure)) return false;
	return !objective.raidTargets?.some(function (site, index) { return !sameStructure(site, original.raidTargets?.[index]); })
		&& !objective.captureSites?.some(function (site, index) { return !sameSite(site, original.captureSites?.[index]); });
};

export const sortieMatchesCompany = function (saved: SortieCheckpoint, company: Campaign): boolean {
	return Boolean(company.active && matchesContract(saved, company.active) && matchesCompany(saved, company));
};

export const parseSortieCheckpoint = function (value: unknown, contract: Contract, company?: Campaign): SortieCheckpoint | undefined {
	const result = v.safeParse(sortieSchema, value, { abortEarly: true });
	if (!result.success || !matchesContract(result.output, contract) || (company && !matchesCompany(result.output, company))) return undefined;
	// The seed fixes the original garrison and site geometry. Check these while
	// choosing a primary/backup, before accepting an otherwise coherent world.
	const initial = createMissionState(contract, { frame: result.output.frame, difficulty: result.output.difficulty });
	return matchesBattlefield(result.output, initial) ? result.output : undefined;
};

const restoreWarning = function (warning: SortieCheckpoint['warnings'][number], flights: readonly DropFlight[]): Warning | undefined {
	const { drop, perimeter, ...spawn } = warning;
	const entry: MissionSpawn & { life: number } = spawn;
	if (!drop) return perimeter ? { ...entry, perimeter } : entry;
	const flight = flights[drop.flight];
	return flight ? { ...entry, drop: { flight, lane: drop.lane, delay: drop.delay } } : undefined;
};

export const restoreSortie = function (initial: State, saved: SortieCheckpoint): State | undefined {
	const original = initial.mission;
	if (!original || !matchesContract(saved, original.contract) || !matchesBattlefield(saved, initial)) return undefined;
	const { version: _version, contractId: _contractId, contractKind: _contractKind, rigs: _rigs, flights, warnings, mission, ...combat } = structuredClone(saved);
	const transports: DropFlight[] = flights.map(function (flight) { return { ...flight, field: original.map }; });
	const arrivals: Warning[] = [];
	for (const warning of warnings) {
		const restored = restoreWarning(warning, transports);
		if (!restored) return undefined;
		arrivals.push(restored);
	}
	const restoredMission: MissionRuntime = {
		...mission, contract: original.contract, map: original.map, structure: mission.structure, targetId: mission.targetId,
	};
	// Keep the ordinary State beam accessor. Attach will create fresh ECS entity
	// IDs and preserve combat IDs, ordering, and shared transport identities.
	return Object.assign(createState({ frame: saved.frame, difficulty: saved.difficulty }), {
		...combat, warnings: arrivals, mission: restoredMission, events: [],
	} satisfies Omit<State, 'beam'>);
};
