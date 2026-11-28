import { withPilots, withRigs } from './company-fixture';
import { expect, test } from 'bun:test';
import { assignOperationSlot, CAMPAIGN_STORAGE_KEY, commitOperations, createCampaign, getContracts, parseCampaign, readCampaign, saveCampaign, stageOperation, STARTING_CREDITS } from '../src/campaign';
import { companySlotKey, exportCompanyBackup, importCompanyBackup, lastCompanySlot, readCompanySlot, rememberCompanySlot, slotChanged, writeCompanySlot } from '../src/company-saves';
import { checkpointDeployment } from '../src/company';

const withStorage = function (run: (storage: Storage) => void) {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const data = new Map<string, string>();
	const storage: Storage = {
		get length() { return data.size; },
		clear: function () { data.clear(); },
		getItem: function (key) { return data.get(key) ?? null; },
		key: function (index) { return [...data.keys()][index] ?? null; },
		removeItem: function (key) { data.delete(key); },
		setItem: function (key, value) { data.set(key, value); },
	};
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
	try { run(storage); } finally {
		if (original) Object.defineProperty(globalThis, 'localStorage', original);
		else Reflect.deleteProperty(globalThis, 'localStorage');
	}
};

test('migrates the original v8 company into its own slot and protects it when the other mode starts', function () {
	withStorage(function (storage) {
		const career = { ...createCampaign(77, 'career'), credits: 18450 };
		storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(career));
		const campaign = createCampaign(84, 'campaign');
		expect(lastCompanySlot()).toBe('career');
		expect(saveCampaign(campaign)).toBe(true);
		expect(readCompanySlot('career').company).toEqual(career);
		const old = readCompanySlot('career');
		expect(writeCompanySlot(old, { ...career, credits: 16000 }).status).toBe('saved');
		expect(storage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull();
		expect(readCampaign().credits).toBe(16000);
		expect(writeCompanySlot(old, career).status).toBe('conflict');
		rememberCompanySlot('campaign');
		expect(readCampaign()).toEqual(campaign);
		storage.setItem(companySlotKey('career'), '{damaged');
		expect(readCompanySlot('career')).toMatchObject({ company: career, recovered: true });
	});
});

test('keeps unmarked v8 companies playable without inventing a story and purges only unsupported namespaces', function () {
	withStorage(function (storage) {
		const unmarked = { ...createCampaign(72), introComplete: true, credits: 2000 };
		for (let version = 1; version < 8; version++) storage.setItem(`heavy-rig:campaign:v${version}`, JSON.stringify({ ...unmarked, version }));
		storage.setItem('heavy-rig:profile:v1', 'keep settings');
		storage.setItem('other-game:campaign:v4', 'keep other game');
		storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(unmarked));
		expect(readCampaign()).toEqual(unmarked);
		expect(readCompanySlot('campaign').company?.mode).toBeUndefined();
		expect(readCompanySlot('career').company).toBeUndefined();
		for (let version = 1; version < 8; version++) expect(storage.getItem(`heavy-rig:campaign:v${version}`)).toBeNull();
		expect(storage.getItem('heavy-rig:profile:v1')).toBe('keep settings');
		expect(storage.getItem('other-game:campaign:v4')).toBe('keep other game');
		expect(saveCampaign(unmarked)).toBe(true);
		expect(readCompanySlot('campaign').company).toEqual(unmarked);
		storage.setItem('heavy-rig:campaign:v4', 'obsolete');
		expect(saveCampaign(unmarked)).toBe(true);
		expect(storage.getItem('heavy-rig:campaign:v4')).toBeNull();
		expect(parseCampaign(JSON.stringify({ ...unmarked, version: 4 })).credits).toBe(STARTING_CREDITS);
	});
});

test('old in-flight saves restart with launch condition, keep committed crews and export without field state', function () {
	withStorage(function (storage) {
		const fresh = createCampaign(318, 'career');
		const ready = withPilots(withRigs({ ...fresh, credits: 60_000 }, 'kestrel-b', 'warden'), 'flint', 'kite');
		const [field, crew] = getContracts(ready);
		if (!field || !crew) throw new Error('Missing paired contracts');
		const company = { ...ready, fleet: ready.fleet.map(function (rig) {
			return rig.frameId === 'kestrel' ? { ...rig, integrity: 82 } : rig;
		}) };
		const staged = stageOperation(stageOperation(company, field.id), crew.id);
		const assigned = assignOperationSlot(assignOperationSlot(staged, field.id, 1, { pilotId: 'flint', frameId: 'kestrel-b' }),
			crew.id, 0, { pilotId: 'kite', frameId: 'warden' });
		const launched = commitOperations(assigned);
		expect(launched.deployed?.wing).toHaveLength(1);
		expect(launched.committedCrew).toHaveLength(1);
		const interrupted = checkpointDeployment(launched, 0, 0, [{ frameId: 'kestrel-b', hp: 35 }]);
		const key = companySlotKey('career');
		const oldSave = JSON.stringify({ format: 'heavy-rig-company', version: 1, slot: 'career', company: interrupted, checkpoint: { time: 51, outcome: 'lost' } });

		storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(interrupted));
		expect(readCompanySlot('career').company).toEqual(parseCampaign(JSON.stringify(launched)));
		storage.removeItem(CAMPAIGN_STORAGE_KEY);

		storage.setItem(key, oldSave);
		const loaded = readCompanySlot('career');
		expect(loaded.company).toEqual(launched);
		expect(importCompanyBackup(oldSave)?.company).toEqual(launched);
		const exported = exportCompanyBackup(loaded);
		if (!exported) throw new Error('Missing portable backup');
		expect(JSON.parse(exported)).not.toHaveProperty('checkpoint');

		storage.setItem(key + ':backup', oldSave);
		storage.setItem(key, '{damaged');
		expect(slotChanged(loaded)).toBe(true);
		const recovered = readCompanySlot('career');
		expect(recovered.recovered).toBe(true);
		expect(recovered.company).toEqual(launched);
		storage.removeItem(key + ':backup');
		expect(writeCompanySlot(recovered, launched).status).toBe('conflict');

		storage.clear();
		const restored = importCompanyBackup(exported);
		if (!restored) throw new Error('Missing restored company');
		expect(writeCompanySlot(readCompanySlot(restored.slot), restored.company).status).toBe('saved');
		expect(readCompanySlot('career').company).toEqual(launched);
		expect(readCompanySlot('campaign').company).toBeUndefined();
	});
});

test('an interrupted primary write preserves the previous company and allows the same transaction to retry', function () {
	withStorage(function (storage) {
		const original = createCampaign(84, 'campaign');
		expect(saveCampaign(original)).toBe(true);
		const loaded = readCompanySlot('campaign');
		const next = { ...original, credits: 700 };
		const write = storage.setItem;
		storage.setItem = function (key, contents) {
			if (key === companySlotKey('campaign')) throw new Error('Storage quota');
			write(key, contents);
		};
		expect(writeCompanySlot(loaded, next).status).toBe('unavailable');
		expect(readCompanySlot('campaign').company).toEqual(original);
		storage.setItem = write;
		expect(writeCompanySlot(loaded, next).status).toBe('saved');
		expect(readCompanySlot('campaign').company).toEqual(next);
	});
});
