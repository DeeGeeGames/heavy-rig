import { expect, test } from 'bun:test';
import { InstancedBufferGeometry, Mesh, Scene, Vector3 } from 'three';
import { createState } from '../src/simulation';
import { createWorldObjects } from '../src/world-3d';

const smokeIn = function (scene: Scene) {
	const smoke = scene.getObjectByName('projectile-smoke');
	if (!(smoke instanceof Mesh) || !(smoke.geometry instanceof InstancedBufferGeometry)) throw new Error('Missing instanced smoke');
	return { root: smoke, geometry: smoke.geometry };
};

test('missile and rocket smoke survives projectile removal, freezes on pause, and fully expires after one second', function () {
	for (const kind of ['missile', 'rocket'] as const) {
		const scene = new Scene(); const world = createWorldObjects(scene); const state = createState();
		state.time = 2;
		state.shots.push({ x: 800, y: 700, vx: 300, vy: 0, life: 2, kind, target: undefined, damage: 1 });
		try {
			world.update(state);
			const smoke = smokeIn(scene);
			expect(smoke.geometry.instanceCount).toBe(1);
			const projectile = scene.getObjectByName('projectile');
			expect(projectile?.children[0]?.visible).toBe(false);
			state.shots = []; state.time = 2.5; world.update(state);
			expect(scene.getObjectByName('projectile')).toBeUndefined();
			expect(smoke.root.visible).toBe(true);
			expect(smoke.geometry.getAttribute('smokeAgeSeed').getX(0)).toBe(0.5);
			const center = new Vector3().fromBufferAttribute(smoke.geometry.getAttribute('smokeCenter'), 0);
			for (let i = 0; i < 3; i++) world.update(state);
			expect(smoke.geometry.instanceCount).toBe(1);
			expect(smoke.geometry.getAttribute('smokeAgeSeed').getX(0)).toBe(0.5);
			expect(new Vector3().fromBufferAttribute(smoke.geometry.getAttribute('smokeCenter'), 0).equals(center)).toBe(true);
			state.time = 2.999; world.update(state); expect(smoke.root.visible).toBe(true);
			state.time = 3; world.update(state);
			expect(smoke.geometry.instanceCount).toBe(0); expect(smoke.root.visible).toBe(false);
		} finally { world.dispose(); }
	}
});

test('smoke records the flown path through turns, keeps old streaks fixed, and interpolates emission times', function () {
	const scene = new Scene(); const world = createWorldObjects(scene); const state = createState();
	const shot = { x: 800, y: 700, vx: 160, vy: 0, life: 2, kind: 'missile' as const, target: undefined, damage: 1 };
	state.shots.push(shot);
	try {
		world.update(state);
		shot.x += 40; state.time = 0.25; world.update(state);
		shot.vx = 0; shot.vy = 160; shot.y += 40; state.time = 0.5;
		state.player.x += 200; state.player.turret = Math.PI;
		world.update(state);
		const smoke = smokeIn(scene); const centers = smoke.geometry.getAttribute('smokeCenter');
		expect(smoke.geometry.instanceCount).toBe(21);
		expect(new Vector3().fromBufferAttribute(centers, 0).toArray()).toEqual([800, 42, 700]);
		expect(new Vector3().fromBufferAttribute(centers, 10).toArray()).toEqual([840, 42, 700]);
		expect(new Vector3().fromBufferAttribute(centers, 20).toArray()).toEqual([840, 42, 740]);
		expect(smoke.geometry.getAttribute('smokeAgeSeed').getX(10)).toBeCloseTo(0.25, 6);
		expect(smoke.geometry.getAttribute('smokeAgeSeed').getX(20)).toBe(0);
		state.shots = []; state.time = 1; world.update(state);
		expect(smoke.geometry.instanceCount).toBe(20);
		state.time = 1.5; world.update(state); expect(smoke.geometry.instanceCount).toBe(0);
	} finally { world.dispose(); }
});

test('restarting at the same time or rewinding clears smoke and unrelated weapons emit none', function () {
	const scene = new Scene(); const world = createWorldObjects(scene); const state = createState();
	state.shots.push({ x: 800, y: 700, vx: 300, vy: 0, life: 2, kind: 'rocket', target: undefined, damage: 1 });
	try {
		world.update(state); const smoke = smokeIn(scene); expect(smoke.geometry.instanceCount).toBe(1);
		world.update(createState()); expect(smoke.geometry.instanceCount).toBe(0);
		state.time = 2; world.update(state); expect(smoke.geometry.instanceCount).toBe(1);
		state.time = 1; state.shots = []; world.update(state); expect(smoke.geometry.instanceCount).toBe(0);
		for (const kind of ['bullet', 'cannon', 'ppc', 'enemy'] as const) {
			state.shots.push({ x: 800, y: 700, vx: 300, vy: 0, life: 2, kind, target: undefined, damage: 1 });
		}
		world.update(state); expect(smoke.geometry.instanceCount).toBe(0);
	} finally { world.dispose(); }
});
