import { MIN_COMBAT_ZOOM, MAX_COMBAT_ZOOM } from './shared/camera-zoom';

type ZoomCamera = { getZoom: () => number; setZoom: (value: number) => void };
const zoomSpan = MAX_COMBAT_ZOOM - MIN_COMBAT_ZOOM;
const minFullRangeDragPixels = 112;

export const mountTouchZoom = function (button: HTMLElement, panel: HTMLElement, readout: HTMLElement, track: HTMLElement, portrait: MediaQueryList, signal: AbortSignal, enabled: () => boolean, camera: ZoomCamera) {
	let gesture: { pointerId: number; start: number; zoom: number; travel: number } | undefined;
	const position = function (event: PointerEvent) { return portrait.matches ? -event.clientY : event.clientX; };
	const showZoom = function (zoom: number) {
		readout.textContent = `${zoom.toFixed(2).replace(/0$/, '')}×`;
		track.style.setProperty('--zoom-position', `${(zoom - MIN_COMBAT_ZOOM) / zoomSpan * 100}%`);
	};
	const reset = function () {
		const previous = gesture;
		gesture = undefined;
		panel.hidden = true;
		if (previous && button.hasPointerCapture(previous.pointerId)) button.releasePointerCapture(previous.pointerId);
	};
	button.addEventListener('pointerdown', function (event) {
		if (!enabled() || event.button !== 0 || gesture) return;
		event.preventDefault();
		panel.hidden = false;
		const trackLength = portrait.matches ? track.offsetHeight : track.offsetWidth;
		gesture = { pointerId: event.pointerId, start: position(event), zoom: camera.getZoom(), travel: Math.max(minFullRangeDragPixels, trackLength) };
		button.setPointerCapture(event.pointerId);
		showZoom(gesture.zoom);
	}, { signal });
	button.addEventListener('pointermove', function (event) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		if (!enabled()) { reset(); return; }
		// Relative movement keeps pressing from jumping to an absolute slider value.
		camera.setZoom(gesture.zoom + (position(event) - gesture.start) / gesture.travel * zoomSpan);
		showZoom(camera.getZoom());
	}, { signal });
	for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
		button.addEventListener(name, function (event) { if (event.pointerId === gesture?.pointerId) reset(); }, { signal });
	}
	portrait.addEventListener('change', reset, { signal });
	signal.addEventListener('abort', reset, { once: true });
	return { reset };
};
