import { expect, test } from 'bun:test';
import { acceptContract, abandonContract, createCampaign, getContracts, parseCampaign, recoverInterruptedDeployment, type Campaign } from '../src/campaign';
import { advanceDays, beginDeployment, buyFrame, buyWeapon, canRefit, checkpointDeployment, getOwnedMech, isFrameId, queueRefit, queueRepair, selectFrame } from '../src/company';
import { frameWeight, loadedMounts } from '../src/combat-resources';
import { CHASSIS_IDS, FRAMES, getFrame } from '../src/frames';
import { canEquipWeapon, createStarterLoadout, getHardpoints, isFrameLoadout } from '../src/hardpoints';
import { createMissionState } from '../src/simulation';

const accept = function (campaign: Campaign): Campaign {
	const contract = getContracts(campaign)[0];
	if (!contract) throw new Error('Missing contract fixture');
	return acceptContract(campaign, contract.id);
};

test('the six chassis each offer three distinct purchasable variants with legal starter equipment', function () {
	expect(FRAMES).toHaveLength(18);
	expect(new Set(FRAMES.map(function (frame) { return frame.id; })).size).toBe(18);
	for (const chassisId of CHASSIS_IDS) {
		const variants = FRAMES.filter(function (frame) { return frame.chassisId === chassisId; });
		expect(variants.map(function (frame) { return frame.variant; })).toEqual(['A', 'B', 'C']);
		expect(variants[0]?.id).toBe(chassisId);
		for (const frame of variants) {
			expect(isFrameId(frame.id)).toBe(true);
			expect(isFrameLoadout(frame.id, createStarterLoadout(frame.id))).toBe(true);
			expect(frame.price).toBeGreaterThan(0);
			expect(getHardpoints(frame.id).length).toBeLessThanOrEqual(4);
		}
	}
	expect(isFrameId('kestrel-a')).toBe(false);
	expect(isFrameId('rook-d')).toBe(false);
});

test('compact mounts enforce their equipment limits while full banks support the intended families', function () {
	for (const frame of ['kestrel-b', 'longbow-b'] as const) {
		expect(canEquipWeapon(frame, 1, 'laser')).toBe(true);
		expect(canEquipWeapon(frame, 1, 'ppc')).toBe(false);
	}
	for (const [frame, slot] of [['kestrel-c', 1], ['longbow-c', 1], ['rook', 2], ['rook-b', 2], ['rook-c', 2]] as const) {
		for (const weapon of ['stream-missiles', 'cluster-missiles', 'stream-rockets', 'cluster-rockets'] as const) {
			expect(canEquipWeapon(frame, slot, weapon)).toBe(true);
			expect(canEquipWeapon(frame, slot, `${weapon}-4`)).toBe(false);
			expect(canEquipWeapon(frame, slot, `${weapon}-6`)).toBe(false);
		}
	}
	for (const frame of ['kestrel', 'kestrel-b', 'kestrel-c'] as const) expect(canEquipWeapon(frame, 0, 'autocannon')).toBe(false);
	expect(canEquipWeapon('warden-b', 2, 'ppc')).toBe(true);
	expect(canEquipWeapon('warden-b', 3, 'laser')).toBe(true);
	expect(canEquipWeapon('warden-b', 3, 'cluster-rockets')).toBe(false);
	expect(canEquipWeapon('warden-c', 2, 'ppc')).toBe(true);
	expect(canEquipWeapon('warden-c', 3, 'cluster-rockets-6')).toBe(true);
	expect(canEquipWeapon('maul-b', 1, 'autocannon')).toBe(true);
	expect(canEquipWeapon('maul-c', 1, 'ppc')).toBe(true);
	expect(canEquipWeapon('morrow-b', 0, 'laser')).toBe(true);
	expect(canEquipWeapon('morrow-b', 1, 'ppc')).toBe(true);
	expect(canEquipWeapon('morrow-c', 0, 'ppc')).toBe(true);
	expect(canEquipWeapon('morrow-c', 1, 'cluster-missiles-6')).toBe(true);
});

test('Longbow auxiliary structure costs mass and mobility even with the secondary weapon removed', function () {
	const primary = loadedMounts(['ppc']);
	const standard = frameWeight('longbow', primary);
	const auxiliary = frameWeight('longbow-c', loadedMounts(['ppc', null]));
	expect(auxiliary.total - standard.total).toBe(3);
	expect(auxiliary.speed).toBeLessThan(standard.speed);
	expect(getFrame('longbow-b').mass - getFrame('longbow').mass).toBe(3);
	expect(getFrame('longbow-c').recommendedMass).toBe(getFrame('longbow').recommendedMass);
});

test('separately purchased variants preserve independent equipment, reserves, damage and workshop orders', function () {
	const company = buyWeapon(buyWeapon(buyFrame(buyFrame({ ...createCampaign(83), credits: 50000 }, 'kestrel-b'), 'kestrel-c'), 'laser'), 'cluster-rockets');
	expect(company.fleet.map(function (mech) { return mech.frameId; })).toEqual(['kestrel', 'kestrel-b', 'kestrel-c']);
	expect(company.inventory['machine-gun']).toBe(3);
	expect(buyFrame(company, 'kestrel-b')).toBe(company);
	const queued = queueRefit(queueRefit(company, 'kestrel-b', ['machine-gun', 'laser'], [300, 0]), 'kestrel-c', ['machine-gun', 'cluster-rockets'], [400, 45]);
	expect(queued.workOrders).toHaveLength(2);
	const complete = advanceDays(parseCampaign(JSON.stringify(queued)), 1);
	expect(getOwnedMech(complete, 'kestrel-b')?.reserves).toEqual([300, 0]);
	expect(getOwnedMech(complete, 'kestrel-c')?.reserves).toEqual([400, 45]);
	const deployed = beginDeployment(accept(selectFrame(complete, 'kestrel-b')));
	expect(deployed.deployed?.frameId).toBe('kestrel-b');
	const damaged = checkpointDeployment(deployed, 53, 1);
	expect(getOwnedMech(damaged, 'kestrel-b')?.integrity).toBe(53);
	expect(getOwnedMech(damaged, 'kestrel-c')?.integrity).toBe(100);
	expect(getOwnedMech(damaged, 'kestrel')?.integrity).toBe(100);
	const returned = abandonContract(parseCampaign(JSON.stringify(damaged)));
	const repairing = queueRepair(returned, 'kestrel-b');
	expect(canRefit(repairing, 'kestrel-c', ['machine-gun', null])).toBe(true);
	const bothOrders = queueRefit(repairing, 'kestrel-c', ['machine-gun', null]);
	expect(bothOrders.workOrders.map(function (order) { return order.frameId; })).toEqual(['kestrel-b', 'kestrel-c']);
	expect(parseCampaign(JSON.stringify(bothOrders))).toEqual(bothOrders);
	const contract = deployed.active; const mech = getOwnedMech(complete, 'kestrel-c');
	if (!contract || !mech) throw new Error('Missing variant fixture');
	const combat = createMissionState(contract, { frame: mech.frameId, loadout: mech.loadout, reserves: mech.reserves });
	expect(combat.frame).toBe('kestrel-c');
	expect(combat.loadout.map(function (mount) { return [mount.slot, mount.weapon, mount.rounds]; })).toEqual([[0, 'machine-gun', 400], [1, 'cluster-rockets', 45]]);
});

test('pre-variant v4 saves retain original rig identities, damage, pending work, supplies and deployment recovery', function () {
	// Deliberately use the old serialized shapes and original IDs, with no variant metadata.
	const legacy: Campaign = {
		...createCampaign(73), credits: 12345, selectedFrame: 'longbow',
		fleet: [
			{ frameId: 'kestrel', integrity: 64, loadout: ['machine-gun', null], reserves: [1200, 0] },
			{ frameId: 'warden', integrity: 82, loadout: ['autocannon', null, null, null], reserves: [240, 0, 0, 0] },
			{ frameId: 'maul', integrity: 100, loadout: ['cluster-rockets', null], reserves: [360, 0] },
			{ frameId: 'longbow', integrity: 73, loadout: ['ppc'], reserves: [0] },
			{ frameId: 'morrow', integrity: 100, loadout: ['cluster-missiles', null], reserves: [360, 0] },
		],
		inventory: { ...createCampaign(73).inventory, 'machine-gun': 2, autocannon: 1, ppc: 1, 'cluster-rockets': 1, 'cluster-missiles': 1 },
		workOrders: [
			{ kind: 'repair', frameId: 'kestrel', startedDay: 1, readyDay: 3 },
			{ kind: 'refit', frameId: 'warden', startedDay: 1, readyDay: 2, loadout: ['autocannon', 'machine-gun', null, null], reserves: [140, 800, 0, 0] },
		],
	};
	expect(parseCampaign(JSON.stringify(legacy))).toEqual(legacy);
	const deployed = checkpointDeployment(beginDeployment(accept(legacy)), 51, 1);
	expect(deployed.deployed).toEqual({ frameId: 'longbow', integrity: 51, coolantCharges: 1 });
	const restored = parseCampaign(JSON.stringify(deployed));
	expect(restored).toEqual(deployed);
	expect(restored.fleet.every(function (mech) { return getFrame(mech.frameId).variant === 'A'; })).toBe(true);
	const recovered = recoverInterruptedDeployment(restored);
	expect(recovered.credits).toBe(legacy.credits);
	expect(getOwnedMech(recovered, 'longbow')?.integrity).toBe(51);
	expect(getOwnedMech(recovered, 'warden')?.loadout).toEqual(['autocannon', 'machine-gun', null, null]);
	expect(getOwnedMech(recovered, 'warden')?.reserves).toEqual([140, 800, 0, 0]);
	expect(recovered.workOrders.map(function (order) { return order.frameId; })).toEqual(['kestrel']);
	expect(recoverInterruptedDeployment(parseCampaign(JSON.stringify(recovered)))).toEqual(recovered);
});
