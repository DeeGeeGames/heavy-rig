import { expect, test } from 'bun:test';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { createState, type Effect } from '../src/simulation';
import { createWeaponContactVfx } from '../src/weapon-contact-vfx';
import type { WeaponCue } from '../src/weapon-feedback';

test('late frames sample each round once, leave scuffs on the struck face, and clear them on a mission restart', function () {
	const visuals = createWeaponContactVfx(); const state = createState();
	const batch = function (name: string) {
		const object = visuals.root.getObjectByName(name);
		if (!(object instanceof InstancedMesh)) throw new Error(`Missing ${name}`);
		return object;
	};
	const direction = { x: 0, y: 1, elevation: 0 };
	const facilityImpact: WeaponCue = { type: 'impact', surface: 'concrete', family: 'cannon', heavy: false, direction,
		normal: { x: 0, y: -1, elevation: 0 }, shooter: 0, time: 2 };
	const impact: WeaponCue = { ...facilityImpact, scuff: true };
	const effect = function (feedback: WeaponCue, x: number): Effect { return { x, y: 200, elevation: 36, life: 0.75, size: 30, color: '#fff', feedback }; };
	const marks = batch('weapon-scuff'); const flashes = batch('weapon-flame'); const chips = batch('weapon-solid');
	const matrix = new Matrix4();
	try {
		state.time = 2.1;
		const fire: WeaponCue = { type: 'fire', slot: 0, family: 'cannon', heavy: false, direction, shooter: 0, time: 2 };
		state.effects.push(effect(impact, 120), effect({ ...impact }, 140), effect(facilityImpact, 160), effect(fire, 70));
		visuals.update(state);
		expect(flashes.count).toBe(0); // This frame first sees a round after its muzzle pulse ended.
		expect(chips.count).toBeGreaterThan(0); expect(marks.count).toBe(2);
		for (const [i, x] of [120, 140].entries()) {
			marks.getMatrixAt(i, matrix);
			expect(matrix.elements[12]).toBeCloseTo(x); expect(matrix.elements[13]).toBeCloseTo(36);
			expect(matrix.elements[14]).toBeCloseTo(200 - 0.32);
			expect(new Vector3(0, 0, 1).transformDirection(matrix).z).toBeCloseTo(-1);
		}
		chips.getMatrixAt(0, matrix); const paused = matrix.clone(); const count = chips.count;
		visuals.update(state); chips.getMatrixAt(0, matrix);
		expect(matrix.equals(paused)).toBe(true); expect(chips.count).toBe(count); expect(marks.count).toBe(2);
		state.effects = []; state.time = 3; visuals.update(state);
		expect(chips.count).toBe(0); expect(marks.count).toBe(2);
		const next = createState(); next.time = state.time; visuals.update(next); expect(marks.count).toBe(0);
	} finally { visuals.dispose(); }
});

test('only a ground-reaching splash round raises a pressure front at its own contact', function () {
	const visuals = createWeaponContactVfx(); const state = createState();
	const shot = function (x: number, elevation: number, heavy: boolean): Effect {
		return { x, y: 420, elevation, size: 80, life: 0.75, color: '#fff', feedback: {
			type: 'impact', family: 'missile', heavy, time: 0, shooter: 0, surface: 'armor', direction: { x: 1, y: 0, elevation: 0 },
		} };
	};
	try {
		state.effects.push(shot(100, 30, false), shot(200, 150, true), shot(300, 30, true));
		visuals.update(state);
		const wave = visuals.root.getObjectByName('weapon-wave');
		if (!(wave instanceof InstancedMesh)) throw new Error('Missing pressure front');
		expect(wave.count).toBe(1);
		const matrix = new Matrix4(); wave.getMatrixAt(0, matrix);
		expect(matrix.elements[12]).toBe(300); expect(matrix.elements[13]).toBeLessThan(1); expect(matrix.elements[14]).toBe(420);
	} finally { visuals.dispose(); }
});
