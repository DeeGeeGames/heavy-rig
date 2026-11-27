import { html, render } from 'lit-html';
import { BIOME_NAMES, type Contract, type MissionMap } from './campaign-types';
import { getPlanet } from './campaign';
import { generateMissionMap } from './missions';
import { missionSiteName } from './mission-site-labels';
import type { Point } from './simulation';
import { groundHeight } from './terrain-elevation';

// A fixed raster keeps the projection on the same pixel grid as the hangar art.
// World coordinates are mission metres. Relief is exaggerated for the survey.
const WIDTH = 320;
const HEIGHT = 238;
const paintSurvey = function (canvas: HTMLCanvasElement, map: MissionMap) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const project = function (at: Point): Point {
		const dx = at.x - map.width / 2;
		const dy = at.y - map.height / 2;
		return {
			x: Math.round(WIDTH / 2 + dx * .041 - dy * .024),
			y: Math.round(HEIGHT * .54 + dx * .011 + dy * .024 - groundHeight(map.terrain, at) * .139),
		};
	};
	const cols = Math.round(map.width / 132);
	const rows = Math.round(map.height / 132);
	const mesh = Array.from({ length: rows + 1 }, function (_, y) {
		return Array.from({ length: cols + 1 }, function (_, x) {
			return project({ x: x * map.width / cols, y: y * map.height / rows });
		});
	});
	ctx.clearRect(0, 0, WIDTH, HEIGHT);
	ctx.lineWidth = .8;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const a = mesh[y]?.[x], b = mesh[y]?.[x + 1], c = mesh[y + 1]?.[x + 1], d = mesh[y + 1]?.[x];
			if (!a || !b || !c || !d) continue;
			const slope = (b.y - a.y) + (d.y - a.y) - 4;
			ctx.fillStyle = slope < -3 ? '#464d69' : slope > 3 ? '#202333' : '#2d3248';
			ctx.strokeStyle = slope > 3 ? '#68718a' : '#acb4d1';
			ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
			ctx.fill(); ctx.stroke();
		}
	}
	ctx.lineWidth = 1.45;
	ctx.strokeStyle = '#edac5d';
	for (const road of map.terrain?.roads ?? []) {
		const first = road[0];
		if (!first) continue;
		const start = project(first);
		ctx.beginPath(); ctx.moveTo(start.x, start.y);
		for (let i = 1; i < road.length; i++) {
			const a = road[i - 1], b = road[i];
			if (!a || !b) continue;
			const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 65);
			for (let step = 1; step <= steps; step++) {
				const t = step / steps;
				const p = project({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
				ctx.lineTo(p.x, p.y);
			}
		}
		ctx.stroke();
	}
	const drop = project(map.drop);
	ctx.fillStyle = '#b5ead6';
	ctx.fillRect(drop.x - 2, drop.y - 2, 5, 5);
	for (const [index, site] of (map.sites.length ? map.sites : [map.objective]).entries()) {
		const p = project(site);
		ctx.fillStyle = '#211a18'; ctx.fillRect(p.x - 1, p.y - 15, 3, 16);
		ctx.fillStyle = '#ffd27c'; ctx.fillRect(p.x, p.y - 14, 1, 15);
		if (missionSiteName(map, index)) {
			ctx.fillRect(p.x - 5, p.y - 20, 11, 11);
			ctx.fillStyle = '#211a18'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
			ctx.fillText(String(index + 1), p.x, p.y - 11);
		} else {
			ctx.fillRect(p.x - 2, p.y - 17, 5, 5);
			ctx.fillStyle = '#fff3ca'; ctx.fillRect(p.x - 1, p.y - 16, 3, 3);
		}
	}
};

const surveyChart = function (contract: Contract) {
	const map = generateMissionMap(contract);
	const canvas = document.createElement('canvas');
	const planet = getPlanet(contract.planetId).name;
	canvas.width = WIDTH; canvas.height = HEIGHT;
	canvas.setAttribute('role', 'img');
	canvas.setAttribute('aria-label', `${planet} terrain and objective locations for ${contract.title}`);
	paintSurvey(canvas, map);
	return { canvas, planet, biome: BIOME_NAMES[map.biome], sites: map.terrain?.compounds ?? [],
		dimensions: `${(map.width / 1000).toFixed(2)} × ${(map.height / 1000).toFixed(2)} km` };
};

export class MissionSurvey extends HTMLElement {
	private readonly charts = new Map<string, ReturnType<typeof surveyChart>>();
	private posting: Contract | undefined;
	private drawn = '';
	private visible = false;
	private frame = 0;
	private readonly visibility = new IntersectionObserver(entries => {
		this.visible = entries.at(-1)?.isIntersecting ?? false;
		this.schedule();
	});

	get contract(): Contract | undefined { return this.posting; }
	set contract(value: Contract) { this.posting = value; this.schedule(); }
	connectedCallback() { this.visibility.observe(this); }
	disconnectedCallback() {
		this.visibility.disconnect();
		this.visible = false;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
	}

	private schedule() {
		if (!this.visible || this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			const contract = this.posting;
			if (!this.visible || !contract) return;
			const key = [contract.id, contract.seed, contract.planetId, contract.kind, contract.tier, contract.fieldLayout].join('/');
			if (key === this.drawn) return;
			let chart = this.charts.get(key);
			if (!chart) {
				chart = surveyChart(contract);
				const oldest = this.charts.keys().next().value;
				if (this.charts.size >= 8 && oldest !== undefined) this.charts.delete(oldest);
				this.charts.set(key, chart);
			}
			render(html`<div class="survey-scene">
				${chart.canvas}
				<header><span>FIELD SURVEY</span><strong>${chart.planet}</strong></header>
				<div class="survey-legend"><span><i></i> DROP</span><span><i></i> OBJECTIVE</span></div>
			</div><div class="survey-scale"><b>${chart.biome}</b><span>${chart.dimensions}</span></div>
			${chart.sites.length ? html`<div class="survey-sites">${chart.sites.map(function (site) {
				return html`<span><b>${site.siteIndex + 1}</b> ${site.name}</span>`;
			})}</div>` : ''}`, this);
			this.drawn = key;
			this.dataset['contract'] = contract.id;
		});
	}
}
if (!customElements.get('mission-survey')) customElements.define('mission-survey', MissionSurvey);
