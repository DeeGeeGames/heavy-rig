import type { WeaponTier } from './arsenal';

export type MissionTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const FIRST_RIG_TIER = 3;
export const FIRST_HEAVY_RIG_TIER = 7;
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
	readonly commanderHp?: number;
	readonly objectiveHp: number;
	readonly assault: number;
	readonly patrol: number;
	readonly opposition: string;
}
// Keep the published six-tier terms for saved contracts only. New postings
// use a distinct ID prefix so both kinds can be validated without a save reset.
const legacyMissionTiers: readonly MissionTierDefinition[] = [
	{ tier: 1, name: 'Local', rank: 1, weaponTier: 0, standing: -100, reputation: 50, reward: 1, armor: .75, commanderHp: 900, objectiveHp: 2000, assault: 6, patrol: 4, opposition: 'Light stock rigs lead helicopter-supported sections.' },
	{ tier: 2, name: 'Frontier', rank: 3, weaponTier: 1, standing: -15, reputation: 90, reward: 1.6, armor: .9, commanderHp: 1800, objectiveHp: 2600, assault: 8, patrol: 5, opposition: 'Light and line rigs with Service-grade weapons and helicopter support.' },
	{ tier: 3, name: 'Veteran', rank: 6, weaponTier: 2, standing: 0, reputation: 150, reward: 2.5, armor: 1, commanderHp: 2800, objectiveHp: 3200, assault: 10, patrol: 6, opposition: 'Mixed light and line rigs with tank or helicopter support.' },
	{ tier: 4, name: 'Heavy', rank: 9, weaponTier: 3, standing: 8, reputation: 230, reward: 3.8, armor: 1.15, commanderHp: 3800, objectiveHp: 3500, assault: 11, patrol: 7, opposition: 'Heavy and line rigs join lighter sections with tank or missile VTOL support.' },
	{ tier: 5, name: 'Elite', rank: 12, weaponTier: 4, standing: 20, reputation: 330, reward: 5.5, armor: 1.3, commanderHp: 4800, objectiveHp: 3800, assault: 12, patrol: 8, opposition: 'Heavy and line rigs carry Elite-grade weapons, supported by tanks or missile VTOLs.' },
	{ tier: 6, name: 'Legendary', rank: 15, weaponTier: 5, standing: 35, reputation: 450, reward: 8, armor: 1.5, commanderHp: 6000, objectiveHp: 4100, assault: 13, patrol: 9, opposition: 'Heavy-led sections field Exceptional-grade weapons with missile VTOL or tank support.' },
];
export const MISSION_TIERS: readonly MissionTierDefinition[] = [
	{ tier: 1, name: 'Local', rank: 1, weaponTier: 0, standing: -100, reputation: 50, reward: 1, armor: .7, objectiveHp: 2000, assault: 6, patrol: 4, opposition: 'Helicopter patrols. No hostile rigs.' },
	{ tier: 2, name: 'Patrolled', rank: 2, weaponTier: 0, standing: -35, reputation: 65, reward: 1.25, armor: .8, objectiveHp: 2250, assault: 7, patrol: 4, opposition: 'Helicopters and armored tanks. No hostile rigs.' },
	{ tier: 3, name: 'Frontier', rank: 3, weaponTier: 1, standing: -15, reputation: 90, reward: 1.6, armor: .88, objectiveHp: 2500, assault: 8, patrol: 5, opposition: 'Light scout rigs join helicopter-supported patrols.' },
	{ tier: 4, name: 'Contested', rank: 4, weaponTier: 1, standing: -8, reputation: 115, reward: 2, armor: .94, objectiveHp: 2750, assault: 9, patrol: 5, opposition: 'Scout rigs operate with tank and helicopter support.' },
	{ tier: 5, name: 'Veteran', rank: 6, weaponTier: 2, standing: 0, reputation: 150, reward: 2.5, armor: 1, objectiveHp: 3000, assault: 10, patrol: 6, opposition: 'Light and line rigs with tank or helicopter escorts.' },
	{ tier: 6, name: 'Reinforced', rank: 7, weaponTier: 2, standing: 4, reputation: 185, reward: 3.2, armor: 1.07, objectiveHp: 3250, assault: 10, patrol: 6, opposition: 'Line-led patrols backed by tanks and scout rigs.' },
	{ tier: 7, name: 'Heavy', rank: 9, weaponTier: 3, standing: 8, reputation: 230, reward: 4.05, armor: 1.16, objectiveHp: 3450, assault: 11, patrol: 7, opposition: 'Heavy and line rigs with tank or missile VTOL support.' },
	{ tier: 8, name: 'Veteran Heavy', rank: 10, weaponTier: 3, standing: 14, reputation: 280, reward: 5.1, armor: 1.25, objectiveHp: 3650, assault: 12, patrol: 8, opposition: 'Heavy-led sections with line rigs, tanks and missile VTOLs.' },
	{ tier: 9, name: 'Elite', rank: 12, weaponTier: 4, standing: 20, reputation: 330, reward: 6.4, armor: 1.36, objectiveHp: 3850, assault: 12, patrol: 8, opposition: 'Heavy and line rigs carry Elite weapons with armored and air support.' },
	{ tier: 10, name: 'Legendary', rank: 15, weaponTier: 5, standing: 35, reputation: 450, reward: 8, armor: 1.5, objectiveHp: 4100, assault: 13, patrol: 9, opposition: 'Heavy-led sections field Exceptional weapons with missile VTOL or tank support.' },
];
export const isMissionTier = function (value: unknown): value is MissionTier {
	return MISSION_TIERS.some(function (entry) { return entry.tier === value; });
};
export const getMissionTier = function (tier: MissionTier): MissionTierDefinition {
	const definition = MISSION_TIERS.find(function (entry) { return entry.tier === tier; });
	if (!definition) throw new RangeError(`Unknown mission tier: ${tier}`);
	return definition;
};
type TierContract = { readonly id: string; readonly tier: MissionTier; readonly kind: string; readonly planetId: string };
export const usesLegacyMissionTiers = function (contract: TierContract): boolean {
	const suffix = `-${contract.planetId}-${contract.kind}-${contract.tier}`;
	return contract.tier <= 6 && contract.id.endsWith(suffix) && /^\d+-\d+$/.test(contract.id.slice(0, -suffix.length));
};
export const getContractTier = function (contract: TierContract): MissionTierDefinition {
	return (usesLegacyMissionTiers(contract) ? legacyMissionTiers.find(function (entry) { return entry.tier === contract.tier; }) : undefined)
		?? getMissionTier(contract.tier);
};
export const getPostingTiers = function (legacy: boolean): readonly MissionTierDefinition[] {
	return legacy ? legacyMissionTiers : MISSION_TIERS;
};
export const missionTierPressure = function (contract: TierContract): number {
	return (contract.tier - 1) * (usesLegacyMissionTiers(contract) ? 1 : 5 / 9);
};
export const firstHeavyRigTier = function (contract: TierContract): MissionTier {
	return usesLegacyMissionTiers(contract) ? 4 : FIRST_HEAVY_RIG_TIER;
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
