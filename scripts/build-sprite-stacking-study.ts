import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const assets = join(root, 'design/studies/warden-sprite-stacking');
const source: unknown = await Bun.file(join(assets, 'manifest.json')).json();
const embedSheets = async function (value: unknown): Promise<unknown> {
	if (Array.isArray(value)) return Promise.all(value.map(embedSheets));
	if (typeof value !== 'object' || value === null) return value;
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === 'image' && typeof child === 'string') {
			if (!/^[a-z0-9-]+\.png$/.test(child)) throw new Error('Unexpected sprite sheet filename');
			const bytes = await Bun.file(join(assets, child)).arrayBuffer();
			const expected: unknown = Object.entries(value).find(function ([name]) { return name === 'sha256'; })?.[1];
			const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
			if (typeof expected !== 'string' || actual !== expected) throw new Error(`Sprite sheet hash mismatch: ${child}`);
			result[key] = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
		} else result[key] = await embedSheets(child);
	}
	return result;
};
const result = await Bun.build({ entrypoints: [join(root, 'src/sprite-stack-study.ts')], target: 'browser', format: 'iife', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Sprite stacking proof build failed');
const bundle = result.outputs[0];
if (!bundle) throw new Error('Sprite stacking proof bundle is missing');
const template = await Bun.file(join(root, 'sprite-stacking-preview.html')).text();
const script = (await bundle.text()).replaceAll('</script', '<\\/script');
const manifest = JSON.stringify(await embedSheets(source)).replaceAll('<', '\\u003c');
const html = template.replace('__SPRITE_STACK_DATA__', function () { return manifest; })
	.replace('<script type="module" src="./src/sprite-stack-study.ts"></script>', function () { return `<script>${script}</script>`; });
const output = process.argv[2] ?? join(root, 'dist/sprite-stacking-study.html');
await Bun.write(output, html);
console.log(`Built self-contained Canvas2D sprite proof: ${output} (${Bun.file(output).size} bytes)`);
