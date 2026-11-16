import type { AuthoredPoseContext } from './authored-pose';
import { ACESFilmicToneMapping, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, GridHelper, HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, SphereGeometry, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { authoredMuzzleError, authoredWardenUrl, authoredKestrelUrl, loadAuthoredWarden, loadAuthoredKestrel } from './authored-mech';
import { advanceGait, createGait } from './gait';
import { createMech } from './mech-3d';
import { alignCamera } from './projection-3d';
import { createState } from './simulation';
import { getPlayerMuzzle, getPlayerWeaponRig, getPlayerFiringDirection } from './weapon-rig';

const required = function (id: string): HTMLElement { const node = document.getElementById(id); if (!(node instanceof HTMLElement)) throw new Error(`Missing authored study element ${id}`); return node; };
const canvas = required('authored-canvas'); if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing authored study canvas');
const view = required('view'); const wireframe = required('wireframe'); const anchors = required('anchors');
const aimTarget = required('aim-target');
if (!(view instanceof HTMLSelectElement) || !(aimTarget instanceof HTMLSelectElement) || !(wireframe instanceof HTMLInputElement) || !(anchors instanceof HTMLInputElement)) throw new Error('Invalid authored study controls');
const equipment = document.getElementById('equipment');
const status = required('status'); const diagnostics = required('diagnostics');
const assetState = required('asset-state'); const pauseButton = required('pause');
const motions = ['idle', 'walk', 'run', 'backward', 'turn', 'aim', 'fire'] as const;
type Motion = typeof motions[number];
const isMotion = function (value: string | undefined): value is Motion { return motions.some(function (name) { return name === value; }); };

const frameId = document.documentElement.dataset['authoredFrame'] === 'kestrel' ? 'kestrel' : 'warden';
const start = async function () {
	const url = frameId === 'kestrel' ? authoredKestrelUrl() : authoredWardenUrl(); const assetLabel = url.startsWith('data:') ? `Embedded ${frameId} GLB` : url;
	const factory = await (frameId === 'kestrel' ? loadAuthoredKestrel : loadAuthoredWarden)(url, { diagnostics: true }); const uninstall = factory.install();
	const model = createMech(undefined, false, frameId);
	const renderer = new WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
	const scene = new Scene(); scene.background = new Color('#102027'); scene.add(model.root);
	scene.add(new HemisphereLight('#d6e6e0', '#243337', 2.2));
	const sun = new DirectionalLight('#ffe2b8', 3.4); sun.position.set(-420, 900, -500); scene.add(sun);
	const rim = new DirectionalLight('#91c6d0', 1.6); rim.position.set(700, 450, 600); scene.add(rim);
	const floorGeometry = new PlaneGeometry(4000, 4000); const floorMaterial = new MeshStandardMaterial({ color: '#304346', roughness: 0.92, metalness: 0.1 });
	const floor = new Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; scene.add(floor);
	const grid = new GridHelper(2400, 48, '#425451', '#3b4e4c'); grid.position.y = -0.15; scene.add(grid);
	const camera = new OrthographicCamera(-130, 130, 130, -130, 0.1, 6000);
	const orbit = new OrbitControls(camera, canvas); orbit.target.set(0, 48, 0); orbit.enablePan = false;
	const state = createState({ frame: frameId });
	const markerGeometry = new SphereGeometry(0.8, 6, 4); const markerMaterial = new MeshStandardMaterial({ color: '#ffcf73', emissive: '#ffcf73', emissiveIntensity: 1 });
	const markers = Array.from({ length: 16 }, function () { const mesh = new Mesh(markerGeometry, markerMaterial); mesh.visible = false; scene.add(mesh); return mesh; });
	const shotGeometry = new BufferGeometry(); const shotPositions = new Float32Array(4 * 2 * 3); shotGeometry.setAttribute('position', new Float32BufferAttribute(shotPositions, 3));
	const shotMaterial = new LineBasicMaterial({ color: '#ffbf78', transparent: true, opacity: 0.9 }); const shots = new LineSegments(shotGeometry, shotMaterial); shots.frustumCulled = false; shotGeometry.setDrawRange(0, factory.weaponRigs.length * 2); scene.add(shots);
	const abort = new AbortController();
	let motion: Motion = 'idle'; let time = 0; let previous = 0; let accumulator = 0; let frame = 0; let paused = false; let disposed = false; let lost = false;
	let body = { x: 0, y: 0, angle: 0 }; let gait = createGait(body); let heading = 0; let maxMuzzleError = 0; let rendered = 0;
	const updateCamera = function () {
		const width = canvas.clientWidth; const height = canvas.clientHeight; if (width <= 0 || height <= 0) return;
		renderer.setSize(width, height, false);
		const gameView = view.value === 'game' || view.value === 'game-max'; orbit.enabled = !gameView;
		if (gameView) alignCamera(camera, width, height, state, view.value === 'game-max' ? 2.5 : 1, { x: 0, y: 0 });
		else {
			const close = view.value.startsWith('joints-'); const legs = view.value === 'legs'; const halfHeight = legs ? 22 : close ? 40 : 75; const target = new Vector3(0, legs ? 18 : close ? 75 : 48, 0);
			const aspect = width / height; camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
			const direction = view.value === 'front' || view.value === 'joints-front' ? new Vector3(1, 0.1, 0) : view.value === 'rear' ? new Vector3(-1, 0.1, 0) : view.value === 'joints-rear' ? new Vector3(-1, 0.2, 0.65) : view.value === 'joints-left' ? new Vector3(0, 0.1, -1) : view.value === 'side' || view.value === 'legs' || view.value === 'joints-right' ? new Vector3(0, 0.1, 1) : view.value === 'underside' || view.value === 'joints-underside' ? new Vector3(1, -0.65, 0.8) : new Vector3(1, 0.48, 1.2);
			camera.position.copy(direction.normalize().multiplyScalar(350)).add(target); camera.lookAt(target); camera.updateProjectionMatrix(); orbit.target.copy(target); orbit.update();
		}
	};
	const setWireframe = function () { model.root.traverse(function (node) { if (node instanceof Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material instanceof MeshStandardMaterial) material.wireframe = wireframe.checked; }); };
	let authoredPose: AuthoredPoseContext | undefined;
	const pose = function () {
		const equippedSlots = equipment instanceof HTMLSelectElement ? equipment.value === 'left' ? [0] : equipment.value === 'right' ? [1] : equipment.value === 'empty' ? [] : [0, 1] : undefined;
		const activeSlots = equippedSlots ?? factory.weaponRigs.map(function (_rig, slot) { return slot; });
		shotGeometry.setDrawRange(0, activeSlots.length * 2);
		const range = aimTarget.value === 'sweep' ? 350 : 125;
		const elevation = aimTarget.value === 'near-high' ? 220 : aimTarget.value === 'near-low' ? 0 : 80 + Math.sin(time * 0.7) * 60;
		const target = motion === 'aim' ? { x: body.x + Math.cos(heading) * range, y: body.y + Math.sin(heading) * range, elevation } : undefined;
		const recoil = motion === 'fire' ? Math.max(0, 1 - time % 0.5 / 0.18) : 0;
		model.pose(gait, heading, { recoil, hit: 0, heat: motion === 'fire' ? 50 : 0, time, ...(equippedSlots ? { equippedSlots } : {}), ...(authoredPose ? { authoredPose } : {}), ...(target ? { target } : {}) });
		maxMuzzleError = Math.max(maxMuzzleError, authoredMuzzleError(model, getPlayerWeaponRig(frameId), gait, heading, target, authoredPose, frameId));
		const points = activeSlots.flatMap(function (slot) { const muzzle = model.muzzles[slot]; return muzzle ? [muzzle, ...(model.rocketMuzzles[slot] ?? [])] : []; });
		for (const [index, marker] of markers.entries()) { const at = points[index]; marker.visible = anchors.checked && at !== undefined; if (at) marker.position.copy(at); }
		shots.visible = recoil > 0 && activeSlots.length > 0;
		if (shots.visible) for (const [line, slot] of activeSlots.entries()) {
			const rig = factory.weaponRigs[slot]; if (!rig) throw new Error(`Missing study weapon rig ${slot}`);
			const origin = getPlayerMuzzle(frameId, slot, body, heading, rig.tubes.length ? Math.floor(time * 2) % 6 : undefined, target, authoredPose);
			const direction = getPlayerFiringDirection(frameId, slot, body, heading, origin, target); const position = shotGeometry.getAttribute('position');
			position.setXYZ(line * 2, origin.x - body.x, origin.elevation, origin.y - body.y);
			position.setXYZ(line * 2 + 1, origin.x - body.x + direction.x * (25 + recoil * 35), origin.elevation + direction.elevation * (25 + recoil * 35), origin.y - body.y + direction.y * (25 + recoil * 35)); position.needsUpdate = true;
		}
		grid.position.set(-body.x % 50, -0.15, -body.y % 50);
	};
	const step = function () {
		const dt = 1 / 60; authoredPose ??= factory.advancePose(undefined, body, time); time += dt;
		const speed = motion === 'walk' ? frameId === 'kestrel' ? 24 : 38 : motion === 'run' ? frameId === 'kestrel' ? 125 : 180 : motion === 'backward' ? frameId === 'kestrel' ? -65 : -28 : motion === 'aim' ? frameId === 'kestrel' ? 24 : 35 : 0;
		const angle = body.angle + (motion === 'turn' ? dt * 0.7 : 0);
		body = { x: body.x + Math.cos(angle) * speed * dt, y: body.y + Math.sin(angle) * speed * dt, angle };
		authoredPose = factory.advancePose(authoredPose, body, time);
		gait = advanceGait(gait, body, dt); heading = body.angle + (motion === 'aim' ? Math.sin(time * 0.9) * 1.25 : 0); pose();
	};
	const reset = function () { time = 0; previous = 0; accumulator = 0; body = { x: 0, y: 0, angle: 0 }; gait = createGait(body); heading = 0; maxMuzzleError = 0; authoredPose = undefined; pose(); };
	const setPaused = function (value: boolean) { paused = value; previous = 0; accumulator = 0; pauseButton.textContent = paused ? 'Resume' : 'Pause'; pauseButton.setAttribute('aria-pressed', String(paused)); };
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-motion]')) button.addEventListener('click', function () { const name = button.dataset['motion']; if (!isMotion(name)) return; motion = name; reset(); for (const sibling of document.querySelectorAll<HTMLButtonElement>('[data-motion]')) sibling.setAttribute('aria-pressed', String(sibling === button)); }, { signal: abort.signal });
	pauseButton.addEventListener('click', function () { setPaused(!paused); }, { signal: abort.signal });
	required('step').addEventListener('click', function () { setPaused(true); step(); }, { signal: abort.signal });
	if (equipment instanceof HTMLSelectElement) equipment.addEventListener('change', pose, { signal: abort.signal });
	required('reset').addEventListener('click', reset, { signal: abort.signal }); view.addEventListener('change', updateCamera, { signal: abort.signal }); aimTarget.addEventListener('change', pose, { signal: abort.signal }); wireframe.addEventListener('change', setWireframe, { signal: abort.signal }); anchors.addEventListener('change', pose, { signal: abort.signal });
	window.addEventListener('keydown', function (event) { if (event.code === 'Space' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); setPaused(!paused); } }, { signal: abort.signal });
	const observer = new ResizeObserver(updateCamera); observer.observe(canvas);
	canvas.addEventListener('webglcontextlost', function (event) { event.preventDefault(); lost = true; previous = 0; }, { signal: abort.signal });
	canvas.addEventListener('webglcontextrestored', function () { lost = false; previous = 0; updateCamera(); }, { signal: abort.signal });
	const tick = function (now: number) {
		if (disposed) return;
		const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0; previous = now;
		if (!paused && !lost) { accumulator += dt; while (accumulator >= 1 / 60) { step(); accumulator -= 1 / 60; } }
		if (!lost) { if (orbit.enabled) orbit.update(); renderer.render(scene, camera); rendered += 1; }
		status.textContent = `${motion.toUpperCase()} · ${time.toFixed(3)} s · ${renderer.info.render.triangles.toLocaleString()} scene triangles · ${renderer.info.render.calls} draws`;
		diagnostics.textContent = JSON.stringify({ ready: true, asset: assetLabel, motion, time, authoredMotion: model.root.userData['authoredMotion'], rendered, maxMuzzleError, drawCalls: renderer.info.render.calls, sceneTriangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, weaponRigs: factory.weaponRigs, logicalTubeMapping: factory.tubeMapping, contextLost: lost }, null, 2);
		frame = requestAnimationFrame(tick);
	};
	const dispose = function () {
		if (disposed) return; disposed = true; window.removeEventListener('pagehide', onPageHide); cancelAnimationFrame(frame); observer.disconnect(); abort.abort(); orbit.dispose(); model.dispose(); uninstall(); factory.dispose();
		floorGeometry.dispose(); floorMaterial.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); shotGeometry.dispose(); shotMaterial.dispose(); grid.geometry.dispose(); for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose(); renderer.dispose(); scene.clear();
	};
	const onPageHide = function (event: PageTransitionEvent) { if (!event.persisted) dispose(); };
	window.addEventListener('pagehide', onPageHide); if (import.meta.hot) import.meta.hot.dispose(dispose);
	reset(); updateCamera(); assetState.textContent = `${frameId === 'kestrel' ? 'Kestrel' : 'Warden'} A · authored asset`; document.documentElement.dataset['authoredReady'] = 'true'; frame = requestAnimationFrame(tick);
};
start().catch(function (error: unknown) { const node = required('error'); node.hidden = false; node.textContent = error instanceof Error ? error.message : String(error); assetState.textContent = 'Asset unavailable'; console.error(error); });
