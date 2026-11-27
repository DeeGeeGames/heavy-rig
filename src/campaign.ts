import { companyRank, FIRST_RIG_TIER, getContractTier, getPostingTiers, isMissionTier, MAX_COMPANY_REPUTATION, missionTierPressure, usesLegacyMissionTiers } from './reputation';
import { ACQUISITION_SECONDS } from './missions';
import type { Contract, FactionId, MissionKind, PlanetId } from './campaign-types';
import type { MissionTier } from './reputation';
import { createOpeningProgress, getAuthoredStep, getChainStatus, isAuthoredContract, parseChainProgress, type ChainProgress } from './contract-chains';
import { applyMissionInfluence, createUniverse, FACTION_IDS, getJumpRoute, getSystemIntel, isPlanetId, mixSeed, PLANETS, type UniverseState } from './universe';
export { getPlanet, PLANETS, type PlanetDefinition } from './universe';

import { advanceDays, beginDeployment, createCompany, deploymentIssue, isAssignment, isDeployedSquad, isSortieSquad, MAX_DAY, parseCompany, type CompanyState, type DeployedPilot } from './company';
import { forecastCrew, resolveCrew, type CrewCheck, type CrewForecast, type CrewResolution } from './crew-resolution';
import { getPilot, isPilotId, MAX_PILOT_WINS, recordPilotWins, SQUAD_SIZE, type PilotAssignment, type PilotId } from './pilots';
import { rigName, type RigId } from './rigs';

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

interface FieldLeadPayment {
	pilotId: PilotId;
	fee: number;
}

export interface CampaignResult {
	contract: Contract;
	won: boolean;
	aborted: boolean;
	payout: number;
	repairRepayment?: number;
	favor: number;
	companyReputation: number;
	day: number;
	fieldLead?: FieldLeadPayment;
	squad?: readonly DeployedPilot[];
	crew?: Pick<CrewResolution, 'objective' | 'extraction'>;
}

export interface PlannedOperation {
	shipId: 'wayfarer';
	contract: Contract;
	lineup: readonly PilotAssignment[];
	leaderId?: PilotId | undefined;
}

interface CrewSortie {
	contract: Contract;
	resolution: CrewResolution;
}

interface OperationReview {
	operation: PlannedOperation;
	live: boolean;
	leaderId: PilotId | undefined;
	issues: readonly string[];
	forecast?: CrewForecast;
}

export interface Campaign extends CompanyState {
	version: 8;
	introComplete: boolean;
	mode?: 'campaign' | 'career';
	story?: ChainProgress;
	universe: UniverseState;
	seed: number;
	planetId: PlanetId;
	day: number;
	boardRevision: number;
	credits: number;
	upkeepOwed?: number;
	repairDebt?: number;
	companyReputation: number;
	completed: number;
	failed: number;
	reputation: Record<FactionId, number>;
	boardReputation: Record<FactionId, number>;
	active: Contract | undefined;
	lastResult: CampaignResult | undefined;
	operations?: readonly PlannedOperation[] | undefined;
	committedCrew?: readonly CrewSortie[] | undefined;
	lastOperationDay?: readonly CampaignResult[] | undefined;
	preferredLineup?: readonly PilotAssignment[];
	pilotWins?: Partial<Record<PilotId, number>>;
}

const CAMPAIGN_VERSION = 8;
export const CAMPAIGN_STORAGE_KEY = `heavy-rig:campaign:v${CAMPAIGN_VERSION}`;
const postingPrefix = 'mission:';
const postingKey = function (id: string): string { return id.startsWith(postingPrefix) ? id.slice(postingPrefix.length) : id; };
export const MISSION_KINDS: readonly MissionKind[] = ['defend', 'demolition', 'assassination', 'clearance', 'raid', 'recovery', 'acquisition'];
const MAX_COUNT = 1_000_000;
const MAX_OPERATIONS = MISSION_KINDS.length + 1;
export const MAX_CREDITS = 1_000_000_000_000;
export const STARTING_CREDITS = 750;
export const fieldLeadFee = function (contract: Contract): number { return Math.round(contract.reward / 4); };
const repairRepaymentLimit = function (payout: number): number { return Math.floor(payout / 4); };
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
		...createCompany(), version: CAMPAIGN_VERSION, introComplete: false, universe: createUniverse(), seed: isInteger(seed, 0, 0xffffffff) ? seed : freshSeed(), planetId: 'meridian', day: 1, boardRevision: 0,
		credits: STARTING_CREDITS, companyReputation: 0, completed: 0, failed: 0, reputation: zeroReputation(), boardReputation: zeroReputation(), active: undefined, lastResult: undefined,
		...(mode ? { mode, introComplete: mode === 'career' } : {}),
		...(mode === 'campaign' ? { story: createOpeningProgress() } : {}),
	};
};

export const reputationLabel = function (score: number): string {
	return score >= 50 ? 'ALLIED' : score >= 20 ? 'TRUSTED' : score >= 5 ? 'FAVORED' : score > -15 ? 'NEUTRAL' : score > -40 ? 'DISTRUSTED' : 'HOSTILE';
};

export const CONTRACT_COPY: Readonly<Record<MissionKind, Readonly<{ title: string; briefing: string; reward: number }>>> = {
	defend: { title: 'Hold the signal', briefing: 'Defend the contracted uplink through the hostile assault. Keep its integrity above zero, then rendezvous with your dropship.', reward: 1200 },
	demolition: { title: 'Break the supply line', briefing: 'Locate and destroy the marked processing facility. Its garrison is expendable; the facility is the objective. Reach extraction after demolition.', reward: 1400 },
	assassination: { title: 'Cut the command link', briefing: 'Find and destroy the designated command frame. Supporting forces are optional targets. Leave the surface through the extraction zone.', reward: 1700 },
	raid: { title: 'Sever the supply network', briefing: 'Destroy three marked supply installations in any order. Their defenders are optional. Return to extraction after all three are destroyed.', reward: 1700 },
	recovery: { title: 'Recover the black box', briefing: 'Reach the marked cache and stay inside its zone for five uninterrupted seconds to recover the data. Fighting the guards is optional. Extract with the recovered data.', reward: 1500 },
	acquisition: { title: 'Mark the strike corridor', briefing: `Activate three targeting beacons within ${ACQUISITION_SECONDS / 60} minutes. Stay in each zone for three uninterrupted seconds; activated beacons remain active. Then return to extraction. Fighting defenders is optional.`, reward: 1900 },
	clearance: { title: 'Sweep the basin', briefing: 'Clear all three occupied sites of patrols and any fixed guns, then return to the extraction zone.', reward: 1600 },
};
export const contractCopy = function (kind: MissionKind, tier: MissionTier, legacy = false): Readonly<{ title: string; briefing: string; reward: number }> {
	const copy = CONTRACT_COPY[kind];
	if (kind !== 'assassination' || legacy) return copy;
	return { ...copy, briefing: copy.briefing.replace('command frame', tier < FIRST_RIG_TIER ? 'command vehicle' : 'command rig') };
};

// A board is a pure function of its campaign seed and revision. Acceptance keeps
// its reputation snapshot, so posting terms cannot move after the pilot agrees.
const getContractTemplates = function (campaign: Campaign, planetId: PlanetId, legacy: boolean): Contract[] {
	const planetIndex = ['meridian', 'cinder', 'borealis'].indexOf(planetId);
	const boardSeed = mixSeed(mixSeed(campaign.seed, campaign.boardRevision + 1), planetIndex + 1);
	// A ten-tier posting already accepted or staged before the new layout
	// keeps the layout the pilot agreed to when the board is regenerated.
	const legacyDefenseIds = new Set([campaign.active, ...(campaign.operations ?? []).map(function ({ contract }) { return contract; }),
		...(campaign.committedCrew ?? []).map(function ({ contract }) { return contract; })].flatMap(function (contract) {
		return contract?.kind === 'defend' && contract.fieldLayout === undefined ? [contract.id] : [];
	}));
	return getPostingTiers(legacy).flatMap(function (level) {
		return MISSION_KINDS.map(function (kind, index) {
			const seed = mixSeed(mixSeed(boardSeed, level.tier), index + 1);
			const employerIndex = (boardSeed + index) % FACTION_IDS.length;
			const employer = FACTION_IDS[employerIndex] ?? 'freeholds';
			const opponent = FACTION_IDS[(employerIndex + 1 + seed % 2) % FACTION_IDS.length] ?? 'combine';
			const tier = level.tier;
			const copy = contractCopy(kind, tier, legacy);
			const reward = Math.round(copy.reward * level.reward * (1 + campaign.boardReputation[employer] * 0.0025));
			const id = `${legacy ? '' : postingPrefix}${campaign.seed}-${campaign.boardRevision}-${planetId}-${kind}-${tier}`;
			const contract = { id, seed, planetId, kind, employer, opponent, tier };
			const standingChange = Math.round(missionTierPressure(contract) * 2);
			return {
				...contract, title: copy.title, briefing: copy.briefing, reward, favor: 8 + standingChange, hostility: 6 + standingChange,
				requiredReputation: level.standing,
				...(kind === 'defend' && !legacy && !legacyDefenseIds.has(id) ? { fieldLayout: 'extended-defense' as const } : {}),
			};
		});
	});
};

// Accepted postings retain their front snapshot. Unaccepted work follows the
// live front, including after Engineering advances the calendar.
const getBoardContracts = function (campaign: Campaign, planetId: PlanetId, legacy: boolean): Contract[] {
	if (campaign.universe.boardVersion === 1) return getContractTemplates(campaign, planetId, legacy);
	const intel = getSystemIntel({ ...campaign, day: campaign.active ? campaign.universe.boardDay : campaign.day }, planetId);
	const [holder, challenger] = intel.participants;
	if (!intel.conflict || !holder || !challenger) return [];
	return getContractTemplates(campaign, planetId, legacy).map(function (contract) {
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
			reward: Math.round(CONTRACT_COPY[contract.kind].reward * getContractTier(contract).reward * (1 + campaign.boardReputation[employer] * .0025)),
			briefing: `${context} ${contract.briefing}`,
		};
	});
};
export const getContracts = function (campaign: Campaign, planetId: PlanetId = campaign.planetId): Contract[] {
	return getBoardContracts(campaign, planetId, false);
};

export const getTransmission = function (campaign: Campaign) {
	return getChainStatus(campaign.mode === 'campaign' && campaign.introComplete ? campaign.story : undefined);
};

const findPosting = function (campaign: Campaign, id: string, legacy = false): Contract | undefined {
	const story = getTransmission(campaign)?.offers.find(function (step) {
		return step.contract.id === id && step.contract.planetId === campaign.planetId;
	});
	return story ? { ...story.contract } : getBoardContracts(campaign, campaign.planetId, legacy).find(function (posted) { return posted.id === id; });
};

export const canAcceptContract = function (campaign: Campaign, contract: Contract): boolean {
	return !campaign.active && !campaign.deployed && campaign.boardRevision < MAX_COUNT && campaign.day < MAX_DAY
		&& companyRank(campaign) >= getContractTier(contract).rank
		&& contract.planetId === campaign.planetId && campaign.reputation[contract.employer] >= contract.requiredReputation
		&& Boolean(findPosting(campaign, contract.id));
};

export const acceptContract = function (campaign: Campaign, contractId: string): Campaign {
	const contract = findPosting(campaign, contractId);
	if (campaign.operations?.length || !contract || !canAcceptContract(campaign, contract)) return campaign;
	return {
		...campaign, universe: { ...campaign.universe, boardDay: campaign.day }, active: contract,
		reputation: { ...campaign.reputation, [contract.opponent]: boundedReputation(campaign.reputation[contract.opponent] - contract.hostility) },
		...(campaign.story && isAuthoredContract(contract) ? { story: { ...campaign.story, committed: contract.id } } : {}),
	};
};

export const forecastArrival = function (campaign: Campaign, planetId: PlanetId): Campaign {
	if (campaign.active || campaign.deployed || campaign.operations?.length || campaign.planetId === planetId || campaign.boardRevision >= MAX_COUNT || campaign.day >= MAX_DAY || !isPlanetId(planetId)) return campaign;
	return advanceDays({
		...campaign, planetId, universe: { ...campaign.universe, boardDay: campaign.day + 1, boardVersion: 2 }, boardRevision: campaign.boardRevision + 1, boardReputation: { ...campaign.reputation },
	}, 1);
};

export const travelTo = function (campaign: Campaign, planetId: PlanetId): Campaign {
	if (!isPlanetId(planetId)) return campaign;
	const { fare } = getJumpRoute(campaign.planetId, planetId);
	if (campaign.credits < fare) return campaign;
	const departure = { ...campaign, credits: campaign.credits - fare };
	const arrival = forecastArrival(departure, planetId);
	return arrival === departure ? campaign : arrival;
};

const emptyLineup = function (): readonly PilotAssignment[] {
	return Array.from({ length: SQUAD_SIZE }, function () { return { pilotId: null, frameId: null }; });
};

export const getPlannedOperation = function (campaign: Campaign, id: string | undefined): PlannedOperation | undefined {
	return campaign.operations?.find(function (operation) { return operation.contract.id === id; });
};

export const canStageOperation = function (campaign: Campaign, contract: Contract): boolean {
	return (campaign.operations?.length ?? 0) < MAX_OPERATIONS
		&& !campaign.operations?.some(function (operation) { return postingKey(operation.contract.id) === postingKey(contract.id); })
		&& (!isAuthoredContract(contract) || !campaign.operations?.some(function (operation) { return isAuthoredContract(operation.contract); }))
		&& canAcceptContract(campaign, contract);
};

export const stageOperation = function (campaign: Campaign, id: string): Campaign {
	const contract = findPosting(campaign, id);
	if (!contract || !canStageOperation(campaign, contract)) return campaign;
	const operations = campaign.operations ?? [];
	const lineup = operations.length ? emptyLineup() : (campaign.preferredLineup ?? campaign.lineup).map(function (slot) {
		return slot.pilotId && !campaign.pilots.includes(slot.pilotId) ? { pilotId: null, frameId: null } : slot;
	});
	return { ...campaign, operations: [...operations, { shipId: 'wayfarer', contract, lineup }] };
};

export const removeOperation = function (campaign: Campaign, id: string): Campaign {
	return campaign.deployed || !getPlannedOperation(campaign, id) ? campaign : {
		...campaign, operations: campaign.operations?.filter(function (entry) { return entry.contract.id !== id; }),
	};
};

export const assignOperationSlot = function (campaign: Campaign, id: string | undefined, index: number, assignment: PilotAssignment): Campaign {
	const operation = getPlannedOperation(campaign, id);
	const lineup = operation?.lineup ?? (id === undefined && !campaign.active ? campaign.preferredLineup ?? campaign.lineup : undefined);
	const slot = lineup?.[index];
	if (campaign.deployed || !lineup || !slot || slot.pilotId === assignment.pilotId && slot.frameId === assignment.frameId
		|| assignment.pilotId && !campaign.pilots.includes(assignment.pilotId)
		|| assignment.frameId && (!assignment.pilotId || !campaign.fleet.some(function (rig) { return rig.frameId === assignment.frameId; }))
		|| lineup.some(function (other, seat) { return seat !== index && Boolean(assignment.pilotId && assignment.pilotId === other.pilotId || assignment.frameId && assignment.frameId === other.frameId); })) return campaign;
	const updated = lineup.map(function (seat, i) { return i === index ? { ...assignment } : seat; });
	if (!operation) return { ...campaign, preferredLineup: updated };
	const leaderId = updated.some(function (seat) { return seat.pilotId === operation.leaderId && seat.frameId !== null; }) ? operation.leaderId : undefined;
	return { ...campaign, operations: campaign.operations?.map(function (entry) {
		return entry === operation ? { ...entry, lineup: updated, leaderId } : entry;
	}) };
};

export const assignOperationLead = function (campaign: Campaign, contractId: string, pilotId: PilotId): Campaign {
	const operation = getPlannedOperation(campaign, contractId);
	if (campaign.deployed || campaign.active || !operation || pilotId === 'player' || operation.leaderId === pilotId
		|| operation.lineup.some(function (seat) { return seat.pilotId === 'player'; })
		|| !operation.lineup.some(function (seat) { return seat.pilotId === pilotId && seat.frameId !== null; })) return campaign;
	return { ...campaign, operations: campaign.operations?.map(function (entry) { return entry === operation ? { ...entry, leaderId: pilotId } : entry; }) };
};

export const reviewOperations = function (campaign: Campaign): { entries: readonly OperationReview[]; issues: readonly string[] } {
	const operations = campaign.operations ?? [];
	const board = operations.length ? getContracts(campaign) : [];
	if (operations.some(function ({ contract }) { return usesLegacyMissionTiers(contract); })) board.push(...getBoardContracts(campaign, campaign.planetId, true));
	const postings = new Map(board.map(function (contract) { return [contract.id, contract]; }));
	const storyOffers = getTransmission(campaign)?.offers ?? [];
	const entries = operations.map(function (operation): OperationReview {
		const { contract, lineup } = operation;
		const live = lineup.some(function (seat) { return seat.pilotId === 'player'; });
		const issues: string[] = [];
		const seats = lineup.filter(function (seat) { return seat.pilotId !== null; });
		const leaderId = live ? 'player' : operation.leaderId ?? seats.find(function (seat) { return seat.frameId !== null; })?.pilotId ?? undefined;
		const current = isAuthoredContract(contract) ? storyOffers.find(function (offer) { return offer.contract.id === contract.id; })?.contract : postings.get(contract.id);
		if (contract.planetId !== campaign.planetId || !current || !sameContract(contract, current) || campaign.reputation[contract.employer] < contract.requiredReputation
			|| companyRank(campaign) < getContractTier(contract).rank) issues.push('This posting changed. Remove it and review the board.');
		if (isAuthoredContract(contract) && !live) issues.push('Commander required.');
		if (!seats.length) issues.push('Assign at least one pilot and rig.');
		for (const { pilotId, frameId } of seats) {
			if (!pilotId) continue;
			const callsign = getPilot(pilotId).callsign;
			if (!campaign.pilots.includes(pilotId)) issues.push(`${callsign} is no longer on the roster.`);
			if (operations.some(function (other) { return other !== operation && other.lineup.some(function (seat) { return seat.pilotId === pilotId; }); })) issues.push(`${callsign} is assigned to another sortie.`);
			if (!frameId) { issues.push(`${callsign} needs a rig.`); continue; }
			if (operations.some(function (other) { return other !== operation && other.lineup.some(function (seat) { return seat.frameId === frameId; }); })) issues.push(`${rigName(frameId)} is assigned to another sortie.`);
			const problem = deploymentIssue(campaign, frameId);
			if (problem) issues.push(`${rigName(frameId)}: ${problem}`);
		}
		return { operation, live, leaderId, issues, ...(!live && !issues.length && leaderId ? { forecast: forecastCrew(campaign, contract, lineup, leaderId) } : {}) };
	});
	const issues = [...new Set(entries.flatMap(function (entry) { return entry.issues; }))];
	if (campaign.active || campaign.deployed) issues.push('Finish the active contract first.');
	if (campaign.day >= MAX_DAY || campaign.boardRevision >= MAX_COUNT || campaign.completed + campaign.failed + operations.length > MAX_COUNT) issues.push('The campaign calendar is full.');
	return { entries, issues };
};

const chargeHostility = function (reputation: Campaign['reputation'], contracts: readonly Contract[]): Campaign['reputation'] {
	const next = { ...reputation };
	for (const { opponent, hostility } of contracts) next[opponent] = boundedReputation(next[opponent] - hostility);
	return next;
};

const deployedSquad = function (deployed: CompanyState['deployed']): readonly DeployedPilot[] | undefined {
	return deployed ? [{ pilotId: 'player', frameId: deployed.frameId, integrity: deployed.integrity, startingIntegrity: deployed.startingIntegrity }, ...deployed.wing] : undefined;
};

const recordContract = function (campaign: Campaign, contract: Contract, won: boolean, aborted: boolean, resolution?: CrewResolution): Campaign & { lastResult: CampaignResult } {
	const squad = resolution?.squad ?? deployedSquad(campaign.deployed);
	const crew = resolution ? { objective: resolution.objective, extraction: resolution.extraction } : undefined;
	const leaderId = resolution ? resolution.leaderId : campaign.deployed ? 'player' : undefined;
	const favor = won ? Math.min(contract.favor, 100 - campaign.reputation[contract.employer]) : 0;
	const basePay = won ? Math.min(contract.reward, MAX_CREDITS - campaign.credits) : 0;
	const fee = won && leaderId ? fieldLeadFee(contract) : 0;
	const companyFee = leaderId === 'player' ? Math.min(fee, MAX_CREDITS - campaign.credits - basePay) : 0;
	const payout = basePay + companyFee;
	const repairRepayment = Math.min(campaign.repairDebt ?? 0, repairRepaymentLimit(payout));
	const fieldLead = leaderId ? { pilotId: leaderId, fee: leaderId === 'player' ? companyFee : fee } : undefined;
	const reputation = { ...campaign.reputation, [contract.employer]: boundedReputation(campaign.reputation[contract.employer] + favor) };
	const companyReputation = won ? Math.min(getContractTier(contract).reputation, MAX_COMPANY_REPUTATION - campaign.companyReputation) : 0;
	const day = campaign.day + 1;
	const story = campaign.story;
	return {
		...campaign, universe: applyMissionInfluence(campaign.universe, contract.planetId, contract.employer, contract.opponent, won), reputation,
		credits: campaign.credits + payout - repairRepayment, companyReputation: campaign.companyReputation + companyReputation, completed: campaign.completed + Number(won), failed: campaign.failed + Number(!won),
		...(repairRepayment ? { repairDebt: (campaign.repairDebt ?? 0) - repairRepayment } : {}),
		lastResult: { contract, won, aborted, payout, favor, companyReputation, day, ...(repairRepayment ? { repairRepayment } : {}), ...(fieldLead ? { fieldLead } : {}), ...(squad ? { squad } : {}), ...(crew ? { crew } : {}) },
		...(won && squad?.some(function (member) { return member.pilotId !== 'player'; }) ? { pilotWins: recordPilotWins(campaign, squad.map(function (member) { return member.pilotId; })) } : {}),
		...(won && story?.committed === contract.id ? { story: { id: story.id, completed: [...story.completed, contract.id] } } : {}),
	};
};

const endDay = function (campaign: Campaign): Campaign {
	return advanceDays({ ...campaign,
		universe: { ...campaign.universe, boardDay: campaign.day + 1, boardVersion: 2 },
		active: undefined, deployed: undefined, committedCrew: undefined, boardReputation: { ...campaign.reputation }, boardRevision: campaign.boardRevision + 1,
	}, 1);
};

const finishOperations = function (campaign: Campaign, won: boolean, aborted: boolean): Campaign {
	const crew = campaign.committedCrew;
	if (!crew) return campaign;
	const live = campaign.active;
	const reports: CampaignResult[] = [];
	const damage = new Map<RigId, number>();
	let next = campaign;
	if (live) {
		const recorded = recordContract(next, live, won, aborted);
		reports.push(recorded.lastResult);
		next = recorded;
	}
	for (const { contract, resolution } of crew) {
		const { objective, extraction, squad } = resolution;
		for (const { frameId, integrity } of squad) damage.set(frameId, integrity);
		const recorded = recordContract(next, contract, objective.passed && extraction.passed, false, resolution);
		reports.push(recorded.lastResult);
		next = recorded;
	}
	return endDay({ ...next, lastResult: reports[0], lastOperationDay: reports,
		fleet: next.fleet.map(function (rig) { const integrity = damage.get(rig.frameId); return integrity === undefined ? rig : { ...rig, integrity }; }),
	});
};

export const commitOperations = function (campaign: Campaign): Campaign {
	const review = reviewOperations(campaign);
	const first = review.entries[0];
	if (!first || review.issues.length) return campaign;
	const live = review.entries.find(function (entry) { return entry.live; })?.operation;
	let next: Campaign = { ...campaign, operations: undefined, preferredLineup: first.operation.lineup };
	if (live) {
		const lineup = [...live.lineup].sort(function (left, right) { return Number(right.pilotId === 'player') - Number(left.pilotId === 'player'); });
		next = beginDeployment({ ...next, active: live.contract, lineup });
		if (!next.deployed) return campaign;
	}
	const crew: CrewSortie[] = [];
	for (const { live, leaderId, operation: { contract, lineup } } of review.entries) {
		if (live) continue;
		if (!leaderId) return campaign;
		crew.push({ contract, resolution: resolveCrew(campaign, contract, lineup, leaderId) });
	}
	crew.sort(function (left, right) { return left.contract.id.localeCompare(right.contract.id); });
	next = { ...next, committedCrew: crew, reputation: chargeHostility(campaign.reputation, review.entries.map(function (entry) { return entry.operation.contract; })),
		universe: { ...campaign.universe, boardDay: campaign.day },
		...(campaign.story && live && isAuthoredContract(live.contract) ? { story: { ...campaign.story, committed: live.contract.id } } : {}),
	};
	return live ? next : finishOperations(next, false, false);
};

const finishContract = function (campaign: Campaign, won: boolean, aborted: boolean): Campaign {
	const contract = campaign.active;
	if (!contract || campaign.boardRevision >= MAX_COUNT || campaign.day >= MAX_DAY) return campaign;
	if (campaign.committedCrew) return finishOperations(campaign, won, aborted);
	return endDay(recordContract({ ...campaign, lastOperationDay: undefined }, contract, won, aborted));
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
		&& isMissionTier(value['tier']) && isInteger(value['requiredReputation'], -100, 100)
		&& (value['fieldLayout'] === undefined || value['fieldLayout'] === 'extended-defense' && value['kind'] === 'defend' && value['id'].startsWith(postingPrefix));
};

const isResultLead = function (value: unknown, squad: unknown, fee: number): value is FieldLeadPayment {
	return object(value) && isPilotId(value['pilotId']) && isInteger(value['fee'], 0, fee)
		&& (value['pilotId'] === 'player' || value['fee'] === fee)
		&& isSortieSquad(squad) && squad.some(function (member) { return member.pilotId === value['pilotId']; });
};

const isResult = function (value: unknown): value is CampaignResult {
	if (!object(value) || !isContract(value['contract'])) return false;
	const contract = value['contract'];
	const crew = value['crew'];
	const squad = value['squad'];
	const fieldLead = value['fieldLead'];
	const won = value['won'];
	if (typeof won !== 'boolean' || fieldLead !== undefined && !isResultLead(fieldLead, squad, won ? fieldLeadFee(contract) : 0)) return false;
	const companyFee = fieldLead?.pilotId === 'player' ? fieldLead.fee : 0;
	return typeof value['aborted'] === 'boolean' && !(won && value['aborted'])
		&& isInteger(value['payout'], companyFee ? contract.reward + companyFee : 0, contract.reward + companyFee) && isInteger(value['favor'], 0, contract.favor)
		&& (value['repairRepayment'] === undefined || isInteger(value['repairRepayment'], 1, repairRepaymentLimit(value['payout'])))
		&& isInteger(value['companyReputation'], 0, getContractTier(contract).reputation)
		&& (won || value['companyReputation'] === 0)
		&& (fieldLead === undefined || (fieldLead.pilotId === 'player') === (crew === undefined))
		&& (crew === undefined ? squad === undefined || isDeployedSquad(squad) : !value['aborted'] && !isAuthoredContract(contract) && isCrewChecks(crew)
			&& won === (crew.objective.passed && crew.extraction.passed) && isCrewSquad(squad, crew.extraction.passed))
		&& (won || value['payout'] === 0 && value['favor'] === 0) && isInteger(value['day'], 2, MAX_DAY);
};

const isCrewCheck = function (value: unknown): value is CrewCheck {
	return object(value) && isInteger(value['chance'], 0, 100) && isInteger(value['roll'], 1, 100) && value['passed'] === (value['roll'] <= value['chance']);
};

const isCrewChecks = function (value: unknown): value is Pick<CrewResolution, 'objective' | 'extraction'> {
	return object(value) && isCrewCheck(value['objective']) && isCrewCheck(value['extraction']);
};

const isCrewSquad = function (squad: unknown, extracted: boolean): squad is readonly DeployedPilot[] {
	return isSortieSquad(squad) && squad.every(function (member) { return member.pilotId !== 'player'; })
		&& (!extracted || squad.some(function (member) { return member.integrity > 0; }));
};

const isCrewSortie = function (value: unknown): value is CrewSortie {
	if (!object(value) || !isContract(value['contract']) || isAuthoredContract(value['contract'])) return false;
	const resolution = value['resolution'];
	if (!object(resolution)) return false;
	const squad = resolution['squad'];
	const leaderId = resolution['leaderId'];
	return isCrewChecks(resolution) && isCrewSquad(squad, resolution.extraction.passed)
		&& (leaderId === undefined || squad.some(function (member) { return member.pilotId === leaderId; }));
};

const isLineup = function (value: unknown): value is readonly PilotAssignment[] {
	if (!Array.isArray(value) || value.length !== SQUAD_SIZE || !value.every(isAssignment)) return false;
	const pilots = value.flatMap(function (seat) { return seat.pilotId ? [seat.pilotId] : []; });
	const rigs = value.flatMap(function (seat) { return seat.frameId ? [seat.frameId] : []; });
	return new Set(pilots).size === pilots.length && new Set(rigs).size === rigs.length;
};

const isPlannedOperation = function (value: unknown): value is PlannedOperation {
	if (!object(value) || value['shipId'] !== 'wayfarer' || !isContract(value['contract']) || !isLineup(value['lineup'])) return false;
	const leaderId = value['leaderId'];
	return leaderId === undefined || leaderId !== 'player' && value['lineup'].some(function (seat) { return seat.pilotId === leaderId && seat.frameId !== null; });
};

const isPilotWins = function (value: unknown): value is Partial<Record<PilotId, number>> {
	return object(value) && Object.entries(value).every(function ([id, wins]) { return isPilotId(id) && id !== 'player' && isInteger(wins, 0, MAX_PILOT_WINS); });
};

const sameContract = function (saved: Contract, generated: Contract): boolean {
	// Authored copy can be revised while a pilot still has the original terms.
	const sameCopy = isAuthoredContract(generated) || saved.title === generated.title && saved.briefing === generated.briefing;
	return saved.id === generated.id && saved.seed === generated.seed && saved.planetId === generated.planetId && saved.kind === generated.kind
		&& saved.employer === generated.employer && saved.opponent === generated.opponent && sameCopy
		&& saved.reward === generated.reward && saved.favor === generated.favor && saved.hostility === generated.hostility
		&& saved.tier === generated.tier && saved.requiredReputation === generated.requiredReputation && saved.fieldLayout === generated.fieldLayout;
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
		if (!object(value) || value['version'] !== CAMPAIGN_VERSION || typeof value['introComplete'] !== 'boolean' || !isInteger(value['seed'], 0, 0xffffffff) || !isPlanetId(value['planetId'])
			|| !isInteger(value['day'], 1, MAX_DAY) || !isInteger(value['boardRevision'], 0, MAX_COUNT) || value['day'] < value['boardRevision'] + 1
			|| !isInteger(value['companyReputation'], 0, MAX_COMPANY_REPUTATION)
			|| !isInteger(value['credits'], 0, MAX_CREDITS) || value['upkeepOwed'] !== undefined && !isInteger(value['upkeepOwed'], 0, MAX_CREDITS)
			|| value['repairDebt'] !== undefined && !isInteger(value['repairDebt'], 0, MAX_CREDITS)
			|| !isInteger(value['completed'], 0, MAX_COUNT) || !isInteger(value['failed'], 0, MAX_COUNT)
			|| value['completed'] + value['failed'] > Math.min(MAX_COUNT, value['boardRevision'] * MAX_OPERATIONS) || !isReputation(value['reputation']) || !isReputation(value['boardReputation'])
			|| value['active'] !== undefined && !isContract(value['active']) || value['lastResult'] !== undefined && !isResult(value['lastResult'])) return createCampaign();
		const universe = parseUniverse(value['universe'], value['day']);
		if (!universe) return createCampaign();
		const company = parseCompany(value, value['day'], value['active'] !== undefined);
		if (!company) return createCampaign();
		const operations = value['operations']; const committedCrew = value['committedCrew']; const lastOperationDay = value['lastOperationDay'];
		const preferredLineup = value['preferredLineup']; const pilotWins = value['pilotWins'];
		if (preferredLineup !== undefined && !isLineup(preferredLineup) || pilotWins !== undefined && !isPilotWins(pilotWins)) return createCampaign();
		if (operations !== undefined && (!Array.isArray(operations) || operations.length > MAX_OPERATIONS || !operations.every(isPlannedOperation)
			|| new Set(operations.map(function (entry) { return postingKey(entry.contract.id); })).size !== operations.length
			|| operations.some(function (entry) { return entry.contract.planetId !== value['planetId']; })
			|| operations.filter(function (entry) { return isAuthoredContract(entry.contract); }).length > 1
			|| operations.length > 0 && value['active'] !== undefined)) return createCampaign();
		if (committedCrew !== undefined && (!Array.isArray(committedCrew) || committedCrew.length >= MAX_OPERATIONS || !committedCrew.every(isCrewSortie)
			|| !value['active'] || !company.deployed || value['completed'] + value['failed'] + committedCrew.length + 1 > MAX_COUNT)) return createCampaign();
		if (lastOperationDay !== undefined && (!Array.isArray(lastOperationDay) || !lastOperationDay.length || lastOperationDay.length > MAX_OPERATIONS || !lastOperationDay.every(isResult)
			|| lastOperationDay.filter(function (result) { return !result.crew; }).length > 1
			|| new Set(lastOperationDay.map(function (result) { return result.contract.id; })).size !== lastOperationDay.length
			|| lastOperationDay.some(function (result) { return result.day !== lastOperationDay[0]?.day; })
			|| JSON.stringify(lastOperationDay[0]) !== JSON.stringify(value['lastResult']))) return createCampaign();
		const mode = value['mode'];
		if (mode !== undefined && mode !== 'campaign' && mode !== 'career') return createCampaign();
		const story = parseChainProgress(value['story']);
		if (mode === 'campaign') {
			if (!story || story.completed.length > value['completed'] || !value['introComplete'] && (story.completed.length > 0 || story.committed)) return createCampaign();
		} else if (value['story'] !== undefined) return createCampaign();
		const campaign: Campaign = {
			...company, version: CAMPAIGN_VERSION, introComplete: value['introComplete'], universe, seed: value['seed'], planetId: value['planetId'], day: value['day'], boardRevision: value['boardRevision'],
			credits: value['credits'], companyReputation: value['companyReputation'], completed: value['completed'], failed: value['failed'], reputation: { ...value['reputation'] },
			...(value['upkeepOwed'] === undefined ? {} : { upkeepOwed: value['upkeepOwed'] }),
			...(value['repairDebt'] === undefined ? {} : { repairDebt: value['repairDebt'] }),
			boardReputation: { ...value['boardReputation'] }, active: value['active'], lastResult: value['lastResult'],
			...(operations ? { operations } : {}), ...(committedCrew ? { committedCrew } : {}), ...(lastOperationDay ? { lastOperationDay } : {}),
			...(preferredLineup ? { preferredLineup } : {}), ...(pilotWins ? { pilotWins } : {}),
			...(mode ? { mode } : {}), ...(story ? { story } : {}),
		};
		const result = campaign.lastResult;
		if (result && result.day > campaign.day) return createCampaign();
		if (result && isAuthoredContract(result.contract)) {
			const step = getAuthoredStep(story, result.contract);
			const reported = result.won ? story?.completed.at(-1) : story?.committed;
			if (!step || reported !== result.contract.id || !sameContract(result.contract, step.contract)) return createCampaign();
		}
		const active = campaign.active;
		const contracts = active ? [active, ...(committedCrew?.map(function (sortie) { return sortie.contract; }) ?? [])] : [];
		const expectedReputation = chargeHostility(campaign.boardReputation, contracts);
		if (!FACTION_IDS.every(function (id) { return campaign.reputation[id] === expectedReputation[id]; })) return createCampaign();
		if (active) {
			if (campaign.day >= MAX_DAY || campaign.boardRevision >= MAX_COUNT) return createCampaign();
			if (isAuthoredContract(active) && story?.committed !== active.id) return createCampaign();
			const generated = findPosting(campaign, active.id, usesLegacyMissionTiers(active));
			if (!generated || !sameContract(active, generated) || companyRank(campaign) < getContractTier(active).rank || campaign.boardReputation[active.employer] < active.requiredReputation) return createCampaign();
			campaign.active = generated;
		}
		if (committedCrew) {
			const squad = [...(deployedSquad(company.deployed) ?? []), ...committedCrew.flatMap(function (sortie) { return sortie.resolution.squad; })];
			if (new Set(contracts.map(function (contract) { return contract.id; })).size !== contracts.length
				|| new Set(squad.map(function (member) { return member.pilotId; })).size !== squad.length || new Set(squad.map(function (member) { return member.frameId; })).size !== squad.length
				|| committedCrew.some(function ({ contract, resolution }) {
					const posting = findPosting(campaign, contract.id, usesLegacyMissionTiers(contract));
					return !posting || !sameContract(contract, posting) || companyRank(campaign) < getContractTier(contract).rank || campaign.boardReputation[contract.employer] < contract.requiredReputation
						|| resolution.squad.some(function (member) {
							return !campaign.pilots.includes(member.pilotId) || deploymentIssue(campaign, member.frameId) !== undefined
								|| campaign.fleet.find(function (rig) { return rig.frameId === member.frameId; })?.integrity !== member.startingIntegrity;
						});
				})) return createCampaign();
		}
		return campaign;
	} catch { return createCampaign(); }
};

const purgePreviousCampaigns = function () {
	for (let version = 1; version < CAMPAIGN_VERSION; version++) localStorage.removeItem(`heavy-rig:campaign:v${version}`);
};
export const readCampaign = function (): Campaign {
	try { purgePreviousCampaigns(); return recoverInterruptedDeployment(parseCampaign(localStorage.getItem(CAMPAIGN_STORAGE_KEY))); } catch { return createCampaign(); }
};

export const saveCampaign = function (campaign: Campaign): boolean {
	try { purgePreviousCampaigns(); localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaign)); return true; } catch { return false; }
};
