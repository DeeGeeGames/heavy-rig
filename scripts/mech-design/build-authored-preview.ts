import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const assetArgument = process.argv[2]; const outputArgument = process.argv[3];
if (!assetArgument || !outputArgument) throw new Error('Usage: bun scripts/mech-design/build-authored-preview.ts asset.glb new-generated-output');
const asset = resolve(root, assetArgument); const output = resolve(root, outputArgument);
const relativeOutput = relative(join(root, 'design/mechs/generated'), output);
if (!relativeOutput || relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) throw new Error('Preview output must be a new directory inside design/mechs/generated');
await mkdir(output);
const bytes = await Bun.file(asset).arrayBuffer();
const assetUrl = `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`;
const bundle = async function (path: string) {
	const result = await Bun.build({ entrypoints: [join(root, path)], target: 'browser', format: 'esm', minify: true, conditions: ['browser', 'production'], define: { 'process.env.NODE_ENV': '"production"' } });
	if (!result.success) throw new AggregateError(result.logs, 'Authored preview build failed');
	const script = result.outputs.find(function (item) { return item.kind === 'entry-point'; });
	if (!script || result.outputs.length !== 1) throw new Error('Expected a single standalone authored preview bundle');
	return (await script.text()).replaceAll('</script', '<\\/script');
};
const injectAsset = function (html: string) { return html.replace('<html lang="en">', `<html lang="en" data-authored-asset="${assetUrl}">`); };
const studyScript = await bundle('src/authored-mech-study.ts');
const study = injectAsset((await Bun.file(join(root, 'authored-mech-study.html')).text()).replace('<script type="module" src="./src/authored-mech-study.ts"></script>', function () { return `<script type="module">${studyScript}</script>`; }));
await Bun.write(join(output, 'study.html'), study);
let game = await Bun.file(join(root, 'index.html')).text();
for (const match of game.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)">/g)) {
	const path = match[1]; if (!path) throw new Error('Missing stylesheet path');
	let css = await Bun.file(join(root, path)).text();
	for (const resource of css.matchAll(/url\((['"]?)(\.\.\/assets\/[^'")]+)\1\)/g)) {
		const url = resource[2]; if (!url) throw new Error('Missing stylesheet asset path');
		const file = Bun.file(resolve(dirname(join(root, path)), url));
		const encoded = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
		css = css.replace(resource[0], function () { return `url("${encoded}")`; });
	}
	game = game.replace(match[0], function () { return `<style>${css}</style>`; });
}
game = game.replace('src="./public/brand/heavy-rig.png"', `src="data:image/png;base64,${Buffer.from(await Bun.file(join(root, 'public/brand/heavy-rig.png')).arrayBuffer()).toString('base64')}"`);
const gameScript = await bundle('src/authored-game.ts');
game = injectAsset(game.replace('<script type="module" src="./src/main.ts"></script>', function () { return `<script type="module">${gameScript}</script>`; }));
await Bun.write(join(output, 'game.html'), game);
for await (const path of new Bun.Glob('**/*').scan({ cwd: join(root, 'public'), onlyFiles: true })) await Bun.write(join(output, path), Bun.file(join(root, 'public', path)));
const provenance = { asset: relative(root, asset), sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), bytes: bytes.byteLength, study: 'study.html', game: 'game.html', mode: 'Production bundles with embedded authored GLB; ordinary index and default game are unchanged.' };
await Bun.write(join(output, 'preview-manifest.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify({ output, ...provenance }, null, 2));
