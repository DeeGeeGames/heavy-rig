import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });

const result = await Bun.build({
	entrypoints: [join(root, 'index.html'), join(root, 'warden-preview.html'), join(root, 'models-preview.html'), join(root, 'warden-stress.html')],
	outdir: dist,
	target: 'browser',
	minify: true,
	conditions: ['browser', 'production'],
	define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) throw new AggregateError(result.logs, 'Heavy Rig build failed');

for await (const path of new Bun.Glob('**/*').scan({ cwd: join(root, 'public'), onlyFiles: true })) {
	const file = Bun.file(join(root, 'public', path));
	if (path.endsWith('.glb') && (await file.slice(0, 80).text()).startsWith('version https://git-lfs.github.com/spec/v1\n')) {
		throw new Error(`Unresolved Git LFS asset: public/${path}; run git lfs pull --include='public/assets/mechs/**' --exclude=''`);
	}
	await Bun.write(join(dist, path), file);
}
for (const path of ['CNAME', '.nojekyll']) {
	await Bun.write(join(dist, path), Bun.file(join(root, path)));
}
console.log('Built Heavy Rig in dist/');
await import('./build-warden-study');
await import('./build-models-study');
