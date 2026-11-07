import { join } from 'node:path';

const dist = join(import.meta.dir, '..', 'dist');
const files = new Map<string, ReturnType<typeof Bun.file>>();
for await (const path of new Bun.Glob('**/*').scan({ cwd: dist, onlyFiles: true, dot: true })) {
	files.set(`/${path}`, Bun.file(join(dist, path)));
}
if (!files.has('/index.html')) throw new Error('Missing production build. Run bun run build first.');

const port = Number(Bun.env['PORT'] ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const server = Bun.serve({
	port,
	fetch(request) {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
		}
		const pathname = new URL(request.url).pathname;
		const file = files.get(pathname === '/' ? '/index.html' : pathname);
		return file
			? new Response(request.method === 'HEAD' ? null : file, { headers: { 'Content-Type': file.type, 'Cache-Control': 'no-store' } })
			: new Response('Not found', { status: 404 });
	},
});
console.log(`Serving production build at ${server.url}`);
