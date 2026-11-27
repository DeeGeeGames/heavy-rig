import type { MissionTier } from './reputation';
import type { Point } from './simulation';
import type { FieldTerrain } from './field-terrain';

export type FactionId = 'freeholds' | 'combine' | 'accord';
export type PlanetId = 'meridian' | 'cinder' | 'borealis' | 'brackwater' | 'elderholt' | 'galeward' | 'iolith' | `system-${number}`;
export const BIOME_NAMES = {
	badlands: 'Badlands', volcanic: 'Volcanic', tundra: 'Tundra', wetlands: 'Tidal wetlands',
	forest: 'Old-growth forest', steppe: 'Wind steppe', crystal: 'Crystal barrens',
} as const;
export type Biome = keyof typeof BIOME_NAMES;
export type MissionKind = 'defend' | 'demolition' | 'assassination' | 'clearance' | 'raid' | 'recovery' | 'acquisition';

export const MISSION_NAMES: Readonly<Record<MissionKind, string>> = {
	defend: 'Garrison defense', demolition: 'Facility demolition', assassination: 'Priority target', clearance: 'Area clearance',
	raid: 'Raid', recovery: 'Recovery', acquisition: 'Target acquisition',
};

export interface Contract {
	id: string;
	seed: number;
	planetId: PlanetId;
	kind: MissionKind;
	employer: FactionId;
	opponent: FactionId;
	title: string;
	briefing: string;
	reward: number;
	favor: number;
	hostility: number;
	tier: MissionTier;
	requiredReputation: number;
	fieldLayout?: 'extended-defense';
}

export interface Landmark extends Point {
	kind: 'rocks' | 'depot' | 'crater';
	radius: number;
	rotation: number;
}

export interface MissionMap {
	seed: number;
	biome: Biome;
	width: number;
	height: number;
	drop: Point;
	objective: Point;
	extraction: Point;
	sites: Point[];
	landmarks: Landmark[];
	terrain?: FieldTerrain;
	defenseApproach?: { staging: readonly [Point, Point]; arrivalRadius: number; firstWaveDelay: number; minimumStandoff: number };
}

export interface MissionStructure extends Point { hp: number; maxHp: number }
export interface CaptureSite extends Point { holdTime: number; complete: boolean }

export interface MissionRuntime {
	contract: Contract;
	map: MissionMap;
	stage: 'active' | 'extract';
	structure: MissionStructure | undefined;
	raidTargets?: MissionStructure[];
	captureSites?: CaptureSite[];
	acquisitionTime?: number;
	defenseArrivalRadius?: number;
	targetId: number | undefined;
	progress: number;
	required: number;
	extractTime: number;
}
