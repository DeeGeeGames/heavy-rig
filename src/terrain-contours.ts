import { contours } from 'd3-contour';
import type { MissionMap } from './campaign-types';
import { groundHeight } from './terrain-elevation';

const surveys = new WeakMap<MissionMap, HTMLCanvasElement>();
const interval = 40;

// Both tactical views use the same survey. Rasterize it once per map so a
// moving radar contact never rebuilds or traces the terrain contours.
export const drawTerrainContours = function (ctx: CanvasRenderingContext2D, map: MissionMap, x: number, y: number, width: number, height: number) {
	const field = map.terrain?.elevation;
	if (!field) return;
	let survey = surveys.get(map);
	if (!survey) {
		survey = document.createElement('canvas');
		survey.width = 480; survey.height = Math.round(480 * map.height / map.width);
		const ink = survey.getContext('2d');
		if (!ink) return;
		const cols = Math.ceil(map.width / 60), rows = Math.ceil(map.height / 60);
		const samples = Array.from({ length: cols * rows }, function (_, i) {
			return groundHeight(map.terrain, { x: (i % cols + .5) * map.width / cols, y: (Math.floor(i / cols) + .5) * map.height / rows });
		});
		const levels: number[] = [];
		for (let m = Math.ceil(field.minHeight / interval) * interval; m < field.maxHeight; m += interval) levels.push(m);
		ink.scale(survey.width / cols, survey.height / rows);
		ink.fillStyle = 'rgba(174, 187, 143, .055)'; ink.strokeStyle = 'rgba(177, 195, 158, .38)'; ink.lineWidth = cols / survey.width;
		for (const line of contours().size([cols, rows]).thresholds(levels)(samples)) {
			ink.beginPath();
			for (const polygon of line.coordinates) for (const ring of polygon) {
				for (const [i, point] of ring.entries()) {
					const [px, py] = point;
					if (px === undefined || py === undefined) continue;
					if (i === 0) ink.moveTo(px, py); else ink.lineTo(px, py);
				}
				ink.closePath();
			}
			ink.fill('evenodd'); ink.stroke();
		}
		surveys.set(map, survey);
	}
	ctx.drawImage(survey, x, y, width, height);
};
