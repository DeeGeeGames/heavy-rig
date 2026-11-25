export type MenuDirection = 'up' | 'down' | 'left' | 'right';

type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
interface MenuItem { getBoundingClientRect(): Bounds }

export const availableMenuControl = function (item: HTMLElement) {
	return !item.matches(':disabled') && !item.closest('[hidden], [inert]') && item.getClientRects().length > 0 && getComputedStyle(item).visibility === 'visible';
};
export const menuControls = function (root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]')].filter(availableMenuControl);
};

export const directionalControl = function <T extends MenuItem>(items: readonly T[], current: T, direction: MenuDirection): T | undefined {
	const from = current.getBoundingClientRect();
	const horizontal = direction === 'left' || direction === 'right';
	const positive = direction === 'right' || direction === 'down';
	const start = horizontal ? 'left' : 'top';
	const end = horizontal ? 'right' : 'bottom';
	const near = horizontal ? 'top' : 'left';
	const far = horizontal ? 'bottom' : 'right';
	let best: T | undefined;
	let bestScore = Infinity;
	for (const item of items) {
		if (item === current) continue;
		const rect = item.getBoundingClientRect();
		const forward = (rect[start] + rect[end] - from[start] - from[end]) * (positive ? .5 : -.5);
		if (forward <= 1) continue;
		const alongGap = positive ? rect[start] - from[end] : from[start] - rect[end];
		const acrossGap = Math.max(0, from[near] - rect[far], rect[near] - from[far]);
		const across = Math.abs(rect[near] + rect[far] - from[near] - from[far]) / 2;
		// A wider button in the row below is not a horizontal neighbor. Markers
		// can overlap on both axes, so use their dominant direction in that case.
		if (alongGap < -1 && (acrossGap > 0 || across >= forward)) continue;
		if (acrossGap > forward) continue;
		const score = Math.max(0, alongGap) + acrossGap * 4 + across * .35 + forward * .05;
		if (score < bestScore) { best = item; bestScore = score; }
	}
	return best;
};

const scrollsVertically = function (node: HTMLElement) {
	if (!node.clientHeight || node.scrollHeight <= node.clientHeight + 1 || node.closest('[hidden], [inert]')) return false;
	const style = getComputedStyle(node);
	return style.visibility === 'visible' && (style.overflowY === 'auto' || style.overflowY === 'scroll');
};

const containingScrollArea = function (item: HTMLElement, root: HTMLElement) {
	for (let node: HTMLElement | null = item; node && root.contains(node); node = node.parentElement) {
		if (scrollsVertically(node)) return node;
	}
	return undefined;
};

export const menuScrollArea = function (root: HTMLElement) {
	const focused = document.activeElement;
	if (focused instanceof HTMLElement && root.contains(focused)) {
		const ancestor = containingScrollArea(focused, root);
		if (ancestor) return ancestor;
		const pane = focused.closest('.workspace-pane')?.querySelector<HTMLElement>('.paged-content');
		if (pane && scrollsVertically(pane)) return pane;
	}
	return [root, ...root.querySelectorAll<HTMLElement>('div, section, nav, aside')].find(scrollsVertically);
};

const verticallyVisible = function (target: HTMLElement, viewport: DOMRect) {
	const rect = target.getBoundingClientRect();
	const shown = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top);
	return shown >= Math.min(rect.height, viewport.height) - 1;
};

export const scrollMenu = function (root: HTMLElement, speed: number, dt: number) {
	const area = menuScrollArea(root);
	if (!area) return;
	const previous = area.scrollTop;
	area.scrollTop += speed * Math.max(350, area.clientHeight * 1.8) * dt;
	const current = document.activeElement;
	if (previous === area.scrollTop || !(current instanceof HTMLElement) || !area.contains(current)) return;
	const viewport = area.getBoundingClientRect();
	if (verticallyVisible(current, viewport)) return;
	const visible = menuControls(area).filter(function (item) { return verticallyVisible(item, viewport); });
	const neighbor = directionalControl(visible, current, speed > 0 ? 'down' : 'up');
	neighbor?.focus({ preventScroll: true });
};

export const selectMenuControl = function (root: HTMLElement, current: HTMLElement) {
	if (!root.contains(current) || !current.matches('button:enabled, a[href], input:enabled') || !availableMenuControl(current)) return false;
	const area = containingScrollArea(current, root);
	if (area && !verticallyVisible(current, area.getBoundingClientRect())) focusMenuControl(current);
	else current.click();
	return true;
};

export const focusMenuControl = function (target: HTMLElement) {
	target.focus({ preventScroll: true });
	// Only reveal within scrolling panels. Scrolling the clipped game shell
	// also moves the footer and leaves the focus ring outside the viewport.
	for (let node = target.parentElement; node; node = node.parentElement) {
		if (!scrollsVertically(node)) continue;
		const viewport = node.getBoundingClientRect();
		const rect = target.getBoundingClientRect();
		if (rect.top < viewport.top + 3) node.scrollTop += rect.top - viewport.top - 3;
		else if (rect.bottom > viewport.bottom - 3) node.scrollTop += rect.bottom - viewport.bottom + 3;
	}
};

export const moveMenuFocus = function (root: HTMLElement, direction: MenuDirection, items: readonly HTMLElement[] = menuControls(root)) {
	const current = document.activeElement;
	if (!(current instanceof HTMLElement) || !items.includes(current)) {
		const first = items[0];
		if (first) focusMenuControl(first);
		return;
	}
	const row = current.closest<HTMLElement>('[data-menu-row]');
	if (row && (direction === 'left' || direction === 'right')) {
		const neighbor = directionalControl(items.filter(function (item) { return row.contains(item); }), current, direction);
		if (neighbor) focusMenuControl(neighbor);
		return;
	}
	const scroller = containingScrollArea(current, root);
	const inner = scroller && (direction === 'up' || direction === 'down')
		? directionalControl(items.filter(function (item) { return scroller.contains(item); }), current, direction)
		: undefined;
	const target = inner ?? directionalControl(items.filter(function (item) {
		const area = containingScrollArea(item, root);
		if (!area || area === scroller) return true;
		const viewport = area.getBoundingClientRect();
		const rect = item.getBoundingClientRect();
		return rect.bottom > viewport.top && rect.top < viewport.bottom;
	}), current, direction);
	if (target) focusMenuControl(target);
};
