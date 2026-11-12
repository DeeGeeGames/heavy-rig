import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });

const result = await Bun.build({
	entrypoints: [join(root, 'index.html'), join(root, 'warden-preview.html'), join(root, 'models-preview.html'), join(root, 'prototype-preview.html')],
	outdir: dist,
	target: 'browser',
	minify: true,
	conditions: ['browser', 'production'],
	define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) throw new AggregateError(result.logs, 'Heavy Rig build failed');

for await (const path of new Bun.Glob('**/*').scan({ cwd: join(root, 'public'), onlyFiles: true })) {
	await Bun.write(join(dist, path), Bun.file(join(root, 'public', path)));
}
for (const path of ['CNAME', '.nojekyll']) {
	await Bun.write(join(dist, path), Bun.file(join(root, path)));
}
console.log('Built Heavy Rig in dist/');
await import('./build-warden-study');
await import('./build-models-study');
await import('./build-prototype-study');
