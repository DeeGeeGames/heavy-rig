const STORAGE_KEY = 'heavy-rig.fullscreen-viewport';

// Recover stale page scale after fullscreen, including across a reload.
// Wait for the scale to settle, then restore the original viewport policy.
export const mountFullscreenViewport = function (signal: AbortSignal) {
	const viewport = document.querySelector('meta[name="viewport"]');
	if (!(viewport instanceof HTMLMetaElement)) return;
	let usedFullscreen = false;
	let pending = false;
	try { pending = sessionStorage.getItem(STORAGE_KEY) === 'pending'; } catch { /* Storage may be unavailable. */ }
	let awaitingPageShow = pending && document.readyState !== 'complete';
	let active = Boolean(document.fullscreenElement);
	let frame = 0;
	let original: string | undefined;
	const remember = function (pending: boolean) {
		try {
			if (pending) sessionStorage.setItem(STORAGE_KEY, 'pending');
			else sessionStorage.removeItem(STORAGE_KEY);
		} catch { /* In-page fullscreen recovery still works without storage. */ }
	};
	const restore = function () {
		if (original !== undefined) viewport.content = original;
		original = undefined;
	};
	const recover = function () {
		if (document.fullscreenElement) return;
		cancelAnimationFrame(frame);
		original ??= viewport.content;
		viewport.content = `${original}, initial-scale=1, minimum-scale=1, maximum-scale=1`;
		window.scrollTo(0, 0);
		// Metadata changes can reach Chrome's visual viewport after multiple frames.
		// Bound the wait so browsers that ignore the constraint retain normal zoom.
		let frames = 0;
		const settle = function () {
			frames++;
			const scaled = window.visualViewport && Math.abs(window.visualViewport.scale - 1) > .01;
			if (frames < 2 || scaled && frames < 60) { frame = requestAnimationFrame(settle); return; }
			restore(); pending = false; remember(false);
		};
		frame = requestAnimationFrame(settle);
	};
	document.addEventListener('fullscreenchange', function () {
		const next = Boolean(document.fullscreenElement);
		if (next) { cancelAnimationFrame(frame); restore(); usedFullscreen = true; remember(true); }
		else if (active) recover();
		active = next;
	}, { signal });
	window.addEventListener('pagehide', function () { if (usedFullscreen) remember(true); }, { signal });
	window.addEventListener('pageshow', function () {
		if (pending || awaitingPageShow || usedFullscreen) recover();
		awaitingPageShow = false;
	}, { signal });
	signal.addEventListener('abort', function () { cancelAnimationFrame(frame); restore(); }, { once: true });
	if (pending) recover();
};
