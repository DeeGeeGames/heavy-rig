import type { EnemyKind } from './simulation';

export type Difficulty = 'story' | 'standard' | 'veteran';
export interface DifficultyDefinition {
	id: Difficulty;
	name: string;
	description: string;
	enemyArmor: number;
	enemyDamage: number;
	scoreMultiplier: number;
}
export const DIFFICULTIES: readonly DifficultyDefinition[] = [
	{ id: 'story', name: 'Field recruit', description: 'Lighter enemy armor and damage. Learn the frame, finish the operation.', enemyArmor: 0.85, enemyDamage: 0.55, scoreMultiplier: 0.75 },
	{ id: 'standard', name: 'Pilot', description: 'The intended fight. Manage heat, intercept artillery, protect the relay.', enemyArmor: 1, enemyDamage: 1, scoreMultiplier: 1 },
	{ id: 'veteran', name: 'Veteran', description: 'Reinforced hostiles and harder hits. Preparation and positioning matter.', enemyArmor: 1.2, enemyDamage: 1.3, scoreMultiplier: 1.4 },
];
export interface EnemySpawn { kind: EnemyKind; commander?: boolean }
export interface WaveDefinition {
	number: number;
	name: string;
	briefing: string;
	interval: number;
	bearing: number;
	enemies: readonly EnemySpawn[];
}
const scout: EnemySpawn = { kind: 'scout' };
const striker: EnemySpawn = { kind: 'striker' };
const siege: EnemySpawn = { kind: 'siege' };
const commander: EnemySpawn = { kind: 'siege', commander: true };
const helicopter: EnemySpawn = { kind: 'helicopter' };
const vtol: EnemySpawn = { kind: 'vtol' };
const tank: EnemySpawn = { kind: 'tank' };
export const WAVES: readonly WaveDefinition[] = [
	{ number: 1, name: 'First contact', briefing: 'Recon frames and a circling helicopter are crossing the perimeter. Keep moving and lead airborne contacts.', interval: 5, bearing: 1.6, enemies: [scout, scout, helicopter, scout, striker] },
	{ number: 2, name: 'Crossfire', briefing: 'Tanks and artillery are joining the assault. Flank their armored fronts; punish artillery while its armor vents after firing.', interval: 6, bearing: 3.2, enemies: [scout, tank, helicopter, striker, siege, scout, striker] },
	{ number: 3, name: 'Hammerfall', briefing: 'Missile VTOLs strafe around the artillery. Clear the orange markers, then punish the exposed cooling cycle.', interval: 6, bearing: 4.8, enemies: [siege, helicopter, vtol, siege, tank, scout, siege, striker] },
	{ number: 4, name: 'Breaking point', briefing: 'The combined assault is committing: armor, gunships and missile VTOLs. Hold a coolant charge in reserve.', interval: 6, bearing: 0.8, enemies: [tank, helicopter, siege, striker, vtol, striker, siege, tank, vtol] },
	{ number: 5, name: 'Iron crown', briefing: 'The Crown is deploying behind armored and airborne escorts. Leave its marked impact field, then attack the open armor. Below half integrity, its barrage spreads.', interval: 5, bearing: 2.4, enemies: [tank, siege, helicopter, vtol, commander, scout, siege, tank, vtol, striker] },
];
export const TOTAL_HOSTILES = WAVES.reduce(function (total, wave) { return total + wave.enemies.length; }, 0);
export const getWaveDefinition = function (wave: number): WaveDefinition {
	const definition = WAVES.find(function (candidate) { return candidate.number === wave; });
	if (!definition) throw new RangeError(`Unknown Heavy Rig wave: ${wave}`);
	return definition;
};
export const getDifficultyDefinition = function (difficulty: Difficulty): DifficultyDefinition {
	const definition = DIFFICULTIES.find(function (candidate) { return candidate.id === difficulty; });
	if (!definition) throw new RangeError(`Unknown Heavy Rig difficulty: ${difficulty}`);
	return definition;
};
