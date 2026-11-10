import { html, svg } from 'lit-html';
import { contours } from 'd3-contour';
import { FACTIONS, getFaction, type Campaign } from './campaign';
import type { FactionId, PlanetId } from './campaign-types';
import { FACTION_CENTERS, PLANETS, getPlanet, getSystemIntel, randomSource, territoryScores, type TerritoryContext } from './universe';

const WIDTH = 1000; const HEIGHT = 660; const COLUMNS = 180; const ROWS = 120;
let cached: { seed: number; day: number; influence: TerritoryContext['universe']['influence']; paths: ReadonlyMap<FactionId, string> } | undefined;
const territoryPaths = function (context: TerritoryContext): ReadonlyMap<FactionId, string> {
	if (cached?.seed === context.seed && cached.day === context.day && cached.influence === context.universe.influence) return cached.paths;
	const samples = Array.from({ length: COLUMNS * ROWS }, function (_, index) { return territoryScores(context, (index % COLUMNS + .5) / COLUMNS * 100, (Math.floor(index / COLUMNS) + .5) / ROWS * 100); });
	const contour = contours().size([COLUMNS, ROWS]);
	const paths = new Map(FACTIONS.map(function (faction) {
		const values = samples.map(function (sample) { return sample[faction.id] - Math.max(0, ...FACTIONS.filter(function (other) { return other.id !== faction.id; }).map(function (other) { return sample[other.id]; })); });
		const shape = contour.contour(values, 0);
		const path = shape.coordinates.flatMap(function (polygon) { return polygon.map(function (ring) { return ring.map(function (point, index) { return `${index ? 'L' : 'M'}${((point[0] ?? 0) / COLUMNS * WIDTH).toFixed(1)},${((point[1] ?? 0) / ROWS * HEIGHT).toFixed(1)}`; }).join('') + 'Z'; }); }).join('');
		return [faction.id, path] as const;
	}));
	cached = { seed: context.seed, day: context.day, influence: context.universe.influence, paths };
	return paths;
};
const stars = function () {
	const random = randomSource(0x53544152);
	return Array.from({ length: 540 }, function () { return { x: random() * WIDTH, y: random() * HEIGHT, radius: .3 + random() * 1.05, opacity: .2 + random() * .55 }; });
}();
interface ChartView { zoom: number; x: number; y: number; drag: { id: number; x: number; y: number } | undefined }
const views = new WeakMap<HTMLElement, ChartView>();
const viewFor = function (root: HTMLElement) {
	const existing = views.get(root); if (existing) return existing;
	const view: ChartView = { zoom: 1, x: 0, y: 0, drag: undefined }; views.set(root, view); return view;
};
const updateTransform = function (root: HTMLElement) {
	const view = viewFor(root); const stage = root.querySelector<HTMLElement>('.territory-stage');
	const viewport = root.querySelector<HTMLElement>('.territory-viewport');
	const limitX = Math.max(0, ((stage?.clientWidth ?? 0) * view.zoom - (viewport?.clientWidth ?? 0)) / 2);
	const limitY = Math.max(0, ((stage?.clientHeight ?? 0) * view.zoom - (viewport?.clientHeight ?? 0)) / 2);
	view.x = Math.max(-limitX, Math.min(limitX, view.x)); view.y = Math.max(-limitY, Math.min(limitY, view.y));
	if (stage) stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
	const reset = root.querySelector<HTMLElement>('[data-chart-reset]'); if (reset) reset.dataset['zoom'] = String(Math.round(view.zoom * 100));
};
export const focusTerritoryMap = function (root: HTMLElement, planetId: PlanetId) {
	const stage = root.querySelector<HTMLElement>('.territory-stage');
	if (!stage) return;
	const planet = getPlanet(planetId); const view = viewFor(root);
	view.zoom = 3;
	view.x = (.5 - planet.x / 100) * stage.clientWidth * view.zoom;
	view.y = (.5 - planet.y / 100) * stage.clientHeight * view.zoom;
	view.drag = undefined;
	updateTransform(root);
};
export const renderTerritoryMap = function (root: HTMLElement, campaign: Campaign, destination: PlanetId, select: (id: PlanetId) => void) {
	const paths = territoryPaths(campaign); const selected = getPlanet(destination); const current = getPlanet(campaign.planetId);
	const view = viewFor(root);
	const zoom = function (delta: number) { view.zoom = Math.max(1, Math.min(3, view.zoom + delta)); updateTransform(root); };
	return html`<div class="territory-chart">
		<div class="chart-caption"><span>THE WAYFARER REACH</span><small>LIVE FRONT / DAY ${String(campaign.day).padStart(3, '0')}</small></div>
		<div class="territory-viewport"
			@pointerdown=${function (event: PointerEvent) { if (event.target instanceof Element && event.target.closest('button')) return; const target = event.currentTarget; if (!(target instanceof HTMLElement)) return; view.drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; target.setPointerCapture(event.pointerId); }}
			@pointermove=${function (event: PointerEvent) { if (view.drag?.id !== event.pointerId) return; view.x += event.clientX - view.drag.x; view.y += event.clientY - view.drag.y; view.drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; updateTransform(root); }}
			@pointerup=${function () { view.drag = undefined; }} @pointercancel=${function () { view.drag = undefined; }}
			@wheel=${function (event: WheelEvent) { event.preventDefault(); zoom(event.deltaY < 0 ? .2 : -.2); }}>
			<div class="territory-stage" @focusin=${function (event: FocusEvent) {
					if (!(event.target instanceof HTMLElement) || !event.target.matches('.system-marker')) return;
					const viewport = root.querySelector<HTMLElement>('.territory-viewport'); if (!viewport) return;
					const bounds = viewport.getBoundingClientRect(); const marker = event.target.getBoundingClientRect();
					const margin = 20;
					view.x += marker.left < bounds.left + margin ? bounds.left + margin - marker.left : marker.right > bounds.right - margin ? bounds.right - margin - marker.right : 0;
					view.y += marker.top < bounds.top + margin ? bounds.top + margin - marker.top : marker.bottom > bounds.bottom - margin ? bounds.bottom - margin - marker.bottom : 0;
					updateTransform(root);
				}} style="transform:translate(${view.x}px,${view.y}px) scale(${view.zoom})">
				<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="territory-field" aria-hidden="true">
					<defs><pattern id="chart-grid" width="100" height="66" patternUnits="userSpaceOnUse"><path d="M100 0H0V66" fill="none" stroke="#b4d4dd" stroke-opacity=".07"/></pattern></defs>
					<rect width="1000" height="660" fill="url(#chart-grid)"/>
					${FACTIONS.map(function (faction) { return svg`<path class="territory-glow" d=${paths.get(faction.id) ?? ''} style="--territory-color:${faction.color}"/><path class="territory-border" d=${paths.get(faction.id) ?? ''} style="--territory-color:${faction.color}"/>`; })}
					${stars.map(function (star) { return svg`<circle cx=${star.x} cy=${star.y} r=${star.radius} fill="#c1dce3" opacity=${star.opacity}/>`; })}
					<path class="plotted-course" d="M${current.x * 10},${current.y * 6.6} L${selected.x * 10},${selected.y * 6.6}"/>
				</svg>
				${FACTIONS.map(function (faction) { const center = FACTION_CENTERS[faction.id]; return html`<span class="territory-name" style="left:${center.x}%;top:${center.y}%;color:${faction.color}">${faction.name}</span>`; })}
				<span class="unclaimed-label">UNCLAIMED SPACE</span>
				${PLANETS.map(function (world) {
					const intel = getSystemIntel(campaign, world.id); const faction = intel.owner ? getFaction(intel.owner) : undefined;
					const label = world.id === destination || world.id === campaign.planetId || !world.id.startsWith('system-');
					return html`<button class="system-marker ${intel.conflict ? 'conflict-system' : ''} ${world.id === campaign.planetId ? 'current-system' : ''}" style="left:${world.x}%;top:${world.y}%;--system-color:${faction?.color ?? '#7c96a0'}" data-system=${world.id} aria-label="${world.name} · ${faction?.name ?? 'Unclaimed'} · ${intel.conflict ? 'Conflict zone' : 'No conflict'}" aria-pressed=${world.id === destination} ?disabled=${Boolean(campaign.active)} title="${world.name} · ${intel.conflict ? 'CONFLICT ZONE' : faction?.shortName ?? 'UNCLAIMED'}" @click=${function () { select(world.id); }}><i></i>${label ? html`<span>${world.name}${world.id === campaign.planetId ? html`<small>WAYFARER</small>` : ''}</span>` : ''}</button>`;
				})}
			</div>
		</div>
		<div class="chart-tools"><button aria-label="Zoom out" @click=${function () { zoom(-.5); }}>−</button><button data-chart-reset data-zoom=${Math.round(view.zoom * 100)} @click=${function () { view.zoom = 1; view.x = 0; view.y = 0; updateTransform(root); }}>RESET</button><button aria-label="Zoom in" @click=${function () { zoom(.5); }}>+</button><span>SCROLL TO ZOOM · DRAG TO PAN</span></div>
		<div class="chart-legend">${FACTIONS.map(function (faction) { return html`<span style="--legend-color:${faction.color}"><i></i>${faction.shortName}</span>`; })}<span style="--legend-color:#718792"><i></i>UNCLAIMED</span><span class="conflict-key">◌ CONFLICT</span></div>
	</div>`;
};
