import { Box3, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Texture, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { installMechAssetBinding, type MechAssetModel } from './mech-asset-registry';
import type { WalkerGait } from './gait';
import type { MechFeedback } from './mech-3d';
import { getPlayerMuzzle, type SpatialPoint, type WeaponBody, type WeaponRig } from './weapon-rig';
import { advanceAuthoredPose, authoredClipNames, prepareAuthoredTorsoSampler, type AuthoredMotion, type AuthoredPoseContext } from './authored-pose';
import { prepareAuthoredLocomotion, type AuthoredLocomotionOptions } from './authored-gait';
import type { FrameId } from './frames';

export const WARDEN_LOGICAL_TUBE_MAPPING = ['lower_1', 'lower_2', 'lower_4', 'upper_1', 'upper_3', 'upper_4'] as const;

export const authoredWardenUrl = function (): string {
	return new URLSearchParams(location.search).get('asset') ?? document.documentElement.dataset['authoredAsset'] ?? './assets/mechs/warden/game-ready.glb';
};
const wardenWeaponSpecs = [
	{ group: 'rig_mount_left-gun', muzzle: 'physical_exit_left_gun_1', side: 'left', launcher: false },
	{ group: 'rig_mount_right-gun', muzzle: 'physical_exit_right_gun_1', side: 'right', launcher: false },
	{ group: 'rig_mount_left-shoulder bank', muzzle: 'muzzle_left_launcher', side: 'left', launcher: true },
	{ group: 'rig_mount_right-shoulder bank', muzzle: 'muzzle_right_launcher', side: 'right', launcher: true },
] as const;
const kestrelWeaponSpecs = [
	{ group: 'rig_mount_left-gun', muzzle: 'muzzle_left-gun', side: 'left', launcher: false },
	{ group: 'rig_mount_right-gun', muzzle: 'muzzle_right-gun', side: 'right', launcher: false },
] as const;
interface AuthoredDescriptor {
	readonly frame: 'warden' | 'kestrel';
	readonly height: number;
	readonly weapons: readonly { readonly group: string; readonly muzzle: string; readonly side: 'left' | 'right'; readonly launcher: boolean }[];
	readonly locomotion?: AuthoredLocomotionOptions;
}
const wardenDescriptor: AuthoredDescriptor = { frame: 'warden', height: 101.75, weapons: wardenWeaponSpecs };
const kestrelDescriptor: AuthoredDescriptor = {
	// Existing procedural Kestrel, posed neutrally on its own rig: floor0, roof74.82.
	frame: 'kestrel', height: 74.82, weapons: kestrelWeaponSpecs,
	// Kestrel's approved source cycle has a shorter stride and longer support
	// fraction. The measured solver retains its own asymmetric pivots and soles.
	locomotion: { walkStride: 0.45, walkExtension: 0.15, run: { cycleSeconds: 0.8, stanceFraction: 0.44, referenceSpeed: 30, enterSpeed: 25, exitSpeed: 20.5, swingLift: 5.6, bodyLift: 0.67, bodyRoll: 0.025, bodyPitch: 0.052, footPitch: 0.157 } },
};
export const authoredKestrelUrl = function (): string {
	return new URLSearchParams(location.search).get('asset') ?? document.documentElement.dataset['authoredAsset'] ?? './assets/mechs/kestrel/game-ready.glb';
};
interface AuthoredOptions { readonly height?: number; readonly diagnostics?: boolean }

const named = function (root: Object3D, name: string): Object3D {
	const found: Object3D[] = [];
	root.traverse(function (node) { if (node.name === name || node.userData['name'] === name) found.push(node); });
	const node = found[0];
	if (!node || found.length !== 1) throw new Error(`Expected one authored node ${name}; found ${found.length}`);
	return node;
};
const point = function (value: Vector3): SpatialPoint { return { x: value.x, y: value.z, elevation: value.y }; };
const finitePoint = function (value: Vector3) { return [value.x, value.y, value.z].every(Number.isFinite); };
const materialsOf = function (node: Mesh): Material[] { return Array.isArray(node.material) ? node.material : [node.material]; };

const disposeAsset = function (asset: Pick<GLTF, 'scene'>) {
	const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); const textures = new Set<Texture>();
	const images = new Set<ImageBitmap>();
	asset.scene.traverse(function (node) {
		if (!(node instanceof Mesh)) return;
		geometries.add(node.geometry);
		for (const material of materialsOf(node)) {
			materials.add(material);
			for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
		}
	});
	for (const texture of textures) {
		const source: unknown = texture.source.data;
		if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) images.add(source);
		texture.dispose();
	}
	for (const image of images) image.close();
	for (const material of materials) material.dispose();
	for (const geometry of geometries) geometry.dispose();
};

// The source stays caller-owned. Instances share immutable geometry/textures and
// own their cloned materials, pose state and transforms.
const prepareAuthored = function (descriptor: AuthoredDescriptor, asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions, release?: () => void) {
	if (asset.scene.parent) throw new Error('Authored source must be an unparented neutral scene');
	const sourceBounds = new Box3().setFromObject(asset.scene);
	const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
	const height = options.height ?? descriptor.height;
	const weaponSpecs = descriptor.weapons;
	if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 || !Number.isFinite(height) || height <= 0) throw new Error('Invalid authored asset height');
	asset.scene.traverse(function (node) { if (node instanceof SkinnedMesh) throw new Error(`${descriptor.frame} asset contract requires rigid groups`); });
	const scale = height / sourceHeight;
	const sourceCenter = named(asset.scene, 'rig_torso').getWorldPosition(new Vector3());
	const origin = Object.freeze({ x: sourceCenter.x, z: sourceCenter.z });
	const motions: AuthoredMotion[] = authoredClipNames.map(function (name) {
		const clip = asset.animations.find(function (candidate) { return candidate.name === name; });
		if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error(`Missing authored ${name} animation`);
		const metadata: unknown = clip.userData['nativeUnitsPerSecond'] ?? clip.userData['nominalForwardSpeed'];
		const validMetadata = typeof metadata === 'number' && Number.isFinite(metadata) && metadata !== 0;
		if (descriptor.frame === 'kestrel' && !validMetadata) throw new Error(`Missing Kestrel ${name} nominal speed metadata`);
		const nominal = validMetadata ? Math.abs(metadata) : name === 'walk' ? 0.32 / 0.9 : name === 'run' ? 0.64 / 0.9 : 0.2666666667;
		return { name, clip, nominalSpeed: nominal * scale };
	});
	const makeGraph = function () {
		const root = new Group(); root.name = `authored-${descriptor.frame}-frame`;
		const hull = new Group(); hull.name = 'authored-hull-heading'; root.add(hull);
		const basis = new Group(); basis.name = 'authored-native-basis'; basis.rotation.y = Math.PI / 2; basis.scale.setScalar(scale); basis.position.set(-origin.z * scale, -sourceBounds.min.y * scale, origin.x * scale); hull.add(basis);
		const scene = asset.scene.clone(true); basis.add(scene); root.updateMatrixWorld(true);
		return { root, hull, scene };
	};
	const probe = makeGraph();
	const weaponRigs: readonly WeaponRig[] = weaponSpecs.map(function (spec) {
		const pivot = named(probe.scene, spec.group).getWorldPosition(new Vector3());
		const muzzle = named(probe.scene, spec.muzzle).getWorldPosition(new Vector3());
		if (!finitePoint(pivot) || !finitePoint(muzzle) || muzzle.x <= pivot.x) throw new Error(`Invalid authored weapon orientation ${spec.group}`);
		const tubes = spec.launcher ? WARDEN_LOGICAL_TUBE_MAPPING.map(function (suffix) {
			const exit = named(probe.scene, `physical_exit_${spec.side}_launcher_${suffix}`).getWorldPosition(new Vector3()).sub(muzzle);
			if (!finitePoint(exit)) throw new Error(`Invalid authored launcher exit ${suffix}`);
			return point(exit);
		}) : [];
		return { pivot: point(pivot), muzzle: point(muzzle), tubes };
	});
	const neutralTorso = named(probe.scene, 'rig_torso');
	for (const spec of weaponSpecs) {
		const mount = named(probe.scene, spec.group);
		if (mount.parent !== neutralTorso) throw new Error(`Authored mount must be fixed directly to torso: ${spec.group}`);
		if (motions.some(function (motion) { return motion.clip.tracks.some(function (track) { return track.name.startsWith(`${mount.name}.`) || track.name.startsWith(`${spec.group}.`); }); })) throw new Error(`Authored mount cannot have independent animation: ${spec.group}`);
	}
	const inverseTorso = neutralTorso.matrixWorld.clone().invert();
	const exits = weaponSpecs.map(function (spec) {
		return { muzzle: named(probe.scene, spec.muzzle).getWorldPosition(new Vector3()).applyMatrix4(inverseTorso), tubes: spec.launcher ? WARDEN_LOGICAL_TUBE_MAPPING.map(function (suffix) { return named(probe.scene, `physical_exit_${spec.side}_launcher_${suffix}`).getWorldPosition(new Vector3()).applyMatrix4(inverseTorso); }) : [] };
	});
	const nativeBasis = new Matrix4().compose(new Vector3(-origin.z * scale, -sourceBounds.min.y * scale, origin.x * scale), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(scale, scale, scale));
	const sampler = prepareAuthoredTorsoSampler(named(asset.scene, 'rig_torso'), motions, nativeBasis);
	const locomotion = prepareAuthoredLocomotion(named(probe.scene, 'rig_pelvis'), (['left', 'right'] as const).map(function (side, index) {
		return { index: index === 0 ? 0 : 1, thigh: named(probe.scene, `rig_leg_${side}_thigh`), shin: named(probe.scene, `rig_leg_${side}_shin`), foot: named(probe.scene, `rig_leg_${side}_foot`) };
	}), scale, descriptor.locomotion);
	const advancePose = function (previous: AuthoredPoseContext | undefined, body: WeaponBody, time: number): AuthoredPoseContext {
		const valid = previous && time >= previous.time ? previous : undefined;
		const dt = valid ? Math.min(time - valid.time, 0.1) : 0;
		if (valid?.gait && dt === 0 && valid.body.x === body.x && valid.body.y === body.y && valid.body.angle === (body.angle ?? 0)) return valid;
		const context = { ...advanceAuthoredPose(motions, valid, body, time), gait: locomotion.advance(valid?.gait, body, dt) };
		return { ...context, pelvisDrop: locomotion.pelvisDrop(context.gait, sampler.pelvisMatrix(context)) };
	};
	const muzzle = function (body: WeaponBody, heading: number, slot: number, tubeIndex: number | undefined, context: AuthoredPoseContext | undefined): SpatialPoint {
		const exit = exits[slot]; if (!exit) throw new RangeError(`Missing authored muzzle ${slot}`);
		const local = tubeIndex === undefined || exit.tubes.length === 0 ? exit.muzzle : exit.tubes[((tubeIndex % exit.tubes.length) + exit.tubes.length) % exit.tubes.length];
		if (!local) throw new RangeError(`Missing authored tube ${slot}/${tubeIndex}`);
		const result = point(local.clone().applyMatrix4(sampler.matrix(context, body.angle ?? heading, heading)));
		return { x: result.x + body.x, y: result.y + body.y, elevation: result.elevation };
	};
	probe.root.clear();
	let instances = 0;
	let closed = false;
	let releaseSource = release;
	let installation: { remove: () => void; closing: boolean } | undefined;
	const releaseIfUnused = function () {
		if (instances !== 0) return;
		if (installation?.closing) { installation.remove(); installation = undefined; }
		if (closed) { releaseSource?.(); releaseSource = undefined; }
	};
	const create = function (): MechAssetModel {
		if (closed) throw new Error(`Authored ${descriptor.frame} factory is disposed`);
		if (installation?.closing) throw new Error(`Authored ${descriptor.frame} installation is closing; dispose existing models first`);
		const { root, hull, scene } = makeGraph();
		const ownedMaterials = new Map<Material, Material>();
		const cloneMaterial = function (source: Material) {
			const previous = ownedMaterials.get(source); if (previous) return previous;
			const material = source.clone(); ownedMaterials.set(source, material); return material;
		};
		scene.traverse(function (node) {
			if (!(node instanceof Mesh)) return;
			node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
			node.castShadow = true; node.receiveShadow = true;
		});
		const torso = named(scene, 'rig_torso');
		const upperBody = sampler.sample(undefined).map(function (transform, index) { return { name: transform.name, node: index === 0 ? scene : named(scene, transform.name) }; });
		const weapons = weaponSpecs.map(function (spec) {
			const mount = named(scene, spec.group);
			const muzzle = named(scene, spec.muzzle);
			const exits = spec.launcher ? WARDEN_LOGICAL_TUBE_MAPPING.map(function (suffix) { return named(scene, `physical_exit_${spec.side}_launcher_${suffix}`); }) : [];
			return { mount, muzzle, exits };
		});
		const muzzles = weapons.map(function () { return new Vector3(); });
		const rocketMuzzles = weapons.map(function (weapon) { return weapon.exits.map(function () { return new Vector3(); }); });
		const legs = (['left', 'right'] as const).map(function (side) { return { thigh: named(scene, `rig_leg_${side}_thigh`), shin: named(scene, `rig_leg_${side}_shin`), foot: named(scene, `rig_leg_${side}_foot`) }; });
		const y = new Vector3(0, 1, 0); const yaw = new Quaternion(); const inverse = new Matrix4();
		const position = new Vector3(); const labelVertex = new Vector3(); const relative = new Matrix4();
		const bounds: { part: Mesh; corners: Vector3[] }[] = [];
		scene.traverse(function (node) {
			if (!(node instanceof Mesh)) return;
			node.geometry.computeBoundingBox(); const box: Box3 | null = node.geometry.boundingBox; if (!box) return;
			bounds.push({ part: node, corners: [box.min.x, box.max.x].flatMap(function (x) { return [box.min.y, box.max.y].flatMap(function (y) { return [box.min.z, box.max.z].map(function (z) { return new Vector3(x, y, z); }); }); }) });
		});
		const neutralMaterials = [...ownedMaterials.values()].flatMap(function (material) {
			return material instanceof MeshStandardMaterial ? [{ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity }] : [];
		});
		let previous: AuthoredPoseContext | undefined;
		let disposed = false; let labelHeight = height;
		instances += 1;
		const pose = function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			if (disposed) return;
			const context = feedback?.authoredPose ?? advancePose(previous, gait.body, feedback?.time ?? previous?.time ?? 0);
			for (const transform of sampler.sample(context)) {
				const target = upperBody.find(function (entry) { return entry.name === transform.name; })?.node;
				if (!target) throw new Error(`Missing authored upper-body node ${transform.name}`);
				target.position.copy(transform.position); target.quaternion.copy(transform.quaternion); target.scale.copy(transform.scale);
			}
			const planted = context.gait;
			if (!planted) throw new Error('Missing fixed-step authored gait');
			hull.rotation.y = -planted.body.angle;
			torso.quaternion.premultiply(yaw.setFromAxisAngle(y, planted.body.angle - heading));
			for (const solved of locomotion.solve(planted, sampler.pelvisMatrix(context))) {
				const leg = legs[solved.index]; if (!leg) throw new Error('Missing authored leg');
				leg.thigh.quaternion.copy(solved.thigh); leg.shin.quaternion.copy(solved.shin); leg.foot.quaternion.copy(solved.foot);
			}
			// Empty Kestrel hardpoints hide only the interchangeable gun assembly.
			// Mount brackets remain torso-owned, and simulation retains slot anchors.
			if (descriptor.frame === 'kestrel') for (const [slot, weapon] of weapons.entries()) weapon.mount.visible = feedback?.equippedSlots === undefined || feedback.equippedSlots.includes(slot);
			// Weapons and structural necks retain their authored local transforms.
			root.updateMatrixWorld(true); inverse.copy(root.matrixWorld).invert();
			for (const [slot, weapon] of weapons.entries()) {
				muzzles[slot]?.copy(weapon.muzzle.getWorldPosition(position)).applyMatrix4(inverse);
				for (const [index, exit] of weapon.exits.entries()) rocketMuzzles[slot]?.[index]?.copy(exit.getWorldPosition(position)).applyMatrix4(inverse);
			}
			for (const entry of neutralMaterials) {
				entry.material.emissive.copy(entry.emissive);
				entry.material.emissiveIntensity = entry.intensity;
				if ((feedback?.hit ?? 0) > 0) { entry.material.emissive.set('#ffae73'); entry.material.emissiveIntensity = Math.max(entry.intensity, (feedback?.hit ?? 0) * 0.8); }
			}
			labelHeight = 0;
			for (const bound of bounds) {
				relative.multiplyMatrices(inverse, bound.part.matrixWorld);
				for (const corner of bound.corners) { labelVertex.copy(corner).applyMatrix4(relative); labelHeight = Math.max(labelHeight, labelVertex.y - (labelVertex.x + labelVertex.z) * 0.5); }
			}
			previous = context;
			if (options.diagnostics) root.userData['authoredMotion'] = context;
		};
		return {
			root, muzzles, rocketMuzzles,
			get exhaust() { return undefined; },
			get labelHeight() { return labelHeight; },
			pose,
			dispose: function () {
				if (disposed) return; disposed = true;
				for (const material of ownedMaterials.values()) material.dispose();
				root.removeFromParent(); root.clear(); instances -= 1; releaseIfUnused();
			},
		};
	};
	return {
		create, weaponRigs, advancePose, muzzle, tubeMapping: descriptor.frame === 'warden' ? WARDEN_LOGICAL_TUBE_MAPPING : [], height, nativeHorizontalOrigin: origin,
		install: function () {
			if (closed) throw new Error(`Authored ${descriptor.frame} factory is disposed`);
			const remove = installMechAssetBinding(descriptor.frame, { create, weaponRigs, advancePose, muzzle });
			installation = { remove, closing: false };
			return function () { if (installation?.remove === remove) installation.closing = true; releaseIfUnused(); };
		},
		dispose: function () { if (installation) installation.closing = true; closed = true; releaseIfUnused(); },
	};
};

export const prepareAuthoredWarden = function (asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions = {}) {
	return prepareAuthored(wardenDescriptor, asset, options);
};

// Preload before creating the game presentation. Factory creation stays synchronous.
export const loadAuthoredWarden = async function (url: string, options: AuthoredOptions = {}) {
	const asset = await new GLTFLoader().loadAsync(url);
	try {
		return prepareAuthored(wardenDescriptor, asset, options, function () { disposeAsset(asset); });
	} catch (error: unknown) {
		disposeAsset(asset);
		throw error;
	}
};

export const prepareAuthoredKestrel = function (asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions = {}) {
	return prepareAuthored(kestrelDescriptor, asset, options);
};
export const loadAuthoredKestrel = async function (url: string, options: AuthoredOptions = {}) {
	const asset = await new GLTFLoader().loadAsync(url);
	try { return prepareAuthored(kestrelDescriptor, asset, options, function () { disposeAsset(asset); }); }
	catch (error: unknown) { disposeAsset(asset); throw error; }
};

export const authoredMuzzleError = function (model: MechAssetModel, rigs: readonly WeaponRig[], gait: WalkerGait, heading: number, target?: SpatialPoint, context?: AuthoredPoseContext, frame: FrameId = 'warden'): number {
	return rigs.reduce(function (largest, rig, slot) {
		const actual = model.muzzles[slot]; if (!actual) throw new Error('Missing authored muzzle output');
		const expected = getPlayerMuzzle(frame, slot, gait.body, heading, undefined, target, context);
		let error = Math.max(largest, actual.distanceTo(new Vector3(expected.x - gait.body.x, expected.elevation, expected.y - gait.body.y)));
		for (const index of rig.tubes.keys()) {
			const exit = model.rocketMuzzles[slot]?.[index]; if (!exit) throw new Error('Missing authored tube output');
			const expectedExit = getPlayerMuzzle(frame, slot, gait.body, heading, index, target, context);
			error = Math.max(error, exit.distanceTo(new Vector3(expectedExit.x - gait.body.x, expectedExit.elevation, expectedExit.y - gait.body.y)));
		}
		return error;
	}, 0);
};
