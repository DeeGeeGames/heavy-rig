import { expect, spyOn, test } from 'bun:test';
import { FileLoader, Mesh, type Object3D } from 'three';
import { getWeapon } from '../src/arsenal';
import { authoredMuzzleError, loadPlayableMechFamily, playableMechUrl } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { getHardpoints } from '../src/hardpoints';
import { createMech } from '../src/mech-3d';
import { getMechAssetBinding } from '../src/mech-asset-registry';
import { getPlayerWeaponRig } from '../src/weapon-rig';
import { CHASSIS_IDS, PLAYABLE_FRAMES } from '../src/frames';

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
