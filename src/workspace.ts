import { html, render, type TemplateResult } from 'lit-html';

export interface WorkspacePane {
	id: string;
	label: string;
	items: readonly TemplateResult[];
	actions?: TemplateResult;
	secondary?: boolean;
}
interface WorkspaceState {
	active: string;
	pages: Map<string, number>;
	groups: Map<string, readonly (readonly HTMLElement[])[]>;
}
const states = new Map<HTMLElement, WorkspaceState>();

export const textItems = function (text: string): TemplateResult[] {
	const words = text.split(/\s+/).filter(Boolean);
	const chunks: string[] = [];
	for (const word of words) {
		const last = chunks.at(-1);
		if (last && last.length + word.length < 155) chunks[chunks.length - 1] = `${last} ${word}`;
		else chunks.push(word);
	}
	return chunks.map(function (chunk) { return html`<p class="workspace-copy">${chunk}</p>`; });
};

const stateFor = function (root: HTMLElement): WorkspaceState {
	const existing = states.get(root);
	if (existing) return existing;
	const state: WorkspaceState = { active: '', pages: new Map(), groups: new Map() };
	states.set(root, state);
	return state;
};
const setPage = function (root: HTMLElement, pane: HTMLElement, page: number, focusContent = false) {
	const state = stateFor(root);
	const id = pane.dataset['pane'] ?? '';
	const groups = state.groups.get(id) ?? [];
	const index = Math.max(0, Math.min(page, groups.length - 1));
	state.pages.set(id, index);
	const visible = groups[index] ?? [];
	const focused = document.activeElement;
	const losesFocus = focused instanceof HTMLElement && pane.querySelector('.paged-content')?.contains(focused) && !visible.some(function (item) { return item.contains(focused); });
	for (const item of pane.querySelectorAll<HTMLElement>('.page-item')) {
		item.hidden = !visible.includes(item);
		item.inert = item.hidden;
	}
	const previous = pane.querySelector<HTMLButtonElement>('[data-page-previous]');
	const next = pane.querySelector<HTMLButtonElement>('[data-page-next]');
	const count = pane.querySelector<HTMLElement>('[data-page-count]');
	if (previous) previous.disabled = index <= 0;
	if (next) next.disabled = index >= groups.length - 1;
	if (count) count.textContent = `${index + 1} / ${Math.max(1, groups.length)}`;
	if (focusContent || losesFocus) {
		const target = visible.flatMap(function (item) { return [...item.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input')]; })[0]
			?? pane.querySelector<HTMLElement>('.page-controls button:not(:disabled), .pane-actions button:not(:disabled)')
			?? root.querySelector<HTMLElement>(`[data-pane-target="${id}"]`);
		(target ?? pane.querySelector<HTMLElement>('.paged-content'))?.focus({ preventScroll: true });
	}
	else if (focused instanceof HTMLButtonElement && focused.disabled && pane.contains(focused)) {
		(previous && !previous.disabled ? previous : next && !next.disabled ? next : pane.querySelector<HTMLElement>('.paged-content'))?.focus({ preventScroll: true });
	}
};

export const refreshWorkspace = function (root: HTMLElement, preserveFocus = true) {
	if (root.hidden || !root.clientHeight) return;
	const state = stateFor(root);
	const panes = [...root.querySelectorAll<HTMLElement>('.workspace-pane')];
	const focused = document.activeElement;
	const focusedPane = focused instanceof HTMLElement && root.contains(focused) ? focused.closest<HTMLElement>('.workspace-pane') : null;
	const compact = root.clientWidth < 1100 || root.clientHeight < 600 || root.classList.contains('single-workspace');
	if (preserveFocus && compact && focusedPane && !focusedPane.hidden) state.active = focusedPane.dataset['pane'] ?? state.active;
	root.classList.toggle('compact-workspace', compact);
	const selected = panes.find(function (pane) { return pane.dataset['pane'] === state.active; });
	const secondary = selected?.dataset['secondary'] === 'true';
	for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-pane-target]')) tab.setAttribute('aria-pressed', String(tab.dataset['paneTarget'] === state.active));
	for (const pane of panes) {
		pane.hidden = compact || secondary ? pane !== selected : pane.dataset['secondary'] === 'true';
		pane.inert = pane.hidden;
	}
	for (const pane of panes) {
		if (pane.hidden) continue;
		const content = pane.querySelector<HTMLElement>('.paged-content');
		if (!content) continue;
		const items = [...content.children].filter(function (child): child is HTMLElement { return child instanceof HTMLElement; });
		for (const item of items) { item.hidden = false; item.inert = false; }
		const gap = Number.parseFloat(getComputedStyle(content).rowGap) || 0;
		const available = content.clientHeight;
		content.style.setProperty('--page-height', `${available}px`);
		const groups: HTMLElement[][] = [];
		let used = 0;
		for (const item of items) {
			const height = item.getBoundingClientRect().height;
			if (!groups.length || used + gap + height > available + .5) { groups.push([]); used = 0; }
			groups.at(-1)?.push(item);
			used += height + (used ? gap : 0);
		}
		const id = pane.dataset['pane'] ?? '';
		state.groups.set(id, groups);
		const focusedPage = preserveFocus && focused instanceof HTMLElement ? groups.findIndex(function (group) { return group.some(function (item) { return item.contains(focused); }); }) : -1;
		setPage(root, pane, focusedPage >= 0 ? focusedPage : state.pages.get(id) ?? 0);
	}
};

export const selectWorkspacePane = function (root: HTMLElement, id: string, resetPage = false) {
	const focused = document.activeElement;
	const previousPane = focused instanceof HTMLElement && root.contains(focused) ? focused.closest<HTMLElement>('.workspace-pane') : null;
	stateFor(root).active = id;
	if (resetPage) stateFor(root).pages.set(id, 0);
	refreshWorkspace(root, false);
	if (previousPane && previousPane.dataset['pane'] !== id && root.classList.contains('compact-workspace')) {
		const pane = root.querySelector<HTMLElement>(`[data-pane="${id}"]`);
		if (pane) setPage(root, pane, stateFor(root).pages.get(id) ?? 0, true);
	}
};
export const revealWorkspaceElement = function (target: HTMLElement) {
	const root = target.closest<HTMLElement>('.workspace');
	const pane = target.closest<HTMLElement>('.workspace-pane');
	if (!root || !pane) return;
	selectWorkspacePane(root, pane.dataset['pane'] ?? '');
	const groups = stateFor(root).groups.get(pane.dataset['pane'] ?? '') ?? [];
	const page = groups.findIndex(function (group) { return group.some(function (item) { return item.contains(target); }); });
	if (page >= 0) setPage(root, pane, page);
};

export const renderWorkspace = function (root: HTMLElement, header: TemplateResult, panes: readonly WorkspacePane[], footer: TemplateResult, initial: string) {
	const state = stateFor(root);
	if (!panes.some(function (pane) { return pane.id === state.active; })) state.active = initial;
	root.classList.add('workspace');
	root.style.setProperty('--workspace-columns', String(panes.filter(function (pane) { return !pane.secondary; }).length));
	render(html`${header}
		<nav class="workspace-tabs" aria-label="${root.getAttribute('aria-label') ?? 'Department'} views">${panes.map(function (pane) { return html`<button data-pane-target=${pane.id} aria-pressed=${state.active === pane.id} @click=${function () { selectWorkspacePane(root, pane.id); }}>${pane.label}</button>`; })}</nav>
		<div class="workspace-body">${panes.map(function (pane) { return html`
			<section class="workspace-pane" data-pane=${pane.id} data-secondary=${String(Boolean(pane.secondary))} aria-label=${pane.label}>
				<h2 class="pane-heading">${pane.label}</h2>
				<div class="paged-content" tabindex="-1">${pane.items.map(function (item) { return html`<div class="page-item">${item}</div>`; })}</div>
				<nav class="page-controls" aria-label="${pane.label} pages"><button data-page-previous aria-label="Previous ${pane.label} page" @click=${function () { const element = root.querySelector<HTMLElement>(`[data-pane="${pane.id}"]`); if (element) setPage(root, element, (state.pages.get(pane.id) ?? 0) - 1); }}>← PREV</button><span data-page-count role="status"></span><button data-page-next aria-label="Next ${pane.label} page" @click=${function () { const element = root.querySelector<HTMLElement>(`[data-pane="${pane.id}"]`); if (element) setPage(root, element, (state.pages.get(pane.id) ?? 0) + 1); }}>NEXT →</button></nav>
				${pane.actions ? html`<div class="pane-actions">${pane.actions}</div>` : ''}
			</section>`; })}</div>${footer}`, root);
	refreshWorkspace(root);
};

export const mountWorkspaceLayout = function (container: HTMLElement, signal: AbortSignal) {
	const update = function () { for (const root of states.keys()) refreshWorkspace(root); };
	const observer = new ResizeObserver(update);
	observer.observe(container);
	for (const root of container.querySelectorAll('.bridge-screen')) observer.observe(root);
	const controls = container.querySelector('.menu-controls');
	if (controls) observer.observe(controls);
	const focus = function (event: FocusEvent) {
		if (event.target instanceof HTMLElement && event.target.closest('.workspace-pane')) revealWorkspaceElement(event.target);
	};
	container.addEventListener('focusin', focus, { signal });
	signal.addEventListener('abort', function () { observer.disconnect(); states.clear(); }, { once: true });
	void document.fonts.ready.then(function () { if (!signal.aborted) update(); });
	return update;
};
