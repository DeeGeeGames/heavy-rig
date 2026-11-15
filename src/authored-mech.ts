import { AnimationMixer, Box3, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Texture, Vector3, type AnimationAction, type AnimationClip, type BufferGeometry } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { installMechAssetBinding, type MechAssetModel } from './mech-asset-registry';
import type { WalkerGait } from './gait';
import type { MechFeedback } from './mech-3d';
import { rigMuzzle, weaponDirection, weaponPivot, type SpatialPoint, type WeaponRig } from './weapon-rig';

export const WARDEN_LOGICAL_TUBE_MAPPING = ['lower_1', 'lower_2', 'lower_4', 'upper_1', 'upper_3', 'upper_4'] as const;

export const authoredWardenUrl = function (): string {
	return new URLSearchParams(location.search).get('asset') ?? document.documentElement.dataset['authoredAsset'] ?? './assets/mechs/warden/game-ready.glb';
};
const weaponSpecs = [
	{ group: 'rig_mount_left-gun', muzzle: 'physical_exit_left_gun_1', side: 'left', launcher: false },
	{ group: 'rig_mount_right-gun', muzzle: 'physical_exit_right_gun_1', side: 'right', launcher: false },
	{ group: 'rig_mount_left-shoulder bank', muzzle: 'muzzle_left_launcher', side: 'left', launcher: true },
	{ group: 'rig_mount_right-shoulder bank', muzzle: 'muzzle_right_launcher', side: 'right', launcher: true },
] as const;
const clipNames = ['walk', 'run', 'backward'] as const;
type MotionName = typeof clipNames[number];
interface AuthoredOptions { readonly height?: number; readonly diagnostics?: boolean }
interface Motion { readonly name: MotionName; readonly clip: AnimationClip; readonly nominalSpeed: number }

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
// own their cloned materials, mixer state and transforms.
const prepareWarden = function (asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions, release?: () => void) {
	if (asset.scene.parent) throw new Error('Authored source must be an unparented neutral scene');
	const sourceBounds = new Box3().setFromObject(asset.scene);
	const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
	const height = options.height ?? 101.75;
	if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 || !Number.isFinite(height) || height <= 0) throw new Error('Invalid authored asset height');
	asset.scene.traverse(function (node) { if (node instanceof SkinnedMesh) throw new Error('Warden asset contract requires rigid groups'); });
	const scale = height / sourceHeight;
	const sourceCenter = named(asset.scene, 'rig_torso').getWorldPosition(new Vector3());
	const origin = Object.freeze({ x: sourceCenter.x, z: sourceCenter.z });
	const motions: Motion[] = clipNames.map(function (name) {
		const clip = asset.animations.find(function (candidate) { return candidate.name === name; });
		if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error(`Missing authored ${name} animation`);
		const metadata: unknown = clip.userData['nativeUnitsPerSecond'];
		const nominal = typeof metadata === 'number' && Number.isFinite(metadata) && metadata > 0 ? metadata : name === 'walk' ? 0.32 / 0.9 : name === 'run' ? 0.64 / 0.9 : 0.2666666667;
		return { name, clip, nominalSpeed: nominal * scale };
	});
	const makeGraph = function () {
		const root = new Group(); root.name = 'authored-warden-frame';
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
		if (closed) throw new Error('Authored Warden factory is disposed');
		if (installation?.closing) throw new Error('Authored Warden installation is closing; dispose existing models first');
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
		const torsoRest = torso.quaternion.clone();
		const weapons = weaponSpecs.map(function (spec, slot) {
			const part = named(scene, spec.group); const rig = weaponRigs[slot];
			if (!rig) throw new Error('Missing authored weapon rig');
			const muzzle = named(scene, spec.muzzle);
			const exits = spec.launcher ? WARDEN_LOGICAL_TUBE_MAPPING.map(function (suffix) { return named(scene, `physical_exit_${spec.side}_launcher_${suffix}`); }) : [];
			return { part, rig, muzzle, exits, rest: part.quaternion.clone() };
		});
		const muzzles = weapons.map(function () { return new Vector3(); });
		const rocketMuzzles = weapons.map(function (weapon) { return weapon.exits.map(function () { return new Vector3(); }); });
		const mixer = new AnimationMixer(scene);
		const actions: { motion: Motion; action: AnimationAction; weight: number }[] = motions.map(function (motion) {
			const action = mixer.clipAction(motion.clip); action.setEffectiveWeight(0).play(); return { motion, action, weight: 0 };
		});
		const y = new Vector3(0, 1, 0); const yaw = new Quaternion(); const inverse = new Matrix4();
		const x = new Vector3(1, 0, 0); const pitch = new Quaternion();
		const parentQuaternion = new Quaternion(); const desiredQuaternion = new Quaternion(); const rootQuaternion = new Quaternion();
		const position = new Vector3(); const direction = new Vector3(); const labelVertex = new Vector3(); const relative = new Matrix4();
		const bounds: { part: Mesh; corners: Vector3[] }[] = [];
		scene.traverse(function (node) {
			if (!(node instanceof Mesh)) return;
			node.geometry.computeBoundingBox(); const box: Box3 | null = node.geometry.boundingBox; if (!box) return;
			bounds.push({ part: node, corners: [box.min.x, box.max.x].flatMap(function (x) { return [box.min.y, box.max.y].flatMap(function (y) { return [box.min.z, box.max.z].map(function (z) { return new Vector3(x, y, z); }); }); }) });
		});
		const neutralMaterials = [...ownedMaterials.values()].flatMap(function (material) {
			return material instanceof MeshStandardMaterial ? [{ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity }] : [];
		});
		let previous: { time: number; x: number; y: number; angle: number } | undefined;
		let disposed = false; let labelHeight = height;
		instances += 1;
		const pose = function (gait: WalkerGait, heading: number, feedback?: MechFeedback) {
			if (disposed) return;
			const time = feedback?.time ?? previous?.time ?? 0;
			if (previous && time < previous.time) for (const entry of actions) { entry.weight = 0; entry.action.reset().setEffectiveWeight(0).play(); }
			const dt = previous && time > previous.time ? Math.min(time - previous.time, 0.1) : 0;
			const dx = previous ? gait.body.x - previous.x : 0; const dz = previous ? gait.body.y - previous.y : 0;
			const signedSpeed = dt > 0 ? (dx * Math.cos(gait.body.angle) + dz * Math.sin(gait.body.angle)) / dt : 0;
			const turning = previous && dt > 0 ? Math.abs(Math.atan2(Math.sin(gait.body.angle - previous.angle), Math.cos(gait.body.angle - previous.angle))) / dt * 24 : 0;
			const speed = Math.max(Math.abs(signedSpeed), turning);
			const walk = motions.find(function (motion) { return motion.name === 'walk'; });
			const run = motions.find(function (motion) { return motion.name === 'run'; });
			if (!walk || !run) throw new Error('Missing authored motion timing');
			const selected = speed < 0.5 ? undefined : signedSpeed < -0.5 ? 'backward' : speed > (walk.nominalSpeed + run.nominalSpeed) / 2 ? 'run' : 'walk';
			for (const entry of actions) {
				const desiredWeight = entry.motion.name === selected ? 1 : 0;
				entry.weight += (desiredWeight - entry.weight) * (dt > 0 ? 1 - Math.exp(-dt * 18) : 0);
				if (Math.abs(entry.weight - desiredWeight) < 0.0001) entry.weight = desiredWeight;
				entry.action.setEffectiveWeight(entry.weight);
				entry.action.setEffectiveTimeScale(Math.max(0.25, Math.min(3, speed / entry.motion.nominalSpeed)));
			}
			torso.quaternion.copy(torsoRest);
			for (const weapon of weapons) weapon.part.quaternion.copy(weapon.rest);
			mixer.update(dt);
			hull.rotation.y = -gait.body.angle;
			torso.quaternion.premultiply(yaw.setFromAxisAngle(y, gait.body.angle - heading));
			root.updateMatrixWorld(true); root.getWorldQuaternion(rootQuaternion);
			for (const weapon of weapons) {
				const parent = weapon.part.parent; if (!parent) throw new Error('Detached authored weapon');
				const at = weaponPivot(weapon.rig, gait.body, heading);
				position.set(at.x - gait.body.x, at.elevation, at.y - gait.body.y).applyMatrix4(root.matrixWorld);
				weapon.part.position.copy(parent.worldToLocal(position));
				const targetDirection = weaponDirection(weapon.rig, gait.body, heading, feedback?.target);
				direction.set(targetDirection.x, targetDirection.elevation, targetDirection.y);
				desiredQuaternion.setFromAxisAngle(y, Math.atan2(direction.x, direction.z));
				desiredQuaternion.multiply(pitch.setFromAxisAngle(x, -Math.atan2(direction.y, Math.hypot(direction.x, direction.z))));
				desiredQuaternion.premultiply(rootQuaternion);
				weapon.part.quaternion.copy(parent.getWorldQuaternion(parentQuaternion).invert().multiply(desiredQuaternion));
				weapon.part.updateWorldMatrix(false, true);
			}
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
			previous = { time, x: gait.body.x, y: gait.body.y, angle: gait.body.angle };
			if (options.diagnostics) root.userData['authoredMotion'] = { selected: selected ?? 'idle', clips: actions.map(function (entry) { return { name: entry.motion.name, time: entry.action.time, duration: entry.motion.clip.duration, weight: entry.weight, timeScale: entry.action.getEffectiveTimeScale() }; }) };
		};
		return {
			root, muzzles, rocketMuzzles,
			get exhaust() { return undefined; },
			get labelHeight() { return labelHeight; },
			pose,
			dispose: function () {
				if (disposed) return; disposed = true;
				mixer.stopAllAction(); mixer.uncacheRoot(scene);
				for (const material of ownedMaterials.values()) material.dispose();
				root.removeFromParent(); root.clear(); instances -= 1; releaseIfUnused();
			},
		};
	};
	return {
		create, weaponRigs, tubeMapping: WARDEN_LOGICAL_TUBE_MAPPING, height, nativeHorizontalOrigin: origin,
		install: function () {
			if (closed) throw new Error('Authored Warden factory is disposed');
			const remove = installMechAssetBinding('warden', { create, weaponRigs });
			installation = { remove, closing: false };
			return function () { if (installation?.remove === remove) installation.closing = true; releaseIfUnused(); };
		},
		dispose: function () { if (installation) installation.closing = true; closed = true; releaseIfUnused(); },
	};
};

export const prepareAuthoredWarden = function (asset: Pick<GLTF, 'scene' | 'animations'>, options: AuthoredOptions = {}) {
	return prepareWarden(asset, options);
};

// Preload before creating the game presentation. Factory creation stays synchronous.
export const loadAuthoredWarden = async function (url: string, options: AuthoredOptions = {}) {
	const asset = await new GLTFLoader().loadAsync(url);
	try {
		return prepareWarden(asset, options, function () { disposeAsset(asset); });
	} catch (error: unknown) {
		disposeAsset(asset);
		throw error;
	}
};

export const authoredMuzzleError = function (model: MechAssetModel, rigs: readonly WeaponRig[], gait: WalkerGait, heading: number, target?: SpatialPoint): number {
	return rigs.reduce(function (largest, rig, slot) {
		const actual = model.muzzles[slot]; if (!actual) throw new Error('Missing authored muzzle output');
		const expected = rigMuzzle(rig, gait.body, heading, undefined, target);
		let error = Math.max(largest, actual.distanceTo(new Vector3(expected.x - gait.body.x, expected.elevation, expected.y - gait.body.y)));
		for (const index of rig.tubes.keys()) {
			const exit = model.rocketMuzzles[slot]?.[index]; if (!exit) throw new Error('Missing authored tube output');
			const expectedExit = rigMuzzle(rig, gait.body, heading, index, target);
			error = Math.max(error, exit.distanceTo(new Vector3(expectedExit.x - gait.body.x, expectedExit.elevation, expectedExit.y - gait.body.y)));
		}
		return error;
	}, 0);
};
