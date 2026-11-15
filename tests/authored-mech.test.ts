import { expect, test } from 'bun:test';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, QuaternionKeyframeTrack, Vector3 } from 'three';
import { authoredMuzzleError, prepareAuthoredWarden, WARDEN_LOGICAL_TUBE_MAPPING } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { getFiringDirection, getPlayerWeaponRig, rigMuzzle, weaponDirection, type WeaponRig } from '../src/weapon-rig';

const fixture = function () {
	const scene = new Group();
	const pelvis = new Group(); pelvis.name = 'rig_pelvis'; pelvis.position.set(0.07, 0, -0.08); scene.add(pelvis);
	const torso = new Group(); torso.name = 'rig_torso'; torso.position.y = 0.5; pelvis.add(torso);
	const geometry = new BoxGeometry(0.4, 1, 0.3); const material = new MeshStandardMaterial();
	const mesh = new Mesh(geometry, material); mesh.position.y = 0.5; pelvis.add(mesh);
	for (const [side, x] of [['left', 0.35], ['right', -0.35]] as const) {
		for (const kind of ['gun', 'launcher'] as const) {
			const part = new Group(); part.name = kind === 'gun' ? `rig_mount_${side}-gun` : `rig_mount_${side}-shoulder bank`;
			part.position.set(x, kind === 'gun' ? 0.1 : 0.35, 0); torso.add(part);
			const muzzle = new Group(); muzzle.name = kind === 'gun' ? `physical_exit_${side}_gun_1` : `muzzle_${side}_launcher`; muzzle.position.set(0.02, 0.03, 0.3); part.add(muzzle);
			if (kind === 'launcher') for (const row of ['lower', 'upper'] as const) for (const column of [1, 2, 3, 4]) {
				const exit = new Group(); exit.name = `physical_exit_${side}_launcher_${row}_${column}`;
				exit.position.set((column - 2.5) * 0.04, row === 'lower' ? 0 : 0.06, 0.3); part.add(exit);
			}
		}
	}
	const animations = ['walk', 'run', 'backward'].map(function (name) { return new AnimationClip(name, 1, [new QuaternionKeyframeTrack('rig_pelvis.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]); });
	return { scene, animations, geometry, material };
};

test('non-collinear authored hinges keep physical muzzle and six selected exits aligned through aim', function () {
	const rig: WeaponRig = { pivot: { x: 10, y: 2, elevation: 8 }, muzzle: { x: 30, y: 5, elevation: 11 }, tubes: [{ x: 1, y: -2, elevation: 4 }] };
	expect(rigMuzzle(rig, { x: 100, y: 200 }, 0)).toEqual({ x: 130, y: 205, elevation: 11 });
	expect(rigMuzzle(rig, { x: 100, y: 200 }, 0, 0)).toEqual({ x: 131, y: 203, elevation: 15 });
	for (const target of [{ x: 400, y: 350, elevation: 80 }, { x: 450, y: 100, elevation: 0 }]) {
		const axis = weaponDirection(rig, { x: 100, y: 200 }, 0, target);
		const exit = rigMuzzle(rig, { x: 100, y: 200 }, 0, undefined, target);
		const shot = getFiringDirection(exit, 0, target);
		expect(Math.hypot(axis.x - shot.x, axis.y - shot.y, axis.elevation - shot.elevation)).toBeLessThan(1e-10);
	}
	const close = weaponDirection(rig, { x: 100, y: 200 }, 0, { x: 110, y: 202, elevation: 8 });
	expect([close.x, close.y, close.elevation].every(Number.isFinite)).toBe(true);
	const behind = weaponDirection({ pivot: { x: 0, y: 0, elevation: 0 }, muzzle: { x: 45, y: -8, elevation: 0 }, tubes: [] }, { x: 0, y: 0 }, 0, { x: -10, y: 100, elevation: 0 });
	expect(behind.x).toBeGreaterThan(0);
	const asset = fixture(); const factory = prepareAuthoredWarden(asset); const model = factory.create();
	model.pose(createGait({ x: 0, y: 0, angle: 0 }), 0);
	const torso = model.root.getObjectByName('rig_torso'); if (!torso) throw new Error('Missing authored torso');
	const center = torso.getWorldPosition(new Vector3()); expect(Math.hypot(center.x, center.z)).toBeLessThan(1e-7);
	const body = { x: 500, y: 400, angle: -0.6 }; const gait = createGait(body);
	try {
		for (const heading of [-Math.PI, -0.7, 0, 0.7, Math.PI]) for (const target of [undefined, { x: 900, y: 700, elevation: 147 }, { x: 650, y: 450, elevation: 10 }]) {
			model.root.position.set(body.x, 0, body.y);
			model.pose(gait, heading, { recoil: 0.8, hit: 0, heat: 45, time: 0, ...(target ? { target } : {}) });
			expect(authoredMuzzleError(model, factory.weaponRigs, gait, heading, target)).toBeLessThan(1e-7);
		}
		expect(model.rocketMuzzles.map(function (exits) { return exits.length; })).toEqual([0, 0, 6, 6]);
		expect(new Set(WARDEN_LOGICAL_TUBE_MAPPING).size).toBe(6);
	} finally { model.dispose(); factory.dispose(); asset.geometry.dispose(); asset.material.dispose(); }
});

test('authored instances own materials while caller-owned shared assets and defaults survive removal', function () {
	const originalRigs = getPlayerWeaponRig('warden'); const asset = fixture();
	let geometryDisposals = 0; let sourceMaterialDisposals = 0;
	asset.geometry.addEventListener('dispose', function () { geometryDisposals += 1; });
	asset.material.addEventListener('dispose', function () { sourceMaterialDisposals += 1; });
	const factory = prepareAuthoredWarden(asset); const first = factory.create(); const second = factory.create();
	const remove = factory.install();
	try {
		expect(getPlayerWeaponRig('warden')).toBe(factory.weaponRigs);
		const installed = createMech(); expect(installed.root.name).toBe('authored-warden-frame'); installed.dispose();
		expect(function () { factory.install(); }).toThrow('already installed');
		factory.dispose(); first.dispose(); first.dispose();
		expect(getPlayerWeaponRig('warden')).toBe(factory.weaponRigs);
		const gait = createGait({ x: 0, y: 0, angle: 0 }); second.pose(gait, 0);
		expect(second.muzzles.every(function (position) { return Number.isFinite(position.length()); })).toBe(true);
		expect(function () { factory.create(); }).toThrow('disposed');
	} finally {
		remove(); remove(); first.dispose(); second.dispose(); factory.dispose();
	}
	expect(getPlayerWeaponRig('warden')).toBe(originalRigs);
	expect(geometryDisposals).toBe(0); expect(sourceMaterialDisposals).toBe(0);
	const procedural = createMech(); expect(procedural.root.name).toBe('warden-frame'); procedural.dispose();
	asset.geometry.dispose(); asset.material.dispose();
	expect(geometryDisposals).toBe(1); expect(sourceMaterialDisposals).toBe(1);
});
