import { CAMPAIGN_STORAGE_KEY, createCampaign, parseSavedCompany, recoverInterruptedDeployment, type Campaign } from './campaign';
import { parseSortieCheckpoint, sortieMatchesCompany, type SortieCheckpoint } from './sortie-checkpoint';

export type CompanySlot = NonNullable<Campaign['mode']>;
export interface CompanyBackup {
	readonly slot: CompanySlot;
	readonly company: Campaign;
	readonly checkpoint: SortieCheckpoint | undefined;
}
export interface SlotSave {
	readonly slot: CompanySlot;
	readonly company: Campaign | undefined;
	readonly checkpoint: SortieCheckpoint | undefined;
	/** Exact primary observed when loading this company, including a damaged primary. */
	readonly token: string | null | undefined;
	/** Fallback bytes are also guarded when a healthy primary was unavailable. */
	readonly backupToken?: string | null;
	readonly legacyToken?: string;
	readonly recovered: boolean;
}
type SlotWrite = { status: 'saved'; save: SlotSave } | { status: 'conflict' | 'unavailable' };
type DecodedRecord = CompanyBackup & { damagedCheckpoint: boolean };
const LAST_SLOT_KEY = 'heavy-rig:company:last-slot';
export const companySlotKey = function (slot: CompanySlot): string { return `heavy-rig:company:${slot}:v1`; };
const isSlot = function (value: unknown): value is CompanySlot { return value === 'campaign' || value === 'career'; };
// Unmarked v8 companies retain their original mode and progression inside the Campaign slot.
const slotOf = function (company: Campaign): CompanySlot { return company.mode ?? 'campaign'; };
export const emptyCompanySlot = function (slot: CompanySlot): SlotSave {
	return { slot, company: undefined, checkpoint: undefined, token: undefined, recovered: false };
};

const encode = function ({ slot, company, checkpoint }: CompanyBackup): string {
	return JSON.stringify({ format: 'heavy-rig-company', version: 1, slot, company, checkpoint,
		...(company.deployed && !checkpoint ? { resumeFromLanding: true } : {}) });
};
const decode = function (text: string | null): DecodedRecord | undefined {
	if (!text) return undefined;
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== 'object' || !value || !('format' in value) || value.format !== 'heavy-rig-company'
			|| !('version' in value) || value.version !== 1 || !('slot' in value) || !isSlot(value.slot) || !('company' in value)) return undefined;
		const company = parseSavedCompany(value.company);
		if (!company || slotOf(company) !== value.slot) return undefined;
		const hasCheckpoint = 'checkpoint' in value;
		const checkpoint = hasCheckpoint && company.deployed && company.active ? parseSortieCheckpoint(value.checkpoint, company.active, company) : undefined;
		// Condition-only legacy deployments can be exported before their first field checkpoint.
		const fromLanding = 'resumeFromLanding' in value && value.resumeFromLanding === true;
		const damagedCheckpoint = hasCheckpoint ? !checkpoint || fromLanding : Boolean(company.deployed) !== fromLanding;
		return { slot: value.slot, company, checkpoint, damagedCheckpoint };
	} catch { return undefined; }
};
export const exportCompanyBackup = function (save: SlotSave): string | undefined {
	return save.company && encode({ slot: save.slot, company: save.company, checkpoint: save.checkpoint });
};
export const importCompanyBackup = function (text: string): CompanyBackup | undefined {
	const saved = decode(text);
	return saved && !saved.damagedCheckpoint ? { slot: saved.slot, company: saved.company, checkpoint: saved.checkpoint } : undefined;
};

const readLegacyCompany = function (text: string | null): Campaign | undefined {
	if (!text) return undefined;
	try { return parseSavedCompany(JSON.parse(text)); } catch { return undefined; }
};
export const readCompanySlot = function (slot: CompanySlot): SlotSave {
	const empty = emptyCompanySlot(slot);
	try {
		const key = companySlotKey(slot);
		const token = localStorage.getItem(key);
		const primary = decode(token);
		if (primary?.slot === slot && !primary.damagedCheckpoint) return { slot, company: primary.company, checkpoint: primary.checkpoint, token, recovered: false };
		const backupToken = localStorage.getItem(key + ':backup');
		const backup = decode(backupToken);
		if (backup?.slot === slot && !backup.damagedCheckpoint) return { slot, company: backup.company, checkpoint: backup.checkpoint, token, backupToken, recovered: true };
		// An otherwise valid company can still relaunch from its recorded damage if both world snapshots failed.
		const partial = primary?.slot === slot ? primary : backup?.slot === slot ? backup : undefined;
		if (partial) return { ...empty, company: partial.company, token, backupToken, recovered: true };
		const legacyToken = localStorage.getItem(CAMPAIGN_STORAGE_KEY);
		const company = readLegacyCompany(legacyToken);
		return legacyToken && company && slotOf(company) === slot
			? { ...empty, company, token, backupToken, legacyToken }
			: { ...empty, token, backupToken };
	} catch { return empty; }
};

let lastSelected: CompanySlot | undefined;
export const rememberCompanySlot = function (slot: CompanySlot): void {
	lastSelected = slot;
	try { localStorage.setItem(LAST_SLOT_KEY, slot); } catch { /* Session-only selection. */ }
};
export const lastCompanySlot = function (slots?: Readonly<Record<CompanySlot, SlotSave>>): CompanySlot {
	let preferred = lastSelected;
	try {
		const stored = localStorage.getItem(LAST_SLOT_KEY);
		if (isSlot(stored)) preferred = stored;
	} catch { return preferred ?? 'campaign'; }
	const first = preferred ?? 'campaign';
	const other = first === 'career' ? 'campaign' : 'career';
	const saved = function (slot: CompanySlot) { return slots ? slots[slot].company : readCompanySlot(slot).company; };
	return !saved(first) && saved(other) ? other : first;
};

const changed = function (previous: SlotSave): boolean {
	const key = companySlotKey(previous.slot);
	if (localStorage.getItem(key) !== (previous.token ?? null)) return true;
	if ((previous.backupToken !== undefined || previous.token === undefined) && localStorage.getItem(key + ':backup') !== (previous.backupToken ?? null)) return true;
	if (previous.legacyToken !== undefined) return localStorage.getItem(CAMPAIGN_STORAGE_KEY) !== previous.legacyToken;
	if (previous.token == null && !previous.backupToken) {
		const legacy = readLegacyCompany(localStorage.getItem(CAMPAIGN_STORAGE_KEY));
		return Boolean(legacy && slotOf(legacy) === previous.slot);
	}
	return false;
};
export const slotChanged = function (previous: SlotSave): boolean {
	try { return changed(previous); } catch { return false; }
};

const noop = function () {};
/** Keep a single writer per company while still allowing simultaneous play in the other slot. */
export const claimCompanySlot = async function (slot: CompanySlot): Promise<(() => void) | undefined> {
	try {
		if (typeof navigator === 'undefined' || !navigator.locks) return noop;
		return await new Promise<(() => void) | undefined>(function (claimed) {
			void navigator.locks.request(companySlotKey(slot), { ifAvailable: true }, function (lock) {
				if (!lock) { claimed(undefined); return; }
				return new Promise<void>(function (release) { claimed(release); });
			}).catch(function () { claimed(noop); });
		});
	} catch { return noop; }
};

const purgeObsolete = function (): void {
	for (let version = 1; version < 8; version++) localStorage.removeItem(`heavy-rig:campaign:v${version}`);
};
export const writeCompanySlot = function (previous: SlotSave, company: Campaign, checkpoint?: SortieCheckpoint): SlotWrite {
	if (slotOf(company) !== previous.slot || checkpoint && !sortieMatchesCompany(checkpoint, company)) return { status: 'unavailable' };
	try {
		if (changed(previous)) return { status: 'conflict' };
		const slot = previous.slot;
		const key = companySlotKey(slot);
		const backupKey = key + ':backup';
		const token = encode({ slot, company, checkpoint });
		if (token !== previous.token || previous.recovered) {
			// Archive the last valid transaction before the atomic primary replacement. Never copy a damaged primary.
			const healthyPrimary = previous.backupToken === undefined && !previous.legacyToken ? previous.token : undefined;
			if (healthyPrimary) localStorage.setItem(backupKey, healthyPrimary);
			localStorage.setItem(key, token);
			if (!healthyPrimary) {
				try {
					const fallback = previous.backupToken && decode(previous.backupToken);
					if (!fallback || fallback.slot !== slot || fallback.damagedCheckpoint) localStorage.setItem(backupKey, exportCompanyBackup(previous) ?? token);
				} catch { /* A valid primary is already durable. */ }
			}
		}
		// Failure to clean up or remember the active slot cannot undo a committed save.
		try {
			if (previous.legacyToken && localStorage.getItem(CAMPAIGN_STORAGE_KEY) === previous.legacyToken) localStorage.removeItem(CAMPAIGN_STORAGE_KEY);
			purgeObsolete();
		} catch { /* The new slot is authoritative. */ }
		rememberCompanySlot(slot);
		return { status: 'saved', save: { slot, company, checkpoint, token, recovered: false } };
	} catch { return { status: 'unavailable' }; }
};

// Domain callers which only need the current company retain the original synchronous interface.
export const readCampaign = function (): Campaign {
	try { purgeObsolete(); } catch { /* The slot reader handles unavailable storage. */ }
	const saved = readCompanySlot(lastCompanySlot()).company;
	return saved ? recoverInterruptedDeployment(saved) : createCampaign();
};
export const saveCampaign = function (company: Campaign): boolean {
	const previous = readCompanySlot(slotOf(company));
	const checkpoint = previous.checkpoint && company.deployed && company.active
		? parseSortieCheckpoint(previous.checkpoint, company.active, company) : undefined;
	return writeCompanySlot(previous, company, checkpoint).status === 'saved';
};
