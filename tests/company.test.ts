import { describe, expect, test } from 'bun:test';
import { getWeapon } from '../src/arsenal';
import { defaultReserves, loadedMounts } from '../src/combat-resources';
import { createMissionState } from '../src/simulation';
import { abandonContract, acceptContract, createCampaign, getContracts, PLANETS, parseCampaign, recoverInterruptedDeployment, settleContract, travelTo, type Campaign } from '../src/campaign';
import { advanceDays, applyRigCheat, availableWeapons, beginDeployment, buyFrame, buyWeapon, canDeploy, cancelWorkOrder, checkpointDeployment, FRAME_PRICES, getOwnedMech, queueRefit, queueRepair, selectFrame, setAmmunition, unlockAllRigs, WEAPON_PRICES } from '../src/company';

const roundTrip = function (campaign: Campaign) { return parseCampaign(JSON.stringify(campaign)); };
const accept = function (campaign: Campaign): Campaign {
	const contract = getContracts(campaign)[0];
	if (!contract) throw new Error('Missing contract');
	return acceptContract(campaign, contract.id);
};
const funded = function (): Campaign { return { ...createCampaign(23), credits: 30000 }; };

describe('Company ownership and workshop transactions', function () {
	test('starts with only Kestrel and requires affordable purchases without duplicate chassis or free armaments', function () {
		const fresh = createCampaign(23);
		expect(fresh.selectedFrame).toBe('kestrel');
		expect(fresh.fleet).toEqual([{ frameId: 'kestrel', integrity: 100, loadout: ['machine-gun', null], reserves: defaultReserves(['machine-gun', null]) }]);
		expect(availableWeapons(fresh, 'machine-gun')).toBe(0);
		expect(selectFrame(fresh, 'warden')).toBe(fresh);
		expect(buyFrame(fresh, 'warden')).toBe(fresh);
		expect(buyWeapon(fresh, 'laser')).toBe(fresh);
		const company = funded(); const before = JSON.stringify(company);
		const purchased = buyWeapon(buyFrame(company, 'warden'), 'laser');
		expect(purchased.credits).toBe(company.credits - FRAME_PRICES.warden - WEAPON_PRICES.laser);
		expect(getOwnedMech(purchased, 'warden')?.loadout).toEqual(['autocannon', null, null, null]);
		expect(purchased.inventory.autocannon).toBe(1);
		expect(purchased.inventory.laser).toBe(1);
		expect(buyFrame(purchased, 'warden')).toBe(purchased);
		expect(JSON.stringify(company)).toBe(before);
		expect(roundTrip(purchased)).toEqual(purchased);
	});

	test('refits reserve physical copies across mechs, keep existing slots until completion, and conserve inventory', function () {
		const company = buyWeapon(buyWeapon(buyFrame(funded(), 'warden'), 'machine-gun'), 'stream-rockets');
		const target = [null, 'machine-gun', 'stream-rockets', null] as const;
		const queued = queueRefit(company, 'warden', target);
		expect(queued.workOrders[0]).toEqual({ kind: 'refit', frameId: 'warden', startedDay: 1, readyDay: 4, loadout: target, reserves: defaultReserves(target) });
		expect(getOwnedMech(queued, 'warden')?.loadout).toEqual(['autocannon', null, null, null]);
		expect(availableWeapons(queued, 'machine-gun')).toBe(0);
		expect(queueRefit(queued, 'kestrel', ['machine-gun', 'machine-gun'])).toBe(queued);
		expect(queueRefit(company, 'warden', ['machine-gun', 'machine-gun', null, null])).toBe(company);
		expect(queueRefit(queued, 'warden', ['autocannon', null, null, null])).toBe(queued);
		expect(canDeploy(accept(selectFrame(queued, 'warden')))).toBe(false);
		const pending = advanceDays(queued, 2);
		expect(getOwnedMech(pending, 'warden')?.loadout).toEqual(getOwnedMech(company, 'warden')?.loadout);
		expect(roundTrip(pending)).toEqual(pending);
		const complete = advanceDays(pending, 1);
		expect(complete.workOrders).toEqual([]);
		expect(getOwnedMech(complete, 'warden')?.loadout).toEqual(target);
		expect(complete.inventory).toEqual(company.inventory);
		expect(complete.credits).toBe(company.credits);
		expect(canDeploy(accept(selectFrame(complete, 'warden')))).toBe(true);
		expect(roundTrip(complete)).toEqual(complete);
	});

	test('cancellation releases incoming reservations without handing out outgoing equipment early', function () {
		const company = buyWeapon(buyFrame(funded(), 'warden'), 'machine-gun');
		const queued = queueRefit(company, 'warden', ['machine-gun', null, null, null]);
		expect(availableWeapons(queued, 'autocannon')).toBe(0);
		expect(availableWeapons(queued, 'machine-gun')).toBe(0);
		const cancelled = cancelWorkOrder(queued, 'warden');
		expect(cancelled.inventory).toEqual(company.inventory);
		expect(getOwnedMech(cancelled, 'warden')?.loadout).toEqual(getOwnedMech(company, 'warden')?.loadout);
		expect(availableWeapons(cancelled, 'machine-gun')).toBe(1);
		expect(availableWeapons(cancelled, 'autocannon')).toBe(0);
		expect(cancelWorkOrder(cancelled, 'warden')).toBe(cancelled);
		const completed = advanceDays(queued, 1);
		expect(availableWeapons(completed, 'autocannon')).toBe(1);
		expect(availableWeapons(completed, 'machine-gun')).toBe(0);
		expect(advanceDays(completed, 10).inventory).toEqual(company.inventory);
	});

	test('calendar days do not reroll postings, while travel and missions also complete spare-mech work', function () {
		const company = buyWeapon(buyFrame(funded(), 'warden'), 'machine-gun');
		const queued = queueRefit(company, 'warden', ['autocannon', 'machine-gun', null, null]);
		const waited = advanceDays(queued, 7);
		expect(waited.day).toBe(8);
		expect(waited.boardRevision).toBe(0);
		expect(getContracts(waited)).toEqual(getContracts(company));
		expect(roundTrip(waited)).toEqual(waited);
		const travelled = travelTo(queued, 'cinder');
		expect(travelled.day).toBe(2);
		expect(travelled.workOrders).toEqual([]);
		expect(getOwnedMech(travelled, 'warden')?.loadout[1]).toBe('machine-gun');
		const deployed = beginDeployment(accept(queued));
		expect(deployed.deployed?.frameId).toBe('kestrel');
		const settled = settleContract(deployed, true);
		expect(settled.day).toBe(2);
		expect(settled.workOrders).toEqual([]);
		expect(getOwnedMech(settled, 'warden')?.loadout[1]).toBe('machine-gun');
		expect(roundTrip(settled)).toEqual(settled);
		expect(advanceDays(queued, 0)).toBe(queued);
		expect(advanceDays(queued, -1)).toBe(queued);
		expect(advanceDays(queued, Number.NaN)).toBe(queued);
	});

	test('damage survives success, abort, failure, and interrupted deployment without a free repair or duplicate payout', function () {
		for (const outcome of ['success', 'failure', 'abort', 'interruption']) {
			const deployed = beginDeployment(accept(createCampaign(91)));
			const damaged = checkpointDeployment(deployed, 36.25, 1);
			expect(getOwnedMech(damaged)?.integrity).toBe(36.25);
			expect(checkpointDeployment(damaged, 100, 2)).toBe(damaged);
			expect(roundTrip(damaged)).toEqual(damaged);
			const finished = outcome === 'interruption' ? recoverInterruptedDeployment(roundTrip(damaged))
				: outcome === 'abort' ? abandonContract(damaged) : settleContract(damaged, outcome === 'success');
			expect(finished.deployed).toBeUndefined();
			expect(finished.active).toBeUndefined();
			expect(getOwnedMech(finished)?.integrity).toBe(36.25);
			expect(finished.day).toBe(2);
			expect(finished.credits > 0).toBe(outcome === 'success');
			expect(finished.lastResult?.aborted).toBe(outcome === 'abort' || outcome === 'interruption');
			expect(recoverInterruptedDeployment(roundTrip(finished))).toEqual(finished);
			expect(settleContract(finished, true)).toBe(finished);
			// A successful defense may quiet this front; the next job can be elsewhere.
			const nextWorld = PLANETS.find(function (world) { return getContracts(finished, world.id).length > 0; });
			if (!nextWorld) throw new Error('Missing conflict zone');
			const nextDrop = beginDeployment(accept(getContracts(finished).length ? finished : travelTo(finished, nextWorld.id)));
			expect(nextDrop.deployed?.integrity).toBe(36.25);
		}
	});

	test('the sole destroyed Kestrel can be repaired at zero credits, but cannot deploy or heal before its due day', function () {
		const destroyed = settleContract(checkpointDeployment(beginDeployment(accept(createCampaign(87))), 0, 0), false);
		expect(destroyed.credits).toBe(0);
		expect(canDeploy(accept(destroyed))).toBe(false);
		const queued = queueRepair(destroyed, 'kestrel');
		expect(queued.workOrders[0]?.readyDay).toBe(destroyed.day + 5);
		expect(queued.credits).toBe(0);
		const pending = advanceDays(queued, 4);
		expect(getOwnedMech(pending)?.integrity).toBe(0);
		expect(canDeploy(accept(pending))).toBe(false);
		expect(queueRepair(pending, 'kestrel')).toBe(pending);
		const repaired = advanceDays(roundTrip(pending), 1);
		expect(getOwnedMech(repaired)?.integrity).toBe(100);
		expect(repaired.workOrders).toEqual([]);
		expect(canDeploy(accept(repaired))).toBe(true);
		expect(queueRepair(repaired, 'kestrel')).toBe(repaired);
		expect(repaired.inventory).toEqual(destroyed.inventory);
	});

	test('deployment locks workshop, purchasing, frame selection and time advancement, while an unarmed mech stays grounded', function () {
		const company = buyFrame(funded(), 'warden');
		const deployed = checkpointDeployment(beginDeployment(accept(company)), 70, 1);
		expect(buyWeapon(deployed, 'laser')).toBe(deployed);
		expect(buyFrame(deployed, 'maul')).toBe(deployed);
		expect(selectFrame(deployed, 'warden')).toBe(deployed);
		expect(queueRepair(deployed, 'kestrel')).toBe(deployed);
		expect(queueRefit(deployed, 'warden', [null, null, null, null])).toBe(deployed);
		expect(advanceDays(deployed, 1)).toBe(deployed);
		expect(beginDeployment(deployed)).toBe(deployed);
		const empty = advanceDays(queueRefit(company, 'kestrel', [null, null]), 1);
		expect(canDeploy(accept(empty))).toBe(false);
		expect(availableWeapons(empty, 'machine-gun')).toBe(1);
		const rearmed = advanceDays(queueRefit(empty, 'kestrel', [null, 'machine-gun']), 1);
		expect(canDeploy(accept(rearmed))).toBe(true);
	});

	test('old saves reset, and corrupt ownership, reservations, work dates and deployment states cannot restore', function () {
		const company = buyWeapon(buyFrame(funded(), 'warden'), 'laser');
		const queued = queueRefit(company, 'kestrel', [null, 'machine-gun']);
		const deployed = beginDeployment(accept(company));
		const malformed: unknown[] = [
			{ ...company, version: 1 },
			{ ...company, version: 2 },
			{ ...company, version: 3 },
			{ ...company, selectedFrame: 'maul' },
			{ ...company, fleet: [] },
			{ ...company, fleet: [...company.fleet, company.fleet[0]] },
			{ ...company, fleet: [{ frameId: 'kestrel', integrity: 101, loadout: ['machine-gun', null] }] },
			{ ...company, fleet: [{ frameId: 'kestrel', integrity: 100, loadout: ['machine-gun'] }] },
			{ ...company, inventory: { ...company.inventory, 'machine-gun': 0 } },
			{ ...company, inventory: { ...company.inventory, laser: -1 } },
			{ ...queued, workOrders: [...queued.workOrders, { kind: 'refit', frameId: 'warden', startedDay: 1, readyDay: 2, loadout: ['autocannon', 'laser', null, null] }] },
			{ ...queued, workOrders: [{ kind: 'refit', frameId: 'kestrel', startedDay: 1, readyDay: 4, loadout: ['machine-gun', 'laser', null, null] }] },
			{ ...queued, day: 3 },
			{ ...queued, workOrders: [{ kind: 'repair', frameId: 'kestrel', startedDay: 1, readyDay: 2 }] },
			{ ...deployed, deployed: { frameId: 'kestrel', integrity: 80, coolantCharges: 2 } },
			{ ...deployed, deployed: { frameId: 'kestrel', integrity: 100, coolantCharges: 3 } },
			{ ...deployed, active: undefined, reputation: deployed.boardReputation },
			{ ...queued, deployed: { frameId: 'kestrel', integrity: 100, coolantCharges: 2 } },
		];
		for (const value of malformed) {
			const restored = parseCampaign(JSON.stringify(value));
			expect(restored.day).toBe(1);
			expect(restored.credits).toBe(0);
			expect(restored.fleet).toEqual(createCampaign(1).fleet);
			expect(restored.workOrders).toEqual([]);
			expect(restored.deployed).toBeUndefined();
		}
	});
});

test('rig cheat preserves an active deployment and survives save validation without duplicate grants', function () {
	const deployed = beginDeployment(accept(funded()));
	const unlocked = unlockAllRigs(deployed);
	expect(unlocked.fleet).toHaveLength(5);
	expect(unlocked.credits).toBe(deployed.credits);
	expect(unlocked.deployed).toEqual(deployed.deployed);
	expect(unlocked.active).toEqual(deployed.active);
	expect(unlocked.fleet[0]).toEqual(deployed.fleet[0]);
	expect(roundTrip(unlocked)).toEqual(unlocked);
	expect(unlockAllRigs(unlocked)).toBe(unlocked);
});

test('rig cheat adds credits on every entry while preserving deployment and valid saves', function () {
	const deployed = beginDeployment(accept(funded()));
	const granted = applyRigCheat(deployed);
	expect(granted.credits).toBe(deployed.credits + 1_000_000);
	expect(granted.fleet).toHaveLength(5);
	expect(granted.deployed).toEqual(deployed.deployed);
	expect(roundTrip(granted)).toEqual(granted);
	const repeated = applyRigCheat(granted);
	expect(repeated.credits).toBe(granted.credits + 1_000_000);
	expect(repeated.fleet).toEqual(granted.fleet);
	const capped = applyRigCheat({ ...granted, credits: 999_999_999_999 });
	expect(capped.credits).toBe(1_000_000_000_000);
	expect(roundTrip(capped)).toEqual(capped);
});

test('fresh campaign saves require every weapon inventory entry', function () {
	const company = buyWeapon(buyFrame(funded(), 'maul'), 'cluster-rockets-6');
	const inventory = Object.fromEntries(Object.entries(company.inventory).filter(function ([id]) { return !id.endsWith('-4') && !id.endsWith('-6'); }));
	const restored = parseCampaign(JSON.stringify({ ...company, inventory }));
	expect(restored.fleet).toEqual(createCampaign().fleet);
	expect(restored.credits).toBe(0);
	expect(roundTrip(company)).toEqual(company);
});

test('ammunition-only changes are immediate, free, immutable and locked during deployment or work', function () {
	const company = createCampaign(113);
	const reserves = [42, 0];
	const adjusted = queueRefit(company, 'kestrel', ['machine-gun', null], reserves);
	reserves[0] = 1;
	expect(getOwnedMech(adjusted)?.reserves).toEqual([42, 0]);
	expect(getOwnedMech(company)?.reserves).toEqual(defaultReserves(['machine-gun', null]));
	expect(adjusted.day).toBe(company.day);
	expect(adjusted.credits).toBe(company.credits);
	expect(adjusted.inventory).toEqual(company.inventory);
	expect(adjusted.workOrders).toEqual([]);
	expect(roundTrip(adjusted)).toEqual(adjusted);
	expect(canDeploy(accept(adjusted))).toBe(true);
	expect(canDeploy(accept(setAmmunition(adjusted, 'kestrel', [0, 0])))).toBe(false);
	const deployed = beginDeployment(accept(adjusted));
	expect(setAmmunition(deployed, 'kestrel', [1, 0])).toBe(deployed);
	expect(queueRefit(deployed, 'kestrel', ['machine-gun', null], [1, 0])).toBe(deployed);
	const pending = queueRefit(adjusted, 'kestrel', [null, 'machine-gun'], [0, 13]);
	expect(pending.workOrders[0]?.readyDay).toBe(company.day + 2);
	expect(getOwnedMech(pending)?.reserves).toEqual([42, 0]);
	expect(setAmmunition(pending, 'kestrel', [1, 0])).toBe(pending);
	expect(getOwnedMech(cancelWorkOrder(roundTrip(pending), 'kestrel'))?.reserves).toEqual([42, 0]);
	expect(getOwnedMech(advanceDays(roundTrip(pending), 2))?.reserves).toEqual([0, 13]);
});

test('new-format saves reject invalid ammunition counts and loadout mismatches', function () {
	const company = createCampaign(118);
	const mech = getOwnedMech(company);
	if (!mech) throw new Error('Missing starter mech');
	const capacity = getWeapon('machine-gun').ammunition?.capacity;
	if (capacity === undefined) throw new Error('Missing machine-gun ammunition');
	for (const rounds of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, capacity + 1]) {
		expect(setAmmunition(company, 'kestrel', [rounds, 0])).toBe(company);
		expect(queueRefit(company, 'kestrel', [null, 'machine-gun'], [0, rounds])).toBe(company);
		const corrupt = { ...company, credits: 77, fleet: [{ ...mech, reserves: [rounds, 0] }] };
		expect(parseCampaign(JSON.stringify(corrupt)).credits).toBe(0);
	}
	for (const reserves of [[], [1], [1, 1], [1, 0, 0]]) {
		expect(setAmmunition(company, 'kestrel', reserves)).toBe(company);
		expect(parseCampaign(JSON.stringify({ ...company, credits: 77, fleet: [{ ...mech, reserves }] })).credits).toBe(0);
	}
	const energy = buyFrame(funded(), 'longbow');
	expect(setAmmunition(energy, 'longbow', [1])).toBe(energy);
	expect(canDeploy(accept(selectFrame(energy, 'longbow')))).toBe(true);
	const pending = queueRefit(company, 'kestrel', [null, 'machine-gun'], [0, 23]);
	const order = pending.workOrders[0];
	if (!order || order.kind !== 'refit') throw new Error('Missing refit');
	expect(parseCampaign(JSON.stringify({ ...pending, credits: 77, workOrders: [{ ...order, reserves: [23, 0] }] })).credits).toBe(0);
});

test('sorties consume independent runtime supplies and replenish selected reserves after every settlement path', function () {
	for (const outcome of ['success', 'failure', 'abort', 'interruption']) {
		const prepared = setAmmunition(createCampaign(191), 'kestrel', [37, 0]);
		const deployed = beginDeployment(accept(prepared));
		const mech = getOwnedMech(deployed); const contract = deployed.active;
		if (!mech || !contract) throw new Error('Missing deployment');
		const mounts = loadedMounts(mech.loadout, mech.reserves);
		const mount = mounts[0];
		if (!mount) throw new Error('Missing runtime mount');
		mount.rounds = 0;
		expect(getOwnedMech(deployed)?.reserves).toEqual([37, 0]);
		const damaged = checkpointDeployment(deployed, 80, 1);
		const finished = outcome === 'interruption' ? recoverInterruptedDeployment(roundTrip(damaged))
			: outcome === 'abort' ? abandonContract(damaged) : settleContract(damaged, outcome === 'success');
		const nextMech = getOwnedMech(finished);
		if (!nextMech) throw new Error('Missing settled mech');
		const state = createMissionState(contract, { frame: nextMech.frameId, loadout: nextMech.loadout, reserves: nextMech.reserves });
		expect(state.loadout[0]?.rounds).toBe(37);
		expect(getOwnedMech(roundTrip(finished))?.reserves).toEqual([37, 0]);
		expect(finished.credits).toBe(outcome === 'success' ? contract.reward : 0);
		expect(recoverInterruptedDeployment(roundTrip(finished))).toEqual(finished);
	}
});
