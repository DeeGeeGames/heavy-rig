export const directionalControl = function (items: readonly HTMLElement[], current: HTMLElement, direction: 'up' | 'down' | 'left' | 'right') {
	const box = current.getBoundingClientRect();
	const horizontal = direction === 'left' || direction === 'right';
	const sign = direction === 'left' || direction === 'up' ? -1 : 1;
	const candidates = items.filter(function (item) { return item !== current; }).map(function (item) {
		const rect = item.getBoundingClientRect();
		const dx = (rect.left + rect.right - box.left - box.right) / 2;
		const dy = (rect.top + rect.bottom - box.top - box.bottom) / 2;
		const forward = horizontal ? dx : dy;
		const perpendicular = Math.abs(horizontal ? dy : dx);
		return { item, forward: forward * sign, distance: Math.abs(forward) + perpendicular * 3 };
	}).filter(function (entry) { return entry.forward > 3; }).sort(function (a, b) { return a.distance - b.distance; });
	return candidates[0]?.item;
};
