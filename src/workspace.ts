import { html, render, type TemplateResult } from 'lit-html';

export interface WorkspacePane {
	id: string;
	label: string;
	items: readonly TemplateResult[];
	actions?: TemplateResult;
	secondary?: boolean;
}
export interface WorkspaceView {
	id: string;
	label: string;
	panes: readonly string[];
	select?: () => void;
}
interface WorkspaceState {
	active: string;
	renderedView: string;
	views: readonly WorkspaceView[];
	pages: Map<string, number>;
	groups: Map<string, readonly (readonly HTMLElement[])[]>;
	focus: Map<string, { node: HTMLElement; index: number }>;
}
const states = new Map<HTMLElement, WorkspaceState>();
const visible = function (item: HTMLElement) { return !item.closest('[hidden], [inert]') && item.getClientRects().length > 0; };
export const workspaceControls = function (root: HTMLElement) {
	return [...root.querySelectorAll<HTMLElement>('.workspace-body button:not(:disabled), .workspace-body a[href], .workspace-body input:not(:disabled), .workspace-body select:not(:disabled), .bridge-footer button:not(:disabled), .bridge-footer a[href]')].filter(visible);
};
export const textItems = function (text: string): TemplateResult[] {
	const words = text.split(/\s+/).filter(Boolean);
	const chunks: string[] = [];
	for (const word of words) {
		const last = chunks.at(-1);
		if (last && last.length + word.length < 145) chunks[chunks.length - 1] = `${last} ${word}`;
		else chunks.push(word);
	}
	return chunks.map(function (chunk) { return html`<p class="workspace-copy">${chunk}</p>`; });
};
const stateFor = function (root: HTMLElement): WorkspaceState {
	const existing = states.get(root);
	if (existing) return existing;
	const state: WorkspaceState = { active: '', renderedView: '', views: [], pages: new Map(), groups: new Map(), focus: new Map() };
	states.set(root, state);
	return state;
};
export const rememberWorkspaceFocus = function (root: HTMLElement) {
	const node = document.activeElement;
	if (!(node instanceof HTMLElement)) return;
	const index = workspaceControls(root).indexOf(node);
	if (index >= 0) stateFor(root).focus.set(stateFor(root).renderedView, { node, index });
};
export const focusWorkspace = function (root: HTMLElement) {
	const state = stateFor(root);
	const remembered = state.focus.get(state.active);
	const controls = workspaceControls(root);
	const target = remembered && controls.includes(remembered.node) ? remembered.node : controls[Math.min(remembered?.index ?? 0, controls.length - 1)];
	(target ?? root.querySelector<HTMLElement>('.workspace-pane:not([hidden]) .paged-content') ?? root).focus({ preventScroll: true });
};
const changed = function (root: HTMLElement) { root.dispatchEvent(new CustomEvent('workspacechange', { bubbles: true })); };
const setPage = function (root: HTMLElement, pane: HTMLElement, page: number, focusContent = false) {
	const state = stateFor(root); const id = pane.dataset['pane'] ?? '';
	const groups = state.groups.get(id) ?? [];
	const index = Math.max(0, Math.min(page, groups.length - 1));
	state.pages.set(id, index);
	const items = groups[index] ?? [];
	const focused = document.activeElement;
	const losesFocus = focused instanceof HTMLElement && pane.querySelector('.paged-content')?.contains(focused) && !items.some(function (item) { return item.contains(focused); });
	for (const item of pane.querySelectorAll<HTMLElement>('.page-item')) { item.hidden = !items.includes(item); item.inert = item.hidden; }
	const previous = pane.querySelector<HTMLButtonElement>('[data-page-previous]');
	const next = pane.querySelector<HTMLButtonElement>('[data-page-next]');
	const count = pane.querySelector<HTMLElement>('[data-page-count]');
	if (previous) previous.disabled = index <= 0;
	if (next) next.disabled = index >= groups.length - 1;
	if (count) count.textContent = `${index + 1} OF ${Math.max(1, groups.length)}`;
	if (focusContent || losesFocus) {
		const target = items.flatMap(function (item) { return [...item.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input')]; })[0]
			?? pane.querySelector<HTMLElement>('.pane-actions button:not(:disabled), .page-controls button:not(:disabled), .paged-content');
		target?.focus({ preventScroll: true });
	} else if (focused instanceof HTMLButtonElement && focused.disabled && pane.contains(focused)) {
		(previous && !previous.disabled ? previous : next && !next.disabled ? next : pane.querySelector<HTMLElement>('.paged-content'))?.focus({ preventScroll: true });
	}
};
export const refreshWorkspace = function (root: HTMLElement, preserveFocus = true) {
	if (root.hidden || !root.clientHeight) return;
	const state = stateFor(root); const view = state.views.find(function (entry) { return entry.id === state.active; });
	if (!view) return;
	root.dataset['view'] = view.id;
	root.classList.toggle('paired-workspace', view.panes.length > 1);
	for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-pane-target]')) tab.setAttribute('aria-pressed', String(tab.dataset['paneTarget'] === view.id));
	const panes = [...root.querySelectorAll<HTMLElement>('.workspace-pane')];
	for (const pane of panes) { pane.hidden = !view.panes.includes(pane.dataset['pane'] ?? ''); pane.inert = pane.hidden; }
	for (const pane of panes) {
		if (pane.hidden) continue;
		const content = pane.querySelector<HTMLElement>('.paged-content'); if (!content) continue;
		const items = [...content.children].filter(function (item): item is HTMLElement { return item instanceof HTMLElement; });
		for (const item of items) { item.hidden = false; item.inert = false; }
		const gap = Number.parseFloat(getComputedStyle(content).rowGap) || 0;
		const available = content.clientHeight;
		content.style.setProperty('--page-height', `${available}px`);
		const groups: HTMLElement[][] = []; let used = 0;
		for (const item of items) {
			const height = item.getBoundingClientRect().height;
			if (!groups.length || used + gap + height > available + .5) { groups.push([]); used = 0; }
			groups.at(-1)?.push(item); used += height + (used ? gap : 0);
		}
		const id = pane.dataset['pane'] ?? ''; state.groups.set(id, groups);
		const focused = document.activeElement;
		const focusedPage = preserveFocus && focused instanceof HTMLElement ? groups.findIndex(function (group) { return group.some(function (item) { return item.contains(focused); }); }) : -1;
		setPage(root, pane, focusedPage >= 0 ? focusedPage : state.pages.get(id) ?? 0);
	}
};
export const selectWorkspacePane = function (root: HTMLElement, id: string, resetPage = false) {
	const state = stateFor(root);
	const current = state.views.find(function (view) { return view.id === state.active; });
	const view = state.views.find(function (entry) { return entry.id === id; }) ?? (current?.panes.includes(id) ? current : state.views.find(function (entry) { return entry.panes.includes(id); }));
	if (!view) return;
	rememberWorkspaceFocus(root); const switched = state.active !== view.id; state.active = view.id;
	if (resetPage) state.pages.set(id, 0);
	if (switched) view.select?.();
	refreshWorkspace(root, false); state.renderedView = state.active;
	if (switched) focusWorkspace(root);
	changed(root);
};
export const cycleWorkspaceView = function (root: HTMLElement, delta: number) {
	if (root.dataset['picker'] === 'true') return;
	const state = stateFor(root); const index = state.views.findIndex(function (view) { return view.id === state.active; });
	const view = state.views[(index + delta + state.views.length) % state.views.length];
	if (view) { selectWorkspacePane(root, view.id); focusWorkspace(root); }
};
export const revealWorkspaceElement = function (target: HTMLElement) {
	const root = target.closest<HTMLElement>('.workspace'); const pane = target.closest<HTMLElement>('.workspace-pane');
	if (!root || !pane) return;
	const state = stateFor(root); const id = pane.dataset['pane'] ?? '';
	if (!state.views.find(function (view) { return view.id === state.active; })?.panes.includes(id)) selectWorkspacePane(root, id);
	const groups = state.groups.get(id) ?? [];
	const page = groups.findIndex(function (group) { return group.some(function (item) { return item.contains(target); }); });
	if (page >= 0) setPage(root, pane, page);
};
export const moveWorkspaceFocus = function (root: HTMLElement, direction: 'up' | 'down' | 'left' | 'right') {
	const items = workspaceControls(root); const focused = document.activeElement;
	const index = items.findIndex(function (item) { return item === focused; });
	if (index < 0 || !(focused instanceof HTMLElement)) { focusWorkspace(root); return; }
	const box = focused.getBoundingClientRect(); const horizontal = direction === 'left' || direction === 'right';
	const sign = direction === 'left' || direction === 'up' ? -1 : 1;
	const candidates = items.filter(function (item) { return item !== focused; }).map(function (item) {
		const rect = item.getBoundingClientRect();
		const dx = (rect.left + rect.right - box.left - box.right) / 2; const dy = (rect.top + rect.bottom - box.top - box.bottom) / 2;
		const forward = horizontal ? dx : dy; const perpendicular = Math.abs(horizontal ? dy : dx);
		return { item, forward: forward * sign, distance: Math.abs(forward) + perpendicular * 3 };
	}).filter(function (entry) { return entry.forward > 3; }).sort(function (a, b) { return a.distance - b.distance; });
	const target = candidates[0]?.item ?? items[Math.max(0, Math.min(items.length - 1, index + sign))];
	target?.focus({ preventScroll: true }); rememberWorkspaceFocus(root); changed(root);
};
export const renderWorkspace = function (root: HTMLElement, header: TemplateResult, panes: readonly WorkspacePane[], footer: TemplateResult, initial: string, views: readonly WorkspaceView[] = panes.map(function (pane) { return { id: pane.id, label: pane.label, panes: [pane.id] }; }), hero?: TemplateResult) {
	const state = stateFor(root); rememberWorkspaceFocus(root); state.views = views;
	if (!views.some(function (view) { return view.id === state.active; })) state.active = initial;
	root.classList.add('workspace'); root.classList.toggle('has-hangar', Boolean(hero));
	const locked = root.dataset['picker'] === 'true';
	render(html`${header}
		<nav class="workspace-tabs" aria-label="Department pages">
			<button class="nav-step" data-view-step="-1" ?disabled=${locked} aria-label="Previous department page" @click=${function () { cycleWorkspaceView(root, -1); }}><span data-menu-glyph="previousPage"></span></button>
			${views.map(function (view) { return html`<button data-pane-target=${view.id} aria-pressed=${state.active === view.id} ?disabled=${locked} @click=${function () { selectWorkspacePane(root, view.id); }}>${view.label}</button>`; })}
			<button class="nav-step" data-view-step="1" ?disabled=${locked} aria-label="Next department page" @click=${function () { cycleWorkspaceView(root, 1); }}><span data-menu-glyph="nextPage"></span></button>
		</nav>
		<div class="command-heading"><div><span class="eyebrow">WAYFARER / COMPANY OPERATIONS</span><h2>${root.id === 'mechbay' ? 'Ready your rig.' : root.id === 'starmap' ? 'Chart your next jump.' : root.id === 'bridge' ? 'Your next sortie.' : root.id === 'market' ? 'Stock the company.' : 'Keep the company running.'}</h2></div><span class="command-location" data-view-label></span></div>
		<div class="workspace-body">${hero ? html`<aside class="hangar-inspection">${hero}</aside>` : ''}${panes.map(function (pane) { return html`
			<section class="workspace-pane" data-pane=${pane.id} aria-label=${pane.label}>
				<h2 class="pane-heading">${pane.label}</h2>
				<div class="paged-content" tabindex="-1">${pane.items.map(function (item) { return html`<div class="page-item">${item}</div>`; })}</div>
				<nav class="page-controls" aria-label="${pane.label} content pages"><button data-page-previous aria-label="Previous ${pane.label} content page" @click=${function () { const element = root.querySelector<HTMLElement>(`[data-pane="${pane.id}"]`); if (element) { setPage(root, element, (state.pages.get(pane.id) ?? 0) - 1); changed(root); } }}>← PREV</button><span data-page-count role="status"></span><button data-page-next aria-label="Next ${pane.label} content page" @click=${function () { const element = root.querySelector<HTMLElement>(`[data-pane="${pane.id}"]`); if (element) { setPage(root, element, (state.pages.get(pane.id) ?? 0) + 1); changed(root); } }}>NEXT →</button></nav>
				${pane.actions ? html`<div class="pane-actions">${pane.actions}</div>` : ''}
			</section>`; })}</div>${footer}`, root);
	state.renderedView = state.active; refreshWorkspace(root); changed(root);
};
export const mountWorkspaceLayout = function (container: HTMLElement, signal: AbortSignal) {
	const update = function () { for (const root of states.keys()) refreshWorkspace(root); };
	const observer = new ResizeObserver(update); observer.observe(container);
	for (const root of container.querySelectorAll('.bridge-screen')) observer.observe(root);
	const focus = function (event: FocusEvent) {
		if (!(event.target instanceof HTMLElement)) return;
		const root = event.target.closest<HTMLElement>('.workspace');
		if (root && event.target.closest('.workspace-pane')) { revealWorkspaceElement(event.target); rememberWorkspaceFocus(root); }
	};
	container.addEventListener('focusin', focus, { signal });
	signal.addEventListener('abort', function () { observer.disconnect(); states.clear(); }, { once: true });
	void document.fonts.ready.then(function () { if (!signal.aborted) update(); });
	return update;
};
