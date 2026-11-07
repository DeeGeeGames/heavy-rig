import { describe, expect, test } from 'bun:test';
import { abandonContract, acceptContract, createCampaign, getContracts, parseCampaign, recoverInterruptedDeployment, settleContract, travelTo, type Campaign } from '../src/campaign';
import { advanceDays, availableWeapons, beginDeployment, buyFrame, buyWeapon, canDeploy, cancelWorkOrder, checkpointDeployment, FRAME_PRICES, getOwnedMech, queueRefit, queueRepair, selectFrame, WEAPON_PRICES } from '../src/company';

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
		expect(fresh.fleet).toEqual([{ frameId: 'kestrel', integrity: 100, loadout: ['machine-gun', null, null, null] }]);
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
		const company = buyWeapon(buyFrame(funded(), 'warden'), 'laser');
		const queued = queueRefit(company, 'kestrel', [null, 'machine-gun', null, 'laser']);
		expect(queued.workOrders[0]).toEqual({ kind: 'refit', frameId: 'kestrel', startedDay: 1, readyDay: 4, loadout: [null, 'machine-gun', null, 'laser'] });
		expect(getOwnedMech(queued)?.loadout).toEqual(['machine-gun', null, null, null]);
		expect(availableWeapons(queued, 'laser')).toBe(0);
		expect(queueRefit(queued, 'warden', ['autocannon', 'laser', null, null])).toBe(queued);
		expect(queueRefit(company, 'kestrel', ['machine-gun', 'laser', 'laser', null])).toBe(company);
		expect(queueRefit(queued, 'kestrel', ['machine-gun', null, null, null])).toBe(queued);
		expect(canDeploy(accept(queued))).toBe(false);
		const pending = advanceDays(queued, 2);
		expect(getOwnedMech(pending)?.loadout).toEqual(getOwnedMech(company)?.loadout);
		expect(roundTrip(pending)).toEqual(pending);
		const complete = advanceDays(pending, 1);
		expect(complete.workOrders).toEqual([]);
		expect(getOwnedMech(complete)?.loadout).toEqual([null, 'machine-gun', null, 'laser']);
		expect(complete.inventory).toEqual(company.inventory);
		expect(complete.credits).toBe(company.credits);
		expect(canDeploy(accept(complete))).toBe(true);
		expect(roundTrip(complete)).toEqual(complete);
	});

	test('cancellation releases incoming reservations without handing out outgoing equipment early', function () {
		const company = buyWeapon(funded(), 'laser');
		const queued = queueRefit(company, 'kestrel', ['laser', null, null, null]);
		expect(availableWeapons(queued, 'machine-gun')).toBe(0);
		expect(availableWeapons(queued, 'laser')).toBe(0);
		const cancelled = cancelWorkOrder(queued, 'kestrel');
		expect(cancelled.inventory).toEqual(company.inventory);
		expect(getOwnedMech(cancelled)?.loadout).toEqual(getOwnedMech(company)?.loadout);
		expect(availableWeapons(cancelled, 'laser')).toBe(1);
		expect(availableWeapons(cancelled, 'machine-gun')).toBe(0);
		expect(cancelWorkOrder(cancelled, 'kestrel')).toBe(cancelled);
		const completed = advanceDays(queued, 1);
		expect(availableWeapons(completed, 'machine-gun')).toBe(1);
		expect(availableWeapons(completed, 'laser')).toBe(0);
		expect(advanceDays(completed, 10).inventory).toEqual(company.inventory);
	});

	test('calendar days do not reroll postings, while travel and missions also complete spare-mech work', function () {
		const company = buyWeapon(buyFrame(funded(), 'warden'), 'laser');
		const queued = queueRefit(company, 'warden', ['autocannon', 'laser', null, null]);
		const waited = advanceDays(queued, 7);
		expect(waited.day).toBe(8);
		expect(waited.boardRevision).toBe(0);
		expect(getContracts(waited)).toEqual(getContracts(company));
		expect(roundTrip(waited)).toEqual(waited);
		const travelled = travelTo(queued, 'cinder');
		expect(travelled.day).toBe(2);
		expect(travelled.workOrders).toEqual([]);
		expect(getOwnedMech(travelled, 'warden')?.loadout[1]).toBe('laser');
		const deployed = beginDeployment(accept(queued));
		expect(deployed.deployed?.frameId).toBe('kestrel');
		const settled = settleContract(deployed, true);
		expect(settled.day).toBe(2);
		expect(settled.workOrders).toEqual([]);
		expect(getOwnedMech(settled, 'warden')?.loadout[1]).toBe('laser');
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
			const nextDrop = beginDeployment(accept(finished));
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
		const empty = advanceDays(queueRefit(company, 'kestrel', [null, null, null, null]), 1);
		expect(canDeploy(accept(empty))).toBe(false);
		expect(availableWeapons(empty, 'machine-gun')).toBe(1);
		const rearmed = advanceDays(queueRefit(empty, 'kestrel', [null, null, 'machine-gun', null]), 1);
		expect(canDeploy(accept(rearmed))).toBe(true);
	});

	test('v1 saves reset, and corrupt ownership, reservations, work dates and deployment states cannot restore', function () {
		const company = buyWeapon(buyFrame(funded(), 'warden'), 'laser');
		const queued = queueRefit(company, 'kestrel', ['machine-gun', 'laser', null, null]);
		const deployed = beginDeployment(accept(company));
		const malformed: unknown[] = [
			{ ...company, version: 1 },
			{ ...company, selectedFrame: 'maul' },
			{ ...company, fleet: [] },
			{ ...company, fleet: [...company.fleet, company.fleet[0]] },
			{ ...company, fleet: [{ frameId: 'kestrel', integrity: 101, loadout: ['machine-gun', null, null, null] }] },
			{ ...company, fleet: [{ frameId: 'kestrel', integrity: 100, loadout: ['machine-gun'] }] },
			{ ...company, inventory: { ...company.inventory, 'machine-gun': 0 } },
			{ ...company, inventory: { ...company.inventory, laser: -1 } },
			{ ...queued, workOrders: [...queued.workOrders, { kind: 'refit', frameId: 'warden', startedDay: 1, readyDay: 2, loadout: ['autocannon', 'laser', null, null] }] },
			{ ...queued, workOrders: [{ kind: 'refit', frameId: 'kestrel', startedDay: 1, readyDay: 4, loadout: ['machine-gun', 'laser', null, null] }] },
			{ ...queued, day: 2 },
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
