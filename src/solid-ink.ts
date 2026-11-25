import {
	Color, DepthTexture, DoubleSide, FloatType, HalfFloatType, Matrix4, MeshBasicMaterial,
	NearestFilter, PerspectiveCamera, OrthographicCamera, NoBlending, ShaderMaterial, UnsignedIntType, Vector2, Vector3, Vector4,
	WebGLRenderTarget, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createInkSurfaces } from './solid-ink-surfaces';
import { inkGrid, setInkClipTransform } from './solid-ink-grid';
import { edgeShader, inkShader, repairShader, resolveShader, terrainShader } from './solid-ink-shaders';
import type { BakedTerrain } from './terrain-bake';

const vertexShader = 'varying vec2 at; void main() { at=uv; gl_Position=vec4(position.xy,0.,1.); }';
const gridVertexShader = 'varying vec2 at; uniform vec2 rasterUVSize; void main() { at=uv*rasterUVSize; gl_Position=vec4(position.xy,0.,1.); }';

type ViewCamera = OrthographicCamera | PerspectiveCamera;
interface InkFrame {
	anchor?: Vector3;
	cell?: number;
	minimumCell?: number;
	lighterHousing?: boolean;
	terrain?: BakedTerrain;
}

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
		hasTerrain: { value: false }, hasRelief: { value: false },
		terrainColor, terrainDepth,
		liveToTerrain: { value: new Matrix4() }, terrainToLive: { value: new Matrix4() },
		terrainFloorDepth: { value: new Vector4() },
		drawTerrainColor: { value: false },
		rasterUVSize: { value: new Vector2() },
		displayToRaster: { value: new Vector4() },
		units: { value: 1 }, depthRange: { value: 1 }, nearPlane: { value: 1 }, perspective: { value: false }, clearAlpha: { value: 1 }, cell: { value: new Vector2() }, paper: { value: new Vector3() },
	};
	const makePass = function (fragmentShader: string, vertex = gridVertexShader) {
		return new ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader, toneMapped: false, blending: NoBlending, depthTest: false, depthWrite: false });
	};
	const resolve = makePass(resolveShader), edges = makePass(edgeShader), ink = makePass(inkShader), repair = makePass(repairShader);
	// Repair outlines at virtual resolution before nearest-neighbor enlargement.
	const enlarge = makePass(`varying vec2 at; uniform sampler2D finished; uniform bool hasTerrain; uniform vec4 displayToRaster;
		void main() { vec4 pixel=texture2D(finished,at*displayToRaster.xy+displayToRaster.zw); if(hasTerrain && pixel.a==0.) discard; gl_FragColor=pixel; }`, vertexShader);
	const terrainPass = makePass(terrainShader, vertexShader);
	terrainPass.depthTest = terrainPass.depthWrite = true;
	const quad = new FullScreenQuad(resolve);
	const depth = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
	const sceneMaterials = createInkSurfaces();
	const background = new Color(), clear = new Color();
	const ortho = new OrthographicCamera(), perspective = new PerspectiveCamera();
	const displayToClip = new Matrix4(), projectedAnchor = new Vector3();
	const buffers = [source, resolved, lines, inked, finished];
	let disposed = false;
	let verifiedWidth = 0, verifiedHeight = 0;

	return {
		render: function (scene: Scene, camera: ViewCamera, width: number, height: number, { anchor, cell = 1.5, minimumCell = cell, lighterHousing = true, terrain }: InkFrame) {
			camera.updateWorldMatrix(true, false);
			if (anchor) projectedAnchor.copy(anchor).project(camera);
			else projectedAnchor.set(0, 0, 0);
			const grid = inkGrid({
				width, height, cell, minimumCell,
				anchorX: (projectedAnchor.x + 1) * width / 2, anchorY: (projectedAnchor.y + 1) * height / 2,
				maxTextureSize: renderer.capabilities.maxTextureSize,
			});
			if (!grid) throw new Error('Viewport exceeds the solid-ink grid limits');
			const { x, y } = grid;
			for (const buffer of buffers) {
				const taps = buffer === source ? 2 : 1;
				if (buffer.width !== x.capacity * taps || buffer.height !== y.capacity * taps) {
					buffer.setSize(x.capacity * taps, y.capacity * taps);
				}
				buffer.viewport.set(0, 0, x.active * taps, y.active * taps);
				buffer.scissor.copy(buffer.viewport);
				buffer.scissorTest = true;
			}
			const raster = camera instanceof PerspectiveCamera ? perspective.copy(camera, false) : ortho.copy(camera, false);
			raster.matrixWorldAutoUpdate = false;
			raster.projectionMatrix.premultiply(setInkClipTransform(displayToClip, grid));
			raster.projectionMatrixInverse.copy(raster.projectionMatrix).invert();
			uniforms.perspective.value = camera instanceof PerspectiveCamera;
			uniforms.nearPlane.value = camera.near;
			uniforms.units.value = 2 / (raster.projectionMatrix.elements[0] * x.active);
			uniforms.depthRange.value = camera.far - camera.near;
			uniforms.cell.value.set(1 / x.capacity, 1 / y.capacity);
			uniforms.rasterUVSize.value.set(x.active / x.capacity, y.active / y.capacity);
			uniforms.displayToRaster.value.set(x.span / x.capacity, y.span / y.capacity, x.offset / x.capacity, y.offset / y.capacity);

			const target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
			const cubeFace = renderer.getActiveCubeFace(), mipLevel = renderer.getActiveMipmapLevel();
			const autoClear = renderer.autoClear, updateShadows = renderer.shadowMap.autoUpdate;
			const originalBackground = scene.background, override = scene.overrideMaterial;
			const previousShaderError = renderer.debug.onShaderError;
			let shaderError: string | undefined;
			renderer.getClearColor(clear);
			background.copy(originalBackground instanceof Color ? originalBackground : clear).convertLinearToSRGB();
			uniforms.paper.value.set(background.r, background.g, background.b);
			uniforms.hasTerrain.value = terrain !== undefined;
			uniforms.hasRelief.value = terrain?.groundDepth !== undefined;
			uniforms.clearAlpha.value = terrain ? 0 : originalBackground instanceof Color ? 1 : alpha;
			uniforms.terrainColor.value = terrain?.color ?? null;
			uniforms.terrainDepth.value = terrain?.depth ?? null;
			const reprojectTerrain = function (view: ViewCamera, baked: BakedTerrain) {
				uniforms.liveToTerrain.value.copy(baked.projection).multiply(view.matrixWorld).multiply(view.projectionMatrixInverse);
				uniforms.terrainToLive.value.copy(uniforms.liveToTerrain.value).invert();
				uniforms.terrainFloorDepth.value.copy(baked.floorDepth);
			};
			try {
				const overlays = sceneMaterials.begin(scene, raster, lighterHousing);
				renderer.debug.onShaderError = function (gl, program, vertex, fragment) {
					shaderError = gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fragment) || gl.getShaderInfoLog(vertex) || 'Ink shader compilation failed';
					previousShaderError?.(gl, program, vertex, fragment);
				};
				if (x.capacity !== verifiedWidth || y.capacity !== verifiedHeight) {
					const gl = renderer.getContext();
					for (const buffer of buffers) {
						renderer.setRenderTarget(buffer);
						if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete solid-ink framebuffer');
					}
					verifiedWidth = x.capacity; verifiedHeight = y.capacity;
				}
				scene.background = null;
				renderer.setClearColor(0, 0);
				renderer.autoClear = true;
				const draw = function (material: ShaderMaterial, output: WebGLRenderTarget | null) {
					if (output === target) renderer.setRenderTarget(output, cubeFace, mipLevel);
					else renderer.setRenderTarget(output);
					quad.material = material;
					quad.render(renderer);
				};
				renderer.setRenderTarget(source);
				if (terrain) {
					// Occlude live ink samples with the same cached depth used for the terrain image.
					reprojectTerrain(raster, terrain);
					terrainPass.colorWrite = false;
					uniforms.drawTerrainColor.value = false;
					draw(terrainPass, source);
					renderer.autoClear = false;
					if (terrain.groundDepth) renderer.render(terrain.groundDepth, raster);
				}
				renderer.render(scene, raster);
				renderer.autoClear = true;
				draw(resolve, resolved);
				draw(edges, lines);
				draw(ink, inked);
				draw(repair, finished);
				if (terrain) {
					reprojectTerrain(camera, terrain);
					renderer.setClearColor(originalBackground instanceof Color ? originalBackground : clear, originalBackground instanceof Color ? 1 : alpha);
					terrainPass.colorWrite = true;
					uniforms.drawTerrainColor.value = true;
					draw(terrainPass, target);
					renderer.autoClear = false;
					if (terrain.groundDepth) renderer.render(terrain.groundDepth, camera);
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
				sceneMaterials.prepareDepth();
				scene.overrideMaterial = depth;
				raster.projectionMatrix.copy(camera.projectionMatrix);
				raster.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
				renderer.render(scene, raster);
				scene.overrideMaterial = override;
				renderer.render(scene, camera);
			} finally {
				renderer.debug.onShaderError = previousShaderError;
				sceneMaterials.restore();
				scene.background = originalBackground;
				scene.overrideMaterial = override;
				renderer.autoClear = autoClear;
				renderer.shadowMap.autoUpdate = updateShadows;
				renderer.setClearColor(clear, alpha);
				renderer.setRenderTarget(target, cubeFace, mipLevel);
			}
		},
		dispose: function () {
			if (disposed) return;
			disposed = true;
			sceneMaterials.dispose(); quad.dispose();
			for (const material of [resolve, edges, ink, repair, enlarge, terrainPass, depth]) material.dispose();
			for (const buffer of buffers) buffer.dispose();
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
		render: function (scene: Scene, camera: ViewCamera, widthCSS: number, heightCSS: number, frame: InkFrame = {}) {
			if (disposed || !Number.isFinite(widthCSS) || !Number.isFinite(heightCSS) || widthCSS <= 0 || heightCSS <= 0) return true;
			if (pipeline && (scene.background === null || scene.background instanceof Color) && !scene.overrideMaterial) {
				try { pipeline.render(scene, camera, widthCSS, heightCSS, frame); return true; }
				catch (error: unknown) {
					if (frame.terrain) {
						console.warn('Baked terrain draw failed. Using screen-space terrain.', error);
						return false;
					}
					pipeline.dispose(); pipeline = undefined;
					console.warn('Solid ink draw failed. Using native rendering.', error);
				}
			}
			// The battlefield restores the hidden terrain geometry before drawing its fallback.
			if (frame.terrain) return false;
			renderer.render(scene, camera);
			return true;
		},
		dispose: function () { disposed = true; pipeline?.dispose(); pipeline = undefined; },
	};
};
