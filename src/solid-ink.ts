import {
	Color, DepthTexture, DoubleSide, FloatType, HalfFloatType, Matrix4, MeshBasicMaterial,
	NearestFilter, PerspectiveCamera, NoBlending, ShaderMaterial, UnsignedIntType, Vector2, Vector3, Vector4,
	WebGLRenderTarget, type OrthographicCamera, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createInkSurfaces } from './solid-ink-surfaces';
import { edgeShader, inkShader, repairShader, resolveShader, terrainShader } from './solid-ink-shaders';
import type { BakedTerrain } from './terrain-bake';

const vertexShader = 'varying vec2 at; void main() { at=uv; gl_Position=vec4(position.xy,0.,1.); }';

type ViewCamera = OrthographicCamera | PerspectiveCamera;
export type InkCellSize = 1.5 | 2 | 3;

const createPipeline = function (renderer: WebGLRenderer) {
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
	const terrainColor: { value: Texture | null } = { value: null };
	const terrainDepth: { value: DepthTexture | null } = { value: null };
	const uniforms = {
		paints: { value: source.texture }, surfaces: { value: surfaces }, depths: { value: source.depthTexture },
		geometry: { value: resolved.texture }, paintPixels: { value: paintPixels },
		lines: { value: lines.texture }, inked: { value: inked.texture }, finished: { value: finished.texture },
		hasTerrain: { value: false },
		terrainColor, terrainDepth,
		liveToTerrain: { value: new Matrix4() }, terrainToLive: { value: new Matrix4() },
		terrainFloorDepth: { value: new Vector4() },
		drawTerrainColor: { value: false },
		units: { value: 1 }, depthRange: { value: 1 }, nearPlane: { value: 1 }, perspective: { value: false }, clearAlpha: { value: 1 }, cell: { value: new Vector2() }, paper: { value: new Vector3() },
	};
	const makePass = function (fragmentShader: string) {
		return new ShaderMaterial({ uniforms, vertexShader, fragmentShader, toneMapped: false, blending: NoBlending, depthTest: false, depthWrite: false });
	};
	const resolve = makePass(resolveShader), edges = makePass(edgeShader), ink = makePass(inkShader), repair = makePass(repairShader);
	// Repair outlines at virtual resolution before nearest-neighbor enlargement.
	const enlarge = makePass(`varying vec2 at; uniform sampler2D finished; uniform bool hasTerrain;
		void main() { vec4 pixel=texture2D(finished,at); if(hasTerrain && pixel.a==0.) discard; gl_FragColor=pixel; }`);
	const terrainPass = makePass(terrainShader);
	terrainPass.depthTest = terrainPass.depthWrite = true;
	const quad = new FullScreenQuad(resolve);
	const depth = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
	const sceneMaterials = createInkSurfaces();
	const background = new Color(), clear = new Color();
	let disposed = false;
	let verifiedWidth = 0, verifiedHeight = 0;

	return {
		render: function (scene: Scene, camera: ViewCamera, widthCSS: number, heightCSS: number, lighterHousing: boolean, cellSize: InkCellSize, terrain?: BakedTerrain) {
			const w = Math.max(1, Math.round(widthCSS / cellSize)), h = Math.max(1, Math.round(heightCSS / cellSize));
			source.setSize(w * 2, h * 2);
			for (const target of [resolved, lines, inked, finished]) target.setSize(w, h);
			uniforms.perspective.value = camera instanceof PerspectiveCamera;
			uniforms.nearPlane.value = camera.near;
			uniforms.units.value = 2 / (camera.projectionMatrix.elements[0] * w);
			uniforms.depthRange.value = camera.far - camera.near;
			uniforms.cell.value.set(1 / w, 1 / h);

			const target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
			const autoClear = renderer.autoClear, updateShadows = renderer.shadowMap.autoUpdate;
			const originalBackground = scene.background, override = scene.overrideMaterial, cameraLayers = camera.layers.mask;
			const previousShaderError = renderer.debug.onShaderError;
			let shaderError: string | undefined;
			renderer.getClearColor(clear);
			background.copy(originalBackground instanceof Color ? originalBackground : clear).convertLinearToSRGB();
			uniforms.paper.value.set(background.r, background.g, background.b);
			uniforms.hasTerrain.value = terrain !== undefined;
			uniforms.clearAlpha.value = terrain ? 0 : originalBackground instanceof Color ? 1 : alpha;
			uniforms.terrainColor.value = terrain?.color ?? null;
			uniforms.terrainDepth.value = terrain?.depth ?? null;
			if (terrain) {
				uniforms.liveToTerrain.value.copy(terrain.projection).multiply(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
				uniforms.terrainToLive.value.copy(uniforms.liveToTerrain.value).invert();
				uniforms.terrainFloorDepth.value.copy(terrain.floorDepth);
			}
			try {
				const overlays = sceneMaterials.begin(scene, camera, lighterHousing);
				renderer.debug.onShaderError = function (gl, program, vertex, fragment) {
					shaderError = gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fragment) || gl.getShaderInfoLog(vertex) || 'Ink shader compilation failed';
					previousShaderError?.(gl, program, vertex, fragment);
				};
				if (w !== verifiedWidth || h !== verifiedHeight) {
					const gl = renderer.getContext();
					for (const buffer of [source, resolved, lines, inked, finished]) {
						renderer.setRenderTarget(buffer);
						if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete solid-ink framebuffer');
					}
					verifiedWidth = w; verifiedHeight = h;
				}
				scene.background = null;
				renderer.setClearColor(0, 0);
				renderer.autoClear = true;
				const draw = function (material: ShaderMaterial, output: WebGLRenderTarget | null) {
					renderer.setRenderTarget(output);
					quad.material = material;
					quad.render(renderer);
				};
				renderer.setRenderTarget(source);
				if (terrain) {
					// Occlude live ink samples with the same cached depth used for the terrain image.
					terrainPass.colorWrite = false;
					uniforms.drawTerrainColor.value = false;
					draw(terrainPass, source);
					renderer.autoClear = false;
				}
				renderer.render(scene, camera);
				renderer.autoClear = true;
				draw(resolve, resolved);
				draw(edges, lines);
				draw(ink, inked);
				draw(repair, finished);
				if (terrain) {
					renderer.setClearColor(originalBackground instanceof Color ? originalBackground : clear, originalBackground instanceof Color ? 1 : alpha);
					terrainPass.colorWrite = true;
					uniforms.drawTerrainColor.value = true;
					draw(terrainPass, target);
					renderer.autoClear = false;
				}
				draw(enlarge, target);
				if (shaderError) throw new Error(shaderError);
				renderer.debug.onShaderError = previousShaderError;
				if (!overlays) return;

				// Restore the exact scene depth at display resolution before drawing live
				// muzzle flashes, the firing arc, shadows, and the other game overlays.
				renderer.shadowMap.autoUpdate = false;
				renderer.autoClear = false;
				if (!terrain) renderer.clearDepth();
				scene.overrideMaterial = depth;
				renderer.render(scene, camera);
				scene.overrideMaterial = override;
				camera.layers.mask = cameraLayers;
				renderer.render(scene, camera);
			} finally {
				renderer.debug.onShaderError = previousShaderError;
				sceneMaterials.restore();
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
			sceneMaterials.dispose(); quad.dispose();
			for (const material of [resolve, edges, ink, repair, enlarge, terrainPass, depth]) material.dispose();
			for (const target of [source, resolved, lines, inked, finished]) target.dispose();
		},
	};
};

// Each canvas owns a pipeline. Fall back to the native scene renderer when the
// attachment format is unavailable or when allocation/rendering fails.
export const createSolidInk = function (renderer: WebGLRenderer) {
	let pipeline: ReturnType<typeof createPipeline> | undefined;
	try {
		if (renderer.extensions.has('EXT_color_buffer_float')) pipeline = createPipeline(renderer);
		else console.warn('Solid ink requires floating-point render targets. Using native rendering.');
	} catch (error: unknown) { console.warn('Solid ink setup failed. Using native rendering.', error); }
	let disposed = false;
	return {
		get available() { return pipeline !== undefined; },
		render: function (scene: Scene, camera: ViewCamera, widthCSS: number, heightCSS: number, lighterHousing = true, cellSize: InkCellSize = 3, terrain?: BakedTerrain) {
			if (disposed || widthCSS <= 0 || heightCSS <= 0) return true;
			if (pipeline && (scene.background === null || scene.background instanceof Color) && !scene.overrideMaterial) {
				try { pipeline.render(scene, camera, widthCSS, heightCSS, lighterHousing, cellSize, terrain); return true; }
				catch (error: unknown) {
					if (terrain) {
						console.warn('Baked terrain draw failed. Using screen-space terrain.', error);
						return false;
					}
					pipeline.dispose(); pipeline = undefined;
					console.warn('Solid ink draw failed. Using native rendering.', error);
				}
			}
			// The battlefield restores the hidden terrain geometry before drawing its fallback.
			if (terrain) return false;
			renderer.render(scene, camera);
			return true;
		},
		dispose: function () { disposed = true; pipeline?.dispose(); pipeline = undefined; },
	};
};
