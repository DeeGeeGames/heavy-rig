import type { Contract } from './campaign-types';

interface AuthoredStep {
	readonly contract: Readonly<Contract>;
	readonly contact: string;
	readonly label: string;
	readonly pitch: string;
	readonly success: string;
	readonly next: readonly string[];
}

interface ContractChain {
	readonly id: string;
	readonly title: string;
	readonly opening: string;
	readonly steps: readonly AuthoredStep[];
}

export interface ChainProgress {
	readonly id: string;
	readonly completed: readonly string[];
	readonly committed?: string;
}

const RECORDER = 'story:cinder-signal:recorder';
const RELAY = 'story:cinder-signal:relay';
const FUEL_WORKS = 'story:cinder-signal:fuel-works';

// Placeholder writing and terms for the Campaign opening. Keep published contract IDs stable.
const openingChain: ContractChain = {
	id: 'cinder-signal',
	title: 'The Cinder Signal',
	opening: RECORDER,
	steps: [
		{
			contract: {
				id: RECORDER, seed: 283191706, planetId: 'cinder', kind: 'recovery', employer: 'accord', opponent: 'combine',
				title: 'Recover the courier recorder', briefing: 'Find the courier cache. Hold inside its marker for five seconds, then extract with the recorder.',
				tier: 1, requiredReputation: -100, reward: 1500, favor: 8, hostility: 6,
			},
			contact: 'Iona Vale · Wayfarer Signals',
			label: 'Recovery',
			pitch: 'A courier went down on Cinder. The Accord is paying for its recorder. I pinned the drop site on your chart.',
			success: 'Vale decoded the recorder. It holds an evacuation route and the coordinates of a Combine fuel works.',
			next: [RELAY, FUEL_WORKS],
		},
		{
			contract: {
				id: RELAY, seed: 551667118, planetId: 'cinder', kind: 'defend', employer: 'freeholds', opponent: 'combine',
				title: 'Keep the evacuation relay live', briefing: 'Hold the relay against the Combine assault. Keep it transmitting until the attackers are down, then extract.',
				tier: 1, requiredReputation: -100, reward: 1400, favor: 10, hostility: 6,
			},
			contact: 'Tamsin Roe · Freeholds Dispatch',
			label: 'Defense',
			pitch: 'Keep the relay live and our evac ships can use the direct route off Cinder.',
			success: 'Roe confirms the last evac ship cleared Cinder. The relay is still open for the next convoy.',
			next: [],
		},
		{
			contract: {
				id: FUEL_WORKS, seed: 802310449, planetId: 'cinder', kind: 'demolition', employer: 'accord', opponent: 'combine',
				title: 'Destroy the Combine fuel works', briefing: 'Destroy the marked fuel works and extract. You can bypass the garrison.',
				tier: 1, requiredReputation: -100, reward: 1800, favor: 8, hostility: 8,
			},
			contact: 'Marek Sen · Accord Field Office',
			label: 'Demolition',
			pitch: 'Destroy the fuel works and cut off Combine patrols. The evac ships will have to take the long route.',
			success: 'Sen confirms the works are down. The Accord secured the supply lane and the evac ships diverted.',
			next: [],
		},
	],
};

const chains: readonly ContractChain[] = [openingChain];

export const createOpeningProgress = function (): ChainProgress {
	return { id: openingChain.id, completed: [] };
};

const findChain = function (id: string) {
	return chains.find(function (chain) { return chain.id === id; });
};

const findStep = function (chain: ContractChain, id: string) {
	return chain.steps.find(function (step) { return step.contract.id === id; });
};

export const isAuthoredContract = function (contract: Contract) { return contract.id.startsWith('story:'); };

export const getAuthoredStep = function (progress: ChainProgress | undefined, contract: Contract) {
	const chain = progress && isAuthoredContract(contract) ? findChain(progress.id) : undefined;
	return chain ? findStep(chain, contract.id) : undefined;
};

export const getChainStatus = function (progress: ChainProgress | undefined) {
	const chain = progress ? findChain(progress.id) : undefined;
	if (!chain || !progress) return undefined;
	const lastId = progress.completed.at(-1);
	const last = lastId ? findStep(chain, lastId) : undefined;
	const next = last ? last.next : [chain.opening];
	const offers = chain.steps.filter(function (step) {
		return next.includes(step.contract.id) && (!progress.committed || progress.committed === step.contract.id);
	});
	return { title: chain.title, last, offers, committed: progress.committed };
};

export const parseChainProgress = function (value: unknown): ChainProgress | undefined {
	if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string'
		|| !('completed' in value) || !Array.isArray(value.completed)) return undefined;
	const chain = findChain(value.id);
	if (!chain || value.completed.length > chain.steps.length) return undefined;
	const completed: string[] = [];
	let next: readonly string[] = [chain.opening];
	for (const id of value.completed) {
		if (typeof id !== 'string' || !next.includes(id)) return undefined;
		const step = findStep(chain, id);
		if (!step) return undefined;
		completed.push(id);
		next = step.next;
	}
	const committed = 'committed' in value ? value.committed : undefined;
	if (committed === undefined) return { id: chain.id, completed };
	if (typeof committed !== 'string' || !next.includes(committed) || !findStep(chain, committed)) return undefined;
	return { id: chain.id, completed, committed };
};
