export const MIN_COMBAT_ZOOM = 0.35;
export const MAX_COMBAT_ZOOM = 2.5;
export const clampCombatZoom = function (value: number): number {
	return Math.max(MIN_COMBAT_ZOOM, Math.min(MAX_COMBAT_ZOOM, value));
};

export const zoomForWheel = function (zoom: number, event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, pageHeight: number): number {
	const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
	return clampCombatZoom(zoom * Math.exp(-event.deltaY * unit * 0.0015));
};
