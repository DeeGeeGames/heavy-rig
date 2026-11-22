import { authoredKestrelUrl, loadPlayableMechFamily, playableMechUrl } from './authored-mech';
import { loadMechSkinPatterns } from './mech-skin-material';

// Install accepted visual assets before presentation creates synchronous models.
// Each load has an independent deadline and retains the procedural fallback.
const [families, releasePatterns] = await Promise.all([Promise.all([
	loadPlayableMechFamily('warden', playableMechUrl('warden')),
	loadPlayableMechFamily('kestrel', authoredKestrelUrl()),
	loadPlayableMechFamily('maul', playableMechUrl('maul')),
]), loadMechSkinPatterns()]);
const factories = families.flat();
const uninstall = factories.map(function (factory) { return factory.install(); });
let disposed = false;
const dispose = function () {
	if (disposed) return;
	disposed = true; window.removeEventListener('pagehide', onPageHide);
	for (const remove of uninstall) remove();
	for (const factory of factories) factory.dispose();
	releasePatterns();
};
const onPageHide = function (event: PageTransitionEvent) { if (!event.persisted) dispose(); };
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(dispose);
try { await import('./main'); }
catch (error: unknown) { dispose(); throw error; }
