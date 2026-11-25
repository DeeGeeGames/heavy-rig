import { Box3, Color, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Texture, Vector2, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { installMechAssetBinding, type MechAssetModel } from './mech-asset-registry';
import type { WalkerGait } from './gait';
import type { MechFeedback } from './mech-3d';
import { createLegPoseSampling } from './leg-pose-sampling';
import { getPlayerMuzzle, type SpatialPoint, type WeaponBody, type WeaponRig } from './weapon-rig';
import { advanceAuthoredPose, authoredClipNames, prepareAuthoredTorsoSampler, type AuthoredMotion, type AuthoredPoseContext } from './authored-pose';
import { snapMechHeading } from './torso-arc';
import { prepareAuthoredLocomotion, type AuthoredLocomotionOptions } from './authored-gait';
import { KESTREL_RUN_PROFILE } from './authored-run';
import type { FrameId } from './frames';
import type { MechFinish } from './mech-skin';
import { paintColorForZone } from './mech-paint';
import { applySolidPlatePaint, authoredPaintZone } from './authored-paint';
import { applyMechSkinMaterial, type SkinSurface } from './mech-skin-material';
import { getHardpoints } from './hardpoints';
import { getWeapon } from './arsenal';

export const MAUL_LOGICAL_TUBE_MAPPING = ['1_0', '2_0', '1_1', '2_1', '1_3', '2_3'] as const;
export const WARDEN_LOGICAL_TUBE_MAPPING = ['lower_1', 'lower_2', 'lower_4', 'upper_1', 'upper_3', 'upper_4'] as const;

export const playableMechUrl = function (frame: AuthoredChassis, part: 'pixel' | 'variants' = 'pixel'): string {
	return globalThis.document?.getElementById(`${frame}-${part}-glb`)?.textContent || `./assets/mechs/${frame}/${part}.glb`;
};
export const previewAssetOverride = function () {
	return new URLSearchParams(location.search).get('asset') ?? document.documentElement.dataset['authoredAsset'];
};
const previewMechUrl = function (frame: AuthoredChassis): string {
	return previewAssetOverride() ?? playableMechUrl(frame);
};
export const authoredWardenUrl = function (): string {
	return previewMechUrl('warden');
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
const maulWeaponSpecs = [
	{ group: 'rig_mount_left-pod', muzzle: 'muzzle_left-forearm pod', side: 'left', launcher: true },
	{ group: 'rig_mount_right-pod', muzzle: 'muzzle_right-forearm pod', side: 'right', launcher: true },
	{ group: 'rig_mount_left-inboard', muzzle: 'muzzle_left-inboard', side: 'left', launcher: false },
	{ group: 'rig_mount_right-inboard', muzzle: 'muzzle_right-inboard', side: 'right', launcher: false },
] as const;
export type AuthoredChassis = 'warden' | 'kestrel' | 'maul';
interface AuthoredWeaponSpec {
	readonly group: string;
	readonly muzzle: string;
	readonly side: 'left' | 'right';
	readonly launcher: boolean;
	readonly exits?: readonly string[];
}
interface AuthoredDescriptor {
	readonly chassis: AuthoredChassis;
	readonly height: number;
	readonly weapons: readonly AuthoredWeaponSpec[];
	readonly locomotion?: AuthoredLocomotionOptions;
	readonly tubeMapping?: readonly string[];
	readonly launcherExitPrefix?: string;
}
const wardenDescriptor: AuthoredDescriptor = { chassis: 'warden', height: 101.75, weapons: wardenWeaponSpecs };
const kestrelDescriptor: AuthoredDescriptor = {
	// Existing procedural Kestrel, posed neutrally on its own rig: floor0, roof74.82.
	chassis: 'kestrel', height: 74.82, weapons: kestrelWeaponSpecs,
	// Short support and a longer recovery produce visible bounds. Torso rise shares
	// the flight phase; measured pivots and soles still own planted contacts.
	locomotion: { walkStride: 0.6, walkExtension: 0.2, run: KESTREL_RUN_PROFILE },
};
export const authoredKestrelUrl = function (): string {
	return previewMechUrl('kestrel');
};
const maulDescriptor: AuthoredDescriptor = {
	// Procedural Maul posed on FRAME_RIGS.maul at its own scale: floor 0.
	chassis: 'maul', height: 153.65404829172167, weapons: maulWeaponSpecs,
	tubeMapping: MAUL_LOGICAL_TUBE_MAPPING, launcherExitPrefix: '',
	// The source has a short upper leg, broad shoes and heavy forearm pods.
	// Keep strides and foot pitch conservative; measured IK uses its own pivots.
	locomotion: { walkStride: 0.65, walkExtension: 0.18, walkLiftScale: 0.55, stableKneeBend: true, run: { cycleSeconds: 1.15, stanceFraction: 0.36, referenceSpeed: 65, enterSpeed: 42, exitSpeed: 34, swingLift: 8, bodyLift: 2.4, bodyRoll: 0, bodyPitch: 0, footPitch: 0.1, landingLead: 0.8 } },
};
export const authoredMaulUrl = function (): string {
	return previewMechUrl('maul');
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
const isPixelPlateMaterial = function (material: Material): boolean {
	return material instanceof MeshStandardMaterial && material.vertexColors && material.name.endsWith(' plate colors');
};

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
const prepareAuthored = function (descriptor: AuthoredDescriptor, asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions, release?: () => void, variant?: { frame: FrameId; baseBounds: Box3 }) {
	if (asset.scene.parent) throw new Error('Authored source must be an unparented neutral scene');
	const frame = variant?.frame ?? descriptor.chassis;
	const sourceBounds = variant?.baseBounds ?? new Box3().setFromObject(asset.scene);
	const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
	const height = options.height ?? descriptor.height;
	const weaponSpecs = descriptor.weapons;
	const tubeMapping = descriptor.tubeMapping ?? WARDEN_LOGICAL_TUBE_MAPPING;
	const launcherExits = function (spec: AuthoredDescriptor['weapons'][number]): readonly string[] {
		return spec.exits ?? (spec.launcher ? tubeMapping.map(function (suffix) { return `physical_exit_${spec.side}_${descriptor.launcherExitPrefix ?? 'launcher_'}${suffix}`; }) : []);
	};
	if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 || !Number.isFinite(height) || height <= 0) throw new Error('Invalid authored asset height');
	let hasPixelPlates = false;
	asset.scene.traverse(function (node) {
		if (node instanceof SkinnedMesh) throw new Error(`${descriptor.chassis} asset contract requires rigid groups`);
		if (!hasPixelPlates && node instanceof Mesh) hasPixelPlates = materialsOf(node).some(isPixelPlateMaterial);
	});
	const scale = height / sourceHeight;
	const sourceCenter = named(asset.scene, 'rig_torso').getWorldPosition(new Vector3());
	const origin = Object.freeze({ x: sourceCenter.x, z: sourceCenter.z });
	const motions: AuthoredMotion[] = authoredClipNames.map(function (name) {
		const clip = asset.animations.find(function (candidate) { return candidate.name === name; });
		if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error(`Missing authored ${name} animation`);
		const metadata: unknown = clip.userData['nativeUnitsPerSecond'] ?? clip.userData['nominalForwardSpeed'];
		const validMetadata = typeof metadata === 'number' && Number.isFinite(metadata) && metadata !== 0;
		if (descriptor.chassis !== 'warden' && !validMetadata) throw new Error(`Missing ${descriptor.chassis} ${name} nominal speed metadata`);
		const nominal = validMetadata ? Math.abs(metadata) : name === 'walk' ? 0.32 / 0.9 : name === 'run' ? 0.64 / 0.9 : 0.2666666667;
		return { name, clip, nominalSpeed: nominal * scale };
	});
	const makeGraph = function () {
		const root = new Group(); root.name = `authored-${frame}-frame`;
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
		const tubes = launcherExits(spec).map(function (name) {
			const exit = named(probe.scene, name).getWorldPosition(new Vector3()).sub(muzzle);
			if (!finitePoint(exit)) throw new Error(`Invalid authored launcher exit ${name}`);
			return point(exit);
		});
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
		return { muzzle: named(probe.scene, spec.muzzle).getWorldPosition(new Vector3()).applyMatrix4(inverseTorso), tubes: launcherExits(spec).map(function (name) { return named(probe.scene, name).getWorldPosition(new Vector3()).applyMatrix4(inverseTorso); }) };
	});
	const nativeBasis = new Matrix4().compose(new Vector3(-origin.z * scale, -sourceBounds.min.y * scale, origin.x * scale), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(scale, scale, scale));
	const sampler = prepareAuthoredTorsoSampler(named(asset.scene, 'rig_torso'), motions, nativeBasis);
	// The pixel Kestrel's reshaped shoes need a slightly shorter stance to clear
	// the ground together for a full bound at light-load speed.
	const profile = descriptor.locomotion;
	const gaitOptions = hasPixelPlates && descriptor.chassis === 'kestrel' && profile
		? { ...profile, run: { ...profile.run, stanceFraction: 0.25 } } : profile;
	const locomotion = prepareAuthoredLocomotion(named(probe.scene, 'rig_pelvis'), (['left', 'right'] as const).map(function (side, index) {
		return { index: index === 0 ? 0 : 1, thigh: named(probe.scene, `rig_leg_${side}_thigh`), shin: named(probe.scene, `rig_leg_${side}_shin`), foot: named(probe.scene, `rig_leg_${side}_foot`) };
	}), scale, gaitOptions);
	const standingPelvisDrop = descriptor.chassis === 'warden'
		? locomotion.pelvisDrop(locomotion.advance(undefined, { x: 0, y: 0, angle: 0 }, 0), sampler.pelvisMatrix(), 0)
		: undefined;
	const advancePose = function (previous: AuthoredPoseContext | undefined, body: WeaponBody, time: number): AuthoredPoseContext {
		const valid = previous && time >= previous.time ? previous : undefined;
		const dt = valid ? Math.min(time - valid.time, 0.1) : 0;
		if (valid?.gait && dt === 0 && valid.body.x === body.x && valid.body.y === body.y && valid.body.angle === (body.angle ?? 0)) return valid;
		const advanced = locomotion.advance(valid?.gait, body, dt);
		// Maul's weight transfer translates the body; its torso keeps a vertical
		// up axis while independent aiming continues to rotate it around that axis.
		const gait = descriptor.chassis === 'maul' ? { ...advanced, motion: { ...advanced.motion, pitch: 0, roll: 0 } } : advanced;
		const context = { ...advanceAuthoredPose(motions, valid, body, time), gait };
		// Maul needs the displayed hip positions to keep its short legs bent over a planted shoe.
		const supportHeading = descriptor.chassis === 'maul' ? snapMechHeading(gait.body.angle) : gait.body.angle;
		return { ...context, pelvisDrop: locomotion.pelvisDrop(gait, sampler.pelvisMatrix(context), supportHeading), ...(standingPelvisDrop === undefined ? {} : { standingPelvisDrop }) };
	};
	const muzzle = function (body: WeaponBody, heading: number, slot: number, tubeIndex: number | undefined, context: AuthoredPoseContext | undefined): SpatialPoint {
		const exit = exits[slot]; if (!exit) throw new RangeError(`Missing authored muzzle ${slot}`);
		const local = tubeIndex === undefined || exit.tubes.length === 0 ? exit.muzzle : exit.tubes[((tubeIndex % exit.tubes.length) + exit.tubes.length) % exit.tubes.length];
		if (!local) throw new RangeError(`Missing authored tube ${slot}/${tubeIndex}`);
		const hullAngle = snapMechHeading(context?.gait?.body.angle ?? body.angle ?? heading);
		const result = point(local.clone().applyMatrix4(sampler.matrix(context, hullAngle, snapMechHeading(heading))));
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
	const create = function (skin: MechFinish = 'original'): MechAssetModel {
		if (closed) throw new Error(`Authored ${descriptor.chassis} factory is disposed`);
		if (installation?.closing) throw new Error(`Authored ${descriptor.chassis} installation is closing; dispose existing models first`);
		const { root, hull, scene } = makeGraph();
		root.userData['mechSkin'] = typeof skin === 'string' ? skin : 'solid';
		const emptyShoulders = descriptor.chassis === 'warden' && frame !== 'warden' && typeof skin === 'object' && skin.layout === 'caps' ? new Vector2() : undefined;
		const ownedMaterials = new Map<string, Material>();
		const cloneMaterial = function (source: Material, node: Mesh) {
			const key = skin === 'original' ? source.uuid : `${source.uuid}:${node.uuid}`;
			const previous = ownedMaterials.get(key); if (previous) return previous;
			const material = source.clone(); ownedMaterials.set(key, material);
			if (skin === 'original' || !(material instanceof MeshStandardMaterial) || source.name === 'Warden vent recess') return material;
			const nativeScale = node.getWorldScale(new Vector3()).divideScalar(scale);
			if (hasPixelPlates) {
				if (isPixelPlateMaterial(material)) {
					if (typeof skin === 'string') applyMechSkinMaterial(material, skin, { surface: 'pixel-plates', scale: nativeScale });
					else applySolidPlatePaint(material, node, descriptor.chassis, skin, emptyShoulders);
				}
				return material;
			}
			const secondary = ['_shin', '_foot', '_mount_'].some(function (part) { return node.name.includes(part); });
			const surface: SkinSurface = descriptor.chassis !== 'warden' ? secondary ? 'palette-secondary' : 'palette-primary'
				: source.name === 'Warden shared pod atlas' ? 'pod'
					: node.name.includes('mount_connections') || node.name.includes('_pelvis') ? 'mechanism'
						: node.name.includes('-gun') ? 'gun' : secondary ? 'secondary' : 'primary';
			const positions = node.geometry.getAttribute('position');
			let min = Infinity; let max = -Infinity;
			if (surface === 'gun') for (let index = 0; index < positions.count; index++) { const z = positions.getZ(index); min = Math.min(min, z); max = Math.max(max, z); }
			const { zone, side } = authoredPaintZone(node);
			const coat = typeof skin === 'string' ? skin : new Color(paintColorForZone(skin, zone, side));
			applyMechSkinMaterial(material, coat, { surface, scale: nativeScale, ...(surface === 'gun' ? { barrelCutoff: -(max - (max - min) * 0.38) * nativeScale.z } : {}) });
			return material;
		};
		scene.traverse(function (node) {
			if (!(node instanceof Mesh)) return;
			node.material = Array.isArray(node.material) ? node.material.map(function (material) { return cloneMaterial(material, node); }) : cloneMaterial(node.material, node);
			node.castShadow = true; node.receiveShadow = true;
		});
		const torso = named(scene, 'rig_torso');
		const upperBody = sampler.sample(undefined).map(function (transform, index) { return { name: transform.name, node: index === 0 ? scene : named(scene, transform.name) }; });
		const weapons = weaponSpecs.map(function (spec) {
			const mount = named(scene, spec.group);
			const muzzle = named(scene, spec.muzzle);
			const exits = launcherExits(spec).map(function (name) { return named(scene, name); });
			return { mount, muzzle, exits };
		});
		const muzzles = weapons.map(function () { return new Vector3(); });
		const rocketMuzzles = weapons.map(function (weapon) { return weapon.exits.map(function () { return new Vector3(); }); });
		const legs = (['left', 'right'] as const).map(function (side) { return { thigh: named(scene, `rig_leg_${side}_thigh`), shin: named(scene, `rig_leg_${side}_shin`), foot: named(scene, `rig_leg_${side}_foot`) }; });
		const sampleLegPose = createLegPoseSampling(legs.flatMap(function (leg) { return [leg.thigh, leg.shin, leg.foot]; }));
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
			const hullAngle = snapMechHeading(planted.body.angle);
			hull.rotation.y = -hullAngle;
			torso.quaternion.premultiply(yaw.setFromAxisAngle(y, hullAngle - snapMechHeading(heading)));
			for (const solved of locomotion.solve(feedback?.legGait ?? planted, sampler.pelvisMatrix(context), hullAngle)) {
				const leg = legs[solved.index]; if (!leg) throw new Error('Missing authored leg');
				leg.thigh.quaternion.copy(solved.thigh); leg.shin.quaternion.copy(solved.shin); leg.foot.quaternion.copy(solved.foot);
			}
			sampleLegPose(feedback?.legGait);
			// Empty authored equipment slots hide only the interchangeable assembly.
			// Mount brackets remain torso-owned, and simulation retains slot anchors.
			if (frame !== 'warden') for (const [slot, weapon] of weapons.entries()) weapon.mount.visible = feedback?.equippedSlots === undefined || feedback.equippedSlots.includes(slot);
			// B/C remove the entire shoulder cartridge. Carry its cap color on
			// the fixed cheek on each side whose cartridge is currently absent.
			emptyShoulders?.set(weapons[2]?.mount.visible === false ? 1 : 0, weapons[3]?.mount.visible === false ? 1 : 0);
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
	const launcher = weaponSpecs.find(function (spec) { return spec.launcher; });
	return {
		frame, create, weaponRigs, advancePose, muzzle, tubeMapping: launcher ? launcher.exits ?? tubeMapping : [], height, nativeHorizontalOrigin: origin,
		install: function () {
			if (closed) throw new Error(`Authored ${descriptor.chassis} factory is disposed`);
			const remove = installMechAssetBinding(frame, { create, weaponRigs, advancePose, muzzle });
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

export const prepareAuthoredMaul = function (asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions = {}) {
	return prepareAuthored(maulDescriptor, asset, options);
};
export const loadAuthoredMaul = async function (url: string, options: AuthoredOptions = {}) {
	const asset = await new GLTFLoader().loadAsync(url);
	try { return prepareAuthored(maulDescriptor, asset, options, function () { disposeAsset(asset); }); }
	catch (error: unknown) { disposeAsset(asset); throw error; }
};

const playableDescriptors = { warden: wardenDescriptor, kestrel: kestrelDescriptor, maul: maulDescriptor };

const loadPlayableAsset = async function (label: string, url: string): Promise<GLTF | undefined> {
	let expired = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const loading = new GLTFLoader().loadAsync(url).then(function (asset) {
		if (expired) { disposeAsset(asset); return undefined; }
		return asset;
	}).catch(function (error: unknown) {
		console.warn(`${label} asset unavailable.`, error);
		return undefined;
	});
	const fallback = new Promise<undefined>(function (resolve) {
		deadline = setTimeout(function () {
			expired = true;
			console.warn(`${label} loading timed out.`);
			resolve(undefined);
		}, 5000);
	});
	try { return await Promise.race([loading, fallback]); }
	finally { if (deadline !== undefined) clearTimeout(deadline); }
};

const assemblePlayableVariant = function (descriptor: AuthoredDescriptor, frame: FrameId, base: GLTF, modules: GLTF) {
	const scene = base.scene.clone(true);
	const weapons = getHardpoints(frame).map(function (hardpoint, slot): AuthoredWeaponSpec {
		const spec = descriptor.weapons[slot];
		const baseHardpoint = getHardpoints(descriptor.chassis)[slot];
		if (!spec || !baseHardpoint) throw new Error(`Missing ${frame} socket ${slot}`);
		if (hardpoint.family === baseHardpoint.family) return spec;

		const name = `variant_${slot}_${hardpoint.family}`;
		const module = named(modules.scene, name);
		if (module.userData['mount'] !== spec.group) throw new Error(`Wrong socket for ${frame} module ${name}`);
		const socket = named(scene, spec.group);
		for (const child of [...socket.children]) if (!child.name.startsWith('connection_')) socket.remove(child);
		socket.add(...module.clone(true).children);
		const launcher = hardpoint.family === 'launcher';
		const count = launcher ? Math.max(...hardpoint.weapons.map(function (id) { return getWeapon(id).projectiles; })) : 0;
		return { ...spec, launcher, muzzle: `${name}_muzzle`, exits: Array.from({ length: count }, function (_, index) { return `${name}_tube_${index}`; }) };
	});
	return { scene, animations: base.animations, descriptor: { ...descriptor, weapons } };
};

export const loadPlayableMechFamily = async function (chassis: AuthoredChassis, url: string,
	cartridges = url === playableMechUrl(chassis) ? playableMechUrl(chassis, 'variants') : null) {
	const [base, modules] = await Promise.all([
		loadPlayableAsset(chassis, url),
		cartridges ? loadPlayableAsset(`${chassis} B/C`, cartridges) : undefined,
	]);
	if (!base) {
		if (modules) disposeAsset(modules);
		return [];
	}
	// Source meshes are shared by the base and both variants. Keep them alive
	// until the last factory has closed and all of its instances are gone.
	let references = 1;
	const release = function () {
		references -= 1;
		if (references !== 0) return;
		disposeAsset(base);
		if (modules) disposeAsset(modules);
	};
	const factories: ReturnType<typeof prepareAuthored>[] = [];
	const descriptor = playableDescriptors[chassis];
	try {
		const baseBounds = new Box3().setFromObject(base.scene);
		factories.push(prepareAuthored(descriptor, base, {}, release));
		references += 1;
		if (modules) for (const suffix of ['b', 'c'] as const) {
			const frame: FrameId = `${chassis}-${suffix}`;
			try {
				const variant = assemblePlayableVariant(descriptor, frame, base, modules);
				factories.push(prepareAuthored(variant.descriptor, variant, {}, release, { frame, baseBounds }));
				references += 1;
			} catch (error: unknown) {
				console.warn(`${frame} asset invalid.`, error);
			}
		}
	} catch (error: unknown) {
		console.warn(`${chassis} asset invalid.`, error);
	} finally { release(); }
	return factories;
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
