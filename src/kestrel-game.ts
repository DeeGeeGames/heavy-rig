import { authoredKestrelUrl, loadAuthoredKestrel } from './authored-mech';

// Install the approved visual asset and combat origins before the synchronous
// game creates presentation models. A failed asset must not prevent play.
const assetUrl = authoredKestrelUrl();
let timedOut = false;
const loading = loadAuthoredKestrel(assetUrl).then(function (loaded) {
	if (timedOut) { loaded.dispose(); return undefined; }
	return loaded;
}).catch(function (error: unknown) {
	console.warn('Kestrel asset unavailable; using the procedural model.', error);
	return undefined;
});
let deadline: ReturnType<typeof setTimeout> | undefined;
const fallback = new Promise<undefined>(function (resolve) {
	deadline = setTimeout(function () {
		timedOut = true;
		console.warn('Kestrel loading timed out; using the procedural model.');
		resolve(undefined);
	}, 5000);
});
const factory = await Promise.race([loading, fallback]);
if (deadline !== undefined) clearTimeout(deadline);
const uninstall = factory?.install();
let disposed = false;
const dispose = function () {
	if (disposed) return;
	disposed = true; window.removeEventListener('pagehide', onPageHide); uninstall?.(); factory?.dispose();
};
const onPageHide = function (event: PageTransitionEvent) { if (!event.persisted) dispose(); };
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(dispose);
try { await import('./main'); }
catch (error: unknown) { dispose(); throw error; }
