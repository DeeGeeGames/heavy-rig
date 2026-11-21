import {
	Color, DepthTexture, DoubleSide, FloatType, HalfFloatType, Light, Mesh, MeshBasicMaterial,
	MeshStandardMaterial, NearestFilter, NoBlending, ShaderMaterial, UnsignedIntType, Vector2, Vector3,
	WebGLRenderTarget, type Object3D, type OrthographicCamera, type Scene, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createInkMaterial, type InkSource, type InkSurface } from './kestrel-ink-material';
import { edgeShader, inkShader, repairShader, resolveShader } from './kestrel-ink-shaders';

const inkLayer = 30;
const vertexShader = 'varying vec2 at; void main() { at=uv; gl_Position=vec4(position.xy,0.,1.); }';

const bindSurfaces = function (roots: readonly Object3D[], mech: boolean, lighter: { value: boolean }) {
	const bindings: { mesh: Mesh; source: InkSource; ink: InkSource; layers: number }[] = [];
	const cache = new Map<InkSource, Map<InkSurface, InkSource>>();
	for (const root of roots) root.traverse(function (mesh) {
		if (!(mesh instanceof Mesh)) return;
		const source: unknown = mesh.material;
		if (!(source instanceof MeshBasicMaterial || source instanceof MeshStandardMaterial) || source.transparent) return;
		const gun = mesh.name === 'geometry_kestrel_mount_left-gun' || mesh.name === 'geometry_kestrel_mount_right-gun';
		const surface = mech ? gun ? 'gun' : 'mech' : 'yard';
		const variants = cache.get(source) ?? new Map<InkSurface, InkSource>();
		let ink = variants.get(surface);
		if (!ink) {
			ink = createInkMaterial(source, surface, lighter);
			variants.set(surface, ink);
			cache.set(source, variants);
		}
		bindings.push({ mesh, source, ink, layers: mesh.layers.mask });
	});
	return {
		bindings,
		dispose: function () {
			for (const variants of cache.values()) for (const material of variants.values()) material.dispose();
		},
	};
};

export const createKestrelInk = function (renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera) {
	if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Solid ink requires floating-point render targets');
	const options = { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false };
	const source = new WebGLRenderTarget(1, 1, { ...options, count: 2, type: HalfFloatType, depthBuffer: true });
	source.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
	const resolved = new WebGLRenderTarget(1, 1, { ...options, count: 2, type: HalfFloatType });
	resolved.texture.type = FloatType;
	const surfaces = source.textures[1], paintPixels = resolved.textures[1];
	if (!surfaces || !paintPixels) {
		source.dispose(); resolved.dispose();
		throw new Error('Missing ink color attachment');
	}
	const lines = new WebGLRenderTarget(1, 1, options);
	const inked = new WebGLRenderTarget(1, 1, options);
	const finished = new WebGLRenderTarget(1, 1, options);
	const uniforms = {
		paints: { value: source.texture }, surfaces: { value: surfaces }, depths: { value: source.depthTexture },
		geometry: { value: resolved.texture }, paintPixels: { value: paintPixels },
		lines: { value: lines.texture }, inked: { value: inked.texture }, finished: { value: finished.texture },
		units: { value: 1 }, depthRange: { value: 1 }, cell: { value: new Vector2() }, paper: { value: new Vector3() },
	};
	const makePass = function (fragmentShader: string) {
		return new ShaderMaterial({ uniforms, vertexShader, fragmentShader, toneMapped: false, blending: NoBlending, depthTest: false, depthWrite: false });
	};
	const resolve = makePass(resolveShader), edges = makePass(edgeShader), ink = makePass(inkShader), repair = makePass(repairShader);
	// Repair outlines at virtual resolution before nearest-neighbor enlargement.
	const enlarge = makePass('varying vec2 at; uniform sampler2D finished; void main() { gl_FragColor=texture2D(finished,at); }');
	const quad = new FullScreenQuad(resolve);
	const depth = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
	const lighter = { value: false };
	const background = new Color(), clear = new Color();
	const terrain = ['legacy-terrain', 'relay'].flatMap(function (name) {
		const node = scene.getObjectByName(name);
		return node ? [node] : [];
	});
	const yard = bindSurfaces(terrain, false, lighter);
	const lights: { node: Light; layers: number }[] = [];
	scene.traverse(function (node) { if (node instanceof Light) lights.push({ node, layers: node.layers.mask }); });
	let player: { root: Object3D; surfaces: ReturnType<typeof bindSurfaces> } | undefined;
	let disposed = false;

	return {
		render: function (widthCSS: number, heightCSS: number, modelRoot: Object3D, lighterHousing: boolean) {
			if (disposed || widthCSS <= 0 || heightCSS <= 0) return;
			if (player?.root !== modelRoot) {
				player?.surfaces.dispose();
				player = { root: modelRoot, surfaces: bindSurfaces([modelRoot], true, lighter) };
			}
			const w = Math.max(1, Math.round(widthCSS / 3)), h = Math.max(1, Math.round(heightCSS / 3));
			lighter.value = lighterHousing;
			source.setSize(w * 2, h * 2);
			for (const target of [resolved, lines, inked, finished]) target.setSize(w, h);
			uniforms.units.value = (camera.right - camera.left) / (w * camera.zoom);
			uniforms.depthRange.value = camera.far - camera.near;
			uniforms.cell.value.set(1 / w, 1 / h);

			const target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
			const autoClear = renderer.autoClear, updateShadows = renderer.shadowMap.autoUpdate;
			const originalBackground = scene.background, override = scene.overrideMaterial, cameraLayers = camera.layers.mask;
			renderer.getClearColor(clear);
			background.copy(originalBackground instanceof Color ? originalBackground : clear).convertLinearToSRGB();
			uniforms.paper.value.set(background.r, background.g, background.b);
			const groups = [yard, player.surfaces];
			try {
				for (const group of groups) for (const binding of group.bindings) {
					binding.layers = binding.mesh.layers.mask;
					binding.mesh.layers.set(inkLayer);
					binding.mesh.material = binding.ink;
					binding.ink.color.copy(binding.source.color);
					if (binding.ink instanceof MeshStandardMaterial && binding.source instanceof MeshStandardMaterial) {
						binding.ink.emissive.copy(binding.source.emissive);
						binding.ink.emissiveIntensity = binding.source.emissiveIntensity;
					}
				}
				for (const light of lights) { light.layers = light.node.layers.mask; light.node.layers.enable(inkLayer); }
				camera.layers.set(inkLayer);
				scene.background = null;
				renderer.setClearColor(0, 0);
				renderer.autoClear = true;
				renderer.setRenderTarget(source);
				renderer.render(scene, camera);

				const draw = function (material: ShaderMaterial, output: WebGLRenderTarget | null) {
					renderer.setRenderTarget(output);
					quad.material = material;
					quad.render(renderer);
				};
				draw(resolve, resolved);
				draw(edges, lines);
				draw(ink, inked);
				draw(repair, finished);
				draw(enlarge, target);

				// Restore the exact scene depth at display resolution before drawing live
				// muzzle flashes, the firing arc, shadows, and the other game overlays.
				renderer.shadowMap.autoUpdate = false;
				renderer.autoClear = false;
				renderer.clearDepth();
				scene.overrideMaterial = depth;
				renderer.render(scene, camera);
				scene.overrideMaterial = override;
				camera.layers.mask = cameraLayers;
				renderer.render(scene, camera);
			} finally {
				for (const group of groups) for (const binding of group.bindings) {
					binding.mesh.layers.mask = binding.layers;
					binding.mesh.material = binding.source;
				}
				for (const light of lights) light.node.layers.mask = light.layers;
				camera.layers.mask = cameraLayers;
				scene.background = originalBackground;
				scene.overrideMaterial = override;
				renderer.autoClear = autoClear;
				renderer.shadowMap.autoUpdate = updateShadows;
				renderer.setClearColor(clear, alpha);
				renderer.setRenderTarget(target);
			}
		},
		dispose: function () {
			if (disposed) return;
			disposed = true;
			yard.dispose(); player?.surfaces.dispose(); quad.dispose();
			for (const material of [resolve, edges, ink, repair, enlarge, depth]) material.dispose();
			for (const target of [source, resolved, lines, inked, finished]) target.dispose();
		},
	};
};
