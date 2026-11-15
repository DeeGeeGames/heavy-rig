import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('export fingerprints detect buffer, neutral binding, material and motion drift', async function () {
	const script = `
import copy, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('modular', 'scripts/mech-design/modular-export.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d,b=m.read_glb(Path('public/assets/mechs/warden/game-ready.glb'))
excluded={'geometry_rig_mount_left-gun'}
reference=m.reuse_fingerprints(d,b,excluded)
assert m.reuse_fingerprints(copy.deepcopy(d),bytearray(b),excluded)==reference
for kind in ('geometry','neutral','binding','material','motion'):
 c=copy.deepcopy(d);payload=bytearray(b)
 if kind=='geometry':
  a=c['accessors'][c['meshes'][c['nodes'][13]['mesh']]['primitives'][0]['attributes']['POSITION']]
  v=c['bufferViews'][a['bufferView']];payload[v.get('byteOffset',0)+a.get('byteOffset',0)] ^= 1
 elif kind=='neutral':c['nodes'][0]['translation'][0]+=.01
 elif kind=='binding':
  owner=next(n for n in c['nodes'] if 13 in n.get('children',[]));owner['children'].remove(13);c['nodes'][0].setdefault('children',[]).append(13)
 elif kind=='material':c['materials'][0]['doubleSided']=not c['materials'][0].get('doubleSided',False)
 else:
  a=c['accessors'][c['animations'][0]['samplers'][0]['output']];v=c['bufferViews'][a['bufferView']];payload[v.get('byteOffset',0)+a.get('byteOffset',0)] ^= 1
 assert m.reuse_fingerprints(c,payload,excluded)!=reference,kind
print('five real divergence cases rejected')
`;
	const result = Bun.spawn(['python3', '-c', script], { cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr, code] = await Promise.all([new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited]);
	expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
	expect(stdout).toContain('five real divergence cases rejected');
});

test('actual exports pass housing probes and reject deleted housing triangles with retained vertices', async function () {
	const { mkdir, mkdtemp, rm } = await import('node:fs/promises');
	await mkdir(resolve(import.meta.dir, '../design/mechs/generated'), { recursive: true });
	const folder = await mkdtemp(resolve(import.meta.dir, '../design/mechs/generated/modularity-regression-'));
	await rm(folder, { recursive: true }); // Builder deliberately requires a fresh path.
	const run = async function (args: string[]) {
		const process = Bun.spawn(args, { cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' });
		const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
		return { stdout, stderr, code };
	};
	try {
		expect((await run(['python3', 'scripts/mech-design/build-warden-modularity.py', '--output', folder])).code).toBe(0);
		const valid = await run(['bun', 'scripts/mech-design/verify-warden-modularity.mjs', folder]);
		expect({ code: valid.code, stderr: valid.stderr }).toEqual({ code: 0, stderr: '' });
		for (const name of ['alternate', 'empty']) {
			const path = `${folder}/${name}.glb`;
			const original = await Bun.file(path).arrayBuffer();
			const mutate = `
import importlib.util, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('modular','scripts/mech-design/modular-export.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=Path(sys.argv[1]);d,b=m.read_glb(p)
n=next(n for n in d['nodes'] if n['name']=='module_left_'+sys.argv[2])
a=d['accessors'][d['meshes'][n['mesh']]['primitives'][0]['indices']]
a['byteOffset']=a.get('byteOffset',0)+36*4
a['count']-=36
m.write_glb(p,d,b)
`;
			expect((await run(['python3', '-c', mutate, path, name])).code).toBe(0);
			const broken = await run(['bun', 'scripts/mech-design/verify-warden-modularity.mjs', folder]);
			expect(broken.code).not.toBe(0);
			expect(broken.stderr).toContain('Housing surface coverage missing');
			await Bun.write(path, original);
		}
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
}, 30000);
