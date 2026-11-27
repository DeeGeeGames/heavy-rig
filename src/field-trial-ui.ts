import { render, svg } from 'lit-html';
import type { MissionMap } from './campaign-types';
import type { Point } from './simulation';

export const fieldTrialSeed = function (value: string | null): number | undefined {
	if (value === null) return undefined;
	const seed = Number(value);
	return /^\d{1,10}$/.test(value) && Number.isSafeInteger(seed) && seed <= 0xffffffff ? seed : 283191706;
};

// Frame the playable approaches at a constant cartographic scale on either axis.
export const drawFieldSurvey = function (host: HTMLElement, map: MissionMap) {
	const terrain = map.terrain;
	if (!terrain) return;
	const staging = map.defenseApproach?.staging;
	const sites = [map.drop, map.objective, map.extraction, ...terrain.roads.flat()];
	const left = Math.min(...sites.map(function (p) { return p.x; })) - 70;
	const top = Math.min(...sites.map(function (p) { return p.y; })) - 70;
	const width = Math.max(...sites.map(function (p) { return p.x; })) + 70 - left;
	const height = Math.max(...sites.map(function (p) { return p.y; })) + 70 - top;
	const scale = Math.min(468 / width, 162 / height);
	const project = function (p: Point) {
		return { x: 240 + (p.x - left - width / 2) * scale, y: 90 + (p.y - top - height / 2) * scale };
	};
	const pin = function (point: Point, letter: string) {
		const p = project(point);
		return svg`<g transform="translate(${p.x} ${p.y})"><circle r="9" fill="#14282a" stroke="#c8d6c8"/><text text-anchor="middle" y="4" fill="#e5ecd8" font-family="monospace" font-size="12">${letter}</text></g>`;
	};
	render(svg`<svg viewBox="0 0 480 180" preserveAspectRatio="xMidYMid meet" role="img" aria-label=${staging ? 'Field survey showing the drop, relay, pickup and two enemy approaches' : 'Field survey showing the drop, recorder, pickup and both crossings'}>
		${terrain.obstacles.map(function (o) {
			const corner = project({ x: o.x - o.width / 2, y: o.y - o.depth / 2 });
			return svg`<rect x=${corner.x} y=${corner.y} width=${o.width * scale} height=${o.depth * scale}
				fill=${o.kind === 'shed' ? '#778282' : '#1b1416'} stroke=${o.kind === 'shed' ? '#b7c7bb' : '#b06e53'}/>`;
		})}
		${terrain.roads.map(function (road, index) {
			const points = road.map(project).map(function (p) { return `${p.x},${p.y}`; }).join(' ');
			return svg`<polyline points=${points} fill="none" stroke=${index === 0 ? '#ecb267' : staging && index > 1 ? '#df8069' : '#79d1d4'}
				stroke-width="2.5" stroke-linejoin="round" stroke-dasharray=${index === 0 ? 'none' : '6 4'}/>`;
		})}
		${pin(map.drop, 'D')}${pin(map.objective, 'R')}${pin(map.extraction, 'P')}
		${staging ? [pin(staging[0], 'A'), pin(staging[1], 'B')] : ''}
	</svg>`, host);
};
