import type { WeaponTier } from './arsenal';

export type MissionTier = 1 | 2 | 3 | 4 | 5 | 6;
export interface ReputationState { readonly companyReputation: number }
export const MAX_COMPANY_REPUTATION = 1_000_000_000;
export const REPUTATION_RANKS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200] as const;
export interface MissionTierDefinition {
	readonly tier: MissionTier;
	readonly name: string;
	readonly rank: number;
	readonly weaponTier: WeaponTier;
	readonly standing: number;
	readonly reputation: number;
	readonly reward: number;
	readonly armor: number;
	readonly commanderHp: number;
	readonly objectiveHp: number;
	readonly assault: number;
	readonly patrol: number;
	readonly opposition: string;
}
export const MISSION_TIERS: readonly MissionTierDefinition[] = [
	{ tier: 1, name: 'Local', rank: 1, weaponTier: 0, standing: -100, reputation: 50, reward: 1, armor: .75, commanderHp: 420, objectiveHp: 450, assault: 8, patrol: 5, opposition: 'Light scouts and helicopters; a scout leads priority targets.' },
	{ tier: 2, name: 'Frontier', rank: 3, weaponTier: 1, standing: -15, reputation: 90, reward: 1.6, armor: .9, commanderHp: 700, objectiveHp: 600, assault: 11, patrol: 7, opposition: 'Scout screens, striker frames, and helicopter support.' },
	{ tier: 3, name: 'Veteran', rank: 6, weaponTier: 2, standing: 0, reputation: 150, reward: 2.5, armor: 1, commanderHp: 1000, objectiveHp: 800, assault: 14, patrol: 9, opposition: 'Mixed striker formations with tanks and missile VTOLs.' },
	{ tier: 4, name: 'Heavy', rank: 9, weaponTier: 3, standing: 8, reputation: 230, reward: 3.8, armor: 1.15, commanderHp: 1400, objectiveHp: 1050, assault: 18, patrol: 12, opposition: 'Heavy tanks and siege frames with air support.' },
	{ tier: 5, name: 'Elite', rank: 12, weaponTier: 4, standing: 20, reputation: 330, reward: 5.5, armor: 1.3, commanderHp: 1800, objectiveHp: 1350, assault: 22, patrol: 15, opposition: 'Armored siege formations with upgraded weapons.' },
	{ tier: 6, name: 'Legendary', rank: 15, weaponTier: 5, standing: 35, reputation: 450, reward: 8, armor: 1.5, commanderHp: 2300, objectiveHp: 1700, assault: 27, patrol: 18, opposition: 'Massed siege frames, heavy armor, and exceptional weapons.' },
];
export const isMissionTier = function (value: unknown): value is MissionTier {
	return MISSION_TIERS.some(function (entry) { return entry.tier === value; });
};
export const getMissionTier = function (tier: MissionTier): MissionTierDefinition {
	const definition = MISSION_TIERS.find(function (entry) { return entry.tier === tier; });
	if (!definition) throw new RangeError(`Unknown mission tier: ${tier}`);
	return definition;
};
export const companyRank = function (state: ReputationState): number {
	return REPUTATION_RANKS.filter(function (threshold) { return state.companyReputation >= threshold; }).length;
};
export const unlockedMissionTier = function (state: ReputationState): MissionTierDefinition {
	return MISSION_TIERS.reduce(function (highest, entry) { return entry.rank <= companyRank(state) ? entry : highest; }, getMissionTier(1));
};
export const weaponUnlockRank = function (tier: WeaponTier): number {
	return MISSION_TIERS.find(function (entry) { return entry.weaponTier === tier; })?.rank ?? 1;
};
export const reputationProgress = function (state: ReputationState): string {
	const rank = companyRank(state); const next = REPUTATION_RANKS[rank];
	return next === undefined ? 'Maximum company rank' : `${state.companyReputation.toLocaleString()} / ${next.toLocaleString()} reputation · ${next - state.companyReputation} to rank ${rank + 1}`;
};
