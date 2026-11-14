import { catalog } from './catalog';
import { verifiedBaseline } from './cli';
import type { BaselineReference } from './prompt';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir,'../..');
const result = await Bun.build({entrypoints:[resolve(import.meta.dir,'browser.ts')],target:'browser',format:'iife',minify:true});
if (!result.success) throw new AggregateError(result.logs,'Could not build mech design interface');
const output = result.outputs[0];
if (!output) throw Error('Missing browser bundle');
const template = await Bun.file(resolve(root,'design/mechs/builder.template.html')).text();
const ui = await Bun.file(resolve(root,'design/mechs/builder-ui.txt')).text();
const baselines: (BaselineReference & {chassisId: string})[] = [];
for (const frame of catalog.frames.filter(function(f) { return f.variant === 'A'; })) {
	const file = Bun.file(resolve(root,`design/mechs/chassis/${frame.chassisId}/design.json`));
	if (!await file.exists()) continue;
	const record: unknown = await file.json();
	if (typeof record !== 'object' || record === null || !('activeBaseline' in record) || typeof record.activeBaseline !== 'string') continue;
	try {
		const baseline = await verifiedBaseline({schemaVersion:1,mode:'variant',variantId:frame.id,baselineId:record.activeBaseline,background:'Transparent',details:'',loadout:frame.mounts.map(function() { return {weaponId:null,rounds:0}; })});
		if (baseline) baselines.push({...baseline,chassisId:frame.chassisId});
	} catch (error: unknown) { console.warn(`Excluded invalid baseline for ${frame.chassisId}:`,error); }
}
const html = template.replace('__BASELINES__',JSON.stringify(baselines).replaceAll('<','\\u003c')).replace('__BUNDLE__',(await output.text()).replaceAll('</script','<\\/script')).replace('__UI__',ui);
const path = resolve(root,'design/mechs/generated/builder.html');
await Bun.write(path,html);
console.log(path);
