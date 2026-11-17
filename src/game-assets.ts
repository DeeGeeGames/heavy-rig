import { authoredKestrelUrl, loadAuthoredKestrel, loadAuthoredMaul, loadAuthoredWarden } from './authored-mech';
import { loadMechSkinPatterns } from './mech-skin-material';

// Install accepted visual assets before presentation creates synchronous models.
// Each load has an independent deadline and retains the procedural fallback.
const loadWithDeadline = async function (label: string, url: string, load: typeof loadAuthoredKestrel) {
	let expired = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const loading = load(url).then(function (factory) {
		if (expired) { factory.dispose(); return undefined; }
		return factory;
	}).catch(function (error: unknown) {
		console.warn(`${label} asset unavailable; using the procedural model.`, error);
		return undefined;
	});
	const fallback = new Promise<undefined>(function (resolve) {
		deadline = setTimeout(function () {
			expired = true;
			console.warn(`${label} loading timed out; using the procedural model.`);
			resolve(undefined);
		}, 5000);
	});
	const factory = await Promise.race([loading, fallback]);
	if (deadline !== undefined) clearTimeout(deadline);
	return factory;
};
const [factories, releasePatterns] = await Promise.all([Promise.all([
	loadWithDeadline('Warden', './assets/mechs/warden/game-ready.glb', loadAuthoredWarden),
	loadWithDeadline('Kestrel', authoredKestrelUrl(), loadAuthoredKestrel),
	loadWithDeadline('Maul', './assets/mechs/maul/game-ready.glb', loadAuthoredMaul),
]), loadMechSkinPatterns()]);
const uninstall = factories.map(function (factory) { return factory?.install(); });
let disposed = false;
const dispose = function () {
	if (disposed) return;
	disposed = true; window.removeEventListener('pagehide', onPageHide);
	for (const remove of uninstall) remove?.();
	for (const factory of factories) factory?.dispose();
	releasePatterns();
};
const onPageHide = function (event: PageTransitionEvent) { if (!event.persisted) dispose(); };
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(dispose);
try { await import('./main'); }
catch (error: unknown) { dispose(); throw error; }
