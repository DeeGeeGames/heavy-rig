import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const assets = join(root, 'design/studies/warden-article');
const source: unknown = await Bun.file(join(assets, 'manifest.json')).json();
const embed = async function (value: unknown): Promise<unknown> {
	if (Array.isArray(value)) return Promise.all(value.map(embed));
	if (typeof value !== 'object' || value === null) return value;
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === 'image' && typeof child === 'string') {
			if (!/^(?:(?:inputs|control)\/)?[a-z-]+\.png$/.test(child)) throw new Error('Unexpected article-study image path');
			const bytes = await Bun.file(join(assets, child)).arrayBuffer();
			const expected: unknown = Object.entries(value).find(function ([name]) { return name === 'sha256'; })?.[1];
			if (typeof expected !== 'string' || expected !== new Bun.CryptoHasher('sha256').update(bytes).digest('hex')) throw new Error(`Article-study image hash mismatch: ${child}`);
			result[key] = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
		} else result[key] = await embed(child);
	}
	return result;
};
const build = await Bun.build({ entrypoints: [join(root, 'src/article-stack-study.ts')], target: 'browser', format: 'iife', minify: true });
if (!build.success) throw new AggregateError(build.logs, 'Article reproduction build failed');
const bundle = build.outputs[0];
if (!bundle) throw new Error('Article reproduction bundle is missing');
const script = (await bundle.text()).replaceAll('</script', '<\\/script');
const manifest = JSON.stringify(await embed(source)).replaceAll('<', '\\u003c');
const html = (await Bun.file(join(root, 'article-stacking-preview.html')).text())
	.replace('__ARTICLE_DATA__', function () { return manifest; })
	.replace('<script type="module" src="./src/article-stack-study.ts"></script>', function () { return `<script>${script}</script>`; });
const output = process.argv[2] ?? join(root, 'dist/article-stack-study.html');
await Bun.write(output, html);
console.log(`Built self-contained four-view sprite-stack reproduction: ${output} (${Bun.file(output).size} bytes)`);
