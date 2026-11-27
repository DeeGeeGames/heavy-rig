import { isRigId, rigFrameId, type RigId } from './rigs';
import { WEAPON_PRICES } from './equipment-prices';
export { WEAPON_PRICES } from './equipment-prices';
import { getFrameOffer } from './market';
import { unlockedMissionTier } from './reputation';
import { WEAPONS, createWeaponRecord, getWeapon, type WeaponId } from './arsenal';
import { getTransmission, MAX_CREDITS, type Campaign } from './campaign';
import { bareChassisMass, PLAYABLE_FRAMES, type FrameId } from './frames';
import { stockPackage, isFrameLoadout } from './hardpoints';
import { defaultReserves, isReserveLoadout, loadedMounts, usableMount } from './combat-resources';
import { isPilotId, SQUAD_SIZE, type PilotAssignment, type PilotId } from './pilots';
import { getJumpRoute, getSystemIntel, PLANETS } from './universe';

export type Loadout = readonly (WeaponId | null)[];
export interface OwnedMech {
	frameId: RigId;
	integrity: number;
	loadout: Loadout;
	reserves: readonly number[];
}
interface WorkOrderDates { frameId: RigId; startedDay: number; readyDay: number }
export type WorkOrder = (WorkOrderDates & { kind: 'repair' }) | (WorkOrderDates & { kind: 'refit'; loadout: Loadout; reserves: readonly number[] });
export interface DeployedRig { frameId: RigId; integrity: number; startingIntegrity: number }
export interface DeployedPilot extends DeployedRig { pilotId: PilotId }
export interface Deployment extends DeployedRig { coolantCharges: number; wing: readonly DeployedPilot[] }
export interface CompanyState {
	fleet: readonly OwnedMech[];
	selectedFrame: RigId;
	pilots: readonly PilotId[];
	lineup: readonly PilotAssignment[];
	inventory: Record<WeaponId, number>;
	workOrders: readonly WorkOrder[];
	deployed: Deployment | undefined;
}

export const MAX_DAY = 1_000_000_000;
export const UPKEEP_MONTH_DAYS = 30;
const MECH_MONTHLY_UPKEEP_PER_TON = 15;
export const PILOT_MONTHLY_UPKEEP = 750;
const upkeepMonth = function (day: number): number { return Math.floor((day - 1) / UPKEEP_MONTH_DAYS); };
export const nextUpkeepDay = function (day: number): number { return (upkeepMonth(day) + 1) * UPKEEP_MONTH_DAYS + 1; };
export const monthlyUpkeep = function ({ fleet, pilots }: CompanyState): number {
	const tons = fleet.reduce(function (total, mech) { return total + bareChassisMass(rigFrameId(mech.frameId)); }, 0);
	return MECH_MONTHLY_UPKEEP_PER_TON * tons + PILOT_MONTHLY_UPKEEP * pilots.filter(function (id) { return id !== 'player'; }).length;
};
export const newUpkeepDue = function (company: Campaign, days: number): number {
	const months = upkeepMonth(company.day + days) - upkeepMonth(company.day);
	return months > 0 ? months * monthlyUpkeep(company) : 0;
};

const spendableUpkeepFunds = function (campaign: Campaign, day: number): number {
	const { credits, planetId } = campaign;
	if (campaign.universe.boardVersion === 1 || getSystemIntel({ ...campaign, day }, planetId).conflict
		|| getTransmission(campaign)?.offers.some(function ({ contract }) { return contract.planetId === planetId; })) return credits;
	// Where there's no work, leave the company a way out if it could afford one.
	const cheapestExit = PLANETS.reduce(function (fare, destination) {
		return destination.id === planetId ? fare : Math.min(fare, getJumpRoute(planetId, destination.id).fare);
	}, Infinity);
	return credits >= cheapestExit ? credits - cheapestExit : credits;
};

const MAX_INVENTORY = 1000;
const emptyInventory = function (): Record<WeaponId, number> { return createWeaponRecord(function () { return 0; }); };

const isObject = function (value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); };
const isInteger = function (value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max; };
const isIntegrity = function (value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100; };
export const isFrameId = function (value: unknown): value is FrameId { return PLAYABLE_FRAMES.some(function (frame) { return frame.id === value; }); };
export const isWeaponId = function (value: unknown): value is WeaponId { return WEAPONS.some(function (weapon) { return weapon.id === value; }); };
const countWeapon = function (loadout: Loadout, weapon: WeaponId) { return loadout.filter(function (entry) { return entry === weapon; }).length; };
const createOwnedMech = function (frameId: FrameId): OwnedMech {
	return { frameId, integrity: 100, ...stockPackage(frameId) };
};
const refitReserves = function (mech: OwnedMech, target: Loadout): readonly number[] {
	return defaultReserves(target).map(function (rounds, slot) { return target[slot] === mech.loadout[slot] ? mech.reserves[slot] ?? rounds : rounds; });
};

const includeLoadout = function (inventory: Readonly<Record<WeaponId, number>>, loadout: Loadout): Record<WeaponId, number> | undefined {
	const next = { ...inventory };
	for (const weapon of loadout) {
		if (weapon === null) continue;
		if (next[weapon] >= MAX_INVENTORY) return undefined;
		next[weapon]++;
	}
	return next;
};
export const createCompany = function (): CompanyState {
	const mech = createOwnedMech('kestrel');
	const inventory = includeLoadout(emptyInventory(), mech.loadout);
	if (!inventory) throw new RangeError('Starter loadout exceeds inventory capacity');
	const lineup = Array.from({ length: SQUAD_SIZE }, function (_, index): PilotAssignment {
		return index === 0 ? { pilotId: 'player', frameId: mech.frameId } : { pilotId: null, frameId: null };
	});
	return { fleet: [mech], selectedFrame: 'kestrel', pilots: ['player'], lineup, inventory, workOrders: [], deployed: undefined };
};

export const getOwnedMech = function (campaign: CompanyState, frameId: RigId = campaign.selectedFrame): OwnedMech | undefined {
	return campaign.fleet.find(function (mech) { return mech.frameId === frameId; });
};
export const workOrderFor = function (campaign: CompanyState, frameId: RigId): WorkOrder | undefined {
	return campaign.workOrders.find(function (order) { return order.frameId === frameId; });
};
// Inventory counts every copy, including fitted and reserved hardware. A refit
// holds both outgoing and incoming weapons until it completes or is cancelled.
export const availableWeapons = function (campaign: CompanyState, weapon: WeaponId, frameId?: RigId): number {
	const reserved = campaign.fleet.reduce(function (total, mech) {
		if (mech.frameId === frameId) return total;
		const order = workOrderFor(campaign, mech.frameId);
		return total + Math.max(countWeapon(mech.loadout, weapon), order?.kind === 'refit' ? countWeapon(order.loadout, weapon) : 0);
	}, 0);
	return campaign.inventory[weapon] - reserved;
};
export const repairDays = function (integrity: number): number { return Math.max(0, Math.ceil((100 - integrity) / 20)); };
export const refitDays = function (current: Loadout, target: Loadout): number { return target.filter(function (weapon, index) { return current[index] !== weapon; }).length; };
export const canRefit = function (campaign: Campaign, frameId: RigId, target: Loadout, reserves?: readonly number[]): boolean {
	const mech = getOwnedMech(campaign, frameId);
	if (campaign.deployed || !mech || workOrderFor(campaign, frameId) || !isFrameLoadout(rigFrameId(frameId), target)) return false;
	const desired = reserves ?? refitReserves(mech, target);
	if (!isReserveLoadout(target, desired)) return false;
	const days = refitDays(mech.loadout, target);
	return (days > 0 ? campaign.day + days < MAX_DAY : desired.some(function (rounds, slot) { return rounds !== mech.reserves[slot]; }))
		&& WEAPONS.every(function (weapon) { return countWeapon(target, weapon.id) <= availableWeapons(campaign, weapon.id, frameId); });
};
export const deploymentIssue = function (campaign: CompanyState, frameId: RigId): string | undefined {
	const mech = getOwnedMech(campaign, frameId);
	if (!mech) return 'Rig is unavailable.';
	const order = workOrderFor(campaign, frameId);
	if (order) return `In Engineering until day ${order.readyDay}.`;
	if (mech.integrity <= 0) return 'Disabled. Schedule repairs in Engineering.';
	if (!isFrameLoadout(rigFrameId(frameId), mech.loadout) || !isReserveLoadout(mech.loadout, mech.reserves) || !loadedMounts(mech.loadout, mech.reserves).some(usableMount)) return 'No usable weapons. Check the loadout in the Mech Bay.';
	return undefined;
};

export const canDeploy = function (campaign: Campaign, frameId: RigId = campaign.selectedFrame): boolean {
	return Boolean(campaign.active) && !campaign.deployed && campaign.day < MAX_DAY && !deploymentIssue(campaign, frameId);
};

export const canDeploySquad = function (campaign: Campaign): boolean {
	const player = campaign.lineup[0];
	return Boolean(player?.frameId && canDeploy(campaign, player.frameId)) && campaign.lineup.slice(1).every(function ({ pilotId, frameId }) {
		return pilotId === null || Boolean(frameId && !deploymentIssue(campaign, frameId));
	});
};

export const assignPilot = function (campaign: Campaign, index: number, pilotId: PilotId | null): Campaign {
	const slot = campaign.lineup[index];
	if (campaign.deployed || !slot || index === 0 || pilotId === 'player' || slot.pilotId === pilotId) return campaign;
	if (pilotId && (!campaign.pilots.includes(pilotId) || campaign.lineup.some(function (entry) { return entry.pilotId === pilotId; }))) return campaign;
	return { ...campaign, lineup: campaign.lineup.map(function (entry, i) { return i === index ? { pilotId, frameId: pilotId ? entry.frameId : null } : entry; }) };
};

export const assignRig = function (campaign: Campaign, index: number, frameId: RigId | null): Campaign {
	const slot = campaign.lineup[index];
	if (campaign.deployed || !slot?.pilotId || slot.frameId === frameId) return campaign;
	if (frameId && (!getOwnedMech(campaign, frameId) || campaign.lineup.some(function (entry) { return entry.frameId === frameId; }))) return campaign;
	return { ...campaign, lineup: campaign.lineup.map(function (entry, i) { return i === index ? { ...entry, frameId } : entry; }) };
};

export const selectFrame = function (campaign: Campaign, frameId: RigId): Campaign {
	if (campaign.deployed || !getOwnedMech(campaign, frameId) || campaign.selectedFrame === frameId) return campaign;
	return { ...campaign, selectedFrame: frameId };
};
export const buyFrame = function (campaign: Campaign, frameId: FrameId): Campaign {
	if (campaign.deployed || !isFrameId(frameId)) return campaign;
	const offer = getFrameOffer(campaign, frameId);
	if (campaign.credits < offer.price) return campaign;
	let serial = 1;
	while (getOwnedMech(campaign, serial === 1 ? frameId : `${frameId}#${serial}`)) serial++;
	const id: RigId = serial === 1 ? frameId : `${frameId}#${serial}`;
	const mech: OwnedMech = { frameId: id, integrity: 100, loadout: offer.loadout, reserves: offer.reserves };
	const inventory = includeLoadout(campaign.inventory, mech.loadout);
	if (!inventory) return campaign;
	return {
		...campaign, credits: campaign.credits - offer.price,
		fleet: [...campaign.fleet, mech], inventory,
	};
};
// Grant only missing chassis; existing equipment, damage and deployment stay intact.
export const unlockAllRigs = function (campaign: Campaign): Campaign {
	return PLAYABLE_FRAMES.reduce(function (company, frame) {
		if (getOwnedMech(company, frame.id)) return company;
		const mech = createOwnedMech(frame.id);
		const inventory = includeLoadout(company.inventory, mech.loadout);
		if (!inventory) return company;
		return {
			...company,
			fleet: [...company.fleet, mech], inventory,
		};
	}, campaign);
};
export const applyRigCheat = function (campaign: Campaign): Campaign {
	return unlockAllRigs({ ...campaign, credits: Math.min(MAX_CREDITS, campaign.credits + 1_000_000) });
};
export const buyWeapon = function (campaign: Campaign, weapon: WeaponId): Campaign {
	if (campaign.deployed || !isWeaponId(weapon) || getWeapon(weapon).tier > unlockedMissionTier(campaign).weaponTier || campaign.credits < WEAPON_PRICES[weapon] || campaign.inventory[weapon] >= MAX_INVENTORY) return campaign;
	return { ...campaign, credits: campaign.credits - WEAPON_PRICES[weapon], inventory: { ...campaign.inventory, [weapon]: campaign.inventory[weapon] + 1 } };
};
export const queueRepair = function (campaign: Campaign, frameId: RigId): Campaign {
	const mech = getOwnedMech(campaign, frameId);
	if (campaign.deployed || !mech || mech.integrity >= 100 || workOrderFor(campaign, frameId)) return campaign;
	const readyDay = campaign.day + repairDays(mech.integrity);
	if (readyDay >= MAX_DAY) return campaign;
	return { ...campaign, workOrders: [...campaign.workOrders, { kind: 'repair', frameId, startedDay: campaign.day, readyDay }] };
};
export const setAmmunition = function (campaign: Campaign, frameId: RigId, reserves: readonly number[]): Campaign {
	const mech = getOwnedMech(campaign, frameId);
	if (campaign.deployed || !mech || workOrderFor(campaign, frameId) || !isReserveLoadout(mech.loadout, reserves)
		|| reserves.every(function (rounds, slot) { return rounds === mech.reserves[slot]; })) return campaign;
	return { ...campaign, fleet: campaign.fleet.map(function (owned) { return owned.frameId === frameId ? { ...owned, reserves: [...reserves] } : owned; }) };
};
export const queueRefit = function (campaign: Campaign, frameId: RigId, loadout: Loadout, reserves?: readonly number[]): Campaign {
	const mech = getOwnedMech(campaign, frameId);
	if (!mech || !canRefit(campaign, frameId, loadout, reserves)) return campaign;
	const desired = reserves ?? refitReserves(mech, loadout);
	const days = refitDays(mech.loadout, loadout);
	if (days === 0) return setAmmunition(campaign, frameId, desired);
	return { ...campaign, workOrders: [...campaign.workOrders, { kind: 'refit', frameId, startedDay: campaign.day, readyDay: campaign.day + days, loadout: [...loadout], reserves: [...desired] }] };
};
export const cancelWorkOrder = function (campaign: Campaign, frameId: RigId): Campaign {
	if (campaign.deployed || !workOrderFor(campaign, frameId)) return campaign;
	return { ...campaign, workOrders: campaign.workOrders.filter(function (order) { return order.frameId !== frameId; }) };
};
export const advanceDays = function (campaign: Campaign, days: number): Campaign {
	if (campaign.deployed || !isInteger(days, 1, MAX_DAY) || campaign.day + days > MAX_DAY - Number(Boolean(campaign.active))) return campaign;
	const day = campaign.day + days;
	const fleet = campaign.fleet.map(function (mech) {
		const order = workOrderFor(campaign, mech.frameId);
		if (!order || order.readyDay > day) return mech;
		return order.kind === 'repair' ? { ...mech, integrity: 100 } : { ...mech, loadout: [...order.loadout], reserves: [...order.reserves] };
	});
	const due = newUpkeepDue(campaign, days) + (campaign.upkeepOwed ?? 0);
	const paid = due ? Math.min(spendableUpkeepFunds(campaign, day), due) : 0;
	return { ...campaign, day, fleet, workOrders: campaign.workOrders.filter(function (order) { return order.readyDay > day; }),
		...(due ? { credits: campaign.credits - paid, upkeepOwed: Math.min(MAX_CREDITS, due - paid) } : {}) };
};
export const beginDeployment = function (campaign: Campaign): Campaign {
	const frameId = campaign.lineup[0]?.frameId;
	if (!frameId || !canDeploySquad(campaign)) return campaign;
	const snapshot = function (mech: OwnedMech): DeployedRig { return { frameId: mech.frameId, integrity: mech.integrity, startingIntegrity: mech.integrity }; };
	const mech = getOwnedMech(campaign, frameId);
	if (!mech) return campaign;
	const wing = campaign.lineup.slice(1).flatMap(function (slot): DeployedPilot[] {
		const rig = slot.frameId ? getOwnedMech(campaign, slot.frameId) : undefined;
		return rig && slot.pilotId ? [{ ...snapshot(rig), pilotId: slot.pilotId }] : [];
	});
	return { ...campaign, deployed: { ...snapshot(mech), coolantCharges: 2, wing } };
};
export const checkpointDeployment = function (campaign: Campaign, integrity: number, coolantCharges: number, wing: readonly { frameId: RigId; hp: number }[] = []): Campaign {
	const deployed = campaign.deployed;
	if (!deployed || !Number.isFinite(integrity) || !isInteger(coolantCharges, 0, 2)) return campaign;
	const remainingIntegrity = Math.min(deployed.integrity, Math.max(0, integrity));
	const remainingCoolant = Math.min(deployed.coolantCharges, coolantCharges);
	const remainingWing = deployed.wing.map(function (rig) {
		const hp = wing.find(function (sample) { return sample.frameId === rig.frameId; })?.hp;
		const remaining = hp === undefined || !Number.isFinite(hp) ? rig.integrity : Math.min(rig.integrity, Math.max(0, hp));
		return remaining === rig.integrity ? rig : { ...rig, integrity: remaining };
	});
	if (remainingIntegrity === deployed.integrity && remainingCoolant === deployed.coolantCharges && remainingWing.every(function (rig, index) { return rig === deployed.wing[index]; })) return campaign;
	const next = { ...deployed, integrity: remainingIntegrity, coolantCharges: remainingCoolant, wing: remainingWing };
	return {
		...campaign, deployed: next,
		fleet: campaign.fleet.map(function (mech) {
			const rig = mech.frameId === next.frameId ? next : remainingWing.find(function (member) { return member.frameId === mech.frameId; });
			return rig && rig.integrity !== mech.integrity ? { ...mech, integrity: rig.integrity } : mech;
		}),
	};
};

const isOwnedMech = function (value: unknown): value is OwnedMech {
	return isObject(value) && isRigId(value['frameId']) && isIntegrity(value['integrity']) && isFrameLoadout(rigFrameId(value['frameId']), value['loadout']) && isReserveLoadout(value['loadout'], value['reserves']);
};
const isWorkOrder = function (value: unknown): value is WorkOrder {
	return isObject(value) && isRigId(value['frameId']) && isInteger(value['startedDay'], 1, MAX_DAY) && isInteger(value['readyDay'], 2, MAX_DAY - 1)
		&& value['readyDay'] > value['startedDay'] && (value['kind'] === 'repair' || value['kind'] === 'refit' && isFrameLoadout(rigFrameId(value['frameId']), value['loadout']) && isReserveLoadout(value['loadout'], value['reserves']));
};
const isDeployedRig = function (value: Record<string, unknown>): boolean {
	return isRigId(value['frameId']) && isIntegrity(value['integrity']) && isIntegrity(value['startingIntegrity']) && value['startingIntegrity'] > 0 && value['startingIntegrity'] >= value['integrity'];
};
const isDeployedPilot = function (value: unknown): value is DeployedPilot {
	return isObject(value) && isPilotId(value['pilotId']) && isDeployedRig(value);
};
export const isSortieSquad = function (value: unknown): value is readonly DeployedPilot[] {
	return Array.isArray(value) && value.length >= 1 && value.length <= SQUAD_SIZE && value.every(isDeployedPilot)
		&& new Set(value.map(function (pilot) { return pilot.pilotId; })).size === value.length
		&& new Set(value.map(function (pilot) { return pilot.frameId; })).size === value.length;
};
export const isDeployedSquad = function (value: unknown): value is readonly DeployedPilot[] {
	return isSortieSquad(value) && value[0]?.pilotId === 'player';
};
const isDeployment = function (value: unknown): value is Deployment {
	return isObject(value) && isDeployedRig(value) && isInteger(value['coolantCharges'], 0, 2)
		&& Array.isArray(value['wing']) && value['wing'].length < SQUAD_SIZE && isDeployedSquad([{ ...value, pilotId: 'player' }, ...value['wing']]);
};
export const isAssignment = function (value: unknown): value is PilotAssignment {
	return isObject(value) && (value['pilotId'] === null || isPilotId(value['pilotId']))
		&& (value['frameId'] === null || value['pilotId'] !== null && isRigId(value['frameId']));
};
const isInventory = function (value: unknown): value is Record<WeaponId, number> {
	return isObject(value) && WEAPONS.every(function (weapon) { return isInteger(value[weapon.id], 0, MAX_INVENTORY); });
};
// Validate the whole ownership transaction, not just individual shapes. An
// edited/corrupt save must not equip or reserve more copies than were owned.
export const parseCompany = function (value: Record<string, unknown>, day: number, active: boolean): CompanyState | undefined {
	const fleet = value['fleet']; const workOrders = value['workOrders']; const savedInventory = value['inventory'];
	const inventory = savedInventory; const selectedFrame = value['selectedFrame']; const deployed = value['deployed'];
	const pilots = value['pilots']; const lineup = value['lineup'];
	if (!Array.isArray(pilots) || !pilots.every(isPilotId) || !pilots.includes('player') || new Set(pilots).size !== pilots.length
		|| !Array.isArray(lineup) || lineup.length !== SQUAD_SIZE || !lineup.every(isAssignment) || lineup[0]?.pilotId !== 'player') return undefined;
	const assignedPilots = lineup.flatMap(function (slot) { return slot.pilotId ? [slot.pilotId] : []; });
	const assignedFrames = lineup.flatMap(function (slot) { return slot.frameId ? [slot.frameId] : []; });
	if (new Set(assignedPilots).size !== assignedPilots.length || !assignedPilots.every(function (id) { return pilots.includes(id); })
		|| new Set(assignedFrames).size !== assignedFrames.length) return undefined;
	if (!Array.isArray(fleet) || fleet.length < 1 || !fleet.every(isOwnedMech)
		|| !Array.isArray(workOrders) || workOrders.length > fleet.length || !workOrders.every(isWorkOrder)
		|| !isInventory(inventory) || !isRigId(selectedFrame) || deployed !== undefined && !isDeployment(deployed)) return undefined;
	if (new Set(fleet.map(function (mech) { return mech.frameId; })).size !== fleet.length
		|| new Set(workOrders.map(function (order) { return order.frameId; })).size !== workOrders.length
		|| !fleet.some(function (mech) { return mech.frameId === 'kestrel'; })) return undefined;
	const company: CompanyState = {
		fleet: fleet.map(function (mech) { return { frameId: mech.frameId, integrity: mech.integrity, loadout: [...mech.loadout], reserves: [...mech.reserves] }; }), selectedFrame, pilots, lineup,
		inventory: { ...inventory }, workOrders: workOrders.map(function (order) { return order.kind === 'repair'
			? { kind: 'repair', frameId: order.frameId, startedDay: order.startedDay, readyDay: order.readyDay }
			: { kind: 'refit', frameId: order.frameId, startedDay: order.startedDay, readyDay: order.readyDay, loadout: [...order.loadout], reserves: [...order.reserves] }; }),
		deployed,
	};
	if (!getOwnedMech(company, selectedFrame) || !assignedFrames.every(function (id) { return getOwnedMech(company, id); })
		|| WEAPONS.some(function (weapon) { return availableWeapons(company, weapon.id) < 0; })) return undefined;
	if (workOrders.some(function (order) {
		const mech = getOwnedMech(company, order.frameId);
		if (!mech || order.startedDay > day || order.readyDay <= day) return true;
		const duration = order.kind === 'repair' ? repairDays(mech.integrity) : refitDays(mech.loadout, order.loadout);
		return duration === 0 || order.readyDay !== order.startedDay + duration;
	})) return undefined;
	if (deployed) {
		const members = lineup.filter(function (slot) { return slot.pilotId !== null; });
		const deployedPilots = [{ ...deployed, pilotId: 'player' }, ...deployed.wing];
		if (!active || members.length !== deployedPilots.length || !deployedPilots.every(function (member, index) {
			const mech = getOwnedMech(company, member.frameId);
			return members[index]?.pilotId === member.pilotId && members[index]?.frameId === member.frameId && mech?.integrity === member.integrity
				&& loadedMounts(mech.loadout, mech.reserves).some(usableMount) && !workOrderFor(company, member.frameId);
		})) return undefined;
	}
	return company;
};
