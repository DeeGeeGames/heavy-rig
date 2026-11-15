import ECSpresso from 'ecspresso';
import { createCombatRuntime } from '../src/combat-runtime';
import { createMount } from '../src/arsenal';
import { createState, step, type Controls } from '../src/simulation';
import type { AuthoredPoseContext } from '../src/authored-pose';
import { expect, test } from 'bun:test';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, QuaternionKeyframeTrack, VectorKeyframeTrack, Vector3, Matrix4 } from 'three';
import { authoredMuzzleError, prepareAuthoredWarden, WARDEN_LOGICAL_TUBE_MAPPING } from '../src/authored-mech';
import { advanceGait, createGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { getFiringDirection, getPlayerFiringDirection, getPlayerMuzzle, getPlayerWeaponRig, rigMuzzle, weaponDirection, type WeaponRig } from '../src/weapon-rig';

const fixture = function (connections = false) {
	const scene = new Group();
	const pelvis = new Group(); pelvis.name = 'rig_pelvis'; pelvis.position.set(0.07, 0, -0.08); scene.add(pelvis);
	const torso = new Group(); torso.name = 'rig_torso'; torso.position.y = 0.5; pelvis.add(torso);
	const geometry = new BoxGeometry(0.4, 1, 0.3); const material = new MeshStandardMaterial();
	const geometries = [geometry];
	const mesh = new Mesh(geometry, material); mesh.position.y = 0.5; pelvis.add(mesh);
	for (const [side, x] of [['left', 0.35], ['right', -0.35]] as const) {
		for (const kind of ['gun', 'launcher'] as const) {
			const part = new Group(); part.name = kind === 'gun' ? `rig_mount_${side}-gun` : `rig_mount_${side}-shoulder bank`;
			part.position.set(x, kind === 'gun' ? 0.1 : 0.35, 0); torso.add(part);
			const muzzle = new Group(); muzzle.name = kind === 'gun' ? `physical_exit_${side}_gun_1` : `muzzle_${side}_launcher`; muzzle.position.set(0.02, 0.03, 0.3); part.add(muzzle);
			if (connections) {
				const id = `${side}_${kind === 'gun' ? 'gun' : 'shoulder'}`; const sign = Math.sign(x);
				const bodyAnchor = new Group(); bodyAnchor.name = `connection_${id}_torso`; bodyAnchor.position.set(sign * 0.18, part.position.y, 0.02); torso.add(bodyAnchor);
				const mountAnchor = new Group(); mountAnchor.name = `connection_${id}_mount`; mountAnchor.position.set(-sign * 0.04, 0, 0.015); part.add(mountAnchor);
				const housing = new BoxGeometry(0.12, 0.12, 0.12); geometries.push(housing); part.add(new Mesh(housing, material));
				const end = part.position.clone().add(mountAnchor.position); const direction = end.sub(bodyAnchor.position); const length = direction.length();
				const control = new Group(); control.name = `static_${id}`; control.position.copy(bodyAnchor.position); control.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()); torso.add(control);
				// Non-identity child TRS represents a quantized mesh's decode transform.
				const bridgeGeometry = new BoxGeometry(2, 2, 2); geometries.push(bridgeGeometry);
				const bridge = new Mesh(bridgeGeometry, material); bridge.name = `static_decode_${id}_mesh`; bridge.position.y = length / 2; bridge.scale.set(0.024, length / 2 + 0.006, 0.024); control.add(bridge);
			}
			if (kind === 'launcher') for (const row of ['lower', 'upper'] as const) for (const column of [1, 2, 3, 4]) {
				const exit = new Group(); exit.name = `physical_exit_${side}_launcher_${row}_${column}`;
				exit.position.set((column - 2.5) * 0.04, row === 'lower' ? 0 : 0.06, 0.3); part.add(exit);
			}
		}
	}
	const animations = ['walk', 'run', 'backward'].map(function (name) { return new AnimationClip(name, 1, connections ? [
		new VectorKeyframeTrack('rig_pelvis.position', [0, 0.5, 1], [0.07, 0, -0.08, 0.09, 0.03, -0.10, 0.07, 0, -0.08]),
		new QuaternionKeyframeTrack('rig_torso.quaternion', [0, 0.5, 1], [0, 0, 0, 1, Math.sin(0.07), 0, 0, Math.cos(0.07), 0, 0, 0, 1]),
	] : [new QuaternionKeyframeTrack('rig_pelvis.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]); });
	return { scene, animations, geometry, geometries, material };
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
	const asset = fixture(); const factory = prepareAuthoredWarden(asset); const remove = factory.install(); const model = factory.create();
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
	} finally { model.dispose(); remove(); factory.dispose(); asset.geometry.dispose(); asset.material.dispose(); }
});

test('rigid mounts inherit animated torso motion and simulation muzzle sampling never depends on rendering', function () {
	const asset = fixture(true); const factory = prepareAuthoredWarden(asset); const remove = factory.install();
	let body = { x: 500, y: 400, angle: 0 }; let gait = createGait(body);
	let context: AuthoredPoseContext = factory.advancePose(undefined, body, 0);
	const before = getPlayerMuzzle('warden', 0, body, 0, undefined, undefined, context);
	const model = factory.create();
	expect(getPlayerFiringDirection('warden', 0, body, 0, before, { x: body.x - 100, y: body.y + 100, elevation: 220 }).x).toBeGreaterThan(0);
	const torso = model.root.getObjectByName('rig_torso'); if (!torso) throw new Error('Missing animated torso');
	const fixed = torso.children.filter(function (node) { return node.name.startsWith('rig_mount_') || node.name.startsWith('static_'); });
	const matrices = fixed.map(function (node) { node.updateMatrix(); return node.matrix.clone(); });
	const decode = model.root.getObjectsByProperty('type', 'Mesh').filter(function (node) { return node.name.startsWith('static_decode_'); });
	const decodeMatrices = decode.map(function (node) { node.updateMatrix(); return node.matrix.toArray(); });
	let lowest = Infinity; let highest = -Infinity; let maximumTilt = 0;
	try {
		// Rendering arbitrary unrelated poses cannot publish an authoritative cache.
		model.pose(createGait({ x: -900, y: 73, angle: 2 }), -1, { recoil: 0, hit: 0, heat: 0, time: 50, target: { x: 0, y: 0, elevation: 220 } });
		expect(getPlayerMuzzle('warden', 0, body, 0, undefined, undefined, context)).toEqual(before);
		for (let tick = 1; tick <= 180; tick++) {
			const speed = tick < 40 ? 40 : tick < 90 ? 90 : tick < 140 ? -28 : 0; const angle = tick * 0.004;
			body = { x: body.x + Math.cos(angle) * speed / 60, y: body.y + Math.sin(angle) * speed / 60, angle };
			context = factory.advancePose(context, body, tick / 60); gait = advanceGait(gait, body, 1 / 60);
			const heading = angle + Math.sin(tick / 13);
			const target = { x: body.x + Math.cos(heading) * 125, y: body.y + Math.sin(heading) * 125, elevation: tick % 2 ? 220 : 0 };
			model.root.position.set(body.x, 0, body.y); model.root.rotation.y = 0.23; model.root.scale.setScalar(1.3);
			model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: tick / 60, target, authoredPose: context });
			expect(authoredMuzzleError(model, factory.weaponRigs, gait, heading, target, context)).toBeLessThan(1e-6);
			const inverse = torso.matrixWorld.clone().invert();
			for (const [index, node] of fixed.entries()) {
				const expected = matrices[index]; if (!expected) throw new Error('Missing fixed matrix');
				const relative = new Matrix4().multiplyMatrices(inverse, node.matrixWorld);
				expect(Math.max(...relative.elements.map(function (value, element) { return Math.abs(value - (expected.elements[element] ?? Infinity)); }))).toBeLessThan(1e-12);
			}
			const at = torso.getWorldPosition(new Vector3()); lowest = Math.min(lowest, at.y); highest = Math.max(highest, at.y);
			maximumTilt = Math.max(maximumTilt, 1 - new Vector3(0, 1, 0).transformDirection(torso.matrixWorld).y);
		}
		expect(highest - lowest).toBeGreaterThan(1); expect(maximumTilt).toBeGreaterThan(0.001);
		expect(decode.map(function (node) { node.updateMatrix(); return node.matrix.toArray(); })).toEqual(decodeMatrices);
		const last = getPlayerMuzzle('warden', 2, body, 1, 5, undefined, context);
		model.dispose(); expect(getPlayerMuzzle('warden', 2, body, 1, 5, undefined, context)).toEqual(last);
	} finally { model.dispose(); remove(); factory.dispose(); for (const geometry of asset.geometries) geometry.dispose(); asset.material.dispose(); }
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


test('fixed-step authored pose survives pause and matches plain simulation before same-tick firing', async function () {
	const asset = fixture(true); const factory = prepareAuthoredWarden(asset); const remove = factory.install();
	const initial = createState(); initial.spawnIn = 3600; initial.loadout = [createMount('autocannon')];
	const expected = structuredClone(initial); const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	await world.initialize(); const state = combat.attach(initial); combat.setEnabled(true);
	let emissionChecks = 0;
	try {
		for (let tick = 0; tick < 120; tick++) {
			const controls: Controls = { drive: tick < 50 ? 1 : -1, turn: 0.2, stop: false, aim: { x: 1500, y: 300 }, fire: [tick > 10, false, false, false], coolant: false };
			combat.setControls(function () { return controls; }); step(expected, controls, 1 / 60); world.update(1 / 60);
			expect(state.authoredPose).toEqual(expected.authoredPose);
			expect(state.shots).toEqual(expected.shots);
			for (const shot of state.shots.filter(function (shot) { return shot.slot === 0 && (shot.age ?? 0) <= 1 / 60 + 1e-9; })) {
				const origin = getPlayerMuzzle('warden', 0, state.player, state.player.turret, undefined, undefined, state.authoredPose);
				expect(shot.origin).toEqual(origin); emissionChecks++;
			}
		}
		expect(emissionChecks).toBeGreaterThan(0);
		expect(state.authoredPose?.clips.some(function (clip) { return clip.time > 0 && clip.weight > 0; })).toBe(true);
		const snapshot = structuredClone(state.authoredPose); combat.setEnabled(false);
		for (let tick = 0; tick < 10; tick++) world.update(1 / 60);
		expect(state.authoredPose).toEqual(snapshot);
		const replacement = combat.attach(createState()); expect(replacement.authoredPose).toBeUndefined();
	} finally { await world.dispose(); remove(); factory.dispose(); for (const geometry of asset.geometries) geometry.dispose(); asset.material.dispose(); }
});
