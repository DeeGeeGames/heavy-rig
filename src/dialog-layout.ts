interface DialogState {
	root: HTMLElement;
	body: HTMLElement;
	topics: readonly HTMLElement[];
	previous: HTMLButtonElement;
	next: HTMLButtonElement;
	counter: HTMLElement;
	selected: string;
	page: number;
}

const topicName = function (topic: HTMLElement) { return topic.dataset['dialogTopic'] ?? ''; };
const isVisible = function (element: HTMLElement) { return !element.hidden && element.getBoundingClientRect().height > 0; };

// A long narrative keeps its original node (and ID) for the game's updates.
// Only its measured presentation is split, so changing report text stays safe.
const splitText = function (source: HTMLElement, height: number): readonly HTMLElement[] {
	const words = (source.textContent ?? '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [source];
	const fragments: HTMLElement[] = [];
	let start = 0;
	let previous = source;
	source.classList.add('dialog-source-split');
	source.inert = true;
	while (start < words.length) {
		const fragment = source.cloneNode(false);
		if (!(fragment instanceof HTMLElement)) break;
		fragment.removeAttribute('id');
		fragment.removeAttribute('data-dialog-text');
		fragment.classList.remove('dialog-source-split');
		fragment.classList.add('dialog-fragment');
		fragment.inert = false;
		previous.after(fragment);
		let low = 1;
		let high = words.length - start;
		let count = 1;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			fragment.textContent = words.slice(start, start + middle).join(' ');
			if (fragment.getBoundingClientRect().height <= height) { count = middle; low = middle + 1; }
			else high = middle - 1;
		}
		fragment.textContent = words.slice(start, start + count).join(' ');
		fragments.push(fragment);
		previous = fragment;
		start += count;
	}
	return fragments;
};

const paginate = function (state: DialogState, keepFocus = false, focusTarget?: HTMLElement) {
	for (const button of state.root.querySelectorAll<HTMLButtonElement>('[data-dialog-tab]')) {
		button.setAttribute('aria-pressed', String(button.dataset['dialogTab'] === state.selected));
	}
	for (const topic of state.topics) {
		topic.hidden = topicName(topic) !== state.selected;
		topic.inert = topic.hidden;
	}
	const topic = state.topics.find(function (candidate) { return topicName(candidate) === state.selected; });
	if (!topic) return;
	for (const fragment of topic.querySelectorAll('.dialog-fragment')) fragment.remove();
	const sources = [...topic.children].filter(function (item): item is HTMLElement { return item instanceof HTMLElement; });
	for (const source of sources) {
		source.classList.remove('dialog-item-offpage', 'dialog-source-split');
		source.inert = false;
	}
	const height = state.body.clientHeight;
	if (height <= 0) return;
	const items = sources.filter(isVisible).flatMap(function (source) {
		return source.hasAttribute('data-dialog-text') && source.getBoundingClientRect().height > height
			? splitText(source, height)
			: [source];
	});
	const gap = Number.parseFloat(getComputedStyle(topic).rowGap) || 0;
	const pages: HTMLElement[][] = [];
	let page: HTMLElement[] = [];
	let used = 0;
	for (const item of items) {
		const itemHeight = item.getBoundingClientRect().height;
		if (page.length > 0 && used + gap + itemHeight > height + .5) { pages.push(page); page = []; used = 0; }
		used += (page.length > 0 ? gap : 0) + itemHeight;
		page.push(item);
	}
	if (page.length > 0) pages.push(page);
	const focused = focusTarget ?? document.activeElement;
	const focusedPage = keepFocus && focused instanceof HTMLElement ? pages.findIndex(function (candidate) { return candidate.some(function (item) { return item.contains(focused); }); }) : -1;
	state.page = Math.max(0, Math.min(focusedPage >= 0 ? focusedPage : state.page, pages.length - 1));
	for (const [index, candidate] of pages.entries()) {
		for (const item of candidate) {
			item.classList.toggle('dialog-item-offpage', index !== state.page);
			item.inert = index !== state.page;
		}
	}
	state.counter.textContent = `${state.page + 1} / ${Math.max(1, pages.length)}`;
	state.previous.disabled = state.page === 0;
	state.next.disabled = state.page >= pages.length - 1;
	state.previous.parentElement?.classList.toggle('dialog-single-page', pages.length <= 1);
};

export const mountDialogLayout = function (container: HTMLElement, signal: AbortSignal): (focusTarget?: HTMLElement) => void {
	const states: DialogState[] = [];
	const pagers: HTMLElement[] = [];
	let frame = 0;
	let current: HTMLElement | undefined;
	const update = function (focusTarget?: HTMLElement) {
		const controls = container.querySelector<HTMLElement>('.menu-controls');
		const bottom = controls && isVisible(controls) ? container.getBoundingClientRect().bottom - controls.getBoundingClientRect().top + 10 : 18;
		container.style.setProperty('--dialog-bottom-gap', `${bottom}px`);
		const state = states.find(function (candidate) { return !candidate.root.hidden; });
		if (!state) { current = undefined; return; }
		if (current !== state.root) { state.selected = topicName(state.topics[0] ?? state.root); state.page = 0; current = state.root; }
		const targetTopic = focusTarget?.closest<HTMLElement>('[data-dialog-topic]');
		if (targetTopic && state.root.contains(targetTopic)) state.selected = topicName(targetTopic);
		paginate(state, true, focusTarget);
	};
	const schedule = function () {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(function () { update(); });
	};
	for (const root of container.querySelectorAll<HTMLElement>('.modal')) {
		const body = root.querySelector<HTMLElement>('.dialog-body');
		const actions = root.querySelector<HTMLElement>('.dialog-actions');
		if (!body || !actions) continue;
		const topics = [...body.querySelectorAll<HTMLElement>('[data-dialog-topic]')];
		const pager = document.createElement('nav'); pager.className = 'dialog-pager'; pager.setAttribute('aria-label', 'Content pages');
		pagers.push(pager);
		const previous = document.createElement('button'); previous.textContent = '← PREVIOUS'; previous.type = 'button';
		const next = document.createElement('button'); next.textContent = 'NEXT →'; next.type = 'button';
		const counter = document.createElement('span'); counter.setAttribute('role', 'status');
		pager.append(previous, counter, next); actions.before(pager);
		const state: DialogState = { root, body, topics, previous, next, counter, selected: topicName(topics[0] ?? root), page: 0 };
		states.push(state);
		previous.addEventListener('click', function () { state.page = Math.max(0, state.page - 1); paginate(state); if (previous.disabled) next.focus({ preventScroll: true }); }, { signal });
		next.addEventListener('click', function () { state.page++; paginate(state); if (next.disabled) previous.focus({ preventScroll: true }); }, { signal });
		for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-dialog-tab]')) {
			tab.addEventListener('click', function () { state.selected = tab.dataset['dialogTab'] ?? ''; state.page = 0; paginate(state); }, { signal });
		}
	}
	const resize = new ResizeObserver(schedule);
	resize.observe(container);
	const controls = container.querySelector('.menu-controls');
	if (controls) resize.observe(controls);
	for (const state of states) resize.observe(state.body);
	const appearance = new MutationObserver(schedule);
	appearance.observe(container, { attributes: true, attributeFilter: ['class'] });
	signal.addEventListener('abort', function () {
		cancelAnimationFrame(frame); resize.disconnect(); appearance.disconnect();
		for (const pager of pagers) pager.remove();
		for (const fragment of container.querySelectorAll('.dialog-fragment')) fragment.remove();
		for (const source of container.querySelectorAll<HTMLElement>('.dialog-source-split, .dialog-item-offpage')) {
			source.classList.remove('dialog-source-split', 'dialog-item-offpage'); source.inert = false;
		}
	}, { once: true });
	return function (focusTarget) { update(focusTarget); schedule(); };
};
