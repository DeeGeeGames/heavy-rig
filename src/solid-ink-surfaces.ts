import { AmbientLight, DirectionalLight, HemisphereLight, Light, Line, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, Sprite, Vector3, type Camera, type Material, type Object3D, type Scene } from 'three';
import { createInkMaterial, type InkLighting, type InkSource, type InkSurface } from './solid-ink-material';

const inkLayer = 30;
const eligible = function (source: unknown): source is InkSource {
	return (source instanceof MeshStandardMaterial || source instanceof MeshBasicMaterial)
		&& !source.transparent && source.depthWrite && source.depthTest && source.colorWrite;
};

interface MaterialVariant { ink: InkSource; version: number; lastSeen: number }
interface MeshBinding { mesh: Mesh; original: Material | Material[]; layers: number }
interface LightBinding { light: Light; layers: number }

export const createInkSurfaces = function () {
	const materials = new Map<InkSource, Map<InkSurface, MaterialVariant>>();
	const clipped: InkSource[] = [];
	const bindings: MeshBinding[] = [], lights: LightBinding[] = [];
	const meshEntries = new WeakMap<Mesh, MeshBinding>();
	let frame = 0;
	const lighter = { value: true };
	const lighting: InkLighting = {
		keyDirection: { value: new Vector3() }, fillDirection: { value: new Vector3() },
		illumination: { value: new Vector3() }, lightTint: { value: new Vector3() },
	};
	const direction = function (light: DirectionalLight | undefined, vector: Vector3) {
		if (!light) { vector.set(0, 1, 0); return; }
		light.getWorldPosition(vector);
		vector.sub(light.target.getWorldPosition(targetPosition)).normalize();
	};
	const targetPosition = new Vector3();
	const variant = function (source: InkSource, surface: InkSurface) {
		const variants = materials.get(source) ?? new Map<InkSurface, MaterialVariant>();
		let entry = variants.get(surface);
		if (!entry || entry.version !== source.version) {
			entry?.ink.dispose();
			entry = { ink: createInkMaterial(source, surface, lighter, lighting), version: source.version, lastSeen: -1 };
			variants.set(surface, entry); materials.set(source, variants);
		}
		if (entry.lastSeen !== frame) {
			entry.lastSeen = frame;
			if (source.allowOverride && source.clippingPlanes?.length) clipped.push(entry.ink);
			entry.ink.color.copy(source.color);
			if (entry.ink instanceof MeshStandardMaterial && source instanceof MeshStandardMaterial) {
				entry.ink.emissive.copy(source.emissive); entry.ink.emissiveIntensity = source.emissiveIntensity;
				entry.ink.roughness = source.roughness; entry.ink.metalness = source.metalness;
			}
		}
		return entry.ink;
	};

	return {
		// Discover the visible branches each frame. ECS removals, weapon changes,
		// visibility switches, and mission terrain swaps take effect on that draw.
		begin: function (scene: Scene, camera: Camera, lighterHousing: boolean) {
			frame++; lighter.value = lighterHousing;
			let key: DirectionalLight | undefined, fill: DirectionalLight | undefined;
			let ambient = 0;
			let overlays = false;
			const visit = function (node: Object3D, actor: boolean, accord: boolean) {
				if (!node.visible) return;
				if (node.userData['nativeEffects'] === true) { overlays = true; return; }
				const skin: unknown = node.userData['mechSkin'];
				if (typeof skin === 'string') { actor = true; accord = skin === 'accord'; }
				else if (node.name.endsWith('-vehicle') || node.name === 'artillery-emplacement' || node.name === 'silo-turret') actor = true;
				if (camera.layers.test(node.layers)) {
					if (node instanceof Light) {
						lights.push({ light: node, layers: node.layers.mask }); node.layers.enable(inkLayer);
						if (node instanceof DirectionalLight) {
							if (!key || node.intensity > key.intensity) { fill = key; key = node; }
							else if (!fill || node.intensity > fill.intensity) fill = node;
						} else if (node instanceof AmbientLight || node instanceof HemisphereLight) ambient += node.intensity;
					}
					if (node instanceof Line || node instanceof Points || node instanceof Sprite) overlays = true;
					if (node instanceof Mesh) {
						const source: Material | Material[] = node.material;
						const gun = accord && (node.name === 'geometry_kestrel_mount_left-gun' || node.name === 'geometry_kestrel_mount_right-gun');
						const surface = actor ? gun ? 'gun' : 'mech' : 'yard';
						const ink = Array.isArray(source)
							? source.length && source.every(eligible) ? source.map(function (m) { return variant(m, surface); }) : undefined
							: eligible(source) ? variant(source, surface) : undefined;
						if (ink) {
							let binding = meshEntries.get(node);
							if (!binding) { binding = { mesh: node, original: source, layers: node.layers.mask }; meshEntries.set(node, binding); }
							binding.original = source; binding.layers = node.layers.mask;
							bindings.push(binding);
							node.material = ink; node.layers.set(inkLayer);
						} else overlays = true;
					}
				}
				for (const child of node.children) visit(child, actor, accord);
			};
			visit(scene, false, false);
			direction(key, lighting.keyDirection.value); direction(fill, lighting.fillDirection.value);
			lighting.illumination.value.set((key?.intensity ?? 0) / 3.1, (fill?.intensity ?? 0) / 1.05, Math.min(1.5, ambient / 1.4));
			// A modest key tint retains the local biome/hangar light color while the
			// authored six-color ramps still determine each painted plate.
			lighting.lightTint.value.set(1, 1, 1);
			if (key) {
				const { r, g, b } = key.color;
				const max = Math.max(r, g, b, 0.001);
				lighting.lightTint.value.set(.84 + .16*r/max, .84 + .16*g/max, .84 + .16*b/max);
			}
			for (const [source, variants] of materials) {
				for (const [surface, entry] of variants) if (entry.lastSeen !== frame) { entry.ink.dispose(); variants.delete(surface); }
				if (!variants.size) materials.delete(source);
			}
			camera.layers.set(inkLayer);
			return overlays;
		},
		prepareDepth: function () {
			// The shared depth override has no local clipping planes. Replay
			// boundary-crossing geometry with its own clipped shader, depth only.
			for (const material of clipped) { material.allowOverride = false; material.colorWrite = false; }
		},
		restore: function () {
			for (const material of clipped) { material.allowOverride = true; material.colorWrite = true; }
			clipped.length = 0;
			for (const binding of bindings) { binding.mesh.layers.mask = binding.layers; binding.mesh.material = binding.original; }
			for (const binding of lights) binding.light.layers.mask = binding.layers;
			bindings.length = 0; lights.length = 0;
		},
		dispose: function () {
			for (const variants of materials.values()) for (const entry of variants.values()) entry.ink.dispose();
			materials.clear();
		},
	};
};
