import { getWeapon } from './arsenal';
import type { Campaign } from './campaign';
import type { Contract, MissionKind } from './campaign-types';
import { frameWeight, HEAT_LOCK, loadedMounts, usableMount } from './combat-resources';
import { getOwnedMech, type DeployedPilot, type OwnedMech } from './company';
import { getFrame } from './frames';
import { getPilotStats, pilotExperienceMultiplier, type PilotAssignment, type PilotId } from './pilots';
import { getContractTier, missionTierPressure } from './reputation';
import { rigFrameId, type RigId } from './rigs';
import { randomSource } from './universe';

export interface CrewForecast {
	readonly objectiveChance: number;
	readonly baseExtractionChance: number;
	readonly extractionChance: number;
	readonly successChance: number;
	readonly factors: readonly string[];
}

export interface CrewCheck {
	readonly chance: number;
	readonly roll: number;
	readonly passed: boolean;
}

export interface CrewResolution {
	readonly objective: CrewCheck;
	readonly extraction: CrewCheck;
	readonly squad: readonly DeployedPilot[];
	readonly leaderId?: PilotId;
}

interface Capabilities { firepower: number; precision: number; mobility: number; armor: number }
interface ObjectiveProfile extends Capabilities { emphasis: string }

const OBJECTIVES: Readonly<Record<MissionKind, ObjectiveProfile>> = {
	defend: { firepower: .6, precision: 0, mobility: 0, armor: .4, emphasis: 'sustained fire and armor' },
	demolition: { firepower: .9, precision: 0, mobility: 0, armor: .1, emphasis: 'sustained fire' },
	assassination: { firepower: .3, precision: .7, mobility: 0, armor: 0, emphasis: 'Gunnery and precise long-range weapons' },
	clearance: { firepower: .8, precision: 0, mobility: 0, armor: .2, emphasis: 'sustained fire and armor' },
	raid: { firepower: .55, precision: 0, mobility: .45, armor: 0, emphasis: 'firepower and speed' },
	recovery: { firepower: .15, precision: 0, mobility: .85, armor: 0, emphasis: 'Maneuver and speed' },
	acquisition: { firepower: .25, precision: 0, mobility: .75, armor: 0, emphasis: 'Maneuver and speed' },
};

const FIRE_WINDOW_SECONDS = 24;

const weaponPressure = function (mech: OwnedMech) {
	const frame = getFrame(rigFrameId(mech.frameId));
	const mounts = loadedMounts(mech.loadout, mech.reserves);
	const pressure = mounts.filter(usableMount).reduce(function (total, mount) {
		const weapon = getWeapon(mount.weapon);
		// Beam ratings are per second. Pulsed weapons emit a finite number of projectiles per cycle.
		const cycleRate = weapon.kind === 'laser' ? 1 : weapon.projectiles / weapon.interval;
		const fireRate = weapon.ammunition ? Math.min(cycleRate, mount.rounds / FIRE_WINDOW_SECONDS) : cycleRate;
		const damage = weapon.damage * fireRate;
		const heat = weapon.heat * fireRate / weapon.projectiles;
		const precision = (weapon.range / 800) / (1 + 2 * weapon.spread);
		return { damage: total.damage + damage, precisionDamage: total.precisionDamage + damage * precision, heat: total.heat + heat };
	}, { damage: 0, precisionDamage: 0, heat: 0 });
	const heatBudget = frame.cooling + HEAT_LOCK / FIRE_WINDOW_SECONDS;
	const heatFactor = pressure.heat > heatBudget ? heatBudget / pressure.heat : 1;
	return {
		damage: pressure.damage * heatFactor,
		precisionDamage: pressure.precisionDamage * heatFactor,
		speed: frameWeight(frame.id, mounts).speed,
		incomingDamage: frame.incomingDamage,
	};
};

// One full reserve of the starter Kestrel's two machine guns has a rating of 1.
// The curve lets stronger loadouts help without a single high-DPS rig replacing a team.
const fireRating = function (damage: number): number { return 2 * damage / (50 + damage); };

const membersFor = function (campaign: Campaign, lineup: readonly PilotAssignment[]) {
	return lineup.flatMap(function ({ pilotId, frameId }) {
		if (pilotId === null && frameId === null) return [];
		const mech = frameId === null ? undefined : getOwnedMech(campaign, frameId);
		if (pilotId === null || pilotId === 'player' || !mech || mech.integrity <= 0) throw new RangeError('Crew resolution requires assigned hires in operating rigs');
		const pilot = getPilotStats(campaign, pilotId);
		const weapons = weaponPressure(mech);
		const condition = mech.integrity / 100;
		const gunnery = 1 + (pilot.gunnery - 3) * .14;
		const maneuver = 1 + (pilot.maneuver - 3) * .14;
		const experience = pilotExperienceMultiplier(pilot.bonus);
		return [{
			pilotId,
			frameId: mech.frameId,
			integrity: mech.integrity,
			incomingDamage: weapons.incomingDamage,
			capability: {
				firepower: fireRating(weapons.damage) * gunnery * condition * experience,
				precision: fireRating(weapons.precisionDamage) * gunnery * condition * experience,
				mobility: weapons.speed / 100 * maneuver * condition * experience,
				armor: condition / weapons.incomingDamage,
			},
		}];
	}).sort(function (a, b) { return a.frameId < b.frameId ? -1 : a.frameId > b.frameId ? 1 : 0; });
};

// More rigs always add coverage. The best match contributes fully, with
// diminishing support weights for the other seats.
const teamRating = function (ratings: number[]): number {
	const weights = [1, .48, .38, .30];
	return ratings.sort(function (a, b) { return b - a; }).reduce(function (sum, rating, index) {
		return sum + rating * (weights[index] ?? 0);
	}, 0);
};

const percentage = function (chance: number): number { return Math.max(5, Math.min(97, Math.round(chance))); };

const assessCrew = function (campaign: Campaign, contract: Contract, lineup: readonly PilotAssignment[], leaderId: PilotId) {
	const members = membersFor(campaign, lineup);
	if (!members.some(function (member) { return member.pilotId === leaderId; })) throw new RangeError('Crew resolution requires an assigned hire as field lead');
	const profile = OBJECTIVES[contract.kind];
	const objectiveStrength = teamRating(members.map(function ({ capability }) {
		return capability.firepower * profile.firepower + capability.precision * profile.precision + capability.mobility * profile.mobility + capability.armor * profile.armor;
	}));
	const extractionStrength = teamRating(members.map(function ({ capability }) { return .6 * capability.mobility + .4 * capability.armor; }));
	const opposition = missionTierPressure(contract);
	const objectiveChance = percentage(58 + (objectiveStrength - 1) * 36 - opposition * 8);
	const baseExtractionChance = percentage(78 + (extractionStrength - 1) * 28 - opposition * 5);
	const extractionChance = percentage(baseExtractionChance + (getPilotStats(campaign, leaderId).leadership - 1) * 3);
	return { members, profile, objectiveChance, baseExtractionChance, extractionChance };
};

export const forecastCrew = function (campaign: Campaign, contract: Contract, lineup: readonly PilotAssignment[], leaderId: PilotId): CrewForecast {
	const { members, profile, objectiveChance, baseExtractionChance, extractionChance } = assessCrew(campaign, contract, lineup, leaderId);
	const integrity = members.reduce(function (sum, member) { return sum + member.integrity; }, 0) / members.length;
	return {
		objectiveChance,
		baseExtractionChance,
		extractionChance,
		successChance: objectiveChance * extractionChance / 100,
		factors: [
			`The objective favors ${profile.emphasis}.`,
			'Maneuver, speed, and armor help the crew extract.',
			`${members.length} ${members.length === 1 ? 'rig' : 'rigs'} · ${Math.ceil(integrity)}% average integrity · ${getContractTier(contract).name} opposition`,
		],
	};
};

const keyedSeed = function (seed: number, key: string): number {
	let value = seed;
	for (let index = 0; index < key.length; index++) value = Math.imul(value ^ key.charCodeAt(index), 0x01000193);
	return value >>> 0;
};

const check = function (random: () => number, chance: number): CrewCheck {
	const roll = Math.floor(random() * 100) + 1;
	return { chance, roll, passed: roll <= chance };
};

const pressureFrom = function ({ passed, chance, roll }: CrewCheck): number {
	return passed ? Math.max(0, 12 - (chance - roll)) * .5 : 12 + Math.min(22, roll - chance) * .45;
};

const damageRoll = function (seed: number, frameId: RigId) {
	return Math.floor(randomSource(keyedSeed(seed, `damage:${frameId}`))() * 100) + 1;
};

export const resolveCrew = function (campaign: Campaign, contract: Contract, lineup: readonly PilotAssignment[], leaderId: PilotId): CrewResolution {
	const { members, objectiveChance, extractionChance } = assessCrew(campaign, contract, lineup, leaderId);
	// A posting keeps its rolls regardless of the calendar, squad order, or refits.
	const seed = keyedSeed(0x811c9dc5, `crew:${campaign.seed}/${contract.seed}/${contract.id}`);
	const random = randomSource(seed);
	const objective = check(random, objectiveChance);
	const extraction = check(random, extractionChance);
	const pressure = pressureFrom(objective) + pressureFrom(extraction) + missionTierPressure(contract) * 2;
	const damage = members.map(function (member) {
		const severity = Math.max(0, (damageRoll(seed, member.frameId) - 22) * .42 + pressure);
		const exposure = Math.max(.75, 1.15 - .15 * member.capability.mobility);
		return { member, remaining: member.integrity - Math.round(severity * member.incomingDamage * exposure) };
	});
	const bestRemaining = damage.reduce<(typeof damage)[number] | undefined>(function (best, entry) {
		return !best || entry.remaining > best.remaining ? entry : best;
	}, undefined);
	const squad = damage.map(function (entry): DeployedPilot {
		const { frameId, pilotId, integrity } = entry.member;
		// A successful pickup needs one operating rig. The crew recovers other rigs at their recorded integrity.
		const minimum = extraction.passed && entry === bestRemaining && entry.remaining <= 0 ? Math.min(1, integrity) : 0;
		return { frameId, pilotId, startingIntegrity: integrity, integrity: Math.max(minimum, entry.remaining) };
	});
	return { objective, extraction, squad, leaderId };
};
