import { html, render, type TemplateResult } from 'lit-html';
import { directionalControl, focusMenuControl, menuControls, moveMenuFocus, type MenuDirection } from './menu-focus';

export interface WorkspacePane {
	id: string;
	label: string;
	items: readonly TemplateResult[];
	actions?: TemplateResult;
	secondary?: boolean;
	scrollable?: boolean;
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
	detail?: { view: string; pane: HTMLElement; opener: HTMLElement };
}
const states = new Map<HTMLElement, WorkspaceState>();
const openPopover = function (root: HTMLElement) { return root.querySelector<HTMLElement>('.planet-popover:popover-open'); };
export const workspaceNavigationLocked = function (root: HTMLElement) {
	return root.dataset['picker'] === 'true' || Boolean(openPopover(root));
};
export const workspaceControls = function (root: HTMLElement) {
	return menuControls(openPopover(root) ?? root);
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
	if (!(node instanceof HTMLElement) || node.closest('.workspace-tabs, .ship-navigation, .planet-popover')) return;
	const index = workspaceControls(root).indexOf(node);
	if (index >= 0) stateFor(root).focus.set(stateFor(root).renderedView, { node, index });
};
export const focusWorkspace = function (root: HTMLElement) {
	const state = stateFor(root);
	const remembered = state.focus.get(state.active);
	const controls = workspaceControls(root);
	const previous = remembered && (controls.includes(remembered.node) ? remembered.node : controls[Math.min(remembered.index, controls.length - 1)]);
	const target = previous
		?? controls.find(function (item) { return item.matches('.system-marker[aria-pressed="true"], .equipment-choice[aria-pressed="true"]'); })
		?? controls.find(function (item) { return item.closest('.workspace-pane'); })
		?? controls.find(function (item) { return item.matches('[data-pane-target][aria-pressed="true"]'); })
		?? controls.find(function (item) { return item.matches('.ship-navigation .choice-field'); })
		?? controls[0];
	focusMenuControl(target ?? root);
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
		const target = items.flatMap(menuControls)[0]
			?? (focused instanceof HTMLElement && pane.contains(focused) && !focused.matches(':disabled') && focused.closest('.page-controls') ? focused : undefined)
			?? pane.querySelector<HTMLElement>('.pane-actions button:not(:disabled), .page-controls button:not(:disabled)');
		if (target) focusMenuControl(target);
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
		if (pane.hidden || pane.dataset['scrollable'] === 'true') continue;
		const content = pane.querySelector<HTMLElement>('.paged-content'); if (!content) continue;
		const items = [...content.children].filter(function (item): item is HTMLElement { return item instanceof HTMLElement; });
		for (const item of items) { item.hidden = false; item.inert = false; }
		const gap = Number.parseFloat(getComputedStyle(content).rowGap) || 0;
		const pager = pane.querySelector<HTMLElement>('.page-controls');
		if (pager) pager.hidden = true;
		const splitPages = function () {
			const available = content.clientHeight;
			content.style.setProperty('--page-height', `${available}px`);
			const groups: HTMLElement[][] = [];
			let used = 0;
			for (const item of items) {
				const height = item.getBoundingClientRect().height;
				if (!groups.length || used + gap + height > available + .5) { groups.push([]); used = 0; }
				groups.at(-1)?.push(item); used += height + (used ? gap : 0);
			}
			return groups;
		};
		let groups = splitPages();
		if (pager && groups.length > 1) {
			pager.hidden = false;
			groups = splitPages();
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
	delete state.detail;
	rememberWorkspaceFocus(root); const switched = state.active !== view.id; state.active = view.id;
	if (resetPage) state.pages.set(id, 0);
	if (switched) view.select?.();
	refreshWorkspace(root, false); state.renderedView = state.active;
	if (switched) focusWorkspace(root);
	changed(root);
};
export const inspectWorkspacePane = function (root: HTMLElement, id: string, opener: EventTarget | null) {
	const state = stateFor(root);
	const view = state.active;
	selectWorkspacePane(root, id, true);
	const pane = root.querySelector<HTMLElement>(`.workspace-pane[data-pane="${id}"]:not([hidden])`);
	if (!pane) return;
	if (opener instanceof HTMLElement && root.contains(opener)) state.detail = { view, pane, opener };
	const target = pane.querySelector<HTMLElement>('.pane-actions .primary:not(:disabled)')
		?? pane.querySelector<HTMLElement>('.pane-actions button:not(:disabled)')
		?? pane.querySelector<HTMLElement>('.page-controls button:not(:disabled)')
		?? pane.querySelector<HTMLElement>('.paged-content');
	if (target) focusMenuControl(target);
	changed(root);
};
export const workspaceBackTarget = function (root: HTMLElement) {
	const detail = stateFor(root).detail;
	if (!detail || detail.pane.hidden || !root.contains(detail.pane)) return undefined;
	return function () {
		selectWorkspacePane(root, detail.view);
		if (root.contains(detail.opener) && !detail.opener.matches(':disabled')) {
			revealWorkspaceElement(detail.opener);
			focusMenuControl(detail.opener);
		} else focusWorkspace(root);
	};
};
export const cycleWorkspaceView = function (root: HTMLElement, delta: number) {
	if (workspaceNavigationLocked(root)) return;
	const state = stateFor(root); const index = state.views.findIndex(function (view) { return view.id === state.active; });
	const view = state.views[(index + delta + state.views.length) % state.views.length];
	if (view) { selectWorkspacePane(root, view.id); focusWorkspace(root); }
};
export const revealWorkspaceElement = function (target: HTMLElement) {
	const root = target.closest<HTMLElement>('.workspace'); const pane = target.closest<HTMLElement>('.workspace-pane');
	if (!root || !pane) return;
	const state = stateFor(root); const id = pane.dataset['pane'] ?? '';
	if (!state.views.find(function (view) { return view.id === state.active; })?.panes.includes(id)) selectWorkspacePane(root, id);
	const popover = target.closest<HTMLElement>('[popover]');
	if (popover && !popover.matches(':popover-open')) popover.showPopover();
	if (pane.dataset['scrollable'] === 'true') {
		const content = target.closest<HTMLElement>('.paged-content');
		if (content) {
			const viewport = content.getBoundingClientRect();
			const group = target.closest('.page-item')?.getBoundingClientRect();
			const item = group && group.height <= viewport.height ? group : target.getBoundingClientRect();
			if (item.top < viewport.top) content.scrollTop -= viewport.top - item.top;
			else if (item.bottom > viewport.bottom) content.scrollTop += item.bottom - viewport.bottom;
		}
		return;
	}
	const groups = state.groups.get(id) ?? [];
	const page = groups.findIndex(function (group) { return group.some(function (item) { return item.contains(target); }); });
	if (page >= 0 && page !== state.pages.get(id)) setPage(root, pane, page);
};
const centerInViewport = function (item: HTMLElement, viewport: Element) {
	const bounds = viewport.getBoundingClientRect();
	const rect = item.getBoundingClientRect();
	const x = (rect.left + rect.right) / 2;
	const y = (rect.top + rect.bottom) / 2;
	return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
};
export const moveWorkspaceFocus = function (root: HTMLElement, direction: MenuDirection) {
	const items = workspaceControls(root);
	const focused = document.activeElement;
	if (!(focused instanceof HTMLElement) || !items.includes(focused)) { focusWorkspace(root); return; }
	const chart = root.querySelector<HTMLElement>('.territory-viewport');
	if (chart?.contains(focused)) {
		// Moving across the zoomed chart pans the next system into view.
		const marker = directionalControl(items.filter(function (item) { return chart.contains(item); }), focused, direction);
		if (marker) { focusMenuControl(marker); return; }
	}
	moveMenuFocus(root, direction, chart ? items.filter(function (item) { return !chart.contains(item) || centerInViewport(item, chart); }) : items);
};
export const renderWorkspace = function (root: HTMLElement, header: TemplateResult, panes: readonly WorkspacePane[], footer: TemplateResult, initial: string, views: readonly WorkspaceView[] = panes.map(function (pane) { return { id: pane.id, label: pane.label, panes: [pane.id] }; }), hero?: TemplateResult) {
	const state = stateFor(root); rememberWorkspaceFocus(root); state.views = views;
	if (!views.some(function (view) { return view.id === state.active; })) state.active = initial;
	root.classList.add('workspace'); root.classList.toggle('has-hangar', Boolean(hero));
	const locked = root.dataset['picker'] === 'true';
	render(html`${header}
		${views.length > 1 ? html`<nav class="workspace-tabs" aria-label="Department pages">
			<button class="nav-step" data-view-step="-1" ?disabled=${locked} aria-label="Previous department page" @click=${function () { cycleWorkspaceView(root, -1); }}><span data-menu-glyph="previousPage"></span></button>
			${views.map(function (view) { return html`<button data-pane-target=${view.id} aria-pressed=${state.active === view.id} ?disabled=${locked} @click=${function () { selectWorkspacePane(root, view.id); }}>${view.label}</button>`; })}
			<button class="nav-step" data-view-step="1" ?disabled=${locked} aria-label="Next department page" @click=${function () { cycleWorkspaceView(root, 1); }}><span data-menu-glyph="nextPage"></span></button>
		</nav>` : ''}
		<div class="workspace-body">${hero ? html`<aside class="hangar-inspection">${hero}</aside>` : ''}${panes.map(function (pane) { return html`
			<section class="workspace-pane" data-pane=${pane.id} data-scrollable=${String(Boolean(pane.scrollable))} aria-label=${pane.label}>
				<h2 class="pane-heading">${pane.label}</h2>
				<div class="paged-content" tabindex="-1">${pane.items.map(function (item) { return html`<div class="page-item">${item}</div>`; })}</div>
				${pane.scrollable ? '' : html`<nav class="page-controls" aria-label="${pane.label} content pages"><button data-page-previous aria-label="Previous ${pane.label} content page" @click=${function () { const element = root.querySelector<HTMLElement>(`[data-pane="${pane.id}"]`); if (element) { setPage(root, element, (state.pages.get(pane.id) ?? 0) - 1, true); changed(root); } }}>← PREV</button><span data-page-count role="status"></span><button data-page-next aria-label="Next ${pane.label} content page" @click=${function () { const element = root.querySelector<HTMLElement>(`[data-pane="${pane.id}"]`); if (element) { setPage(root, element, (state.pages.get(pane.id) ?? 0) + 1, true); changed(root); } }}>NEXT →</button></nav>`}
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
		if (!root) return;
		const state = stateFor(root);
		const pane = event.target.closest('.workspace-pane');
		if (state.detail && pane && pane !== state.detail.pane) delete state.detail;
		revealWorkspaceElement(event.target);
		rememberWorkspaceFocus(root);
	};
	const inspectMount = function (event: Event) {
		const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-loadout-slot], [data-ammunition-slot]') : null;
		const bay = row?.closest<HTMLElement>('#mechbay');
		const slot = row?.dataset['loadoutSlot'] ?? row?.dataset['ammunitionSlot'];
		if (!bay || slot === undefined) return;
		if (event instanceof PointerEvent) {
			if (event.pointerType !== 'mouse') return;
			if (row instanceof HTMLButtonElement && !row.disabled && row !== document.activeElement) row.focus({ preventScroll: true });
		}
		bay.dataset['inspectionSlot'] = slot;
	};
	container.addEventListener('focusin', inspectMount, { signal });
	container.addEventListener('pointermove', inspectMount, { signal });
	container.addEventListener('focusin', focus, { signal });
	signal.addEventListener('abort', function () { observer.disconnect(); states.clear(); }, { once: true });
	void document.fonts.ready.then(function () { if (!signal.aborted) update(); });
	return update;
};
