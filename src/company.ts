import { WEAPONS, type WeaponId } from './arsenal';
import type { Campaign } from './campaign';
import { FRAMES, getFrame, type FrameId } from './frames';

export type Loadout = readonly (WeaponId | null)[];
export interface OwnedMech {
	frameId: FrameId;
	integrity: number;
	loadout: Loadout;
}
interface WorkOrderDates { frameId: FrameId; startedDay: number; readyDay: number }
export type WorkOrder = (WorkOrderDates & { kind: 'repair' }) | (WorkOrderDates & { kind: 'refit'; loadout: Loadout });
export interface Deployment { frameId: FrameId; integrity: number; coolantCharges: number }
export interface CompanyState {
	fleet: readonly OwnedMech[];
	selectedFrame: FrameId;
	inventory: Record<WeaponId, number>;
	workOrders: readonly WorkOrder[];
	deployed: Deployment | undefined;
}

export const MAX_DAY = 1_000_000_000;
const MAX_INVENTORY = 1000;
export const FRAME_PRICES: Readonly<Record<FrameId, number>> = { kestrel: 4000, warden: 5000, longbow: 6000, morrow: 6500, maul: 7500 };
export const WEAPON_PRICES: Readonly<Record<WeaponId, number>> = {
	'machine-gun': 500, autocannon: 750, laser: 800, 'stream-rockets': 850,
	'stream-missiles': 1000, 'cluster-rockets': 1200, 'cluster-missiles': 1400, ppc: 1500,
};
const isObject = function (value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); };
const isInteger = function (value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max; };
const isIntegrity = function (value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100; };
export const isFrameId = function (value: unknown): value is FrameId { return FRAMES.some(function (frame) { return frame.id === value; }); };
export const isWeaponId = function (value: unknown): value is WeaponId { return WEAPONS.some(function (weapon) { return weapon.id === value; }); };
const isLoadout = function (value: unknown): value is Loadout { return Array.isArray(value) && value.length === 4 && value.every(function (entry: unknown) { return entry === null || isWeaponId(entry); }); };
const countWeapon = function (loadout: Loadout, weapon: WeaponId) { return loadout.filter(function (entry) { return entry === weapon; }).length; };

export const createCompany = function (): CompanyState {
	return {
		fleet: [{ frameId: 'kestrel', integrity: 100, loadout: ['machine-gun', null, null, null] }], selectedFrame: 'kestrel',
		inventory: { 'machine-gun': 1, autocannon: 0, laser: 0, ppc: 0, 'stream-rockets': 0, 'cluster-rockets': 0, 'stream-missiles': 0, 'cluster-missiles': 0 },
		workOrders: [], deployed: undefined,
	};
};

export const getOwnedMech = function (campaign: CompanyState, frameId: FrameId = campaign.selectedFrame): OwnedMech | undefined {
	return campaign.fleet.find(function (mech) { return mech.frameId === frameId; });
};
export const workOrderFor = function (campaign: CompanyState, frameId: FrameId): WorkOrder | undefined {
	return campaign.workOrders.find(function (order) { return order.frameId === frameId; });
};
// Inventory counts every copy, including fitted and reserved hardware. A refit
// holds both outgoing and incoming weapons until it completes or is cancelled.
export const availableWeapons = function (campaign: CompanyState, weapon: WeaponId, frameId?: FrameId): number {
	const reserved = campaign.fleet.reduce(function (total, mech) {
		if (mech.frameId === frameId) return total;
		const order = workOrderFor(campaign, mech.frameId);
		return total + Math.max(countWeapon(mech.loadout, weapon), order?.kind === 'refit' ? countWeapon(order.loadout, weapon) : 0);
	}, 0);
	return campaign.inventory[weapon] - reserved;
};
export const repairDays = function (integrity: number): number { return Math.max(0, Math.ceil((100 - integrity) / 20)); };
export const refitDays = function (current: Loadout, target: Loadout): number { return target.filter(function (weapon, index) { return current[index] !== weapon; }).length; };
export const canRefit = function (campaign: Campaign, frameId: FrameId, target: Loadout): boolean {
	const mech = getOwnedMech(campaign, frameId);
	return !campaign.deployed && Boolean(mech) && !workOrderFor(campaign, frameId) && isLoadout(target)
		&& Boolean(mech && refitDays(mech.loadout, target) > 0 && campaign.day + refitDays(mech.loadout, target) < MAX_DAY)
		&& WEAPONS.every(function (weapon) { return countWeapon(target, weapon.id) <= availableWeapons(campaign, weapon.id, frameId); });
};
export const canDeploy = function (campaign: Campaign, frameId: FrameId = campaign.selectedFrame): boolean {
	const mech = getOwnedMech(campaign, frameId);
	return Boolean(campaign.active) && !campaign.deployed && Boolean(mech && mech.integrity > 0 && mech.loadout.some(function (weapon) { return weapon !== null; }))
		&& !workOrderFor(campaign, frameId) && campaign.day < MAX_DAY;
};

export const selectFrame = function (campaign: Campaign, frameId: FrameId): Campaign {
	if (campaign.deployed || !getOwnedMech(campaign, frameId) || campaign.selectedFrame === frameId) return campaign;
	return { ...campaign, selectedFrame: frameId };
};
export const buyFrame = function (campaign: Campaign, frameId: FrameId): Campaign {
	if (campaign.deployed || !isFrameId(frameId) || getOwnedMech(campaign, frameId) || campaign.credits < FRAME_PRICES[frameId]) return campaign;
	const starter = getFrame(frameId).starter;
	if (campaign.inventory[starter] >= MAX_INVENTORY) return campaign;
	return {
		...campaign, credits: campaign.credits - FRAME_PRICES[frameId],
		fleet: [...campaign.fleet, { frameId, integrity: 100, loadout: [starter, null, null, null] }],
		inventory: { ...campaign.inventory, [starter]: campaign.inventory[starter] + 1 },
	};
};
// Grant only missing chassis; existing equipment, damage and deployment stay intact.
export const unlockAllRigs = function (campaign: Campaign): Campaign {
	return FRAMES.reduce(function (company, frame) {
		if (getOwnedMech(company, frame.id)) return company;
		return {
			...company,
			fleet: [...company.fleet, { frameId: frame.id, integrity: 100, loadout: [frame.starter, null, null, null] }],
			inventory: { ...company.inventory, [frame.starter]: Math.min(MAX_INVENTORY, company.inventory[frame.starter] + 1) },
		};
	}, campaign);
};
export const buyWeapon = function (campaign: Campaign, weapon: WeaponId): Campaign {
	if (campaign.deployed || !isWeaponId(weapon) || campaign.credits < WEAPON_PRICES[weapon] || campaign.inventory[weapon] >= MAX_INVENTORY) return campaign;
	return { ...campaign, credits: campaign.credits - WEAPON_PRICES[weapon], inventory: { ...campaign.inventory, [weapon]: campaign.inventory[weapon] + 1 } };
};
export const queueRepair = function (campaign: Campaign, frameId: FrameId): Campaign {
	const mech = getOwnedMech(campaign, frameId);
	if (campaign.deployed || !mech || mech.integrity >= 100 || workOrderFor(campaign, frameId)) return campaign;
	const readyDay = campaign.day + repairDays(mech.integrity);
	if (readyDay >= MAX_DAY) return campaign;
	return { ...campaign, workOrders: [...campaign.workOrders, { kind: 'repair', frameId, startedDay: campaign.day, readyDay }] };
};
export const queueRefit = function (campaign: Campaign, frameId: FrameId, loadout: Loadout): Campaign {
	const mech = getOwnedMech(campaign, frameId);
	if (!mech || !canRefit(campaign, frameId, loadout)) return campaign;
	return { ...campaign, workOrders: [...campaign.workOrders, { kind: 'refit', frameId, startedDay: campaign.day, readyDay: campaign.day + refitDays(mech.loadout, loadout), loadout: [...loadout] }] };
};
export const cancelWorkOrder = function (campaign: Campaign, frameId: FrameId): Campaign {
	if (campaign.deployed || !workOrderFor(campaign, frameId)) return campaign;
	return { ...campaign, workOrders: campaign.workOrders.filter(function (order) { return order.frameId !== frameId; }) };
};
export const advanceDays = function (campaign: Campaign, days: number): Campaign {
	if (campaign.deployed || !isInteger(days, 1, MAX_DAY) || campaign.day + days > MAX_DAY - Number(Boolean(campaign.active))) return campaign;
	const day = campaign.day + days;
	const fleet = campaign.fleet.map(function (mech) {
		const order = workOrderFor(campaign, mech.frameId);
		if (!order || order.readyDay > day) return mech;
		return order.kind === 'repair' ? { ...mech, integrity: 100 } : { ...mech, loadout: [...order.loadout] };
	});
	return { ...campaign, day, fleet, workOrders: campaign.workOrders.filter(function (order) { return order.readyDay > day; }) };
};
export const beginDeployment = function (campaign: Campaign): Campaign {
	const mech = getOwnedMech(campaign);
	if (!mech || !canDeploy(campaign)) return campaign;
	return { ...campaign, deployed: { frameId: mech.frameId, integrity: mech.integrity, coolantCharges: 2 } };
};
export const checkpointDeployment = function (campaign: Campaign, integrity: number, coolantCharges: number): Campaign {
	const deployed = campaign.deployed;
	if (!deployed || !Number.isFinite(integrity) || !isInteger(coolantCharges, 0, 2)) return campaign;
	const remainingIntegrity = Math.min(deployed.integrity, Math.max(0, integrity));
	const remainingCoolant = Math.min(deployed.coolantCharges, coolantCharges);
	if (remainingIntegrity === deployed.integrity && remainingCoolant === deployed.coolantCharges) return campaign;
	return {
		...campaign, deployed: { ...deployed, integrity: remainingIntegrity, coolantCharges: remainingCoolant },
		fleet: campaign.fleet.map(function (mech) { return mech.frameId === deployed.frameId ? { ...mech, integrity: remainingIntegrity } : mech; }),
	};
};

const isOwnedMech = function (value: unknown): value is OwnedMech {
	return isObject(value) && isFrameId(value['frameId']) && isIntegrity(value['integrity']) && isLoadout(value['loadout']);
};
const isWorkOrder = function (value: unknown): value is WorkOrder {
	return isObject(value) && isFrameId(value['frameId']) && isInteger(value['startedDay'], 1, MAX_DAY) && isInteger(value['readyDay'], 2, MAX_DAY - 1)
		&& value['readyDay'] > value['startedDay'] && (value['kind'] === 'repair' || value['kind'] === 'refit' && isLoadout(value['loadout']));
};
const isDeployment = function (value: unknown): value is Deployment {
	return isObject(value) && isFrameId(value['frameId']) && isIntegrity(value['integrity']) && isInteger(value['coolantCharges'], 0, 2);
};
const isInventory = function (value: unknown): value is Record<WeaponId, number> {
	return isObject(value) && WEAPONS.every(function (weapon) { return isInteger(value[weapon.id], 0, MAX_INVENTORY); });
};
// Validate the whole ownership transaction, not just individual shapes. An
// edited/corrupt save must not equip or reserve more copies than were owned.
export const parseCompany = function (value: Record<string, unknown>, day: number, active: boolean): CompanyState | undefined {
	const fleet = value['fleet']; const workOrders = value['workOrders']; const inventory = value['inventory']; const selectedFrame = value['selectedFrame']; const deployed = value['deployed'];
	if (!Array.isArray(fleet) || fleet.length < 1 || fleet.length > FRAMES.length || !fleet.every(isOwnedMech)
		|| !Array.isArray(workOrders) || workOrders.length > fleet.length || !workOrders.every(isWorkOrder)
		|| !isInventory(inventory) || !isFrameId(selectedFrame) || deployed !== undefined && !isDeployment(deployed)) return undefined;
	if (new Set(fleet.map(function (mech) { return mech.frameId; })).size !== fleet.length
		|| new Set(workOrders.map(function (order) { return order.frameId; })).size !== workOrders.length
		|| !fleet.some(function (mech) { return mech.frameId === 'kestrel'; })) return undefined;
	const company: CompanyState = {
		fleet: fleet.map(function (mech) { return { frameId: mech.frameId, integrity: mech.integrity, loadout: [...mech.loadout] }; }), selectedFrame,
		inventory: { ...inventory }, workOrders: workOrders.map(function (order) { return order.kind === 'repair'
			? { kind: 'repair', frameId: order.frameId, startedDay: order.startedDay, readyDay: order.readyDay }
			: { kind: 'refit', frameId: order.frameId, startedDay: order.startedDay, readyDay: order.readyDay, loadout: [...order.loadout] }; }),
		deployed: deployed ? { frameId: deployed.frameId, integrity: deployed.integrity, coolantCharges: deployed.coolantCharges } : undefined,
	};
	if (!getOwnedMech(company, selectedFrame) || WEAPONS.some(function (weapon) { return availableWeapons(company, weapon.id) < 0; })) return undefined;
	if (workOrders.some(function (order) {
		const mech = getOwnedMech(company, order.frameId);
		if (!mech || order.startedDay > day || order.readyDay <= day) return true;
		const duration = order.kind === 'repair' ? repairDays(mech.integrity) : refitDays(mech.loadout, order.loadout);
		return duration === 0 || order.readyDay !== order.startedDay + duration;
	})) return undefined;
	if (deployed) {
		const mech = getOwnedMech(company, deployed.frameId);
		if (!active || !mech || deployed.frameId !== selectedFrame || mech.integrity !== deployed.integrity || !mech.loadout.some(function (weapon) { return weapon !== null; })
			|| workOrderFor(company, deployed.frameId)) return undefined;
	}
	return company;
};
