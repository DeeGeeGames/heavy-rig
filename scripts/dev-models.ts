import { join } from 'node:path';
import models from '../models-preview.html';
import prototype from '../prototype-preview.html';

const port = Number(Bun.env['PORT'] ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const server = Bun.serve({
	port,
	development: { hmr: true, console: true },
	routes: {
		'/': models,
		'/models-preview.html': models,
		'/prototype-preview.html': prototype,
		'/models/heavy-prototype-reduced.glb': function () {
			return new Response(Bun.file(join(import.meta.dir, '../public/models/heavy-prototype-reduced.glb')), { headers: { 'Content-Type': 'model/gltf-binary' } });
		},
		'/models/heavy-prototype.glb': function () {
			return new Response(Bun.file(join(import.meta.dir, '../public/models/heavy-prototype.glb')), { headers: { 'Content-Type': 'model/gltf-binary' } });
		},
	},
	fetch() { return new Response('Not found', { status: 404 }); },
});
console.log(`Serving model studies at ${server.url}`);
