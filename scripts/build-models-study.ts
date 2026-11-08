import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const result = await Bun.build({ entrypoints: [join(root, 'src/models-study.ts')], target: 'browser', format: 'iife', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Model motion study build failed');
const bundle = result.outputs[0];
if (!bundle) throw new Error('Model motion study bundle is missing');
const template = await Bun.file(join(root, 'models-preview.html')).text();
const script = (await bundle.text()).replaceAll('</script', '<\\/script');
const html = template.replace('<script type="module" src="./src/models-study.ts"></script>', function () { return `<script>${script}</script>`; });
await Bun.write(join(root, 'dist/models-study.html'), html);
console.log('Built standalone model study in dist/models-study.html');
