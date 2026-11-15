/** Build a portable, offline comparison of two actual exported GLBs. */
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { InstancedMesh, Material, Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const usage = `Usage: bun scripts/mech-design/optimization-review.ts
  --source SOURCE.glb --candidate CANDIDATE.glb --renders DIRECTORY
  --output NEW_HTML [--source-label LABEL] [--candidate-label LABEL]
  [--scale-note TEXT]

The output's existing parent directory must be inside design/mechs/generated.
Existing outputs are never overwritten. Renders must contain source- and
candidate- PNGs for front, oblique, rear, side, opposite-side, underside, game
and zoom. Game/zoom crops must be 160×120 pixels. render-report.json must pin
the GLB and PNG hashes and describe a textured render pass. No server is required.`;

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	strict: true,
	allowPositionals: false,
	options: {
		source: { type: 'string' },
		candidate: { type: 'string' },
		renders: { type: 'string' },
		output: { type: 'string' },
		'source-label': { type: 'string', default: 'Source' },
		'candidate-label': { type: 'string', default: 'Candidate' },
		'scale-note': { type: 'string', default: 'Native 160×120 crops from the supplied camera-scale recipe. These are scale estimates, not integrated gameplay captures.' },
		help: { type: 'boolean', short: 'h' },
	},
});
if (values.help) {
	console.log(usage);
	process.exit(0);
}

const required = function (value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`Missing --${name}\n${usage}`);
	return value;
};
const record = function (value: unknown, context: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Expected object: ${context}`);
	return Object.fromEntries(Object.entries(value));
};
const list = function (value: unknown, context: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`Expected array: ${context}`);
	return value;
};
const optionalList = function (value: unknown, context: string): readonly unknown[] {
	return value === undefined ? [] : list(value, context);
};
const htmlText = function (value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
};
const inside = function (parent: string, path: string): boolean {
	const child = relative(parent, path);
	return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

const root = await realpath(resolve(import.meta.dir, '../..'));
const generated = await realpath(join(root, 'design/mechs/generated'));
if (generated !== join(root, 'design/mechs/generated')) throw new Error('Generated directory must not resolve through symlinks');
const output = resolve(required(values.output, 'output'));
if (!inside(root, generated) || !inside(generated, output) || !output.endsWith('.html')) {
	throw new Error('Output must be a new .html file inside this checkout’s design/mechs/generated directory');
}
const actualOutputParent = await realpath(dirname(output));
if (actualOutputParent !== generated && !inside(generated, actualOutputParent)) throw new Error('Output parent resolves outside the generated directory');
if (await Bun.file(output).exists()) throw new Error(`Refusing to overwrite ${output}`);
const renders = resolve(required(values.renders, 'renders'));
const sourcePath = resolve(required(values.source, 'source'));
const candidatePath = resolve(required(values.candidate, 'candidate'));
const sourceLabel = required(values['source-label'], 'source-label');
const candidateLabel = required(values['candidate-label'], 'candidate-label');
const scaleNote = required(values['scale-note'], 'scale-note');

const inspectContainer = function (bytes: ArrayBuffer, name: string): Record<string, unknown> {
	if (bytes.byteLength < 20) throw new Error(`${name}: truncated GLB`);
	const header = new DataView(bytes);
	const jsonLength = header.getUint32(12, true);
	if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4e4f534a || jsonLength === 0 || jsonLength > bytes.byteLength - 20) {
		throw new Error(`${name}: expected a complete GLB 2.0 container`);
	}
	const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, 20, jsonLength)));
	const gltf = record(parsed, name);
	for (const field of ['buffers', 'images']) {
		for (const [index, value] of optionalList(gltf[field], field).entries()) {
			const uri = record(value, `${field}[${index}]`)['uri'];
			if (uri !== undefined && (typeof uri !== 'string' || !uri.startsWith('data:'))) throw new Error(`${name}: ${field}[${index}] must be embedded; external resources are unsupported`);
		}
	}
	const unsupported = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']);
	for (const extension of optionalList(gltf['extensionsUsed'], 'extensionsUsed')) {
		if (typeof extension !== 'string') throw new Error(`${name}: invalid extension name`);
		if (unsupported.has(extension)) throw new Error(`${name}: ${extension} needs a decoder; use an uncompressed review export`);
	}
	for (const rawMesh of list(gltf['meshes'], 'meshes')) {
		for (const primitive of list(record(rawMesh, 'mesh')['primitives'], 'primitives')) {
			const mode = record(primitive, 'primitive')['mode'];
			if (mode !== undefined && mode !== 4) throw new Error(`${name}: review requires triangle-list primitives (mode 4)`);
		}
	}
	return gltf;
};

const measure = async function (path: string, id: 'source' | 'candidate', label: string) {
	const bytes = await Bun.file(path).arrayBuffer();
	const document = inspectContainer(bytes, basename(path));
	// Use the same scene parser as the viewer; it handles node instances and
	// indexed/unindexed geometry. Texture placeholders avoid requiring browser APIs.
	const gltf = await new GLTFLoader().register(function () {
		return { name: 'REVIEW_HEADLESS_TEXTURES', loadTexture: async function () { return new Texture(); } };
	}).parseAsync(bytes, '');
	const materials = new Set<Material>();
	const textures = new Set<Texture>();
	let triangles = 0;
	let meshSections = 0;
	gltf.scene.traverse(function (object) {
		if (!(object instanceof Mesh)) return;
		const positions = object.geometry.getAttribute('position');
		if (!positions) throw new Error(`${path}: missing position attribute`);
		const vertices = object.geometry.index?.count ?? positions.count;
		if (vertices % 3 !== 0) throw new Error(`${path}: incomplete triangle-list primitive`);
		triangles += vertices / 3 * (object instanceof InstancedMesh ? object.count : 1);
		meshSections++;
		for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
		object.geometry.dispose();
	});
	for (const material of materials) {
		for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
		material.dispose();
	}
	for (const texture of textures) texture.dispose();
	if (triangles === 0) throw new Error(`${path}: default scene has no triangles`);
	return {
		id, label, filename: basename(path), triangles, meshSections, materials: materials.size,
		textureImages: optionalList(document['images'], 'images').length,
		bytes: bytes.byteLength,
		sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
		base64: Buffer.from(bytes).toString('base64'),
	};
};

const [source, candidate] = await Promise.all([
	measure(sourcePath, 'source', sourceLabel),
	measure(candidatePath, 'candidate', candidateLabel),
]);
const assets = [source, candidate];
const renderReportValue: unknown = await Bun.file(join(renders, 'render-report.json')).json();
const renderReport = record(renderReportValue, 'render-report.json');
if (renderReport['geometryOnly'] !== false) throw new Error('Comparison requires a textured render pass (geometryOnly: false)');
const renderInputs = record(renderReport['inputs'], 'render-report inputs');
const renderHashes = record(renderReport['renders'], 'render-report PNG hashes');
for (const asset of assets) {
	const input = record(renderInputs[asset.id], `render input ${asset.id}`);
	if (input['sha256'] !== asset.sha256) throw new Error(`Stale ${asset.id} renders: GLB hash differs from render-report.json`);
}
const views = [
	['oblique', 'Three-quarter'], ['front', 'Front'], ['rear', 'Rear'],
	['side', 'Side (+X)'], ['opposite-side', 'Opposite side (−X)'], ['underside', 'Underside'],
] as const;
const images = new Map<string, string>();
await Promise.all(assets.flatMap(function (asset) {
	return [...views.map(function ([view]) { return view; }), 'game', 'zoom'].map(async function (view) {
		const path = join(renders, `${asset.id}-${view}.png`);
		const data = new Uint8Array(await Bun.file(path).arrayBuffer());
		if (renderHashes[`${asset.id}-${view}.png`] !== new Bun.CryptoHasher('sha256').update(data).digest('hex')) {
			throw new Error(`Render PNG hash mismatch: ${path}`);
		}
		const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
		if (data.length < 24 || !pngSignature.every(function (byte, index) { return data[index] === byte; })) throw new Error(`Expected PNG render: ${path}`);
		const dimensions = new DataView(data.buffer, data.byteOffset, data.byteLength);
		if ((view === 'game' || view === 'zoom') && (dimensions.getUint32(16) !== 160 || dimensions.getUint32(20) !== 120)) throw new Error(`Expected native 160×120 crop: ${path}`);
		images.set(`${asset.id}-${view}`, `data:image/png;base64,${Buffer.from(data).toString('base64')}`);
	});
}));
const image = function (id: string, view: string, label: string): string {
	const data = images.get(`${id}-${view}`);
	if (!data) throw new Error(`Missing render ${id}-${view}`);
	return `<img alt="${htmlText(`${label}: ${view}`)}" src="${data}">`;
};

const build = await Bun.build({
	entrypoints: [join(import.meta.dir, 'optimization-viewer.ts')],
	target: 'browser',
	format: 'iife',
	minify: true,
});
const bundle = build.outputs[0];
if (!build.success || !bundle || build.outputs.length !== 1) throw new Error(`Viewer bundle failed: ${build.logs.map(String).join('\n')}`);
const script = (await bundle.text()).replace(/<\/script/gi, '<\\/script');
const maximumTriangles = Math.max(source.triangles, candidate.triangles);
const signedReduction = (1 - candidate.triangles / source.triangles) * 100;
const triangleChange = signedReduction >= 0 ? `${signedReduction.toFixed(1)}% fewer triangles than the source.` : `${(-signedReduction).toFixed(1)}% more triangles than the source.`;
const number = function (value: number): string { return value.toLocaleString('en-US'); };
const pixelRow = function (view: string): string {
	return `<div class="pixels">${assets.map(function (asset) { return `<figure><figcaption>${htmlText(asset.label)}</figcaption>${image(asset.id, view, asset.label)}</figure>`; }).join('')}</div>`;
};

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Geometry optimization comparison</title><style>
:root{font-family:var(--font-sans,system-ui);color:var(--foreground,#ddd);color-scheme:light dark}*{box-sizing:border-box}body{margin:0}p{font-size:13px;line-height:1.45;color:var(--muted-foreground,#aaa);margin:8px 0}button,select{font:inherit;padding:7px 10px;border:1px solid var(--border,#555);border-radius:6px;background:var(--secondary,#292c33);color:var(--foreground,#ddd);cursor:pointer}.labels,.images,.pixels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.labels{font-size:12px;margin:8px 0}.labels strong{font-weight:600}#viewport{height:320px;position:relative;overflow:hidden;border-radius:var(--radius,8px);touch-action:none}#viewport canvas{display:block;width:100%;height:320px}#viewer-placeholder{position:absolute;inset:0;align-items:center;background:#434b52}.images img{display:block;width:100%;border-radius:6px}.images[hidden]{display:none}.toolbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:10px 0}.toolbar label,#viewer-status{font-size:12px}.chart{display:grid;grid-template-columns:minmax(80px,140px) 1fr 65px;gap:10px;align-items:center;font-size:12px;margin:15px 0}.track{background:var(--secondary,#292c33);border-radius:3px}.bar{height:14px;border-radius:3px}.note{padding:12px 16px;background:var(--card,#20242b);border-radius:var(--radius,8px)}h3{font-size:14px;margin:20px 0 8px}table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}th,td{text-align:left;padding:6px 5px;border-bottom:1px solid var(--border,#555);vertical-align:top}th{font-weight:500}.pixels{overflow-x:auto;grid-template-columns:repeat(2,minmax(160px,1fr))}.pixels figure{display:flex;flex-direction:column;align-items:center;margin:0;background:#434b52;border-radius:6px;overflow:hidden}.pixels figcaption{font-size:12px;padding:4px 8px;width:100%;text-align:center;background:var(--secondary,#292c33);color:var(--foreground,#ddd)}.pixels img{width:160px;height:120px;max-width:none;display:block}summary{cursor:pointer;margin:12px 0}code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace)}.hash{font-size:11px}input{accent-color:var(--primary,#d4a061)}
@media(max-width:480px){#viewport,#viewport canvas{height:220px}.toolbar{gap:5px}button{font-size:12px;padding:6px 8px}.labels{font-size:11px}.chart{grid-template-columns:90px 1fr 50px}.pixels{grid-template-columns:repeat(2,160px)}}
</style></head><body>
<div class="labels">${assets.map(function (asset) { return `<strong>${htmlText(asset.label)}</strong>`; }).join('')}</div>
<div id="viewport"><div id="viewer-placeholder" class="images">${assets.map(function (asset) { return image(asset.id, 'oblique', asset.label); }).join('')}</div></div>
<p id="viewer-status">Loading embedded GLBs…</p>
<div class="toolbar">${views.map(function ([view, label]) { return `<button type="button" data-view="${view}">${label}</button>`; }).join('')}<label><input type="checkbox" id="wireframe"> Wireframe</label><label><input type="checkbox" id="details" checked> Baked detail</label></div>
<h3>Exported triangles</h3><div class="chart">${assets.map(function (asset, index) { return `<span>${htmlText(asset.label)}</span><div class="track"><div class="bar" style="width:${(asset.triangles / maximumTriangles * 100).toFixed(2)}%;background:var(--chart-${index + 1},${index === 0 ? '#5484f6' : '#d9a627'})"></div></div><strong>${number(asset.triangles)}</strong>`; }).join('')}</div>
<p>${triangleChange} Counts include mesh instances in the default scene.</p>
<table><thead><tr><th>Export cost</th>${assets.map(function (asset) { return `<th>${htmlText(asset.label)}</th>`; }).join('')}</tr></thead><tbody>
<tr><th>Mesh sections / used materials</th>${assets.map(function (asset) { return `<td>${asset.meshSections} / ${asset.materials}</td>`; }).join('')}</tr>
<tr><th>Contained texture images</th>${assets.map(function (asset) { return `<td>${asset.textureImages}</td>`; }).join('')}</tr>
<tr><th>GLB payload</th>${assets.map(function (asset) { return `<td>${(asset.bytes / 1048576).toFixed(2)} MiB</td>`; }).join('')}</tr>
</tbody></table>
<details open><summary>Matched exported-model renders</summary><div class="toolbar"><select id="still-view">${views.map(function ([view, label]) { return `<option value="${view}">${label}</option>`; }).join('')}</select></div>
${views.map(function ([view]) { return `<div class="images" data-still-view="${view}"${view === 'oblique' ? '' : ' hidden'}>${assets.map(function (asset) { return image(asset.id, view, asset.label); }).join('')}</div>`; }).join('')}</details>
<h3>Estimated gameplay size · default zoom</h3>${pixelRow('game')}
<h3>Estimated gameplay size · maximum zoom</h3>${pixelRow('zoom')}
<p>${htmlText(scaleNote)} Crops retain native pixel size; scroll horizontally on narrow screens.</p>
<div class="note"><p>Turn baked detail off to inspect the structural surfaces in neutral material. The viewer frames both models from their combined bounds and preserves their relative scale and placement.</p><p>Geometry, material sections, textures and payload are separate costs. This comparison does not measure frame time, motion clearance, or owner acceptance.</p></div>
<details><summary>Exact source files</summary>${assets.map(function (asset) { return `<p class="hash"><strong>${htmlText(asset.label)}</strong> · ${htmlText(asset.filename)}<br><code>${asset.sha256}</code></p>`; }).join('')}</details>
${assets.map(function (asset) { return `<script type="application/octet-stream" id="asset-${asset.id}">${asset.base64}</script>`; }).join('')}
<script>${script}</script></body></html>`;

const handle = await open(output, 'wx');
try {
	await handle.writeFile(html, 'utf8');
} finally {
	await handle.close();
}
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), assets: assets.map(function ({ base64, ...asset }) { void base64; return asset; }) }, null, 2));
