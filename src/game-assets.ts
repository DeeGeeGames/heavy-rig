import { loadPlayableMechFamily, playableMechUrl, previewAssetOverride } from './authored-mech';
import { loadMechSkinPatterns } from './mech-skin-material';

// Install accepted visual assets before presentation creates synchronous models.
// Each load has an independent deadline and retains the procedural fallback.
// Each candidate replaces A on its own chassis. B/C use the body their cartridges were authored against.
const frames = ['warden', 'kestrel', 'maul'] as const;
const requested = document.documentElement.dataset['authoredFrame'];
const previewFrame = requested === 'warden' || requested === 'kestrel' || requested === 'maul' ? requested
	: location.pathname.endsWith('/maul-preview.html') ? 'maul' : 'kestrel';
const override = previewAssetOverride();
const hasCandidate = override !== undefined && override !== playableMechUrl(previewFrame);
const [families, candidate, releasePatterns] = await Promise.all([
	Promise.all(frames.map(function (chassis) { return loadPlayableMechFamily(chassis, playableMechUrl(chassis)); })),
	hasCandidate ? loadPlayableMechFamily(previewFrame, override, null) : [],
	loadMechSkinPatterns(document.getElementById('mech-faction-patterns')?.textContent || undefined),
]);
const factories = families.flat().filter(function (factory) {
	if (candidate.length > 0 && factory.frame === previewFrame) { factory.dispose(); return false; }
	return true;
}).concat(candidate);
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
