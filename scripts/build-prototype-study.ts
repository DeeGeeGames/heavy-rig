import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const result = await Bun.build({ entrypoints: [join(root, 'src/mech-prototype-study.ts')], target: 'browser', format: 'iife', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Prototype study build failed');
const bundle = result.outputs[0];
if (!bundle) throw new Error('Missing prototype study bundle');
const template = await Bun.file(join(root, 'prototype-preview.html')).text();
const model = Buffer.from(await Bun.file(join(root, 'public/models/heavy-prototype.glb')).arrayBuffer()).toString('base64');
const candidate = Buffer.from(await Bun.file(join(root, 'public/models/heavy-prototype-reduced.glb')).arrayBuffer()).toString('base64');
const script = (await bundle.text()).replaceAll('</script', '<\\/script');
const html = template.replace('./models/heavy-prototype.glb', `data:model/gltf-binary;base64,${model}`)
	.replace('./models/heavy-prototype-reduced.glb', `data:model/gltf-binary;base64,${candidate}`)
	.replace('<script type="module" src="./src/mech-prototype-study.ts"></script>', function () { return `<script>${script}</script>`; });
await Bun.write(join(root, 'dist/prototype-study.html'), html);
console.log('Built standalone prototype study in dist/prototype-study.html');
