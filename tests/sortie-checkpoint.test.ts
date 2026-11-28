import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { acceptContract, createCampaign, getContracts, parseSavedCompany } from '../src/campaign';
import { assignPilot, assignRig, beginDeployment, buyFrame, checkpointDeployment, getOwnedMech } from '../src/company';
import { hirePilot } from '../src/pilots';
import { createCombatRuntime } from '../src/combat-runtime';
import { createSituationMission } from '../src/situation-sim';
import { captureSortie, parseSortieCheckpoint, restoreSortie, tryCaptureSortie } from '../src/sortie-checkpoint';
import { createMissionState, spawningStep, type CombatStateView, type Controls } from '../src/simulation';

const setup = function () {
	return createSituationMission({ kind: 'acquisition', planetId: 'meridian', tier: 3, frame: 'warden', wing: [{ pilotId: 'flint', frame: 'kestrel' }] }, 32415, 'veteran');
};
const attach = async function (initial: CombatStateView) {
	const runtime = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(runtime.plugin).withFixedTimestep(1 / 60).build();
	await world.initialize();
	const state = runtime.attach(initial);
	runtime.setEnabled(true);
	return { runtime, world, state };
};

test('a live ECS sortie resumes the identical next fixed steps with weapons in flight and a partially captured objective', async function () {
	const initial = setup();
	const original = initial.mission;
	const mate = initial.squadmates[0];
	const site = original?.captureSites?.[0];
	if (!original || !mate || !site) throw new Error('Missing acquisition deployment');
	Object.assign(initial.player, { x: site.x, y: site.y, angle: .3, turret: .3, hp: 73.25, heat: 42 });
	mate.order = { kind: 'move', point: { x: mate.x, y: mate.y }, progress: { searchAfter: 3.5 } };
	mate.fireDiscipline = 'hold';
	mate.experienceBonus = 2;
	const aim = { x: site.x + 400 * Math.cos(.3), y: site.y + 400 * Math.sin(.3) };
	const input: Controls = { drive: 0, turn: 0, stop: false, fire: [true, true, false, true], coolant: false, aim };
	const a = await attach(initial);
	try {
		a.runtime.setControls(function () { return input; });
		for (let tick = 0; tick < 10; tick++) a.world.update(1 / 60);
		const snapshot = captureSortie(a.state);
		const checkpoint = parseSortieCheckpoint(JSON.parse(JSON.stringify(snapshot)), original.contract);
		if (!checkpoint) throw new Error('Live acquisition checkpoint rejected');
		const initialAgain = setup();
		const restored = restoreSortie(initialAgain, checkpoint);
		if (!restored) throw new Error('Acquisition checkpoint did not restore');
		expect(restored.mission?.map).toBe(initialAgain.mission?.map);
		expect(restored.time).toBeGreaterThan(0);
		expect(restored.mission?.captureSites?.[0]?.holdTime).toBeGreaterThan(0);
		expect(restored.shots.length).toBeGreaterThan(0);
		expect(restored.squadmates[0]?.order).toMatchObject({ kind: 'move', progress: { searchAfter: 3.5 } });
		expect(restored.squadmates[0]?.experienceBonus).toBe(2);
		expect(restored.events).toEqual([]);
		const b = await attach(restored);
		try {
			b.runtime.setControls(function () { return input; });
			expect(captureSortie(b.state)).toEqual(snapshot);
			for (let tick = 0; tick < 48; tick++) {
				a.world.update(1 / 60);
				b.world.update(1 / 60);
			}
			expect(captureSortie(b.state)).toEqual(captureSortie(a.state));
			expect(checkpoint.time).toBe(snapshot.time);
			expect(checkpoint.time).toBeLessThan(b.state.time);
		} finally { await b.world.dispose(); }
	} finally { await a.world.dispose(); }
});

test('defense reinforcements share their transport after reload and never serialize terrain in a save', function () {
	const state = createSituationMission({ kind: 'defend', planetId: 'cinder', tier: 10, frame: 'warden', wing: [] }, 1341332682, 'story');
	const mission = state.mission;
	if (!mission) throw new Error('Missing defense deployment');
	Object.assign(state.player, mission.map.objective);
	spawningStep(state, 1 / 60);
	state.spawnIn = 0; state.time = 15;
	spawningStep(state, 1 / 60);
	const snap = captureSortie(state);
	expect(snap.flights).toHaveLength(1);
	expect(JSON.stringify(snap)).not.toContain('"terrain"');
	const fresh = createMissionState(mission.contract, { frame: state.frame, difficulty: state.difficulty });
	const restored = restoreSortie(fresh, snap);
	if (!restored) throw new Error('Defense checkpoint did not restore');
	const passengers = restored.warnings.flatMap(function (warning) { return warning.drop ? [warning.drop] : []; });
	expect(passengers).toHaveLength(2);
	expect(passengers[1]?.flight).toBe(passengers[0]?.flight);
	expect(passengers[0]?.flight.field).toBe(fresh.mission?.map);
	const corrupt = { ...snap, flights: [] };
	expect(parseSortieCheckpoint(corrupt, mission.contract)).toBeUndefined();
	expect(restoreSortie(fresh, corrupt)).toBeUndefined();
});

test('damaged or mismatched combat data is rejected and a recorded loss remains terminal', function () {
	const initial = setup();
	const contract = initial.mission?.contract;
	if (!contract) throw new Error('Missing acquisition deployment');
	const snap = captureSortie(initial);
	expect(parseSortieCheckpoint({ ...snap, nextId: 1 }, contract)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...snap, seed: snap.seed + 1 }, contract)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...snap, mission: { ...snap.mission, captureSites: [] } }, contract)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...snap, loadout: [{ weapon: 'machine-gun', rounds: -1, firing: true, cooldown: 0 }] }, contract)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...snap, shots: [{ damage: 1 }] }, contract)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...snap, outcome: 'won' }, contract)).toBeUndefined();
	initial.player.hp = 0; initial.outcome = 'lost';
	const saved = parseSortieCheckpoint(captureSortie(initial), contract);
	if (!saved) throw new Error('Terminal save rejected');
	const restored = restoreSortie(setup(), saved);
	expect(restored?.outcome).toBe('lost');
	expect(restored?.player.hp).toBe(0);
});

test('a self-consistent truncated clearance garrison fails validation before storage chooses its backup', function () {
	const initial = createSituationMission({ kind: 'clearance', planetId: 'meridian', tier: 1, frame: 'kestrel', wing: [] }, 42, 'standard');
	const contract = initial.mission?.contract;
	if (!contract) throw new Error('Missing clearance contract');
	const valid = captureSortie(initial);
	const truncated = { ...valid, enemies: valid.enemies.slice(1), spawned: valid.spawned - 1, mission: { ...valid.mission, required: valid.mission.required - 1 } };
	expect(parseSortieCheckpoint(valid, contract)).toBeDefined();
	expect(parseSortieCheckpoint(truncated, contract)).toBeUndefined();
	expect(restoreSortie(initial, truncated)).toBeUndefined();
	initial.player.x = Number.NaN;
	expect(tryCaptureSortie(initial)).toBeUndefined();
	expect(valid.player.x).toBeFinite();
});

test('v8 deployed condition and identical chassis copies remain bound to the right pilots at the saved difficulty', function () {
	const funded = { ...createCampaign(23), credits: 30000 };
	const hired = hirePilot(buyFrame(buyFrame(funded, 'kestrel'), 'kestrel'), 'flint');
	const posting = getContracts(hired)[0];
	if (!posting) throw new Error('Missing posting');
	const departed = beginDeployment(assignRig(assignPilot(acceptContract(hired, posting.id), 1, 'flint'), 1, 'kestrel#2'));
	const commander = getOwnedMech(departed, 'kestrel'), wing = getOwnedMech(departed, 'kestrel#2');
	if (!departed.active || !departed.deployed || !commander || !wing) throw new Error('Missing crew deployment');
	const state = createMissionState(departed.active, {
		difficulty: 'veteran', frame: 'kestrel', loadout: commander.loadout, reserves: commander.reserves,
		squadmates: [{ pilotId: 'flint', callsign: 'Flint', specialty: 'marksman', frameId: 'kestrel', loadout: wing.loadout, reserves: wing.reserves, integrity: 100 }],
	});
	const mate = state.squadmates[0];
	if (!mate) throw new Error('Missing wingmate');
	state.player.hp = 61.25; state.coolantCharges = 1; mate.hp = 23.75;
	const field = checkpointDeployment(departed, state.player.hp, state.coolantCharges, [{ frameId: 'kestrel#2', hp: mate.hp }]);
	const loaded = parseSavedCompany(JSON.parse(JSON.stringify(field)));
	if (!loaded?.active) throw new Error('v8 transaction rejected');
	const save = captureSortie(state, field.deployed);
	const valid = parseSortieCheckpoint(save, loaded.active, loaded);
	if (!valid) throw new Error('Matching deployed lineup rejected');
	expect(valid).toMatchObject({ difficulty: 'veteran', player: { hp: 61.25 }, squadmates: [{ hp: 23.75 }], rigs: { commander: 'kestrel', wing: ['kestrel#2'] } });
	expect(parseSortieCheckpoint({ ...save, rigs: { commander: 'kestrel', wing: ['kestrel#3'] } }, loaded.active, loaded)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...save, player: { ...save.player, hp: 100 } }, loaded.active, loaded)).toBeUndefined();
	expect(parseSortieCheckpoint({ ...save, coolantCharges: 2 }, loaded.active, loaded)).toBeUndefined();
	expect(restoreSortie(createMissionState(loaded.active, { difficulty: 'story' }), valid)).toBeUndefined();
});
