import { join } from 'node:path';
import type { AuthoredChassis } from '../src/authored-mech';

const root = join(import.meta.dir, '..');
export const embedPreviewAsset = async function (id: string, path: string) {
	const file = Bun.file(join(root, 'public', path));
	const bytes = Buffer.from(await file.arrayBuffer());
	if (path.endsWith('.glb') && bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`Expected a hydrated GLB at public/${path}`);
	return `<script type="application/octet-stream" id="${id}">data:${file.type};base64,${bytes.toString('base64')}</script>`;
};

export const embedPlayableMechs = async function (families: readonly AuthoredChassis[], withVariants: boolean) {
	const assets: string[] = [];
	for (const chassis of families) for (const part of withVariants ? ['pixel', 'variants'] : ['pixel']) {
		assets.push(await embedPreviewAsset(`${chassis}-${part}-glb`, `assets/mechs/${chassis}/${part}.glb`));
	}
	return assets.join('\n');
};

export const buildStandaloneStudy = async function (name: 'warden' | 'models') {
	const source = `src/${name}-study.ts`;
	const result = await Bun.build({ entrypoints: [join(root, source)], target: 'browser', format: 'esm', minify: true });
	const script = result.outputs[0];
	if (!result.success || result.outputs.length !== 1 || !script) throw new AggregateError(result.logs, `Could not bundle the ${name} motion study`);

	const assets = name === 'warden' ? await embedPlayableMechs(['warden'], false) : await embedPlayableMechs(['warden', 'kestrel', 'maul'], true);
	const template = await Bun.file(join(root, `${name}-preview.html`)).text();
	const tag = `<script type="module" src="./${source}"></script>`;
	if (!template.includes(tag)) throw new Error(`Missing motion study entry for ${name}`);
	const code = (await script.text()).replaceAll('</script', '<\\/script');
	const html = template.replace(tag, function () { return `${assets}\n<script type="module">${code}</script>`; });
	await Bun.write(join(root, 'dist', `${name}-study.html`), html);
	console.log(`Built standalone ${name} study in dist/${name}-study.html`);
};
