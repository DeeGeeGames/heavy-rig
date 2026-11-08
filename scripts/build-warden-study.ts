import { join } from 'node:path';

// A self-contained review artifact: opens from disk and embeds in a review
// without a running server, CDNs, imported modules, or generated-video assets.
const root = join(import.meta.dir, '..');
const result = await Bun.build({ entrypoints: [join(root, 'src/warden-study.ts')], target: 'browser', format: 'iife', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Warden motion study build failed');
const bundle = result.outputs[0];
if (!bundle) throw new Error('Warden motion study bundle is missing');
const template = await Bun.file(join(root, 'warden-preview.html')).text();
const script = (await bundle.text()).replaceAll('</script', '<\\/script');
const html = template.replace('<script type="module" src="./src/warden-study.ts"></script>', function () { return `<script>${script}</script>`; });
await Bun.write(join(root, 'dist/warden-study.html'), html);
console.log('Built standalone Warden study in dist/warden-study.html');
