import { MAX_CREDITS, type Campaign } from './campaign';
import { spendableMaintenanceFunds, type OwnedMech } from './company';
import type { Biome } from './campaign-types';
import { canStartRomance, changeRelationship, getRelationship, retireCouple, type PilotRelationship } from './pilot-relationships';
import { getPilot, isPilotId, type PilotId } from './pilots';
import { rigName } from './rigs';
import { getPlanet, randomSource } from './universe';

const shipKinds = ['star-clock', 'weather-window', 'solar-surge', 'slipped-cradle', 'salvage-plates'] as const;
const crewKinds = ['shared-simulator', 'crossed-calls', 'shore-leave', 'shared-quarters', 'separate-bunks', 'old-channel', 'last-watch'] as const;
type ShipKind = typeof shipKinds[number];
type CrewKind = typeof crewKinds[number];
export type EventKind = ShipKind | CrewKind;
type Pair = readonly [PilotId, PilotId];
export type CompanyEventSpec = { readonly kind: ShipKind; readonly pair?: never } | { readonly kind: CrewKind; readonly pair: Pair };

const isShipKind = function (value: unknown): value is ShipKind { return shipKinds.some(function (kind) { return kind === value; }); };
export const isEventKind = function (value: unknown): value is EventKind { return isShipKind(value) || crewKinds.some(function (kind) { return kind === value; }); };
export const isCompanyEventSpec = function (value: unknown): value is CompanyEventSpec {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !('kind' in value) || !isEventKind(value.kind)) return false;
	if (isShipKind(value.kind)) return !('pair' in value);
	if (!('pair' in value) || !Array.isArray(value.pair) || value.pair.length !== 2) return false;
	const [a, b] = value.pair;
	return isPilotId(a) && isPilotId(b) && a < b;
};

const hullRig = function (campaign: Campaign, kind: EventKind): OwnedMech | undefined {
	if (kind !== 'slipped-cradle' && kind !== 'salvage-plates') return undefined;
	const inWorkshop = new Set(campaign.workOrders.map(function (order) { return order.frameId; }));
	return campaign.fleet.find(function (rig) {
		return (kind === 'slipped-cradle' ? rig.integrity >= 6 : rig.integrity > 0 && rig.integrity <= 93) && !inWorkshop.has(rig.frameId);
	});
};

export const isEventEligible = function (campaign: Campaign, spec: CompanyEventSpec): boolean {
	if (campaign.active || campaign.deployed || campaign.committedCrew) return false;
	if (!spec.pair) return spec.kind !== 'slipped-cradle' && spec.kind !== 'salvage-plates' || Boolean(hullRig(campaign, spec.kind));
	const [a, b] = spec.pair;
	if (a >= b || !campaign.pilots.includes(a) || !campaign.pilots.includes(b)) return false;
	const { romance, affinity } = getRelationship(campaign, a, b);
	switch (spec.kind) {
	case 'shared-simulator': return affinity < 2;
	case 'crossed-calls': return true;
	case 'shore-leave': return affinity >= 0 && canStartRomance(campaign, a, b);
	case 'shared-quarters': return romance === 'dating';
	case 'separate-bunks': return romance === 'dating' || romance === 'committed';
	case 'old-channel': return romance === 'exes' && affinity < 1;
	case 'last-watch': return romance === 'committed';
	}
};

const orderedPair = function (a: PilotId, b: PilotId): Pair { return a < b ? [a, b] : [b, a]; };
const draw = function <T>(items: readonly T[], random: () => number): T | undefined { return items[Math.floor(random() * items.length)]; };
const drawPilots = function (pilots: readonly PilotId[], random: () => number): Pair | undefined {
	if (pilots.length < 2) return undefined;
	const first = Math.floor(random() * pilots.length);
	const other = Math.floor(random() * (pilots.length - 1));
	const a = pilots[first];
	const b = pilots[other >= first ? other + 1 : other];
	return a && b ? orderedPair(a, b) : undefined;
};

// Sample one cast per story. A growing crew gets more possible participants
// without crowding ship incidents out of the draw or allocating every possible pair.
export const eventCandidates = function (campaign: Campaign, seed = campaign.seed): readonly CompanyEventSpec[] {
	if (campaign.active || campaign.deployed || campaign.committedCrew) return [];
	const candidates: CompanyEventSpec[] = shipKinds.map(function (kind) { return { kind }; });
	const random = randomSource(seed);
	const roster = new Set(campaign.pilots);
	const relationships = campaign.relationships ?? [];
	const aboard = relationships.filter(function ({ a, b }) { return roster.has(a) && roster.has(b); });
	const addPair = function (kind: CrewKind, pair: Pair | undefined) { if (pair) candidates.push({ kind, pair }); };
	const fromRecords = function (kind: CrewKind, records: readonly PilotRelationship[]) {
		const match = draw(records, random);
		if (match) addPair(kind, orderedPair(match.a, match.b));
	};
	addPair('shared-simulator', drawPilots(campaign.pilots, random));
	addPair('crossed-calls', drawPilots(campaign.pilots, random));

	const partnered = new Set(relationships.filter(function ({ romance }) { return romance === 'dating' || romance === 'committed' || romance === 'retired'; })
		.flatMap(function ({ a, b }) { return [a, b]; }));
	const singles = campaign.pilots.filter(function (id) { return !partnered.has(id); }).map(getPilot);
	const woman = draw(singles.filter(function (pilot) { return pilot.gender === 'female'; }), random);
	const man = draw(singles.filter(function (pilot) { return pilot.gender === 'male'; }), random);
	if (woman && man) addPair('shore-leave', orderedPair(woman.id, man.id));
	fromRecords('shared-quarters', aboard.filter(function (bond) { return bond.romance === 'dating'; }));
	fromRecords('separate-bunks', aboard.filter(function (bond) { return bond.romance === 'dating' || bond.romance === 'committed'; }));
	fromRecords('old-channel', aboard.filter(function (bond) { return bond.romance === 'exes' && bond.affinity < 1; }));
	fromRecords('last-watch', aboard.filter(function (bond) { return bond.romance === 'committed'; }));
	return candidates.filter(function (spec) { return isEventEligible(campaign, spec); });
};

interface Consequence {
	readonly story: string;
	readonly credits?: number;
	readonly invoice?: number;
	readonly hull?: number;
	readonly trust?: number;
	readonly romance?: 'dating' | 'committed' | 'exes';
	readonly retire?: true;
}
interface EventOption {
	readonly id: string;
	readonly label: string;
	readonly result: Consequence;
	readonly risk?: { readonly percent: number; readonly miss: Consequence };
}
interface EventScript {
	readonly category: 'Ship' | 'Environment' | 'Crew' | 'Relationship';
	readonly title: string;
	readonly body: string;
	readonly choices: readonly EventOption[];
}
const option = function (id: string, label: string, result: Consequence, risk?: EventOption['risk']): EventOption {
	return { id, label, result, ...(risk ? { risk } : {}) };
};

const surveys: Readonly<Record<Biome, string>> = {
	badlands: 'The water office needs a map of dust moving over its catchment basins.',
	volcanic: 'A foundry wants a track on the ash plume crossing its landing approach.',
	tundra: 'An ice convoy needs the fracture line ahead of its lead crawler mapped.',
	wetlands: 'A pump station wants a reading on the spring tide climbing its levees.',
	forest: 'Fire crews need to know which ridge the smoke will cross next.',
	steppe: 'Wind technicians want a reading on the squall bearing down on their turbine rows.',
	crystal: 'A survey camp wants a pass over the glare hiding its quartz markers.',
};

const eventScript = function (campaign: Campaign, spec: CompanyEventSpec): EventScript {
	const planet = getPlanet(campaign.planetId);
	if (!spec.pair) {
		const rig = hullRig(campaign, spec.kind);
		const name = rig ? rigName(rig.frameId) : 'the rig';
		switch (spec.kind) {
		case 'star-clock': return {
			category: 'Ship', title: 'Eight bells slow',
			body: 'A load of scrap instruments comes aboard the Wayfarer, with a brass star clock still ticking inside the crate. The chandlery will pay by weight today. A collector offers more if the clock can hold time through a full watch.',
			choices: [
				option('sell', 'Take the chandlery offer', { credits: 90, story: 'The chandler counts out the brass weight. Someone winds the clock once more before it goes.' }),
				option('test', 'Put the clock on test', { credits: 220, story: 'Eight bells, right on time. The collector takes the clock with its worn brass face intact.' },
					{ percent: 55, miss: { story: 'The clock loses a minute on the last bell. The night watch hangs it in the chart room.' } }),
			],
		};
		case 'weather-window': return {
			category: 'Environment', title: 'One clear pass',
			body: `Survey traffic from ${planet.name} comes through on the weather band. ${surveys[planet.biome]} The Wayfarer can sell a quick scan or rent a recorder for 60 CR and try for a full trace before the window closes.`,
			choices: [
				option('scan', 'Relay the quick scan', { credits: 70, story: 'The ground crew confirms the reading and releases the survey fee.' }),
				option('record', 'Rent the recorder', { credits: 185, story: 'The last line clears the recorder just before the horizon. The full survey payment covers the rental and leaves a profit.' },
					{ percent: 65, miss: { credits: -60, story: 'The ground track slips out of view. The incomplete trace earns no fee, and the rental still comes due.' } }),
			],
		};
		case 'solar-surge': return {
			category: 'Environment', title: 'Running on batteries',
			body: `A solar surge over ${planet.name} blows a lighting inverter. The Wayfarer’s corridors go red on battery power. A parts tender can put a replacement through the lock today. The counter price is 80 CR, or the supplier will carry 125 CR on the ship’s maintenance account.`,
			choices: [
				option('pay', 'Pay at the lock', { credits: -80, story: 'Engineering signs for the inverter. White lights flicker on from the engine room to the bridge.' }),
				option('invoice', 'Put it on account', { invoice: 125, story: 'The lights come back on. The purser files the invoice with unpaid upkeep for collection as funds allow.' }),
			],
		};
		case 'slipped-cradle': return {
			category: 'Ship', title: 'A tooth off the ratchet',
			body: `A freight cradle hangs crooked over ${name} in the Wayfarer’s bay. One tooth has already sheared off the winch. A dock rigger can catch the load. Engineering can also lower it onto the rig’s shoulder, at the cost of an armor plate.`,
			choices: [
				option('jack', 'Hire the dock rigger', { credits: -95, story: 'The rigger takes the weight on a portable jack. The cradle comes down square.' }),
				option('brace', 'Brace it with the rig', { hull: -5, story: `The crew lowers the cradle onto ${name}. A shoulder plate buckles under the load.` }),
			],
		};
		case 'salvage-plates': return {
			category: 'Environment', title: 'A match in the drift',
			body: `A pallet of ceramic armor tiles drifts past the Wayfarer above ${planet.name}. The salvage desk offers cash for it. Engineering has already marked the tiles that fit the damaged hull of ${name}.`,
			choices: [
				option('sell', 'Sell the recovered tiles', { credits: 145, story: 'The salvage launch takes the pallet alongside and transfers the fee.' }),
				option('patch', 'Send the tiles to Engineering', { hull: 7, story: `The weld crew seals a fresh section of armor on ${name}.` }),
			],
		};
		}
	}
	const [first, second] = spec.pair;
	const a = getPilot(first).callsign;
	const b = getPilot(second).callsign;
	const partners = first === 'player' ? `You and ${b}` : second === 'player' ? `You and ${a}` : `${a} and ${b}`;
	switch (spec.kind) {
	case 'shared-simulator': return {
		category: 'Crew', title: 'Flying blind',
		body: `${partners} pull off a blind handoff in the simulator after the instructor kills the comms. There is room for one more run. A survey team at the dock will buy that last slot if you give it up.`,
		choices: [
			option('practice', 'Repeat the handoff', { trust: 1, story: `${partners} make the second pickup in silence. Each rig is right where the other pilot expects it.` }),
			option('rent', 'Rent out the sim time', { credits: 85, story: 'The survey team wires its fee and takes the seats while the cockpit shells are still warm.' }),
		],
	};
	case 'crossed-calls': return {
		category: 'Crew', title: 'Two copies of the order',
		body: `${partners} were on different channels during a pickup drill. Two duty sheets show the same revision and different frequencies. The dock controller can recover the recording before it rolls over at shift change.`,
		choices: [
			option('recover', 'Buy the recovered recording', { credits: -65, trust: 1, story: `${partners} bring both cockpit tapes to the debrief. They carry the same wrong timestamp.` }),
			option('sign', 'Sign off without the tape', { trust: -1, story: `${partners} sign the report. Each leaves thinking the other heard the call.` }),
		],
	};
	case 'shore-leave': return {
		category: 'Relationship', title: 'Two seats on the tender',
		body: `${a} is holding two supper tickets for ${planet.name}. ${b} has both leave slips ready. They want to go down together. The last two seats on the tender can take the pair or a paying courier’s locked case.`,
		choices: [
			option('tickets', 'Clear the two seats', { trust: 1, romance: 'dating', story: `When the tender brings them back, ${a} and ${b} tell the night watch they are seeing each other.` }),
			option('courier', 'Carry the courier’s case', { credits: 80, story: 'The courier pays at the lock. The two supper tickets stay tucked in a jacket pocket.' }),
		],
	};
	case 'shared-quarters': return {
		category: 'Relationship', title: 'Two names on the door',
		body: `An aft cabin has opened up. ${a} and ${b} arrive with two brass nameplates and ask to make it their home. The purser has a standing offer to lease the space for bonded freight.`,
		choices: [
			option('keys', 'Hand them the cabin keys', { trust: 1, romance: 'committed', story: `By the end of the watch, ${a} and ${b} have both nameplates on the door and both lockers full.` }),
			option('lease', 'Lease the cabin for freight', { credits: 105, story: `${a} pockets both nameplates. The two keep their bunks and the purser signs for the freight.` }),
		],
	};
	case 'separate-bunks': return {
		category: 'Relationship', title: 'The second duffel',
		body: `Two packed bags sit in the passage. ${a} and ${b} have asked for separate quarters. They both agree to one last session with a counselor ashore if the company covers it. Otherwise they’re ready to call it.`,
		choices: [
			option('talk', 'Book the shore appointment', { credits: -75, trust: 1, story: `${a} and ${b} set their bags down in the same cabin. This time both pilots write the next shore date on the board.` },
				{ percent: 65, miss: { credits: -75, trust: -1, romance: 'exes', story: `${a} and ${b} return on the same tender and carry their bags to different bunks. They have ended the relationship.` } }),
			option('quarters', 'Sign the separate berths', { trust: -2, romance: 'exes', story: `${a} takes the fore berth. ${b} takes the aft one. The two tell their watchmates they have broken up.` }),
		],
	};
	case 'old-channel': return {
		category: 'Relationship', title: 'An open channel',
		body: `${a} and ${b} have barely spoken since they split up. Now both want to rehearse a paired radio check without the whole watch listening. The only private booth is booked for a paying signal test.`,
		choices: [
			option('booth', 'Give them the booth', { trust: 1, story: `${a} breaks the silence with a radio check. ${b} answers. On the second run, the handoff is clean.` }),
			option('test', 'Keep the paid signal test', { credits: 75, story: 'The test comes back clean. The two pilots leave their own check for another watch.' }),
		],
	};
	case 'last-watch': return {
		category: 'Relationship', title: 'Their last watch',
		body: `${a} and ${b} hand you their resignations. They’ve booked the civil registry on ${planet.name} and found a home to start a family. They leave today. Their rigs stay aboard and their seats open up.`,
		choices: [
			option('bell', 'Ring the departure bell', { retire: true, story: `The watch lines the passage and rings the bell twice. ${a} and ${b} head for the registry in their dress jackets.` }),
			option('grant', 'Give them a wedding grant', { retire: true, credits: -150, story: `The quartermaster adds a household grant to their passage papers. ${a} and ${b} step off the Wayfarer to start their family.` }),
		],
	};
	}
};

const creditDelta = function (campaign: Campaign, delta: number) { return Math.min(MAX_CREDITS - campaign.credits, delta); };
const invoiceDelta = function (campaign: Campaign, amount: number) { return Math.min(amount, MAX_CREDITS - (campaign.upkeepOwed ?? 0)); };
const signed = function (amount: number): string { return amount < 0 ? `−${-amount}` : `+${amount}`; };
const effectText = function (campaign: Campaign, spec: CompanyEventSpec, effect: Consequence): string {
	const terms: string[] = [];
	if (effect.credits) {
		const delta = creditDelta(campaign, effect.credits);
		terms.push(delta ? `${signed(delta)} CR` : 'Credit limit reached');
	}
	if (effect.invoice) terms.push(`+${invoiceDelta(campaign, effect.invoice)} CR unpaid upkeep`);
	if (effect.hull) {
		const rig = hullRig(campaign, spec.kind);
		terms.push(`${signed(effect.hull)} hull points${rig ? ` on ${rigName(rig.frameId)}` : ''}`);
	}
	if (spec.pair && effect.trust) {
		const { affinity } = getRelationship(campaign, ...spec.pair);
		const delta = Math.max(-2, Math.min(2, affinity + effect.trust)) - affinity;
		terms.push(delta ? `Trust ${signed(delta)}` : 'Trust holds');
	}
	if (effect.romance) terms.push({ dating: 'Dating', committed: 'Committed partners', exes: 'Relationship ends' }[effect.romance]);
	if (effect.retire) terms.push('Both pilots retire permanently');
	return terms.join(' · ') || 'No payout';
};

const requiredFunds = function (choice: EventOption): number { return Math.max(0, -(choice.result.credits ?? 0), -(choice.risk?.miss.credits ?? 0)); };
export const describeEvent = function (campaign: Campaign, spec: CompanyEventSpec) {
	const { category, title, body, choices } = eventScript(campaign, spec);
	const funds = spendableMaintenanceFunds(campaign, campaign.day);
	return { category, title, body, choices: choices.map(function (choice) {
		const { id, label, result, risk } = choice;
		const reward = effectText(campaign, spec, result);
		const required = requiredFunds(choice);
		const enabled = funds >= required;
		const detail = risk ? `${risk.percent}% → ${reward} / ${100 - risk.percent}% → ${effectText(campaign, spec, risk.miss)}` : reward;
		return { id, label, enabled, detail: enabled ? detail : `${detail} · Requires ${required} spendable CR` };
	}) };
};

export const applyEventChoice = function (campaign: Campaign, spec: CompanyEventSpec, choiceId: string, seed: number): { campaign: Campaign; outcome: string } | undefined {
	if (!isEventEligible(campaign, spec)) return undefined;
	const choice = eventScript(campaign, spec).choices.find(function (entry) { return entry.id === choiceId; });
	if (!choice || requiredFunds(choice) > spendableMaintenanceFunds(campaign, campaign.day)) return undefined;
	const effect = choice.risk && randomSource(seed)() * 100 >= choice.risk.percent ? choice.risk.miss : choice.result;
	let next = campaign;
	if (effect.credits) next = { ...next, credits: next.credits + creditDelta(next, effect.credits) };
	if (effect.invoice) next = { ...next, upkeepOwed: (next.upkeepOwed ?? 0) + invoiceDelta(next, effect.invoice) };
	const points = effect.hull;
	if (points) {
		const rig = hullRig(next, spec.kind);
		if (!rig) return undefined;
		next = { ...next, fleet: next.fleet.map(function (mech) { return mech === rig ? { ...mech, integrity: mech.integrity + points } : mech; }) };
	}
	if (spec.pair && (effect.trust || effect.romance)) next = changeRelationship(next, ...spec.pair, effect.trust ?? 0, effect.romance);
	if (spec.pair && effect.retire) {
		next = retireCouple(next, ...spec.pair);
		if (spec.pair.some(function (pilot) { return next.pilots.includes(pilot); })) return undefined;
	}
	return { campaign: next, outcome: `${effect.story} ${effectText(campaign, spec, effect)}.` };
};
