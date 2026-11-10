import { expect, test } from 'bun:test';
import { createTraining, prepareTraining, stepTraining, type Training } from '../src/training';
import { createMount, getWeapon } from '../src/arsenal';
import { createState, step, type Controls } from '../src/simulation';

const idle = function (training: Training): Controls {
	return { aim: training.state.enemies[0] ?? training.state.player, drive: 0, turn: 0, stop: false, fire: [false, false, false, false], coolant: false };
};
const advanceToEvasion = function (training: Training) {
	for (let tick = 0; tick < 60 * 60 && training.stage !== 'evade'; tick++) {
		const stage = training.stage;
		stepTraining(training, { ...idle(training), drive: stage === 'drive' ? 1 : 0, stop: stage === 'neutral', turn: stage === 'steer' ? 1 : 0, fire: [stage === 'cannon' || stage === 'heat', stage === 'combined', stage === 'missiles', stage === 'combined'], coolant: stage === 'coolant' }, 1 / 60);
	}
	expect(training.stage).toBe('evade');
};

test('the real control sequence completes training without spawning an assault or ending the operation', function () {
	const training = createTraining();
	advanceToEvasion(training);
	for (let tick = 0; tick < 600 && training.stage !== 'complete'; tick++) stepTraining(training, { ...idle(training), drive: training.strikeIssued ? 1 : 0 }, 1 / 60);
	expect(training.stage).toBe('complete');
	expect(training.state.wave).toBe(1);
	expect(training.state.spawned).toBe(0);
	expect(training.state.player.hp).toBe(100);
	expect(training.state.relay).toBe(100);
	expect(training.state.outcome).toBe('playing');
	const stoppedAt = training.state.time;
	stepTraining(training, { ...idle(training), drive: 1, fire: [true, false, false, false] }, 1 / 60);
	expect(training.state.time).toBe(stoppedAt);
	expect(training.state.events).toEqual([]);
});

test('missing the artillery exercise retries safely and coolant instruction cannot cool into a dead end', function () {
	const training = createTraining();
	for (let tick = 0; tick < 3600 && training.stage !== 'coolant'; tick++) {
		const stage = training.stage;
		stepTraining(training, { ...idle(training), drive: stage === 'drive' ? 1 : 0, stop: stage === 'neutral', turn: stage === 'steer' ? 1 : 0, fire: [stage === 'cannon' || stage === 'heat', stage === 'combined', stage === 'missiles', stage === 'combined'] }, 1 / 60);
	}
	expect(training.stage).toBe('coolant');
	for (let tick = 0; tick < 3600; tick++) stepTraining(training, idle(training), 1 / 60);
	stepTraining(training, { ...idle(training), coolant: true }, 1 / 60);
	expect(training.stage).toBe('evade');
	for (let tick = 0; tick < 420; tick++) stepTraining(training, idle(training), 1 / 60);
	expect(training.stage).toBe('evade');
	expect(training.state.player.hp).toBe(100);
	for (let tick = 0; tick < 600 && training.stage !== 'complete'; tick++) stepTraining(training, { ...idle(training), drive: training.strikeIssued ? 1 : 0 }, 1 / 60);
	expect(training.stage).toBe('complete');
});

test('entering evasion from an outward-facing arena boundary still gives the instructed forward escape', function () {
	const training: Training = { ...createTraining(), stage: 'coolant' };
	training.state.player.x = 35; training.state.player.y = 600; training.state.player.angle = Math.PI;
	stepTraining(training, { ...idle(training), coolant: true }, 1 / 60);
	expect(training.stage).toBe('evade');
	for (let tick = 0; tick < 600 && training.stage !== 'complete'; tick++) stepTraining(training, { ...idle(training), drive: training.strikeIssued ? 1 : 0 }, 1 / 60);
	expect(training.stage).toBe('complete');
});

// This drill must exercise simultaneous mounts, including the new fourth input.
test('combined-fire drill rejects one mount and accepts two held mounts including mount four', function () {
	const training: Training = { ...createTraining(), stage: 'combined' };
	for (let tick = 0; tick < 90; tick++) stepTraining(training, { ...idle(training), fire: [false, false, false, true] }, 1 / 60);
	expect(training.stage).toBe('combined');
	expect(training.state.stats.shotsFired).toBeGreaterThan(0);
	for (let tick = 0; tick < 49; tick++) stepTraining(training, { ...idle(training), fire: [false, true, false, true] }, 1 / 60);
	expect(training.stage).toBe('heat');
});

test('training uses legal Warden equipment, then switches to the Longbow energy hardpoint for reactor instruction', function () {
	const training: Training = { ...createTraining(), stage: 'combined' };
	expect(training.state.frame).toBe('warden');
	expect(training.state.loadout.map(function (mount) { return [mount.weapon, mount.slot]; })).toEqual([
		['autocannon', 0], ['machine-gun', 1], ['cluster-missiles', 2], ['stream-rockets', 3],
	]);
	for (let tick = 0; tick < 49; tick++) stepTraining(training, { ...idle(training), fire: [false, true, false, true] }, 1 / 60);
	expect(training.stage).toBe('heat');
	expect(training.state.frame).toBe('longbow');
	expect(training.state.loadout.map(function (mount) { return [mount.weapon, mount.slot]; })).toEqual([['laser', 0]]);
	for (let tick = 0; tick < 360 && training.stage === 'heat'; tick++) stepTraining(training, { ...idle(training), fire: [true, false, false, false] }, 1 / 60);
	expect(training.stage).toBe('coolant');
});

test('dry drills reload only in the simulator after launched rounds resolve, and can be retried repeatedly', function () {
	const training: Training = { ...createTraining(), stage: 'cannon' };
	training.state.loadout = [{ ...createMount('autocannon', 0), slot: 0 }];
	training.state.shots = [{ x: 500, y: 500, vx: 650, vy: 0, life: 0.5, kind: 'cannon', damage: 38, target: undefined }];
	prepareTraining(training, idle(training));
	expect(training.state.loadout[0]?.rounds).toBe(0);
	training.state.shots = [];
	for (let retry = 0; retry < 3; retry++) {
		const mount = training.state.loadout[0];
		if (!mount) throw new Error('Training cannon is required');
		mount.rounds = 0;
		training.state.player.heat = 100; training.state.player.overheated = true;
		prepareTraining(training, idle(training));
		expect(training.state.loadout[0]?.rounds).toBe(getWeapon('autocannon').ammunition?.defaultLoad);
		expect(training.state.player.overheated).toBe(false);
		expect(training.state.enemies).toHaveLength(1);
		expect(training.stage).toBe('cannon');
	}
	const sortie = createState();
	sortie.loadout = [{ ...createMount('autocannon', 0), slot: 0 }];
	step(sortie, { ...idle(training), fire: [true, false, false, false] }, 1 / 60);
	expect(sortie.loadout[0]?.rounds).toBe(0);
	expect(sortie.stats.shotsFired).toBe(0);
});
