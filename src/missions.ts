import { getMissionTier } from './reputation';
import { getPlanet } from './universe';
import type { Contract, Landmark, MissionMap, MissionRuntime, MissionStructure } from './campaign-types';
import type { EnemyKind, Point, CombatStateView } from './simulation';

export const EXTRACTION_RADIUS = 150;
export const EXTRACTION_SECONDS = 3;
export const FACILITY_RADIUS = 65;
export const FACILITY_TARGET_ID = -1;
export const CAPTURE_RADIUS = 100;
export const RECOVERY_SECONDS = 5;
export const BEACON_SECONDS = 3;
export const ACQUISITION_SECONDS = 180;

// Negative identities never collide with enemy IDs; demolition keeps its old ID.
export const missionStructures = function (mission: MissionRuntime | undefined): { id: number; body: MissionStructure }[] {
	return [
		...(mission?.structure ? [{ id: FACILITY_TARGET_ID, body: mission.structure }] : []),
		...(mission?.raidTargets ?? []).map(function (body, index) { return { id: -2 - index, body }; }),
	];
};

export const isPriorityTarget = function (state: CombatStateView, enemy: { id: number; commander?: boolean }): boolean {
	return Boolean(enemy.commander) || state.mission?.targetId === enemy.id;
};

const randomSource = function (seed: number) {
	let value = seed >>> 0;
	return function () { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
};
const separation = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };

// A seeded layout selects a drop side, relocates objective sites, and scatters
// traversable terrain. Re-entering an accepted contract reproduces its field.
export const generateMissionMap = function (contract: Contract): MissionMap {
	const random = randomSource(contract.seed);
	const width = 4200 + Math.floor(random() * 3) * 300;
	const height = 3000 + Math.floor(random() * 3) * 300;
	const flipX = random() > 0.5; const flipY = random() > 0.5;
	const point = function (x: number, y: number): Point { return { x: flipX ? width - x : x, y: flipY ? height - y : y }; };
	const objective = point(width * (0.62 + random() * 0.12), height * (0.38 + random() * 0.24));
	const drop = contract.kind === 'defend'
		? { x: objective.x + (flipX ? 1 : -1) * 420, y: objective.y + (flipY ? -1 : 1) * 220 }
		: point(420 + random() * 220, height * (0.32 + random() * 0.36));
	const extraction = point(width * (0.22 + random() * 0.1), height * (0.72 + random() * 0.09));
	const sites = [
		point(width * (0.35 + random() * 0.09), height * (0.24 + random() * 0.1)),
		point(width * (0.49 + random() * 0.08), height * (0.65 + random() * 0.1)),
		{ ...objective },
	];
	const reserved = [drop, extraction, objective, ...sites];
	const landmarks: Landmark[] = [];
	for (let attempt = 0; attempt < 180 && landmarks.length < 60; attempt++) {
		const at = { x: 160 + random() * (width - 320), y: 160 + random() * (height - 320) };
		const radius = 35 + random() * 100;
		if (reserved.some(function (site) { return separation(site, at) < 260 + radius; })) continue;
		landmarks.push({ ...at, radius, rotation: random() * Math.PI * 2, kind: attempt % 7 === 0 ? 'depot' : attempt % 3 === 0 ? 'crater' : 'rocks' });
	}
	return { seed: contract.seed, biome: getPlanet(contract.planetId).biome, width, height, drop, objective, extraction, sites, landmarks };
};

export interface MissionSpawn extends Point { kind: EnemyKind; commander?: boolean }
export const missionHostileCount = function (contract: Contract): number {
	const level = getMissionTier(contract.tier);
	return contract.kind === 'defend' || contract.kind === 'clearance' ? level.assault : level.patrol;
};
export const missionSpawn = function (contract: Contract, map: MissionMap, index: number): MissionSpawn {
	const random = randomSource((contract.seed + Math.imul(index + 1, 104729)) >>> 0);
	const commander = contract.kind === 'assassination' && index === 0;
	const site = contract.kind === 'clearance' || contract.kind === 'raid' || contract.kind === 'acquisition' ? map.sites[index % map.sites.length] ?? map.objective : map.objective;
	const angle = index * 2.399963 + random() * 0.6;
	const radius = commander ? 0 : contract.kind === 'defend' ? 760 + random() * 160 : 180 + random() * 250;
	const rosters: Readonly<Record<Contract['tier'], readonly EnemyKind[]>> = {
		1: ['scout', 'helicopter', 'scout', 'scout'],
		2: ['scout', 'helicopter', 'striker', 'scout'],
		3: ['striker', 'tank', 'scout', 'vtol', 'striker', 'helicopter'],
		4: ['striker', 'tank', 'siege', 'vtol', 'helicopter', 'scout'],
		5: ['siege', 'tank', 'striker', 'vtol', 'siege'],
		6: ['siege', 'tank', 'siege', 'vtol', 'striker', 'siege'],
	};
	const roster = rosters[contract.tier];
	const kind: EnemyKind = commander ? contract.tier === 1 ? 'scout' : contract.tier < 4 ? 'striker' : 'siege' : roster[index % roster.length] ?? 'scout';
	return { x: Math.max(100, Math.min(map.width - 100, site.x + Math.cos(angle) * radius)), y: Math.max(100, Math.min(map.height - 100, site.y + Math.sin(angle) * radius)), kind, ...(commander ? { commander: true } : {}) };
};

export const missionObjective = function (state: CombatStateView): string {
	const mission = state.mission;
	if (!mission) return 'Protect Relay 09';
	if (mission.stage === 'extract') return mission.extractTime > 0
		? `Extraction ${Math.ceil(EXTRACTION_SECONDS - mission.extractTime)}s · hold the landing zone`
		: `Return to extraction · ${Math.round(separation(state.player, mission.map.extraction))} m`;
	if (mission.contract.kind === 'raid') return `Destroy supply sites · ${mission.progress}/3 destroyed`;
	if (mission.contract.kind === 'recovery' || mission.contract.kind === 'acquisition') {
		const holding = mission.captureSites?.find(function (site) { return !site.complete && site.holdTime > 0; });
		const duration = mission.contract.kind === 'recovery' ? RECOVERY_SECONDS : BEACON_SECONDS;
		const action = holding ? ` · hold ${(duration - holding.holdTime).toFixed(1)}s` : ' · enter a marked zone';
		return mission.contract.kind === 'recovery' ? `Recover the data${action}`
			: (mission.acquisitionTime ?? 0) <= 0 ? 'Target acquisition failed · deadline expired'
			: `Beacons ${mission.progress}/3 · ${Math.ceil(mission.acquisitionTime ?? 0)}s remaining${action}`;
	}
	if (mission.contract.kind === 'defend') return `Protect the relay · ${mission.progress}/${mission.required} hostiles eliminated`;
	if (mission.contract.kind === 'demolition') return `Destroy the facility · ${Math.ceil(Math.max(0, mission.structure?.hp ?? 0) / (mission.structure?.maxHp ?? 1) * 100)}% integrity`;
	if (mission.contract.kind === 'assassination') return 'Hunt the marked command frame';
	return `Clear the three hostile sites · ${mission.progress}/${mission.required} eliminated`;
};
