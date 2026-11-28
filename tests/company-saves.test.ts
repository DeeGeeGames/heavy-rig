import { expect, test } from 'bun:test';
import { CAMPAIGN_STORAGE_KEY, commitOperations, createCampaign, getContracts, parseCampaign, readCampaign, saveCampaign, stageOperation, STARTING_CREDITS } from '../src/campaign';
import { companySlotKey, exportCompanyBackup, importCompanyBackup, lastCompanySlot, readCompanySlot, rememberCompanySlot, slotChanged, writeCompanySlot } from '../src/company-saves';
import { createMissionState } from '../src/simulation';
import { captureSortie } from '../src/sortie-checkpoint';

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

test('restores a portable in-flight company across cleared storage and falls back to a valid checkpoint after corruption', function () {
	withStorage(function (storage) {
		const fresh = createCampaign(42, 'career');
		const contract = getContracts(fresh).find(function (offer) { return offer.kind === 'recovery' && offer.tier === 1; });
		if (!contract) throw new Error('Missing recovery posting');
		const live = commitOperations(stageOperation(fresh, contract.id));
		const company = parseCampaign(JSON.stringify(live));
		const state = createMissionState(contract, { frame: 'kestrel' });
		state.time = 10;
		const first = writeCompanySlot(readCompanySlot('career'), live, captureSortie(state, live.deployed));
		if (first.status !== 'saved') throw new Error('First checkpoint failed');
		state.time = 30;
		const latest = writeCompanySlot(first.save, live, captureSortie(state, live.deployed));
		if (latest.status !== 'saved') throw new Error('Second checkpoint failed');
		const exported = exportCompanyBackup(latest.save);
		if (!exported) throw new Error('Missing backup');
		const key = companySlotKey('career');
		const missingField = JSON.stringify({ format: 'heavy-rig-company', version: 1, slot: 'career', company: live });
		storage.setItem(key, missingField);
		expect(importCompanyBackup(missingField)).toBeUndefined();
		expect(readCompanySlot('career')).toMatchObject({ recovered: true, checkpoint: first.save.checkpoint });
		const damaged = JSON.stringify({ format: 'heavy-rig-company', version: 1, slot: 'career', company: live, checkpoint: { damaged: true } });
		storage.setItem(key, damaged);
		expect(slotChanged(latest.save)).toBe(true);
		expect(importCompanyBackup(damaged)).toBeUndefined();
		const recovered = readCompanySlot('career');
		expect(recovered).toMatchObject({ recovered: true, checkpoint: first.save.checkpoint, company });
		storage.removeItem(key + ':backup');
		expect(writeCompanySlot(recovered, live, recovered.checkpoint).status).toBe('conflict');
		expect(readCompanySlot('career')).toMatchObject({ recovered: true, checkpoint: undefined, company });
		storage.clear();
		const restored = importCompanyBackup(exported);
		if (!restored) throw new Error('Portable backup failed to load');
		expect(restored.slot).toBe('career');
		expect(writeCompanySlot(readCompanySlot(restored.slot), restored.company, restored.checkpoint).status).toBe('saved');
		expect(readCompanySlot('career')).toMatchObject({ company, checkpoint: latest.save.checkpoint });
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
