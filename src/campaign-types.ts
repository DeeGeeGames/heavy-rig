import type { MissionTier } from './reputation';
import type { Point } from './simulation';

export type FactionId = 'freeholds' | 'combine' | 'accord';
export type PlanetId = 'meridian' | 'cinder' | 'borealis' | `system-${number}`;
export type Biome = 'badlands' | 'volcanic' | 'tundra';
export type MissionKind = 'defend' | 'demolition' | 'assassination' | 'clearance' | 'raid' | 'recovery' | 'acquisition';

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
	targetId: number | undefined;
	progress: number;
	required: number;
	extractTime: number;
}
