import { Color, Data3DTexture, LinearFilter, MeshStandardMaterial, RGFormat, Vector2, Vector3 } from 'three';
import { SKIN_PALETTES, type MechSkinId } from './mech-skin';

const SIZE = 128;
const COLUMNS = 16;
const ROWS = SIZE / COLUMNS;
const fallback = new Data3DTexture(new Uint8Array(2), 1, 1, 1);
fallback.format = RGFormat; fallback.needsUpdate = true;
const pattern = { value: fallback };
const patternReady = { value: 0 };

export const loadMechSkinPatterns = async function (url = './assets/mechs/faction-patterns.png'): Promise<() => void> {
	const abort = new AbortController();
	const deadline = setTimeout(function () { abort.abort(); }, 5000);
	let bitmap: ImageBitmap | undefined;
	try {
		const response = await fetch(url, { signal: abort.signal });
		if (!response.ok) throw new Error(`Pattern texture returned ${response.status}`);
		bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
		if (bitmap.width !== SIZE * COLUMNS || bitmap.height !== SIZE * ROWS) throw new Error('Invalid camouflage texture dimensions');
		const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Camouflage texture decoding unavailable');
		context.drawImage(bitmap, 0, 0);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const data = new Uint8Array(SIZE * SIZE * SIZE * 2);
		for (let z = 0; z < SIZE; z++) for (let y = 0; y < SIZE; y++) {
			const row = (ROWS - 1 - Math.floor(z / COLUMNS)) * SIZE + SIZE - 1 - y;
			for (let x = 0; x < SIZE; x++) {
				const source = (row * canvas.width + z % COLUMNS * SIZE + x) * 4;
				const target = ((z * SIZE + y) * SIZE + x) * 2;
				data[target] = pixels[source] ?? 0; data[target + 1] = pixels[source + 1] ?? 0;
			}
		}
		const texture = new Data3DTexture(data, SIZE, SIZE, SIZE);
		texture.name = 'Shared faction camouflage'; texture.format = RGFormat;
		texture.magFilter = texture.minFilter = LinearFilter; texture.needsUpdate = true;
		pattern.value = texture; patternReady.value = 1;
		let disposed = false;
		return function () {
			if (disposed) return; disposed = true;
			if (pattern.value === texture) { pattern.value = fallback; patternReady.value = 0; }
			texture.dispose(); fallback.dispose();
		};
	} catch (error: unknown) {
		console.warn('Camouflage texture unavailable; using solid faction paint.', error);
		return function () { fallback.dispose(); };
	} finally { clearTimeout(deadline); bitmap?.close(); }
};

// The pixel meshes use flat, linear-byte vertex colors. Only these authored
// armor swatches receive camouflage. Bare metal and the dark bores keep their finish.
const platePaintCases = [
	{ swatches: ['#7798b0', '#729e76', '#bb605b'], paint: 'vec2(1., 1.)' },
	{ swatches: ['#405772', '#42694f', '#854748'], paint: 'vec2(1., .62)' },
	{ swatches: ['#b5c5c4', '#e1a449', '#d0d6d5', '#d2d3cc'], paint: 'vec2(2., 1.)' },
	{ swatches: ['#a97741'], paint: 'vec2(2., .62)' },
].map(function ({ swatches, paint }) {
	const cases = swatches.map(function (swatch) {
		const { r, g, b } = new Color(swatch);
		const rgb = Math.round(r * 255) * 65536 + Math.round(g * 255) * 256 + Math.round(b * 255);
		return `case ${rgb}:`;
	});
	return `${cases.join(' ')} return ${paint};`;
}).join('\n');

export const mechPlateShader = `vec2 mechPlate(vec3 pigment) {
	ivec3 rgb = ivec3(pigment * 255.0 + 0.5);
	switch (rgb.r * 65536 + rgb.g * 256 + rgb.b) {
		${platePaintCases}
	}
	return vec2(0.);
}`;

export type SkinSurface = 'primary' | 'secondary' | 'palette-primary' | 'palette-secondary' | 'pixel-plates' | 'pod' | 'mechanism' | 'gun' | 'procedural';
interface SkinMaterialOptions { surface: SkinSurface; scale: Vector3; barrelCutoff?: number }

export const applyMechSkinMaterial = function (material: MeshStandardMaterial, skin: MechSkinId | Color, options: SkinMaterialOptions): void {
	if (skin === 'original') return;
	const skinName = typeof skin === 'string' ? skin : 'solid';
	material.userData['mechSkin'] = skinName;
	if (options.surface === 'mechanism') {
		material.color.set('#45494a'); material.metalness = 0.68; material.roughness = 0.6;
		return;
	}
	// The high-detail authoring viewer also accepts a single coat, using its
	// existing palette/atlas armor masks. Its paint never samples camouflage.
	const palette = skin === 'accord' ? SKIN_PALETTES.accord : SKIN_PALETTES.freeholds;
	const primary = skin instanceof Color ? [skin, skin, skin] : palette.primary.map(function (hex) { return new Color(hex); });
	const secondary = skin instanceof Color ? primary : palette.secondary.map(function (hex) { return new Color(hex); });
	const surface = options.surface;
	const mode = surface.startsWith('palette-') ? 'palette' : surface;
	const second = surface === 'secondary' || surface === 'palette-secondary' || surface === 'pod' || surface === 'gun';
	const colors = second ? secondary : primary;
	const thresholds = second ? palette.secondaryThresholds : palette.thresholds;
	material.customProgramCacheKey = function () { return `mech-skin-1:${skinName}:${mode}`; };
	material.onBeforeCompile = function (shader) {
		shader.uniforms['mechPattern'] = pattern;
		shader.uniforms['mechPatternReady'] = patternReady;
		shader.uniforms['mechMeshScale'] = { value: options.scale };
		shader.uniforms['mechColors'] = { value: colors };
		shader.uniforms['mechPrimaryColors'] = { value: primary };
		shader.uniforms['mechSecondaryColors'] = { value: secondary };
		shader.uniforms['mechThresholds'] = { value: new Vector2(...thresholds) };
		shader.uniforms['mechSecondaryThresholds'] = { value: new Vector2(...palette.secondaryThresholds) };
		shader.uniforms['mechBarrelCutoff'] = { value: options.barrelCutoff ?? 0 };
		shader.uniforms['mechSteel'] = { value: new Color('#6c7376') };
		shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 mechMeshScale;\nvarying vec3 vMechPaintPosition;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvec3 mechPosition = position * mechMeshScale;\nvMechPaintPosition = vec3(mechPosition.x, -mechPosition.z, mechPosition.y);');
		if (mode === 'pixel-plates') {
			shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec2 vMechPlate;
${mechPlateShader}`).replace('#include <color_vertex>', '#include <color_vertex>\nvMechPlate = mechPlate(color.rgb);');
			shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n#define MECH_PIXEL_PLATES\nvarying vec2 vMechPlate;');
		}
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform highp sampler3D mechPattern;
uniform float mechPatternReady;
uniform vec3 mechColors[3];
uniform vec3 mechPrimaryColors[3];
uniform vec3 mechSecondaryColors[3];
uniform vec2 mechThresholds;
uniform vec2 mechSecondaryThresholds;
uniform float mechBarrelCutoff;
uniform vec3 mechSteel;
varying vec3 vMechPaintPosition;
vec3 mechPaint(vec3 a, vec3 b, vec3 c, vec2 limits, float field) {
	float edge = max(fwidth(field), 0.0015);
	return mix(mix(a, b, smoothstep(limits.x - edge, limits.x + edge, field)), c, smoothstep(limits.y - edge, limits.y + edge, field));
}`);
		let assignment = 'diffuseColor.rgb = mechPaintColor;';
		if (mode === 'palette') assignment = '#ifdef USE_MAP\nif (abs(vMapUv.x - 0.0625) < 0.002) { diffuseColor.rgb = mechPaintColor; mechPainted = true; }\n#endif';
		if (mode === 'pod') assignment = 'diffuseColor.rgb *= mechPaintColor * 2.2;';
		if (mode === 'gun') assignment = 'if (vMechPaintPosition.y < mechBarrelCutoff) { diffuseColor.rgb = mechSteel; mechPainted = false; } else { diffuseColor.rgb = mechPaintColor; }';
		const secondaryPaint = skin instanceof Color ? 'mechSecondaryColors[1]' : '(mechPatternReady > 0.5 ? mechPaint(mechSecondaryColors[0], mechSecondaryColors[1], mechSecondaryColors[2], mechSecondaryThresholds, mechField) : mechSecondaryColors[1])';
		if (mode === 'pixel-plates') assignment = `
if (vMechPlate.x > 0.5) {
	diffuseColor.rgb = (vMechPlate.x > 1.5 ? ${secondaryPaint} : mechPaintColor) * vMechPlate.y;
	mechPainted = true;
}`;
		if (mode === 'procedural') assignment = `
bool mechPrimary = distance(diffuseColor.rgb, mechPrimaryColors[1]) < 0.002;
bool mechSecondary = distance(diffuseColor.rgb, mechSecondaryColors[1]) < 0.002;
if (mechPrimary || mechSecondary) {
	diffuseColor.rgb = mechSecondary ? ${secondaryPaint} : mechPaintColor;
	mechPainted = true;
}`;
		const paintChunk = mode === 'pixel-plates' ? '#include <color_fragment>' : '#include <map_fragment>';
		const coat = skin instanceof Color ? 'vec3 mechPaintColor = mechColors[1];' : `vec2 mechFields = texture(mechPattern, clamp(vMechPaintPosition * 0.5 + 0.5, 0.0, 1.0)).rg;
float mechField = ${skin === 'freeholds' ? 'mechFields.r' : 'mechFields.g'};
vec3 mechPaintColor = mechPatternReady > 0.5 ? mechPaint(mechColors[0], mechColors[1], mechColors[2], mechThresholds, mechField) : mechColors[1];`;
		shader.fragmentShader = shader.fragmentShader.replace(paintChunk, `${paintChunk}
${coat}
bool mechPainted = ${mode === 'palette' || mode === 'procedural' || mode === 'pixel-plates' ? 'false' : 'true'};
${assignment}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (mechPainted) roughnessFactor = ${skin === 'freeholds' ? '0.74' : '0.64'} + (rand(vMechPaintPosition.xy * 145.0 + vMechPaintPosition.z) - 0.5) * 0.08;`);
		if (mode === 'gun') shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (vMechPaintPosition.y < mechBarrelCutoff) metalnessFactor = 0.83;');
	};
};
