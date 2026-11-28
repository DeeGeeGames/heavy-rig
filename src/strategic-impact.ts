import type { Contract } from './campaign-types';
import { mixSeed, randomSource } from './universe';

export const TANK_DELAY_SECONDS = 18;

interface Target {
	readonly role: string;
	readonly briefing: string;
}

// Each set runs from a secondary target to one the local front depends on.
const targets = {
	defend: [
		{ role: 'patrol-uplink', briefing: 'This uplink relays patrol reports for one outpost. Keeping it live preserves that post’s contact with dispatch.' },
		{ role: 'convoy-uplink', briefing: 'Supply convoys use this uplink to route around blocked roads. Holding it keeps dispatch in contact with the convoys.' },
		{ role: 'front-command-uplink', briefing: 'This uplink is the only link between local garrisons and front command. Losing it would leave those garrisons acting alone.' },
	],
	demolition: [
		{ role: 'reserve-processor', briefing: 'This processor fills overflow orders. Destroying it cuts into the opponent’s spare production capacity.' },
		{ role: 'spares-works', briefing: 'This plant turns raw stock into replacement parts for local garrisons. Destroying it interrupts their repair supply.' },
		{ role: 'front-fuel-works', briefing: 'Most of the opponent’s fuel for this front is refined here. Destroying the works cuts off their main source of fuel.' },
	],
	assassination: [
		{ role: 'sector-patrol-lead', briefing: 'The target schedules patrols in one sector. Removing them disrupts that sector’s patrol coordination.' },
		{ role: 'reserve-dispatch-lead', briefing: 'The target routes reinforcements between local garrisons. Removing them breaks the link between those garrisons and their reserve.' },
		{ role: 'front-operations-lead', briefing: 'The target coordinates the opponent’s offensive across this front. Removing them leaves the attacking columns without their shared command.' },
	],
	clearance: [
		{ role: 'service-track-pickets', briefing: 'These pickets overlook a secondary service track. Clearing the sites removes their watch on that route.' },
		{ role: 'supply-road-pickets', briefing: 'These patrols control three crossings on the local supply road. Clearing them reopens the direct route for freight.' },
		{ role: 'embarkation-pickets', briefing: 'These patrols control the only ground approaches to the regional landing yards. Clearing them reopens those approaches to the employer.' },
	],
	raid: [
		{ role: 'patrol-stores', briefing: 'These stores carry fuel and spares for local patrols. Destroying them takes out the patrols’ roadside supply points.' },
		{ role: 'distribution-depots', briefing: 'These depots split bulk shipments among the opponent’s local garrisons. Destroying them breaks that distribution network.' },
		{ role: 'armored-reserve-depot', briefing: `These depots fuel the armored reserve. Destroy them to delay this faction’s tanks by ${TANK_DELAY_SECONDS} seconds the next time you defend against them here.` },
	],
	recovery: [
		{ role: 'patrol-logs', briefing: 'The cache holds patrol logs for one sector. Recovering them reveals which roads those patrols use.' },
		{ role: 'freight-manifest', briefing: 'The cache holds current freight manifests. Recovering them identifies which local garrisons rely on which supply routes.' },
		{ role: 'offensive-orders', briefing: 'The cache holds the opponent’s offensive orders. Recovering them exposes the staging routes and timing of the main push.' },
	],
	acquisition: [
		{ role: 'patrol-staging-fix', briefing: 'The beacons give fire control a fix on a secondary patrol staging area the employer can’t resolve from orbit.' },
		{ role: 'freight-junction-fix', briefing: 'The beacons pinpoint the freight junction the opponent uses to move supplies between local garrisons.' },
		{ role: 'siege-line-fix', briefing: 'The beacons map the siege line’s gun positions for the employer. Orbital scans alone can’t distinguish those guns from their decoys.' },
	],
} as const satisfies Readonly<Record<Contract['kind'], readonly [Target, Target, Target]>>;

export type StrategicTerms = {
	readonly impact: number;
	readonly role: typeof targets[Contract['kind']][number]['role'];
};

const impactBand = function (tier: Contract['tier']): readonly [min: number, max: number] {
	return tier <= 3 ? [10, 30] : tier <= 6 ? [20, 40] : [20, 50];
};

export const strategicTerms = function (contract: Pick<Contract, 'kind' | 'tier' | 'seed'>, reserveDisrupted = false): StrategicTerms {
	const random = randomSource(mixSeed(contract.seed, 0x53545241));
	const roleRoll = random();
	// A reserve that is still cut off cannot be offered as a fresh opportunity to delay its tanks.
	const pivotalTarget = roleRoll >= 0.86 && !(contract.kind === 'raid' && reserveDisrupted);
	const importance = pivotalTarget ? 2 : roleRoll < 0.43 ? 0 : 1;
	const { role } = targets[contract.kind][importance];
	const [min, max] = impactBand(contract.tier);
	const span = max - min;
	const impactRoll = random();
	// Neighboring roles overlap substantially, so a role does not dictate an exact rating.
	const lower = min + Math.floor(span * (importance === 0 ? 0 : importance === 1 ? 0.25 : 0.5));
	const upper = max - Math.ceil(span * (importance === 0 ? 0.35 : importance === 1 ? 0.15 : 0));
	if (upper === 50) {
		// Only pivotal targets can rate 50, and only on a separate rare roll.
		return { role, impact: random() < 0.03 ? 50 : lower + Math.floor(impactRoll * (50 - lower)) };
	}
	return { role, impact: lower + Math.floor(impactRoll * (upper - lower + 1)) };
};

export const isStrategicTerms = function (value: unknown, contract: Pick<Contract, 'kind' | 'tier'>): value is StrategicTerms {
	if (typeof value !== 'object' || value === null || Array.isArray(value)
		|| !('impact' in value) || typeof value.impact !== 'number' || !Number.isInteger(value.impact) || !('role' in value)) return false;
	const [min, max] = impactBand(contract.tier);
	const roles = targets[contract.kind];
	return value.impact >= min && value.impact <= max
		&& (value.impact === 50 ? value.role === roles[2].role : roles.some(function (target) { return target.role === value.role; }));
};

export const strategicBriefing = function (contract: Contract): string {
	return targets[contract.kind].find(function (target) { return target.role === contract.strategy?.role; })?.briefing ?? '';
};

export const isArmoredReserveRaid = function (contract: Contract): boolean {
	return contract.kind === 'raid' && contract.strategy?.role === 'armored-reserve-depot';
};
