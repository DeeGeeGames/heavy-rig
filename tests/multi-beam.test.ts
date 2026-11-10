import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { Mesh, Scene, Vector3, type Object3D } from 'three';
import { getWeapon } from '../src/arsenal';
import { loadedMounts } from '../src/combat-resources';
import { createCombatRuntime } from '../src/combat-runtime';
import { createState, weaponsStep, type Controls } from '../src/simulation';
import { createWorldObjects } from '../src/world-3d';

const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 1100, y: 780 }, fire: [false, false, false, false], coolant: false };
const fire: Controls = { ...idle, targetId: 1, fire: [false, false, true, true] };
const scenario = function () {
	const state = createState({ frame: 'warden-b' }); state.spawnIn = 3600; state.player.turret = 0;
	state.loadout = loadedMounts([null, null, 'laser', 'laser']);
	state.enemies.push({ id: state.nextId++, x: 1100, y: 780, angle: 0, hp: 1000, maxHp: 1000, cooldown: 3600, heavy: false, kind: 'scout' });
	return state;
};

test('simultaneous lasers retain sparse mount slots and apply damage and heat once per firing mount', function () {
	const state = scenario(); const target = state.enemies[0]; if (!target) throw new Error('Missing target');
	const laser = getWeapon('laser');
	weaponsStep(state, fire, 1 / 60);
	expect(state.beams.map(function (beam) { return beam.slot; })).toEqual([2, 3]);
	expect(state.beam).toBe(state.beams[0]);
	expect(target.hp).toBeCloseTo(1000 - laser.damage * 2 / 60, 8);
	expect(state.player.heat).toBeCloseTo(laser.heat * 2 / 60, 8);
	expect(state.loadout.map(function (mount) { return mount.rounds; })).toEqual([0, 0]);
	weaponsStep(state, { ...idle, fire: [false, false, false, true] }, 1 / 60);
	expect(state.beams.map(function (beam) { return beam.slot; })).toEqual([3]);
	weaponsStep(state, idle, 1 / 60);
	expect(state.beams).toEqual([]); expect(state.beam).toBeUndefined();
});

test('a laser reaching the shared heat lock prevents later mounts from dealing damage or retaining a beam', function () {
	const state = scenario(); state.player.heat = 99.8;
	const target = state.enemies[0]; if (!target) throw new Error('Missing target');
	weaponsStep(state, fire, 1 / 60);
	expect(state.beams.map(function (beam) { return beam.slot; })).toEqual([2]);
	expect(target.hp).toBeCloseTo(1000 - getWeapon('laser').damage / 60, 8);
	expect(state.player.overheated).toBe(true); expect(state.stats.overheats).toBe(1);
	const hp = target.hp;
	weaponsStep(state, fire, 1 / 60);
	expect(state.beams).toEqual([]); expect(target.hp).toBe(hp); expect(state.stats.overheats).toBe(1);
});

test('ECS beam feedback stays authoritative through pause, resource replacement, and mission replacement', async function () {
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize();
		const state = combat.attach(scenario()); combat.setControls(function () { return fire; }); combat.setEnabled(true);
		world.update(1 / 60);
		expect(state.beams.map(function (beam) { return beam.slot; })).toEqual([2, 3]);
		expect(state.beams).toBe(world.getResource('combatFeedback').beams);
		const snapshot = JSON.stringify(state); combat.setEnabled(false);
		for (let tick = 0; tick < 60; tick++) world.update(1 / 60);
		expect(JSON.stringify(state)).toBe(snapshot);
		world.addResource('combatFeedback', { ...world.getResource('combatFeedback'), beams: [{ slot: 3, x: 1200, y: 700 }] });
		expect(state.beam).toBe(state.beams[0]); expect(state.beam?.x).toBe(1200);
		state.beam = undefined; expect(world.getResource('combatFeedback').beams).toEqual([]);
		const next = combat.attach(createState());
		expect(next.beams).toEqual([]); expect(next.beam).toBeUndefined();
	} finally { await world.dispose(); }
});

const beamEnds = function (value: Object3D | undefined): readonly [Vector3, Vector3] {
	const halo = value?.children[0]; if (!(halo instanceof Mesh)) throw new Error('Missing beam mesh');
	return [new Vector3(0, -0.5, 0).applyMatrix4(halo.matrixWorld), new Vector3(0, 0.5, 0).applyMatrix4(halo.matrixWorld)];
};

test('beam rendering follows each exact muzzle slot and clears every beam on restart', function () {
	const scene = new Scene(); const world = createWorldObjects(scene); const state = createState();
	const muzzles = [new Vector3(900, 40, 780), new Vector3(910, 60, 790), new Vector3(920, 80, 800), new Vector3(930, 100, 810)];
	state.beams = [{ slot: 1, x: 1200, y: 700, elevation: 112 }, { slot: 3, x: 1250, y: 710 }];
	try {
		world.update(state, { muzzles, exhaust: undefined }); scene.updateMatrixWorld(true);
		expect(scene.getObjectByName('laser')?.visible).toBe(false);
		expect(scene.getObjectByName('laser-2')?.visible).toBe(false);
		for (const endpoint of state.beams) {
			const beam = scene.getObjectByName(`laser-${endpoint.slot}`); const muzzle = muzzles[endpoint.slot];
			if (!muzzle) throw new Error('Missing muzzle');
			expect(beam?.visible).toBe(true);
			const [origin, impact] = beamEnds(beam);
			expect(origin.distanceTo(muzzle)).toBeLessThan(1e-6);
			expect(impact.distanceTo(new Vector3(endpoint.x, endpoint.elevation ?? 42, endpoint.y))).toBeLessThan(1e-6);
		}
		world.update(createState());
		for (const name of ['laser', 'laser-1', 'laser-2', 'laser-3']) expect(scene.getObjectByName(name)?.visible).toBe(false);
	} finally { world.dispose(); world.dispose(); }
	expect(scene.children).toHaveLength(0);
});
