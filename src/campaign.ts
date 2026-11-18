import { companyRank, getMissionTier, isMissionTier, MAX_COMPANY_REPUTATION, MISSION_TIERS } from './reputation';
import { ACQUISITION_SECONDS } from './missions';
import type { Contract, FactionId, MissionKind, PlanetId } from './campaign-types';
import { createOpeningProgress, getAuthoredStep, getChainStatus, isAuthoredContract, parseChainProgress, type ChainProgress } from './contract-chains';
import { applyMissionInfluence, createUniverse, FACTION_IDS, getSystemIntel, isPlanetId, PLANETS, type UniverseState } from './universe';
export { getPlanet, PLANETS, type PlanetDefinition } from './universe';

import { advanceDays, createCompany, MAX_DAY, parseCompany, type CompanyState } from './company';

export interface FactionDefinition {
	id: FactionId;
	name: string;
	shortName: string;
	description: string;
	color: string;
}

const factionDefinitions: Readonly<Record<FactionId, FactionDefinition>> = {
	freeholds: { id: 'freeholds', name: 'Frontier Freeholds', shortName: 'FREEHOLDS', description: 'Independent settlements defending water, farmland, and the right to govern themselves.', color: '#92ceb4' },
	combine: { id: 'combine', name: 'Ferric Combine', shortName: 'COMBINE', description: 'An industrial consortium that treats every mine, transit lane, and garrison as an investment.', color: '#e4ae74' },
	accord: { id: 'accord', name: 'Signal Accord', shortName: 'ACCORD', description: 'A network of orbital stations protecting communication routes and its own expanding influence.', color: '#a8bce8' },
};

export const FACTIONS: readonly FactionDefinition[] = Object.values(factionDefinitions);
export const getFaction = function (id: FactionId): FactionDefinition { return factionDefinitions[id]; };

export interface CampaignResult {
	contract: Contract;
	won: boolean;
	aborted: boolean;
	payout: number;
	favor: number;
	companyReputation: number;
	day: number;
}

export interface Campaign extends CompanyState {
	version: 6;
	introComplete: boolean;
	mode?: 'campaign' | 'career';
	story?: ChainProgress;
	universe: UniverseState;
	seed: number;
	planetId: PlanetId;
	day: number;
	boardRevision: number;
	credits: number;
	companyReputation: number;
	completed: number;
	failed: number;
	reputation: Record<FactionId, number>;
	boardReputation: Record<FactionId, number>;
	active: Contract | undefined;
	lastResult: CampaignResult | undefined;
}

export const CAMPAIGN_STORAGE_KEY = 'heavy-rig:campaign:v6';
const MISSION_KINDS: readonly MissionKind[] = ['defend', 'demolition', 'assassination', 'clearance', 'raid', 'recovery', 'acquisition'];
const MAX_COUNT = 1_000_000;
export const MAX_CREDITS = 1_000_000_000_000;
const isInteger = function (value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
};
const object = function (value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); };
const isFactionId = function (value: unknown): value is FactionId { return value === 'freeholds' || value === 'combine' || value === 'accord'; };
const isMissionKind = function (value: unknown): value is MissionKind { return value === 'defend' || value === 'demolition' || value === 'assassination' || value === 'clearance' || value === 'raid' || value === 'recovery' || value === 'acquisition'; };
const boundedReputation = function (value: number) { return Math.max(-100, Math.min(100, value)); };
const zeroReputation = function (): Record<FactionId, number> { return { freeholds: 0, combine: 0, accord: 0 }; };
const freshSeed = function () {
	try { return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1; } catch { return Date.now() >>> 0; }
};

export const createCampaign = function (seed?: number, mode?: Campaign['mode']): Campaign {
	return {
		...createCompany(), version: 6, introComplete: false, universe: createUniverse(), seed: isInteger(seed, 0, 0xffffffff) ? seed : freshSeed(), planetId: 'meridian', day: 1, boardRevision: 0,
		credits: 0, companyReputation: 0, completed: 0, failed: 0, reputation: zeroReputation(), boardReputation: zeroReputation(), active: undefined, lastResult: undefined,
		...(mode ? { mode, introComplete: mode === 'career' } : {}),
		...(mode === 'campaign' ? { story: createOpeningProgress() } : {}),
	};
};

export const reputationLabel = function (score: number): string {
	return score >= 50 ? 'ALLIED' : score >= 20 ? 'TRUSTED' : score >= 5 ? 'FAVORED' : score > -15 ? 'NEUTRAL' : score > -40 ? 'DISTRUSTED' : 'HOSTILE';
};

const mixSeed = function (seed: number, value: number) {
	const mixed = Math.imul(seed ^ value, 0x45d9f3b);
	return (mixed ^ (mixed >>> 16)) >>> 0;
};

const contractCopy: Readonly<Record<MissionKind, { title: string; briefing: string; reward: number }>> = {
	defend: { title: 'Hold the signal', briefing: 'Defend the contracted uplink through the hostile assault. Keep its integrity above zero, then rendezvous with your dropship.', reward: 1200 },
	demolition: { title: 'Break the supply line', briefing: 'Locate and destroy the marked processing facility. Its garrison is expendable; the facility is the objective. Reach extraction after demolition.', reward: 1400 },
	assassination: { title: 'Cut the command link', briefing: 'Find and destroy the designated command frame. Supporting forces are optional targets. Leave the surface through the extraction zone.', reward: 1700 },
	raid: { title: 'Sever the supply network', briefing: 'Destroy three marked supply installations in any order. Their defenders are optional. Return to extraction after all three are destroyed.', reward: 1700 },
	recovery: { title: 'Recover the black box', briefing: 'Reach the marked cache and stay inside its zone for five uninterrupted seconds to recover the data. Fighting the guards is optional. Extract with the recovered data.', reward: 1500 },
	acquisition: { title: 'Mark the strike corridor', briefing: `Activate three targeting beacons within ${ACQUISITION_SECONDS / 60} minutes. Stay in each zone for three uninterrupted seconds; activated beacons remain active. Then return to extraction. Fighting defenders is optional.`, reward: 1900 },
	clearance: { title: 'Sweep the basin', briefing: 'Eliminate every hostile patrol across the marked sector. Once the region is clear, return to the extraction zone.', reward: 1600 },
};

// A board is a pure function of its campaign seed and revision. Acceptance keeps
// its reputation snapshot, so posting terms cannot move after the pilot agrees.
const getContractTemplates = function (campaign: Campaign, planetId: PlanetId = campaign.planetId): Contract[] {
	const planetIndex = ['meridian', 'cinder', 'borealis'].indexOf(planetId);
	const boardSeed = mixSeed(mixSeed(campaign.seed, campaign.boardRevision + 1), planetIndex + 1);
	return MISSION_TIERS.flatMap(function (level) {
		return MISSION_KINDS.map(function (kind, index) {
			const seed = mixSeed(mixSeed(boardSeed, level.tier), index + 1);
			const employerIndex = (boardSeed + index) % FACTION_IDS.length;
			const employer = FACTION_IDS[employerIndex] ?? 'freeholds';
			const opponent = FACTION_IDS[(employerIndex + 1 + seed % 2) % FACTION_IDS.length] ?? 'combine';
			const tier = level.tier;
			const copy = contractCopy[kind];
			const reward = Math.round(copy.reward * level.reward * (1 + campaign.boardReputation[employer] * 0.0025));
			return {
				id: `${campaign.seed}-${campaign.boardRevision}-${planetId}-${kind}-${tier}`, seed, planetId, kind, employer, opponent,
				title: copy.title, briefing: copy.briefing, reward, favor: 8 + (tier - 1) * 2, hostility: 6 + (tier - 1) * 2,
				tier, requiredReputation: level.standing,
			};
		});
	});
};

// Accepted postings retain their front snapshot. Unaccepted work follows the
// live front, including after Engineering advances the calendar.
export const getContracts = function (campaign: Campaign, planetId: PlanetId = campaign.planetId): Contract[] {
	if (campaign.universe.boardVersion === 1) return getContractTemplates(campaign, planetId);
	const intel = getSystemIntel({ ...campaign, day: campaign.active ? campaign.universe.boardDay : campaign.day }, planetId);
	const [holder, challenger] = intel.participants;
	if (!intel.conflict || !holder || !challenger) return [];
	return getContractTemplates(campaign, planetId).map(function (contract) {
		// Keep the original four kinds on their historical faction parity at every tier.
		const index = (contract.tier - 1) * 4 + MISSION_KINDS.indexOf(contract.kind);
		const employer = contract.kind === 'defend' || index % 2 === 1 ? holder : challenger;
		const opponent = employer === holder ? challenger : holder;
		const faction = getFaction(employer); const rival = getFaction(opponent);
		const asset = employer === 'freeholds' ? 'settlement water routes' : employer === 'combine' ? 'ore processing network' : 'orbital relay network';
		const context = contract.kind === 'defend' ? `${faction.name} needs its ${asset} protected from a ${rival.name} assault.`
			: contract.kind === 'demolition' ? `${faction.name} is disrupting ${rival.name} supply operations on this front.`
			: contract.kind === 'assassination' ? `${faction.name} has identified a ${rival.name} commander coordinating the local offensive.`
			: contract.kind === 'raid' ? `${faction.name} is targeting three ${rival.name} supply sites.`
			: contract.kind === 'recovery' ? `${faction.name} needs data recovered from territory guarded by ${rival.name}.`
			: contract.kind === 'acquisition' ? `${faction.name} needs targeting beacons established for a strike on ${rival.name}.`
			: `${faction.name} needs ${rival.name} patrols cleared from the contested approaches.`;
		return { ...contract, employer, opponent,
			seed: mixSeed(contract.seed, PLANETS.findIndex(function (world) { return world.id === planetId; }) + 1),
			reward: Math.round(contractCopy[contract.kind].reward * getMissionTier(contract.tier).reward * (1 + campaign.boardReputation[employer] * .0025)),
			briefing: `${context} ${contract.briefing}`,
		};
	});
};

export const getTransmission = function (campaign: Campaign) {
	return getChainStatus(campaign.mode === 'campaign' && campaign.introComplete ? campaign.story : undefined);
};

const findPosting = function (campaign: Campaign, id: string): Contract | undefined {
	const story = getTransmission(campaign)?.offers.find(function (step) {
		return step.contract.id === id && step.contract.planetId === campaign.planetId;
	});
	return story ? { ...story.contract } : getContracts(campaign).find(function (posted) { return posted.id === id; });
};

export const canAcceptContract = function (campaign: Campaign, contract: Contract): boolean {
	return !campaign.active && !campaign.deployed && campaign.boardRevision < MAX_COUNT && campaign.day < MAX_DAY
		&& companyRank(campaign) >= getMissionTier(contract.tier).rank
		&& contract.planetId === campaign.planetId && campaign.reputation[contract.employer] >= contract.requiredReputation
		&& Boolean(findPosting(campaign, contract.id));
};

export const acceptContract = function (campaign: Campaign, contractId: string): Campaign {
	const contract = findPosting(campaign, contractId);
	if (!contract || !canAcceptContract(campaign, contract)) return campaign;
	return {
		...campaign, universe: { ...campaign.universe, boardDay: campaign.day }, active: contract,
		reputation: { ...campaign.reputation, [contract.opponent]: boundedReputation(campaign.reputation[contract.opponent] - contract.hostility) },
		...(campaign.story && isAuthoredContract(contract) ? { story: { ...campaign.story, committed: contract.id } } : {}),
	};
};

export const travelTo = function (campaign: Campaign, planetId: PlanetId): Campaign {
	if (campaign.active || campaign.deployed || campaign.planetId === planetId || campaign.boardRevision >= MAX_COUNT || campaign.day >= MAX_DAY || !isPlanetId(planetId)) return campaign;
	return { ...advanceDays(campaign, 1), planetId, universe: { ...campaign.universe, boardDay: campaign.day + 1, boardVersion: 2 }, boardRevision: campaign.boardRevision + 1, boardReputation: { ...campaign.reputation } };
};

const finishContract = function (campaign: Campaign, won: boolean, aborted: boolean): Campaign {
	const contract = campaign.active;
	if (!contract || campaign.boardRevision >= MAX_COUNT || campaign.day >= MAX_DAY) return campaign;
	const favor = won ? Math.min(contract.favor, 100 - campaign.reputation[contract.employer]) : 0;
	const payout = won ? Math.min(contract.reward, MAX_CREDITS - campaign.credits) : 0;
	const reputation = { ...campaign.reputation, [contract.employer]: boundedReputation(campaign.reputation[contract.employer] + favor) };
	const companyReputation = won ? Math.min(getMissionTier(contract.tier).reputation, MAX_COMPANY_REPUTATION - campaign.companyReputation) : 0;
	const day = campaign.day + 1;
	const story = campaign.story;
	return advanceDays({
		...campaign, universe: { ...applyMissionInfluence(campaign.universe, contract.planetId, contract.employer, contract.opponent, won), boardDay: day, boardVersion: 2 }, active: undefined, deployed: undefined, reputation, boardReputation: { ...reputation }, boardRevision: campaign.boardRevision + 1,
		credits: campaign.credits + payout, companyReputation: campaign.companyReputation + companyReputation, completed: campaign.completed + Number(won), failed: campaign.failed + Number(!won),
		lastResult: { contract, won, aborted, payout, favor, companyReputation, day },
		...(won && story?.committed === contract.id ? { story: { id: story.id, completed: [...story.completed, contract.id] } } : {}),
	}, 1);
};

export const settleContract = function (campaign: Campaign, won: boolean): Campaign { return finishContract(campaign, won, false); };
export const abandonContract = function (campaign: Campaign): Campaign { return finishContract(campaign, false, true); };
export const recoverInterruptedDeployment = function (campaign: Campaign): Campaign { return campaign.deployed ? abandonContract(campaign) : campaign; };

const isReputation = function (value: unknown): value is Record<FactionId, number> {
	return object(value) && FACTION_IDS.every(function (id) { return isInteger(value[id], -100, 100); });
};

const isContract = function (value: unknown): value is Contract {
	if (!object(value)) return false;
	return typeof value['id'] === 'string' && value['id'].length <= 100 && isInteger(value['seed'], 0, 0xffffffff)
		&& isPlanetId(value['planetId']) && isMissionKind(value['kind']) && isFactionId(value['employer']) && isFactionId(value['opponent']) && value['employer'] !== value['opponent']
		&& typeof value['title'] === 'string' && value['title'].length <= 100 && typeof value['briefing'] === 'string' && value['briefing'].length <= 500
		&& isInteger(value['reward'], 0, 100_000) && isInteger(value['favor'], 0, 100) && isInteger(value['hostility'], 0, 100)
		&& isMissionTier(value['tier']) && isInteger(value['requiredReputation'], -100, 100);
};

const isResult = function (value: unknown): value is CampaignResult {
	if (!object(value) || !isContract(value['contract'])) return false;
	const contract = value['contract'];
	return typeof value['won'] === 'boolean' && typeof value['aborted'] === 'boolean' && !(value['won'] && value['aborted'])
		&& isInteger(value['payout'], 0, contract.reward) && isInteger(value['favor'], 0, contract.favor)
		&& isInteger(value['companyReputation'], 0, getMissionTier(contract.tier).reputation)
		&& (value['won'] || value['companyReputation'] === 0)
		&& (value['won'] || value['payout'] === 0 && value['favor'] === 0) && isInteger(value['day'], 2, MAX_DAY);
};

const sameContract = function (saved: Contract, generated: Contract): boolean {
	// Recognize accepted v6 acquisition postings with the original three-minute briefing.
	// The longer deadline must not invalidate an otherwise unchanged company save.
	const sameBriefing = saved.briefing === generated.briefing || saved.kind === 'acquisition'
		&& saved.briefing === generated.briefing.replace(`within ${ACQUISITION_SECONDS / 60} minutes.`, 'within three minutes.');
	// Authored copy can be revised while a pilot still has the original terms.
	const sameCopy = isAuthoredContract(generated) || saved.title === generated.title && sameBriefing;
	return saved.id === generated.id && saved.seed === generated.seed && saved.planetId === generated.planetId && saved.kind === generated.kind
		&& saved.employer === generated.employer && saved.opponent === generated.opponent && sameCopy
		&& saved.reward === generated.reward && saved.favor === generated.favor && saved.hostility === generated.hostility
		&& saved.tier === generated.tier && saved.requiredReputation === generated.requiredReputation;
};

const parseUniverse = function (value: unknown, day: number): UniverseState | undefined {
	if (!object(value) || !isInteger(value['boardDay'], 1, day) || (value['boardVersion'] !== 1 && value['boardVersion'] !== 2)
		|| !Array.isArray(value['influence']) || value['influence'].length > PLANETS.length * FACTION_IDS.length) return undefined;
	const influence: UniverseState['influence'][number][] = [];
	for (const entry of value['influence']) {
		if (!object(entry) || !isPlanetId(entry['planetId']) || !isFactionId(entry['factionId']) || !isInteger(entry['value'], -18, 18)
			|| influence.some(function (prior) { return prior.planetId === entry['planetId'] && prior.factionId === entry['factionId']; })) return undefined;
		influence.push({ planetId: entry['planetId'], factionId: entry['factionId'], value: entry['value'] });
	}
	return { influence, boardDay: value['boardDay'], boardVersion: value['boardVersion'] };
};

// Validate the saved transaction, including the already-paid acceptance penalty.
// Invalid saves are reset as a unit; never restore a partly accepted contract.
export const parseCampaign = function (raw: string | null): Campaign {
	if (!raw) return createCampaign();
	try {
		const value: unknown = JSON.parse(raw);
		if (!object(value) || value['version'] !== 6 || typeof value['introComplete'] !== 'boolean' || !isInteger(value['seed'], 0, 0xffffffff) || !isPlanetId(value['planetId'])
			|| !isInteger(value['day'], 1, MAX_DAY) || !isInteger(value['boardRevision'], 0, MAX_COUNT) || value['day'] < value['boardRevision'] + 1
			|| !isInteger(value['companyReputation'], 0, MAX_COMPANY_REPUTATION)
			|| !isInteger(value['credits'], 0, MAX_CREDITS) || !isInteger(value['completed'], 0, MAX_COUNT) || !isInteger(value['failed'], 0, MAX_COUNT)
			|| value['completed'] + value['failed'] > value['boardRevision'] || !isReputation(value['reputation']) || !isReputation(value['boardReputation'])
			|| value['active'] !== undefined && !isContract(value['active']) || value['lastResult'] !== undefined && !isResult(value['lastResult'])) return createCampaign();
		const universe = parseUniverse(value['universe'], value['day']);
		if (!universe) return createCampaign();
		const company = parseCompany(value, value['day'], value['active'] !== undefined);
		if (!company) return createCampaign();
		// An unmarked v6 save could be either starting mode. Its original
		// escape flag and ordinary contracts already describe how it resumes.
		const mode = value['mode'];
		if (mode !== undefined && mode !== 'campaign' && mode !== 'career') return createCampaign();
		const story = parseChainProgress(value['story']);
		if (mode === 'campaign') {
			if (!story || story.completed.length > value['completed'] || !value['introComplete'] && (story.completed.length > 0 || story.committed)) return createCampaign();
		} else if (value['story'] !== undefined) return createCampaign();
		const campaign: Campaign = {
			...company, version: 6, introComplete: value['introComplete'], universe, seed: value['seed'], planetId: value['planetId'], day: value['day'], boardRevision: value['boardRevision'],
			credits: value['credits'], companyReputation: value['companyReputation'], completed: value['completed'], failed: value['failed'], reputation: { ...value['reputation'] },
			boardReputation: { ...value['boardReputation'] }, active: value['active'], lastResult: value['lastResult'],
			...(mode ? { mode } : {}), ...(story ? { story } : {}),
		};
		const result = campaign.lastResult;
		if (result && result.day > campaign.day) return createCampaign();
		if (result && isAuthoredContract(result.contract)) {
			const step = getAuthoredStep(story, result.contract);
			const reported = result.won ? story?.completed.at(-1) : story?.committed;
			if (!step || reported !== result.contract.id || !sameContract(result.contract, step.contract)) return createCampaign();
		}
		if (!FACTION_IDS.every(function (id) {
			const expected = campaign.active?.opponent === id ? boundedReputation(campaign.boardReputation[id] - campaign.active.hostility) : campaign.boardReputation[id];
			return campaign.reputation[id] === expected;
		})) return createCampaign();
		const active = campaign.active;
		if (active) {
			if (campaign.day >= MAX_DAY || campaign.boardRevision >= MAX_COUNT) return createCampaign();
			if (isAuthoredContract(active) && story?.committed !== active.id) return createCampaign();
			const generated = findPosting(campaign, active.id);
			if (!generated || !sameContract(active, generated) || companyRank(campaign) < getMissionTier(active.tier).rank || campaign.reputation[active.employer] < active.requiredReputation) return createCampaign();
			campaign.active = generated;
		}
		return campaign;
	} catch { return createCampaign(); }
};

// Reputation and mission terms changed in v6. Start fresh under the approved
// reset policy; input and presentation profiles remain separate.
const purgePreviousCampaigns = function () {
	for (const version of [1, 2, 3, 4, 5]) localStorage.removeItem(`heavy-rig:campaign:v${version}`);
};
export const readCampaign = function (): Campaign {
	try { purgePreviousCampaigns(); return recoverInterruptedDeployment(parseCampaign(localStorage.getItem(CAMPAIGN_STORAGE_KEY))); } catch { return createCampaign(); }
};

export const saveCampaign = function (campaign: Campaign): boolean {
	try { purgePreviousCampaigns(); localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaign)); return true; } catch { return false; }
};
