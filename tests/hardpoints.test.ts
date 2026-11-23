import { rigFrameId } from '../src/rigs';
import { expect, test } from 'bun:test';
import { acceptContract, createCampaign, getContracts, parseCampaign } from '../src/campaign';
import { advanceDays, buyWeapon, canDeploy, canRefit, getOwnedMech, queueRefit, selectFrame, unlockAllRigs } from '../src/company';
import { FRAMES, getFrame } from '../src/frames';
import { canEquipWeapon, createStarterLoadout, getHardpoints, isFrameLoadout } from '../src/hardpoints';

test('physical hardpoints reject wrong families, oversized guns, and nonexistent slots', function () {
	expect(canEquipWeapon('kestrel', 0, 'machine-gun')).toBe(true);
	expect(canEquipWeapon('kestrel', 1, 'autocannon')).toBe(false);
	expect(canEquipWeapon('kestrel', 2, 'machine-gun')).toBe(false);
	expect(canEquipWeapon('warden', 1, 'autocannon')).toBe(true);
	expect(canEquipWeapon('warden', 2, 'machine-gun')).toBe(false);
	expect(canEquipWeapon('warden', 2, 'cluster-missiles')).toBe(true);
	expect(canEquipWeapon('maul', 0, 'cluster-rockets')).toBe(true);
	expect(canEquipWeapon('maul', 0, 'laser')).toBe(false);
	expect(canEquipWeapon('maul', 2, 'machine-gun')).toBe(true);
	expect(canEquipWeapon('maul', 2, 'autocannon')).toBe(false);
	expect(canEquipWeapon('maul-b', 2, 'laser')).toBe(true);
	expect(canEquipWeapon('maul-b', 2, 'ppc')).toBe(false);
	expect(canEquipWeapon('maul-c', 1, 'ppc')).toBe(true);
	expect(canEquipWeapon('maul-c', 3, 'stream-rockets')).toBe(true);
	expect(canEquipWeapon('maul-c', 3, 'stream-rockets-4')).toBe(false);
	expect(canEquipWeapon('longbow', 0, 'ppc')).toBe(true);
	expect(canEquipWeapon('longbow', 0, 'laser')).toBe(true);
	expect(canEquipWeapon('longbow', 1, 'ppc')).toBe(false);
	expect(canEquipWeapon('morrow', 1, 'stream-missiles')).toBe(true);
	expect(canEquipWeapon('morrow', 1, 'machine-gun')).toBe(false);
	for (const frame of FRAMES) expect(isFrameLoadout(frame.id, createStarterLoadout(frame.id))).toBe(true);
});

test('company rejects incompatible equipment and forged saves without spending or reserving inventory', function () {
	const campaign = buyWeapon(unlockAllRigs({ ...createCampaign(42), credits: 10000 }), 'laser');
	const invalid = [null, null, 'machine-gun', null] as const;
	expect(canRefit(campaign, 'warden', invalid)).toBe(false);
	expect(queueRefit(campaign, 'warden', invalid)).toBe(campaign);
	expect(queueRefit(campaign, 'kestrel', ['laser', null])).toBe(campaign);
	expect(queueRefit(campaign, 'maul-c', [null, 'laser', 'laser'])).toBe(campaign);
	const forged = { ...campaign, fleet: campaign.fleet.map(function (mech) { return mech.frameId === 'warden' ? { ...mech, loadout: invalid } : mech; }) };
	expect(parseCampaign(JSON.stringify(forged)).fleet).toEqual(createCampaign(42).fleet);
	const queued = queueRefit(campaign, 'maul-c', [null, 'laser', null, null]);
	const forgedOrder = { ...queued, workOrders: queued.workOrders.map(function (order) { return { ...order, loadout: [null, 'machine-gun'] }; }) };
	expect(parseCampaign(JSON.stringify(forgedOrder)).workOrders).toEqual([]);
	const complete = advanceDays(queued, 4);
	expect(getOwnedMech(complete, 'maul-c')?.loadout).toEqual([null, 'laser', null, null]);
	expect(parseCampaign(JSON.stringify(complete))).toEqual(complete);
	// In-memory corruption cannot bypass the deployment guard either.
	const contract = getContracts(campaign)[0];
	if (!contract) throw new Error('Missing contract fixture');
	const accepted = acceptContract(selectFrame(campaign, 'warden'), contract.id);
	expect(canDeploy(accepted)).toBe(true);
	expect(canDeploy({ ...accepted, fleet: forged.fleet })).toBe(false);
});

test('owned chassis and refits persist exactly their visible hardpoint count', function () {
	const company = unlockAllRigs(createCampaign(42));
	expect(company.fleet.filter(function (mech) { return getFrame(rigFrameId(mech.frameId)).variant === 'A'; }).map(function (mech) { return [mech.frameId, mech.loadout.length]; })).toEqual([
		['kestrel', 2], ['warden', 4], ['maul', 4],
	]);
	for (const mech of company.fleet) {
		expect(mech.loadout).toHaveLength(getHardpoints(rigFrameId(mech.frameId)).length);
		expect(isFrameLoadout(rigFrameId(mech.frameId), mech.loadout)).toBe(true);
	}
	expect(parseCampaign(JSON.stringify(company))).toEqual(company);
});
