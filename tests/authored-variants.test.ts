import { expect, spyOn, test } from 'bun:test';
import { FileLoader, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { createMount, getWeapon, type FireInputs } from '../src/arsenal';
import { authoredMuzzleError, loadPlayableMechFamily, playableMechUrl } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { canEquipWeapon, getHardpoints } from '../src/hardpoints';
import { createMech } from '../src/mech-3d';
import { getMechAssetBinding } from '../src/mech-asset-registry';
import { getPlayerWeaponRig } from '../src/weapon-rig';
import { CHASSIS_IDS, PLAYABLE_FRAMES } from '../src/frames';
import { createState, weaponsStep, type Unit } from '../src/simulation';

const chassisMeshes = function (node: Object3D) {
	return node.children.flatMap(function collect(part): Mesh[] {
		if (part.name.startsWith('rig_mount_') || part.name.startsWith('fitting_')) return [];
		return part instanceof Mesh ? [part] : part.children.flatMap(collect);
	});
};

test('playable B/C cartridges fit their approved body and use their physical firing exits', async function () {
	const load = spyOn(FileLoader.prototype, 'loadAsync').mockImplementation(async function (url: string) {
		return Bun.file(new URL(url.replace('./assets/', '../public/assets/'), import.meta.url)).arrayBuffer();
	});
	try {
		for (const chassis of CHASSIS_IDS) {
			const factories = await loadPlayableMechFamily(chassis, playableMechUrl(chassis));
			const remove = factories.map(function (factory) { return factory.install(); });
			const frames = PLAYABLE_FRAMES.filter(function (frame) { return frame.chassisId === chassis; }).map(function (frame) { return frame.id; });
			const models = frames.map(function (frame) { return createMech(undefined, false, frame); });
			try {
				expect(factories).toHaveLength(frames.length);
				const base = models[0];
				if (!base) throw new Error('Missing base');
				for (const [index, frame] of frames.entries()) {
					const model = models[index];
					const binding = getMechAssetBinding(frame);
					if (!model || !binding?.advancePose) throw new Error(`Missing authored model for ${frame}`);
					const body = { x: 170, y: 290, angle: 0.45 };
					const gait = createGait(body);
					const rig = getPlayerWeaponRig(frame);
					expect(rig.map(function (slot) { return slot.tubes.length; })).toEqual(getHardpoints(frame).map(function (mount) {
						if (frame === 'morrow') return 4; // Six-round refits cycle the four physical apertures.
						if (frame === 'harrow-b' && mount.id === 'dorsal-artillery') return 3;
						return mount.family === 'launcher' ? Math.max(...mount.weapons.map(function (id) { return getWeapon(id).projectiles; })) : 0;
					}));
					const context = binding.advancePose(undefined, body, 0);
					const heading = -0.6;
					model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: 0, authoredPose: context });
					expect(authoredMuzzleError(model, rig, gait, heading, undefined, context, frame)).toBeLessThan(1e-7);
					model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: 0, authoredPose: context, equippedSlots: [] });
					const fitted: string[] = [];
					model.root.traverseVisible(function (part) {
						if (part.name.startsWith('rig_mount_') && part.children.length) fitted.push(part.name);
					});
					expect(fitted).toEqual([]);
					const shared = chassisMeshes(base.root);
					expect(shared.length).toBeGreaterThan(6);
					expect(chassisMeshes(model.root)).toHaveLength(shared.length);
					for (const [part, mesh] of chassisMeshes(model.root).entries()) {
						const reference = shared[part];
						if (!reference) throw new Error(`Missing reference chassis mesh ${part}`);
						expect(mesh.geometry).toBe(reference.geometry);
						expect(mesh.matrixWorld.toArray()).toEqual(reference.matrixWorld.toArray());
					}
				}
			} finally {
				for (const model of models) model.dispose();
				for (const uninstall of remove) uninstall();
				for (const factory of factories) factory.dispose();
			}
		}
	} finally { load.mockRestore(); }
});

test('every playable authored ARC socket holds its pivot and moves the physical muzzle with the retargeting beam', async function () {
	const load = spyOn(FileLoader.prototype, 'loadAsync').mockImplementation(async function (url: string) {
		return Bun.file(new URL(url.replace('./assets/', '../public/assets/'), import.meta.url)).arrayBuffer();
	});
	try {
		for (const chassis of CHASSIS_IDS) {
			const factories = await loadPlayableMechFamily(chassis, playableMechUrl(chassis));
			const remove = factories.map(function (factory) { return factory.install(); });
			try {
				for (const { frame } of factories) for (const slot of getHardpoints(frame).keys()) {
					if (!canEquipWeapon(frame, slot, 'laser')) continue;
					const state = createState({ frame, starter: 'laser' });
					state.loadout = [{ ...createMount('laser'), slot }];
					const body = state.player;
					body.angle = body.turret = -.67;
					const gait = createGait(body);
					const tank: Unit = { id: 1, kind: 'tank', x: body.x + Math.cos(body.turret) * 210, y: body.y + Math.sin(body.turret) * 210, hp: 500, maxHp: 500, angle: 0, cooldown: 999, heavy: true };
					const air: Unit = { ...tank, id: 2, kind: 'vtol', x: body.x + Math.cos(body.turret) * 310, y: body.y + Math.sin(body.turret) * 310 };
					state.enemies = [tank, air];
					const context = getMechAssetBinding(frame)?.advancePose?.(undefined, body, 0);
					if (!context) throw new Error(`Missing ${frame} authored pose`);
					state.authoredPose = context;
					const model = createMech(undefined, false, frame);
					model.root.position.set(body.x, 0, body.y);
					const fire: FireInputs = [slot === 0, slot === 1, slot === 2, slot === 3];
					try {
						const gimbal = model.root.getObjectByName(`laser-gimbal-${slot}`);
						if (!gimbal) throw new Error(`Missing ${frame}/${slot} gimbal`);
						const poses = [];
						for (const [tick, target] of [tank, air, ...Array<Unit>(28).fill(air)].entries()) {
							weaponsStep(state, { drive: 0, turn: 0, stop: false, aim: target, targetId: target.id, fire, coolant: false }, 1 / 60);
							const beam = state.beams[0]; if (!beam?.aim || !beam.origin) throw new Error(`Missing ${frame}/${slot} beam`);
							model.pose(gait, body.turret, { recoil: 0, hit: 0, heat: 0, time: tick / 60, authoredPose: context, mountDirections: new Map([[slot, beam.aim.direction]]) });
							const origin = new Vector3(beam.origin.x - body.x, beam.origin.elevation, beam.origin.y - body.y);
							expect(model.muzzles[slot]?.distanceTo(origin)).toBeLessThan(1e-6);
							poses.push({ pivot: gimbal.getWorldPosition(new Vector3()), rotation: gimbal.quaternion.clone() });
							if (tick === 1) expect(air.hp).toBe(500);
						}
						const first = poses[0], next = poses[1], last = poses.at(-1);
						if (!first || !next || !last) throw new Error('Missing retarget poses');
						expect(first.pivot.distanceTo(last.pivot)).toBeLessThan(1e-6);
						expect(first.rotation.angleTo(next.rotation)).toBeGreaterThan(0.001);
						expect(first.rotation.angleTo(next.rotation)).toBeLessThan(first.rotation.angleTo(last.rotation));
						expect(tank.hp).toBeLessThan(500);
						expect(air.hp).toBeLessThan(500);
						if (frame === 'maul-c' && slot === 1) {
							// The close centerline requires more inboard traverse than
							// this gauntlet has before its ray crosses the chassis.
							for (const enemy of [tank, air]) {
								state.beams = [];
								enemy.x = body.x + Math.cos(body.turret) * 45;
								enemy.y = body.y + Math.sin(body.turret) * 45;
								state.enemies = [enemy];
								weaponsStep(state, { drive: 0, turn: 0, stop: false, aim: enemy, targetId: enemy.id, fire, coolant: false }, 1 / 60);
								const beam = state.beams[0]; if (!beam?.aim || !beam.origin) throw new Error('Missing point-blank beam');
								const direction = beam.aim.direction;
								model.pose(gait, body.turret, { recoil: 0, hit: 0, heat: 0, time: 1, authoredPose: context, mountDirections: new Map([[slot, direction]]) });
								const axis = new Vector3(direction.x, direction.elevation, direction.y);
								const origin = new Vector3(beam.origin.x, beam.origin.elevation, beam.origin.y).addScaledVector(axis, 0.04);
								const hits = new Raycaster(origin, axis, 0, 80).intersectObject(model.root);
								expect(hits.filter(function ({ object }) {
									for (let node: Object3D | null = object; node; node = node.parent) if (node === gimbal) return false;
									return true;
								})).toHaveLength(0);
							}
						}
					} finally { model.dispose(); }
				}
			} finally {
				for (const uninstall of remove) uninstall();
				for (const factory of factories) factory.dispose();
			}
		}
	} finally { load.mockRestore(); }
});

test('a stale cartridge package leaves the base playable and both alternate fittings on their fallbacks', async function () {
	const load = spyOn(FileLoader.prototype, 'loadAsync').mockImplementation(async function (url: string) {
		const bytes = await Bun.file(new URL(url.replace('./assets/', '../public/assets/'), import.meta.url)).arrayBuffer();
		if (url.endsWith('pixel.glb')) {
			// A valid GLB with a different generator stamp stands in for a stale cached revision.
			const data = Buffer.from(bytes);
			const stamp = data.indexOf('Heavy Rig plate workshop');
			if (stamp < 0) throw new Error('Missing generator stamp');
			data[stamp] = 'h'.charCodeAt(0);
		}
		return bytes;
	});
	const warn = spyOn(console, 'warn').mockImplementation(function () {});
	try {
		const factories = await loadPlayableMechFamily('bastion', playableMechUrl('bastion'));
		try {
			expect(factories.map(function (factory) { return factory.frame; })).toEqual(['bastion']);
			expect(warn).toHaveBeenCalledWith('bastion cartridges belong to another chassis revision.');
		} finally { for (const factory of factories) factory.dispose(); }
	} finally { warn.mockRestore(); load.mockRestore(); }
});
