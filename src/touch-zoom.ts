import { MIN_COMBAT_ZOOM, MAX_COMBAT_ZOOM } from './shared/camera-zoom';

type ZoomCamera = { getZoom: () => number; setZoom: (value: number) => void };
const zoomSpan = MAX_COMBAT_ZOOM - MIN_COMBAT_ZOOM;
const fullRangeDrag = 112;

export const mountTouchZoom = function (button: HTMLElement, panel: HTMLElement, readout: HTMLElement, knob: HTMLElement, signal: AbortSignal, enabled: () => boolean, camera: ZoomCamera) {
	let gesture: { pointerId: number; y: number; zoom: number } | undefined;
	const reset = function () {
		const previous = gesture;
		gesture = undefined;
		panel.hidden = true;
		if (previous && button.hasPointerCapture(previous.pointerId)) button.releasePointerCapture(previous.pointerId);
	};
	button.addEventListener('pointerdown', function (event) {
		if (!enabled() || event.button !== 0 || gesture) return;
		event.preventDefault();
		gesture = { pointerId: event.pointerId, y: event.clientY, zoom: camera.getZoom() };
		button.setPointerCapture(event.pointerId);
		readout.textContent = `${gesture.zoom.toFixed(2).replace(/0$/, '')}×`;
		knob.style.top = '50%';
		panel.hidden = false;
	}, { signal });
	button.addEventListener('pointermove', function (event) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		if (!enabled()) { reset(); return; }
		// Relative movement keeps pressing from jumping to an absolute slider value.
		camera.setZoom(gesture.zoom + (gesture.y - event.clientY) / fullRangeDrag * zoomSpan);
		const zoom = camera.getZoom();
		readout.textContent = `${zoom.toFixed(2).replace(/0$/, '')}×`;
		knob.style.top = `${50 - (zoom - gesture.zoom) / zoomSpan * 50}%`;
	}, { signal });
	for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
		button.addEventListener(name, function (event) { if (event.pointerId === gesture?.pointerId) reset(); }, { signal });
	}
	signal.addEventListener('abort', reset, { once: true });
	return { reset };
};
