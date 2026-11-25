import { Color, MathUtils } from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import type { MissionMap } from './campaign-types';
import { cloudEntry, cloudExit, LAUNCH_TIMING } from './launch-timing';
import { SURFACE_PALETTES } from './mission-environment';

// Both cameras pass through the same cloud bank. Bake its wisps once, then
// move through the texture on the launch clock so the cut happens inside it.
export const createLaunchClouds = function (map: MissionMap) {
	const palette = SURFACE_PALETTES[map.biome];
	const sheet = document.createElement('canvas');
	sheet.width = 256; sheet.height = 160;
	const paint = sheet.getContext('2d');
	if (paint) {
		const pixels = paint.createImageData(sheet.width, sheet.height);
		const low = new Color(palette.haze).convertLinearToSRGB();
		const high = new Color(palette.light).lerp(new Color(palette.dust), .4).convertLinearToSRGB();
		const color = new Color(), noise = new ImprovedNoise(), seed = (map.seed >>> 0) % 8191 / 97;
		for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) {
			const density = noise.noise(x / 79, y / 32, seed) + .45 * noise.noise(x / 28, y / 15, seed + 8) + .15 * noise.noise(x / 10, y / 6, seed + 19);
			const shade = MathUtils.clamp(.5 + density * .65, 0, 1);
			color.lerpColors(low, high, Math.round(shade * 12) / 12);
			const i = 4 * (y * sheet.width + x);
			pixels.data[i] = color.r * 255; pixels.data[i + 1] = color.g * 255; pixels.data[i + 2] = color.b * 255;
			pixels.data[i + 3] = 255 * MathUtils.smoothstep(shade, .06, .78);
		}
		paint.putImageData(pixels, 0, 0);
	}
	return function (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
		if (time <= cloudEntry || time >= cloudExit) return;
		const cover = MathUtils.smoothstep(time, cloudEntry, LAUNCH_TIMING.approach - .08)
			* (1 - MathUtils.smoothstep(time, LAUNCH_TIMING.approach + .08, cloudExit));
		const travel = (time - cloudEntry) / (cloudExit - cloudEntry);
		const scale = Math.max(width / sheet.width, height / sheet.height) * (1.08 + .28 * travel);
		const w = sheet.width * scale, h = sheet.height * scale;
		ctx.save();
		ctx.globalAlpha = cover ** 3; ctx.fillStyle = palette.haze; ctx.fillRect(0, 0, width, height);
		ctx.globalAlpha = cover; ctx.imageSmoothingEnabled = false;
		ctx.drawImage(sheet, (width - w) * (.35 + .23 * travel), (height - h) * (.25 + .50 * travel), w, h);
		ctx.restore();
	};
};
