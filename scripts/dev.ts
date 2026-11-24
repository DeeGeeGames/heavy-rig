import { join } from 'node:path';
import game from '../index.html';
import models from '../models-preview.html';
import wardenPreview from '../warden-preview.html';
import wardenStress from '../warden-stress.html';
import wardenStudy from '../authored-mech-study.html';
import kestrelStudy from '../kestrel-study.html';
import maulStudy from '../maul-study.html';

// The HTML bundler handles imports. Runtime requests for models, sound and prompts
// use the same public paths that the production build serves.
const publicRoot = join(import.meta.dir, '..', 'public');
const files: Record<string, Response> = {};
for await (const path of new Bun.Glob('**/*').scan({ cwd: publicRoot, onlyFiles: true })) {
	files[`/${path}`] = new Response(Bun.file(join(publicRoot, path)));
}
const view = Bun.argv[2];
const server = Bun.serve({
	development: { hmr: true, console: true },
	routes: {
		...files,
		'/': view === 'models' ? models : view === 'stress' ? wardenStress : game,
		'/index.html': game,
		'/kestrel-preview.html': game,
		'/maul-preview.html': game,
		'/models-preview.html': models,
		'/warden-preview.html': wardenPreview,
		'/warden-stress.html': wardenStress,
		'/authored-mech-study.html': wardenStudy,
		'/kestrel-study.html': kestrelStudy,
		'/maul-study.html': maulStudy,
	},
});
console.log(`Serving Heavy Rig development preview at ${server.url}`);
