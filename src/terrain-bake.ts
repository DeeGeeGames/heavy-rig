import { Box3, Color, DepthTexture, DirectionalLight, HemisphereLight, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, UnsignedIntType, Vector3, Vector4, WebGLRenderTarget, type BufferGeometry, type Group, type Object3D, type WebGLRenderer } from 'three';
import { BATTLEFIELD_CELL_WORLD_UNITS } from './solid-ink-grid';

export interface TerrainBakeSource {
	art: readonly Group[];
	ground: Mesh<BufferGeometry, MeshStandardMaterial>;
	coveredGround?: Object3D;
	relief?: boolean;
}

export interface BakedTerrain {
	color: WebGLRenderTarget['texture'];
	depth: DepthTexture;
	projection: Matrix4;
	floorDepth: Vector4;
	groundDepth?: Scene;
	dispose: () => void;
}

export const bakeTerrain = function (renderer: WebGLRenderer, { art, ground, coveredGround, relief }: TerrainBakeSource, view: OrthographicCamera, light: Color): BakedTerrain {
	const scene = new Scene();
	const parents = art.map(function (group) { return { group, parent: group.parent }; });
	const groundMaterial = ground.material, coveredGroundVisible = coveredGround?.visible;
	const clear = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha();
	const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear, updateShadows = renderer.shadowMap.autoUpdate;
	const previousShaderError = renderer.debug.onShaderError;
	let shaderError: string | undefined;
	const pigment = new MeshStandardMaterial({ map: groundMaterial.map, color: groundMaterial.color, vertexColors: groundMaterial.vertexColors, toneMapped: false });
	pigment.onBeforeCompile = function (shader) {
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
			.replace('#include <opaque_fragment>', 'outgoingLight = diffuseColor.rgb * mix(0.62, 1.0, getShadowMask());\n#include <opaque_fragment>' + (relief ? '\ngl_FragColor.a = 0.5;' : ''));
	};
	const sun = new DirectionalLight(light, 1.75);
	let target: WebGLRenderTarget | undefined;
	let complete = false;
	try {
		for (const group of art) scene.attach(group);
		ground.material = pigment;
		if (coveredGround) coveredGround.visible = false;
		const bounds = new Box3().setFromObject(scene);
		const center = bounds.getCenter(new Vector3());
		const radius = bounds.getSize(new Vector3()).length() / 2;
		const distance = Math.max(3000, radius + 2);
		const camera = new OrthographicCamera(-1, 1, 1, -1, 1, Math.max(6000, distance + radius + 2));
		camera.quaternion.copy(view.quaternion);
		camera.position.copy(center).add(new Vector3(0, 0, distance).applyQuaternion(camera.quaternion));
		camera.updateMatrixWorld(true);
		const projected = bounds.clone().applyMatrix4(camera.matrixWorldInverse);
		const cell = BATTLEFIELD_CELL_WORLD_UNITS;
		camera.left = Math.floor(projected.min.x / cell) * cell - cell;
		camera.right = Math.ceil(projected.max.x / cell) * cell + cell;
		camera.bottom = Math.floor(projected.min.y / cell) * cell - cell;
		camera.top = Math.ceil(projected.max.y / cell) * cell + cell;
		camera.updateProjectionMatrix();
		const width = (camera.right - camera.left) / cell, height = (camera.top - camera.bottom) / cell;
		if (Math.max(width, height) > renderer.capabilities.maxTextureSize) throw new Error('Terrain bake exceeds the GPU texture size');
		const depth = new DepthTexture(width, height, UnsignedIntType);
		target = new WebGLRenderTarget(width, height, { depthTexture: depth, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true });
		const sunOffset = new Vector3(-840, 1800, -1000);
		const shadowDistance = Math.max(sunOffset.length(), radius + 2);
		sun.position.copy(center).add(sunOffset.setLength(shadowDistance)); sun.target.position.copy(center);
		sun.castShadow = true;
		sun.shadow.camera.left = sun.shadow.camera.bottom = -radius;
		sun.shadow.camera.right = sun.shadow.camera.top = radius;
		sun.shadow.camera.far = Math.max(4400, shadowDistance + radius + 2);
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.normalBias = 2; sun.shadow.bias = -0.0003;
		scene.add(sun, sun.target, new HemisphereLight('#c4e5e7', '#28302c', 0.85));
		renderer.autoClear = true;
		renderer.shadowMap.autoUpdate = true;
		renderer.setClearColor(0, 0);
		renderer.setRenderTarget(target);
		const gl = renderer.getContext();
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete terrain bake framebuffer');
		renderer.debug.onShaderError = function (context, program, vertex, fragment) {
			shaderError = context.getProgramInfoLog(program) || context.getShaderInfoLog(fragment) || context.getShaderInfoLog(vertex) || 'Terrain bake shader compilation failed';
			previousShaderError?.(context, program, vertex, fragment);
		};
		renderer.render(scene, camera);
		if (shaderError) throw new Error(shaderError);
		const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const [, xToY, , , , yToY, , , , zToY, , , , offsetY] = projection.clone().invert().elements;
		const floorDepth = new Vector4(-xToY / zToY, -yToY / zToY, (ground.getWorldPosition(new Vector3()).y - offsetY) / zToY, 0.2 / Math.abs(zToY));
		// Draw the shared ground mesh depth-only so feet, shadows and overlays
		// meet even steep slopes exactly between the baked color texels.
		const groundDepth = relief ? new Scene() : undefined;
		const depthMaterial = groundDepth ? new MeshBasicMaterial({ colorWrite: false }) : undefined;
		if (groundDepth && depthMaterial) {
			const surface = new Mesh(ground.geometry, depthMaterial);
			surface.matrixAutoUpdate = false; surface.matrix.copy(ground.matrixWorld);
			surface.layers.enableAll(); groundDepth.add(surface);
		}
		const result = { color: target.texture, depth, projection, floorDepth, ...(groundDepth ? { groundDepth } : {}), dispose: function () { depthMaterial?.dispose(); target?.dispose(); } };
		complete = true;
		return result;
	} finally {
		renderer.debug.onShaderError = previousShaderError;
		for (const { group, parent } of parents) {
			if (parent) parent.attach(group); else group.removeFromParent();
		}
		ground.material = groundMaterial;
		if (coveredGround && coveredGroundVisible !== undefined) coveredGround.visible = coveredGroundVisible;
		renderer.setRenderTarget(previousTarget);
		renderer.setClearColor(clear, alpha);
		renderer.autoClear = autoClear;
		renderer.shadowMap.autoUpdate = updateShadows;
		pigment.dispose(); sun.shadow.dispose();
		if (!complete) target?.dispose();
	}
};
