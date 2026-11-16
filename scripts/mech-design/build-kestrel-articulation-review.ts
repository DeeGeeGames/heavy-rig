/** Portable inspection of exact Kestrel GLBs; joint sweeps are diagnostic. */
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ACESFilmicToneMapping, AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, InstancedMesh, LoopOnce, Material, Mesh, MeshStandardMaterial, Object3D, OrthographicCamera, Quaternion, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface ReviewAsset {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly base64: string;
	readonly triangles: number;
	readonly meshSections: number;
	readonly clips: readonly string[];
}
interface JointSpec {
	readonly id: string;
	readonly label: string;
	readonly node: string;
	readonly axis: 'x' | 'y';
	readonly minimum: number;
	readonly maximum: number;
}
interface ReviewConfiguration {
	readonly source: ReviewAsset;
	readonly candidate: ReviewAsset;
	readonly joints: readonly JointSpec[];
	readonly requiredNodes: readonly string[];
}

const joints: readonly JointSpec[] = [
	{ id: 'torso', label: 'Torso yaw', node: 'rig_torso', axis: 'y', minimum: -90, maximum: 90 },
	{ id: 'left-hip', label: 'Own-left hip', node: 'rig_leg_left_thigh', axis: 'x', minimum: -35, maximum: 35 },
	{ id: 'right-hip', label: 'Own-right hip', node: 'rig_leg_right_thigh', axis: 'x', minimum: -35, maximum: 35 },
	{ id: 'left-knee', label: 'Own-left knee', node: 'rig_leg_left_shin', axis: 'x', minimum: -45, maximum: 45 },
	{ id: 'right-knee', label: 'Own-right knee', node: 'rig_leg_right_shin', axis: 'x', minimum: -45, maximum: 45 },
	{ id: 'left-ankle', label: 'Own-left ankle', node: 'rig_leg_left_foot', axis: 'x', minimum: -30, maximum: 30 },
	{ id: 'right-ankle', label: 'Own-right ankle', node: 'rig_leg_right_foot', axis: 'x', minimum: -30, maximum: 30 },
];
const requiredNodes = ['rig_pelvis', 'rig_torso', 'rig_leg_left_thigh', 'rig_leg_left_shin', 'rig_leg_left_foot', 'rig_leg_right_thigh', 'rig_leg_right_shin', 'rig_leg_right_foot', 'rig_mount_left-gun', 'rig_mount_right-gun'];
const approvedSourceHash = '1fde921c6c2058d549b27396b922b5371356162a46a9cb494aed973b39db316a';

// This function is typechecked here, then serialized without its types into the
// browser entry. Keep all browser state inside it; only Three.js imports are free.
const startReview = async function (configuration: ReviewConfiguration): Promise<void> {
	const element = function (id: string): HTMLElement {
		const found = document.getElementById(id);
		if (!(found instanceof HTMLElement)) throw new Error(`Missing review element ${id}`);
		return found;
	};
	const input = function (id: string): HTMLInputElement {
		const found = element(id); if (!(found instanceof HTMLInputElement)) throw new Error(`Expected input ${id}`); return found;
	};
	const clipSelect = element('clip');
	if (!(clipSelect instanceof HTMLSelectElement)) throw new Error('Expected clip select');
	const status = element('status'); const diagnostics = element('diagnostics');
	const neutral = input('neutral'); const wireframe = input('wireframe');
	const comparison = input('comparison'); const playing = input('play'); const phaseInput = input('phase');
	const controlsPanel = element('joint-controls');
	const sourcePanel = element('source-panel'); const candidatePanel = element('candidate-panel');
	const loader = new GLTFLoader();
	const parse = function (asset: ReviewAsset) {
		const bytes = Uint8Array.from(atob(asset.base64), function (character) { return character.charCodeAt(0); });
		return loader.parseAsync(bytes.buffer, '');
	};
	const [source, candidate] = await Promise.all([parse(configuration.source), parse(configuration.candidate)]);
	const nodes = new Map<string, Object3D>();
	for (const name of configuration.requiredNodes) {
		const found: Object3D[] = []; candidate.scene.traverse(function (node) { if (node.name === name) found.push(node); });
		const node = found[0]; if (found.length !== 1 || !node) throw new Error(`Expected exactly one candidate node ${name}; found ${found.length}`);
		nodes.set(name, node);
	}
	const hingeAxes = new Map<string, Vector3>();
	for (const spec of configuration.joints) {
		const node = nodes.get(spec.node); if (!node) throw new Error(`Missing joint ${spec.node}`);
		if (spec.axis === 'y') { hingeAxes.set(spec.id, new Vector3(0, 1, 0)); continue; }
		const rawAxis: unknown = node.userData['hingeAxis'];
		if (rawAxis === undefined) { hingeAxes.set(spec.id, new Vector3(1, 0, 0)); continue; }
		if (!Array.isArray(rawAxis) || rawAxis.length !== 3) throw new Error(`Invalid hingeAxis on ${spec.node}`);
		const values: readonly unknown[] = rawAxis; const [x, y, z] = values;
		if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || ![x, y, z].every(Number.isFinite)) throw new Error(`Invalid hingeAxis on ${spec.node}`);
		const axis = new Vector3(x, y, z); if (Math.abs(axis.length() - 1) > 0.001) throw new Error(`hingeAxis must be normalized on ${spec.node}`);
		hingeAxes.set(spec.id, axis.normalize());
	}
	const rest = new Map<Object3D, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>();
	candidate.scene.traverse(function (node) { rest.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }); });
	const mixer = new AnimationMixer(candidate.scene);
	const availableClips = candidate.animations.filter(function (clip) { return ['walk', 'run', 'backward'].includes(clip.name) && Number.isFinite(clip.duration) && clip.duration > 0; });
	for (const clip of availableClips) { const option = document.createElement('option'); option.value = clip.name; option.textContent = clip.name; clipSelect.append(option); }
	const hasClips = availableClips.length > 0;
	playing.disabled = !hasClips; phaseInput.disabled = true;
	element('motion-note').textContent = hasClips ? 'Playback samples the candidate’s embedded clips. The source stays neutral. Manual joint offsets compose onto the sampled pose.' : 'No walk, run or backward clips are embedded. The controls below are diagnostic joint sweeps only.';

	const bounds = new Box3().setFromObject(source.scene).union(new Box3().setFromObject(candidate.scene));
	if (bounds.isEmpty()) throw new Error('Review assets have empty bounds');
	const center = bounds.getCenter(new Vector3()); const dimensions = bounds.getSize(new Vector3());
	const span = Math.max(dimensions.x, dimensions.y, dimensions.z) * 1.4;
	if (!Number.isFinite(span) || span <= 0) throw new Error('Review assets have invalid bounds');
	const panels = [
		{ panel: sourcePanel, model: source.scene, label: 'source', asset: configuration.source },
		{ panel: candidatePanel, model: candidate.scene, label: 'candidate', asset: configuration.candidate },
	].map(function (entry) {
		const canvas = entry.panel.querySelector('canvas'); if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing review canvas');
		const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping;
		const scene = new Scene(); scene.add(entry.model); scene.add(new HemisphereLight(0xe0e5eb, 0x484b50, 1.2));
		for (const lightSpec of [{ position: new Vector3(2, 4, 3), power: 1.8 }, { position: new Vector3(-3, 2, 1), power: 0.9 }, { position: new Vector3(1, 3, -3), power: 1.2 }]) {
			const light = new DirectionalLight(0xffffff, lightSpec.power); light.position.copy(lightSpec.position); scene.add(light);
		}
		const camera = new OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, span * 0.0001, span * 100);
		const orbit = new OrbitControls(camera, canvas); orbit.target.copy(center); orbit.enableDamping = false; orbit.minZoom = 0.4; orbit.maxZoom = 5;
		const originals = new Map<Mesh, Material | Material[]>(); const inspection = new MeshStandardMaterial({ color: new Color(0.57, 0.6, 0.62), metalness: 0.12, roughness: 0.58 });
		entry.model.traverse(function (node) { if (node instanceof Mesh) originals.set(node, node.material); });
		return { ...entry, canvas, renderer, scene, camera, orbit, originals, inspection };
	});
	let phase = 0; let frame = 0; let previousTime = 0; let disposed = false; let synchronizing = false;
	const angles = new Map<string, number>();
	const sliders = new Map<string, HTMLInputElement>();
	const updateMaterials = function () {
		for (const panel of panels) {
			panel.inspection.wireframe = wireframe.checked;
			for (const [mesh, original] of panel.originals) {
				for (const material of Array.isArray(original) ? original : [original]) if ('wireframe' in material && typeof material.wireframe === 'boolean') material.wireframe = wireframe.checked;
				mesh.material = neutral.checked ? panel.inspection : original;
			}
		}
	};
	const pose = function () {
		mixer.stopAllAction();
		for (const [node, transform] of rest) { node.position.copy(transform.position); node.quaternion.copy(transform.quaternion); node.scale.copy(transform.scale); }
		const clip = availableClips.find(function (entry) { return entry.name === clipSelect.value; });
		if (clip) { const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play(); mixer.setTime(phase * clip.duration); }
		for (const spec of configuration.joints) {
			const node = nodes.get(spec.node); if (!node) throw new Error(`Missing joint ${spec.node}`);
			const axis = hingeAxes.get(spec.id); if (!axis) throw new Error(`Missing hinge axis ${spec.id}`);
			node.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, (angles.get(spec.id) ?? 0) * Math.PI / 180));
		}
		candidate.scene.updateMatrixWorld(true);
		const states = configuration.requiredNodes.map(function (name) { const node = nodes.get(name); if (!node) throw new Error(`Missing required node ${name}`); return { name, worldMatrix: node.matrixWorld.elements.slice() }; });
		diagnostics.textContent = JSON.stringify({ sourceSha256: configuration.source.sha256, candidateSha256: configuration.candidate.sha256, clip: clip?.name ?? null, phase, jointDegrees: Object.fromEntries(angles), hingeAxes: Object.fromEntries(Array.from(hingeAxes, function ([id, axis]) { return [id, axis.toArray()]; })), nodes: states }, null, 2);
		candidatePanel.dataset['clip'] = clip?.name ?? 'rest'; candidatePanel.dataset['phase'] = String(phase); candidatePanel.dataset['jointDegrees'] = JSON.stringify(Object.fromEntries(angles));
		status.textContent = `${clip ? `${clip.name} · phase ${phase.toFixed(2)}` : 'Neutral rest'} · diagnostic local joint offsets · no gait or clearance acceptance implied`;
		element('phase-value').textContent = phase.toFixed(2);
	};
	const render = function () {
		if (disposed) return;
		pose();
		for (const panel of panels) {
			if (panel.panel.hidden) continue;
			const width = panel.canvas.clientWidth; const height = panel.canvas.clientHeight; if (width <= 0 || height <= 0) continue;
			const aspect = width / height;
			panel.camera.left = -span * aspect / 2; panel.camera.right = span * aspect / 2; panel.camera.top = span / 2; panel.camera.bottom = -span / 2; panel.camera.updateProjectionMatrix();
			panel.renderer.setSize(width, height, false); panel.renderer.render(panel.scene, panel.camera);
		}
	};
	for (const panel of panels) panel.orbit.addEventListener('change', function () {
		if (synchronizing || disposed) return; synchronizing = true;
		for (const other of panels) if (other !== panel) { other.camera.position.copy(panel.camera.position); other.camera.quaternion.copy(panel.camera.quaternion); other.camera.zoom = panel.camera.zoom; other.orbit.target.copy(panel.orbit.target); other.orbit.update(); }
		synchronizing = false; render();
	});
	const setView = function (view: string) {
		const directions: Readonly<Record<string, readonly [number, number, number]>> = { oblique: [0.85, 0.4, 1], front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], underside: [0.6, -1, 0.8] };
		const direction = directions[view]; if (!direction) throw new Error(`Unknown review view ${view}`);
		synchronizing = true;
		for (const panel of panels) { panel.camera.position.copy(center).add(new Vector3(...direction).normalize().multiplyScalar(span * 3)); panel.camera.up.set(0, 1, 0); panel.camera.zoom = 1; panel.orbit.target.copy(center); panel.camera.lookAt(center); panel.orbit.update(); }
		synchronizing = false;
		for (const button of document.querySelectorAll('button[data-view]')) button.setAttribute('aria-pressed', String(button.getAttribute('data-view') === view));
		render();
	};
	const tick = function (time: number) {
		frame = 0; if (disposed) return;
		const clip = availableClips.find(function (entry) { return entry.name === clipSelect.value; });
		if (!playing.checked || !clip) return;
		const elapsed = previousTime === 0 ? 0 : Math.max(0, Math.min((time - previousTime) / 1000, 0.1)); previousTime = time;
		phase = (phase + elapsed / clip.duration) % 1; phaseInput.value = String(phase); render(); frame = requestAnimationFrame(tick);
	};
	const updatePlayback = function () { if (frame) cancelAnimationFrame(frame); frame = 0; previousTime = 0; if (playing.checked && clipSelect.value !== 'rest') frame = requestAnimationFrame(tick); render(); };
	for (const spec of configuration.joints) {
		const row = document.createElement('label'); row.className = spec.id === 'torso' ? 'joint torso-joint' : 'joint';
		const title = document.createElement('span'); title.textContent = spec.label;
		const slider = document.createElement('input'); slider.type = 'range'; slider.id = `joint-${spec.id}`; slider.min = String(spec.minimum); slider.max = String(spec.maximum); slider.step = '1'; slider.value = '0';
		const value = document.createElement('output'); value.textContent = '0°'; value.htmlFor.add(slider.id);
		slider.addEventListener('input', function () { const angle = Number(slider.value); if (!Number.isFinite(angle) || angle < spec.minimum || angle > spec.maximum) throw new Error('Invalid joint angle'); angles.set(spec.id, angle); value.textContent = `${angle}°`; render(); });
		row.append(title, slider, value); controlsPanel.append(row); sliders.set(spec.id, slider); angles.set(spec.id, 0);
	}
	const presets: Readonly<Record<string, Readonly<Record<string, number>>>> = {
		neutral: {}, torso: { torso: 45 }, left: { 'left-hip': 18, 'left-knee': -30, 'left-ankle': 12 }, right: { 'right-hip': 18, 'right-knee': -30, 'right-ankle': 12 }, combined: { torso: 35, 'left-hip': 22, 'left-knee': -28, 'left-ankle': 6, 'right-hip': -12, 'right-knee': 20, 'right-ankle': -8 },
	};
	for (const button of document.querySelectorAll('button[data-preset]')) button.addEventListener('click', function () {
		const name = button.getAttribute('data-preset'); const preset = name ? presets[name] : undefined; if (!preset) throw new Error('Unknown pose preset');
		playing.checked = false; clipSelect.value = 'rest'; phase = 0; phaseInput.value = '0'; phaseInput.disabled = true;
		for (const [id, slider] of sliders) { slider.value = String(preset[id] ?? 0); slider.dispatchEvent(new Event('input', { bubbles: true })); }
		updatePlayback();
	});
	for (const button of document.querySelectorAll('button[data-view]')) button.addEventListener('click', function () { const view = button.getAttribute('data-view'); if (view) setView(view); });
	for (const checkbox of [neutral, wireframe]) checkbox.addEventListener('change', function () { updateMaterials(); render(); });
	comparison.addEventListener('change', function () { sourcePanel.hidden = !comparison.checked; render(); });
	clipSelect.addEventListener('change', function () { phase = 0; phaseInput.value = '0'; phaseInput.disabled = clipSelect.value === 'rest'; if (clipSelect.value === 'rest') playing.checked = false; updatePlayback(); });
	playing.addEventListener('change', updatePlayback);
	phaseInput.addEventListener('input', function () { const value = Number(phaseInput.value); if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid motion phase'); phase = value; playing.checked = false; updatePlayback(); });
	const observer = new ResizeObserver(render); for (const panel of panels) observer.observe(panel.canvas);
	window.addEventListener('pagehide', function () {
		disposed = true; if (frame) cancelAnimationFrame(frame); observer.disconnect(); mixer.stopAllAction(); mixer.uncacheRoot(candidate.scene);
		const materials = new Set<Material>(); const textures = new Set<Texture>(); const geometries = new Set<Mesh['geometry']>();
		for (const panel of panels) {
			panel.orbit.dispose(); materials.add(panel.inspection);
			for (const [mesh, original] of panel.originals) { geometries.add(mesh.geometry); for (const material of Array.isArray(original) ? original : [original]) materials.add(material); }
			panel.renderer.dispose(); panel.renderer.forceContextLoss();
		}
		for (const material of materials) { for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value); material.dispose(); }
		for (const texture of textures) texture.dispose(); for (const geometry of geometries) geometry.dispose();
	}, { once: true });
	updateMaterials(); setView('oblique'); document.documentElement.dataset['kestrelReviewReady'] = 'true';
};

const record = function (value: unknown, context: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Expected object: ${context}`); return Object.fromEntries(Object.entries(value));
};
const list = function (value: unknown, context: string): readonly unknown[] { if (!Array.isArray(value)) throw new Error(`Expected array: ${context}`); return value; };
const optionalList = function (value: unknown, context: string): readonly unknown[] { return value === undefined ? [] : list(value, context); };
const htmlText = function (value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); };
const inside = function (parent: string, path: string): boolean { const child = relative(parent, path); return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child); };

const inspect = async function (path: string, root: string, candidate: boolean): Promise<ReviewAsset> {
	const bytes = await Bun.file(path).arrayBuffer(); const header = new DataView(bytes);
	if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw new Error(`${path}: expected a complete GLB 2.0 container`);
	const length = header.getUint32(12, true); if (length === 0 || length > bytes.byteLength - 20) throw new Error(`${path}: invalid JSON chunk length`);
	const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, 20, length))); const gltf = record(parsed, path);
	for (const field of ['buffers', 'images']) for (const raw of optionalList(gltf[field], field)) { const uri = record(raw, field)['uri']; if (uri !== undefined && (typeof uri !== 'string' || !uri.startsWith('data:'))) throw new Error(`${path}: external ${field} resources are unsupported in an offline review`); }
	for (const extension of optionalList(gltf['extensionsUsed'], 'extensionsUsed')) { if (typeof extension !== 'string') throw new Error('Invalid extension name'); if (['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(extension)) throw new Error(`${path}: ${extension} needs an external decoder; supply an uncompressed review export`); }
	// Parse with the same loader as the viewer so instances and scene selection
	// count correctly. Embedded texture placeholders avoid browser-only decoding.
	const loaded = await new GLTFLoader().register(function () { return { name: 'KESTREL_REVIEW_HEADLESS_TEXTURES', loadTexture: async function () { return new Texture(); } }; }).parseAsync(bytes, '');
	let triangles = 0; let meshSections = 0;
	const nodeNames: string[] = []; const materials = new Set<Material>(); const textures = new Set<Texture>();
	loaded.scene.traverse(function (node) {
		nodeNames.push(node.name);
		if (!(node instanceof Mesh)) return;
		const positions = node.geometry.getAttribute('position'); if (!positions) throw new Error('Missing mesh positions');
		const count = node.geometry.index?.count ?? positions.count;
		if (count % 3 !== 0) throw new Error('Incomplete triangle-list primitive');
		triangles += count / 3 * (node instanceof InstancedMesh ? node.count : 1); meshSections++;
		for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
		node.geometry.dispose();
	});
	for (const material of materials) { for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value); material.dispose(); }
	for (const texture of textures) texture.dispose();
	if (candidate) for (const name of requiredNodes) if (nodeNames.filter(function (value) { return value === name; }).length !== 1) throw new Error(`${path}: expected one named rig node ${name} in the default scene`);
	if (triangles === 0) throw new Error('Review asset has no triangles');
	const clips = optionalList(gltf['animations'], 'animations').map(function (clip) { const name = record(clip, 'animation')['name']; return typeof name === 'string' ? name : ''; }).filter(function (name) { return ['walk', 'run', 'backward'].includes(name); });
	return { path: relative(root, path), sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, base64: Buffer.from(bytes).toString('base64'), triangles, meshSections, clips };
};

if (import.meta.main) {
	const assetArgument = Bun.argv[2]; const outputArgument = Bun.argv[3];
	if (!assetArgument || !outputArgument || Bun.argv.length !== 4) throw new Error('Usage: bun scripts/mech-design/build-kestrel-articulation-review.ts candidate.glb new-output-directory');
	const root = await realpath(resolve(import.meta.dir, '../..')); const generated = await realpath(join(root, 'design/mechs/generated'));
	if (generated !== join(root, 'design/mechs/generated')) throw new Error('Generated directory must not resolve through symlinks');
	const output = resolve(root, outputArgument); if (!inside(generated, output)) throw new Error('Review output must be a new directory inside design/mechs/generated');
	const parent = await realpath(dirname(output)); if (parent !== generated && !inside(generated, parent)) throw new Error('Review output parent resolves outside the generated directory');
	const sourcePath = join(root, 'design/mechs/assets/kestrel/generated-source/source.glb'); const candidatePath = resolve(root, assetArgument);
	const [source, candidate] = await Promise.all([inspect(sourcePath, root, false), inspect(candidatePath, root, true)]);
	if (source.sha256 !== approvedSourceHash) throw new Error('Retained Kestrel source differs from the owner-approved raw source');
	const configuration: ReviewConfiguration = { source, candidate, joints, requiredNodes };
	await mkdir(output);
	const entry = join(output, 'viewer-entry.ts');
	try {
		const imports = "import { ACESFilmicToneMapping, AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, LoopOnce, Material, Mesh, MeshStandardMaterial, Object3D, OrthographicCamera, Quaternion, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three'; import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js';";
		await Bun.write(entry, `${imports}\nconst start = ${startReview.toString()};\nvoid start(${JSON.stringify(configuration)}).catch(function(error) { const status = document.getElementById('status'); if (status) status.textContent = 'Review failed: ' + (error instanceof Error ? error.message : String(error)); document.documentElement.dataset.kestrelReviewReady = 'error'; console.error(error); });`);
		const build = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', minify: true, conditions: ['browser', 'production'], define: { 'process.env.NODE_ENV': '"production"' } });
		if (!build.success) throw new AggregateError(build.logs, 'Kestrel review bundle failed'); const bundle = build.outputs.find(function (file) { return file.kind === 'entry-point'; }); if (!bundle || build.outputs.length !== 1) throw new Error('Expected one standalone review bundle');
		const script = (await bundle.text()).replaceAll('</script', '<\\/script');
		const assetPanel = function (id: string, title: string, asset: ReviewAsset): string { return `<article id="${id}" class="panel"><div class="caption">${title}<span>${asset.triangles.toLocaleString('en-US')} triangles · ${asset.meshSections} sections</span></div><canvas></canvas><p class="fingerprint" title="${asset.sha256}">${htmlText(asset.path)}<br>SHA-256 ${asset.sha256}</p></article>`; };
		const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kestrel articulation review</title><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:14px var(--font-sans,system-ui);color:var(--foreground,CanvasText)}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}button,select,input,label{font:inherit;font-size:12px}button,select{background:var(--secondary,color-mix(in srgb,Canvas 94%,CanvasText));color:var(--foreground,CanvasText);border:1px solid var(--border,color-mix(in srgb,Canvas 75%,CanvasText));border-radius:var(--radius,8px);padding:7px 10px}button{cursor:pointer}button[aria-pressed=true]{background:var(--primary,#3d68f4);color:var(--primary-foreground,#fff)}label{display:flex;align-items:center;gap:5px}select:disabled,input:disabled{opacity:.45}.models{display:flex;gap:12px}.panel{min-width:0;flex:1;background:var(--secondary,color-mix(in srgb,Canvas 94%,CanvasText));border:1px solid var(--border,color-mix(in srgb,Canvas 75%,CanvasText));border-radius:var(--radius,8px);overflow:hidden}.caption{font-size:13px;padding:12px 12px 0}.caption span{display:block;color:var(--muted-foreground,color-mix(in srgb,CanvasText 65%,Canvas));font-size:11px;margin-top:4px}canvas{display:block;width:100%;height:370px;touch-action:none}.fingerprint{font:10px var(--font-mono,ui-monospace,monospace);overflow-wrap:anywhere;margin:0;padding:0 12px 12px;color:var(--muted-foreground,color-mix(in srgb,CanvasText 65%,Canvas))}.note{font-size:12px;line-height:1.5;color:var(--muted-foreground,color-mix(in srgb,CanvasText 65%,Canvas));margin:10px 0}.joints{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin:12px 0}.joint{display:grid;grid-template-columns:110px minmax(40px,1fr) 38px;gap:6px}.joint input{width:100%;margin:0}.torso-joint{grid-column:1 / -1}.joint output{text-align:right;font-variant-numeric:tabular-nums}details{margin-top:12px;font-size:12px}summary{cursor:pointer}pre{font:10px var(--font-mono,ui-monospace,monospace);white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}[hidden]{display:none!important}@media(max-width:580px){.models{flex-direction:column}canvas{height:320px}.joints{grid-template-columns:1fr}.joint{grid-template-columns:105px minmax(40px,1fr) 38px}}
</style><div class="row">${[['oblique', '3/4'], ['front', 'Front'], ['back', 'Rear'], ['left', 'Own-left'], ['right', 'Own-right'], ['underside', 'Underside']].map(function ([id, label]) { return `<button data-view="${id}" aria-pressed="false">${label}</button>`; }).join('')}</div>
<div class="row"><label><input id="neutral" type="checkbox" checked>Neutral geometry</label><label><input id="wireframe" type="checkbox">Wireframe</label><label><input id="comparison" type="checkbox" checked>Compare raw source</label></div>
<div class="models">${assetPanel('source-panel', 'Approved raw source · neutral', source)}${assetPanel('candidate-panel', 'Repair / articulation candidate', candidate)}</div>
<p class="note">Drag either model to orbit both; scroll to zoom. Shared camera framing and lighting compare the actual embedded GLBs. View materials do not alter the exports.</p>
<div class="row"><label>Motion <select id="clip"><option value="rest">Neutral rest</option></select></label><label><input id="play" type="checkbox">Play</label><label>Phase <input id="phase" type="range" min="0" max="1" step="0.005" value="0"><output id="phase-value">0.00</output></label></div>
<p class="note" id="motion-note"></p><div class="row">${[['neutral', 'Reset pose'], ['torso', 'Torso only'], ['left', 'Left leg only'], ['right', 'Right leg only'], ['combined', 'Combined pose']].map(function ([id, label]) { return `<button data-preset="${id}">${label}</button>`; }).join('')}</div>
<div class="joints" id="joint-controls"></div><p class="note" id="status">Loading exact source and candidate GLBs…</p>
<p class="note">Joint limits and presets are inspection ranges. Leg deltas use normalized node hingeAxis metadata when supplied, otherwise local X; torso yaw uses local Y. These sweeps do not establish planted feet, collision clearance, valid locomotion, physical controls, performance or owner acceptance.</p>
<details><summary>Exact asset and pose diagnostics</summary><pre id="diagnostics"></pre></details><script type="module">${script}</script></html>`;
		await Bun.write(join(output, 'review.html'), html);
		const { base64: sourceData, ...sourceManifest } = source; const { base64: candidateData, ...candidateManifest } = candidate;
		void sourceData; void candidateData;
		await Bun.write(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, source: sourceManifest, candidate: candidateManifest, requiredNodes, joints, review: 'review.html', htmlSha256: new Bun.CryptoHasher('sha256').update(html).digest('hex'), scope: 'Exact exported GLB comparison, composed diagnostic local joint offsets and playback of available embedded clips; no locomotion or game acceptance implied.' }, null, 2) + '\n');
		console.log(JSON.stringify({ output, source: source.sha256, candidate: candidate.sha256, clips: candidate.clips, review: join(output, 'review.html') }, null, 2));
	} catch (error) {
		await rm(output, { recursive: true, force: true }); throw error;
	} finally {
		await rm(entry, { force: true });
	}
}
