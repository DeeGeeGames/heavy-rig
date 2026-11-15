import { authoredWardenUrl, loadAuthoredWarden } from './authored-mech';

// Optional bootstrap: install the visual asset and its combat origins before the
// existing synchronous game creates any presentation models.
const assetUrl = authoredWardenUrl();
const factory = await loadAuthoredWarden(assetUrl);
const uninstall = factory.install();
let disposed = false;
const dispose = function () {
	if (disposed) return;
	disposed = true; window.removeEventListener('pagehide', onPageHide); uninstall(); factory.dispose();
};
const onPageHide = function (event: PageTransitionEvent) { if (!event.persisted) dispose(); };
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(dispose);
try { await import('./main'); }
catch (error: unknown) { dispose(); throw error; }
