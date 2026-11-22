import { createHash } from 'node:crypto';
import { expect, spyOn, test } from 'bun:test';
import { Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getWeapon } from '../src/arsenal';
import { authoredMuzzleError, loadPlayableMechFamily, playableMechUrl } from '../src/authored-mech';
import { createGait } from '../src/gait';
import { getHardpoints } from '../src/hardpoints';
import { createMech } from '../src/mech-3d';
import { getMechAssetBinding } from '../src/mech-asset-registry';
import { getPlayerWeaponRig } from '../src/weapon-rig';
import type { FrameId } from '../src/frames';

const chassisMeshes = function (node: Object3D) {
	return node.children.flatMap(function collect(part): Mesh[] {
		if (part.name.startsWith('rig_mount_')) return [];
		return part instanceof Mesh ? [part] : part.children.flatMap(collect);
	});
};

test('playable B/C cartridges fit their approved body and use their physical firing exits', async function () {
	const load = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function (this: GLTFLoader, url: string) {
		const path = new URL(url.replace('./assets/', '../public/assets/'), import.meta.url);
		const asset = await this.parseAsync(await Bun.file(path).arrayBuffer(), '');
		if (path.pathname.endsWith('/variants.glb')) {
			const base = await Bun.file(new URL('pixel.glb', path)).arrayBuffer();
			expect(asset.scene.userData['baseSha256']).toBe(createHash('sha256').update(new Uint8Array(base)).digest('hex'));
		}
		return asset;
	});
	try {
		for (const chassis of ['warden', 'kestrel', 'maul'] as const) {
			const factories = await loadPlayableMechFamily(chassis, playableMechUrl(chassis));
			const remove = factories.map(function (factory) { return factory.install(); });
			const frames: FrameId[] = [chassis, `${chassis}-b`, `${chassis}-c`];
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
						return mount.family === 'launcher' ? Math.max(...mount.weapons.map(function (id) { return getWeapon(id).projectiles; })) : 0;
					}));
					const context = binding.advancePose(undefined, body, 0);
					const heading = -0.6;
					model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: 0, authoredPose: context });
					expect(authoredMuzzleError(model, rig, gait, heading, undefined, context, frame)).toBeLessThan(1e-7);
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
