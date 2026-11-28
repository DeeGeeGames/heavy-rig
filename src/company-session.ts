import type { Campaign } from './campaign';
import { claimCompanySlot, emptyCompanySlot, lastCompanySlot, readCompanySlot, rememberCompanySlot, slotChanged, writeCompanySlot, type CompanySlot, type SlotSave } from './company-saves';

export const companySlots = ['campaign', 'career'] as const;
export const slotName = function (slot: CompanySlot): string { return slot === 'career' ? 'Career' : 'Campaign'; };

export const createCompanySession = function (isolated: boolean) {
	const read = isolated ? emptyCompanySlot : readCompanySlot;
	const saves: Record<CompanySlot, SlotSave> = { campaign: read('campaign'), career: read('career') };
	const sessionOnly = new Set<CompanySlot>();
	let slot: CompanySlot = isolated ? 'campaign' : lastCompanySlot(saves);
	let release: (() => void) | undefined;
	let acquiring = false;

	const close = function () { release?.(); release = undefined; };
	const changed = function (save: SlotSave) { return !isolated && slotChanged(save); };
	return {
		get current() { return saves[slot]; },
		get openForPlay() { return release !== undefined; },
		get saved() { return Boolean(saves[slot].company) && !sessionOnly.has(slot) && !isolated; },
		get: function (key: CompanySlot) { return saves[key]; },
		changed,
		refresh: function (key: CompanySlot) { saves[key] = read(key); sessionOnly.delete(key); },
		close,
		open: async function (expected: SlotSave, stillWanted: () => boolean) {
			if (acquiring || release) return 'busy';
			acquiring = true;
			try {
				const unlock = isolated ? function () {} : await claimCompanySlot(expected.slot);
				if (!stillWanted()) { unlock?.(); return 'cancelled'; }
				if (!unlock) return 'busy';
				if (changed(expected) || expected !== saves[expected.slot]) {
					unlock();
					return 'stale';
				}
				release = unlock;
				slot = expected.slot;
				if (!isolated) rememberCompanySlot(slot);
				return 'opened';
			} finally { acquiring = false; }
		},
		write: function (company: Campaign) {
			const previous = saves[slot];
			const result = isolated ? undefined : writeCompanySlot(previous, company);
			if (result?.status === 'conflict') return false;
			if (result?.status === 'saved') {
				saves[slot] = result.save;
				sessionOnly.delete(slot);
			} else {
				saves[slot] = { ...previous, company, recovered: false };
				sessionOnly.add(slot);
			}
			return true;
		},
	};
};
