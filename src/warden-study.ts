import { ACESFilmicToneMapping, Color, CylinderGeometry, DirectionalLight, Fog, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer, type BufferGeometry } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { advanceGait, createGait } from './gait';
import { createLowPolyWarden } from './warden-low-poly';

type Motion = 'showcase' | 'walk' | 'reverse' | 'turn' | 'aim' | 'fire' | 'rest';
type Phase = Exclude<Motion, 'showcase'>;
type View = 'three-quarter' | 'side' | 'game';
const isMotion = function (value: string | undefined): value is Motion { return value === 'showcase' || value === 'walk' || value === 'reverse' || value === 'turn' || value === 'aim' || value === 'fire' || value === 'rest'; };
const descriptions: Readonly<Record<Phase, string>> = {
	walk: 'Planted feet, loaded suspension, and working pistons.',
	reverse: 'Backward travel with the same foot-contact solver.',
	turn: 'The chassis turns while the feet step into the new heading.',
	aim: 'The turret tracks independently while the chassis walks forward.',
	fire: 'The gun slides recoil and return inside their fixed cradles.',
	rest: 'Stationary inspection. Drag to inspect the silhouette and joints.',
};
const requireElement = function (id: string) {
	const value = document.getElementById(id);
	if (!value) throw new Error(`Missing Warden study element: ${id}`);
	return value;
};
const canvas = document.getElementById('warden-canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing Warden study canvas');
const stage = requireElement('stage'); const label = requireElement('motion-name'); const description = requireElement('motion-description');
const pauseButton = requireElement('pause'); const orbitButton = requireElement('orbit'); const throttleOutput = requireElement('throttle-value');
const throttleInput = requireElement('throttle'); const playbackInput = requireElement('playback'); const viewInput = requireElement('view');
if (!(throttleInput instanceof HTMLInputElement) || !(playbackInput instanceof HTMLSelectElement) || !(viewInput instanceof HTMLSelectElement)) throw new Error('Invalid Warden study controls');

const startStudy = function () {
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
	renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
	const scene = new Scene(); scene.background = new Color('#102027'); scene.fog = new Fog('#102027', 350, 1100);
	const camera = new PerspectiveCamera(33, 1, 1, 1800);
	const controls = new OrbitControls(camera, canvas); controls.target.set(0, 47, 0); controls.enablePan = false;
	controls.minDistance = 145; controls.maxDistance = 600; controls.maxPolarAngle = Math.PI * 0.48; controls.autoRotateSpeed = 0.9;
	const model = createLowPolyWarden(); scene.add(model.root);
	scene.add(new HemisphereLight('#d6e6e0', '#243337', 2.2));
	const key = new DirectionalLight('#ffe2b8', 3.4); key.position.set(140, 230, 100); key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -120; key.shadow.camera.right = 120;
	key.shadow.camera.top = 130; key.shadow.camera.bottom = -100; key.shadow.camera.near = 20; key.shadow.camera.far = 600;
	key.shadow.normalBias = 0.3; key.shadow.bias = -0.0001; key.target.position.set(0, 35, 0); scene.add(key, key.target);
	const rim = new DirectionalLight('#91c6d0', 1.6); rim.position.set(-130, 120, -100); scene.add(rim);
	const geometries = new Set<BufferGeometry>(); const materials: MeshStandardMaterial[] = [];
	const material = function (color: string) { const value = new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.1 }); materials.push(value); return value; };
	const own = function <T extends BufferGeometry>(value: T): T { geometries.add(value); return value; };
	const floor = new Mesh(own(new PlaneGeometry(4000, 4000)), material('#304346'));
	floor.rotation.x = -Math.PI / 2; floor.position.y = -0.3; floor.receiveShadow = true; scene.add(floor);
	const grid = new GridHelper(2400, 48, '#425451', '#3b4e4c'); grid.position.y = -0.25; scene.add(grid);
	const deck = new Group(); scene.add(deck);
	const pad = new Mesh(own(new CylinderGeometry(89, 91, 1, 64)), material('#2c3d40')); pad.position.y = -0.7; pad.receiveShadow = true; deck.add(pad);
	const markingGeometry = own(new PlaneGeometry(9, 2.5)); const markingMaterial = material('#a78145');
	for (let index = 0; index < 24; index++) {
		const angle = index / 24 * Math.PI * 2;
		const marking = new Mesh(markingGeometry, markingMaterial);
		marking.position.set(Math.cos(angle) * 98, -0.17, Math.sin(angle) * 98); marking.rotation.set(-Math.PI / 2, 0, -angle);
		deck.add(marking);
	}
	const boot = requireElement('error'); const abort = new AbortController();
	let motion: Motion = 'showcase'; let time = 0; let phaseTime = 0; let phase: Phase = 'walk';
	let paused = false; let throttle = 0.65; let playback = 1; let view: View = 'three-quarter';
	let body = { x: 0, y: 0, angle: 0 }; let gait = createGait(body); let speed = 0; let aim = 0;
	let accumulator = 0; let previous = 0; let frame = 0; let ticks = 0; let rendered = 0; let contextLost = false; let disposed = false;
	const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-motion]')];
	const setView = function () {
		if (view === 'side') camera.position.set(-5, 76, 255);
		else if (view === 'game') camera.position.set(170, 245, 170);
		else camera.position.set(155, 112, 185);
		controls.target.set(0, 47, 0); controls.update();
	};
	const resize = function () {
		const width = canvas.clientWidth; const height = canvas.clientHeight;
		if (width <= 0 || height <= 0) return;
		renderer.setSize(width, height, false); camera.aspect = width / height; camera.zoom = width < 500 ? 0.9 : 1.08; camera.updateProjectionMatrix();
	};
	const selectMotion = function (selected: Motion) {
		motion = selected; time = 0; phaseTime = 0; accumulator = 0;
		for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset['motion'] === motion));
	};
	const setPaused = function (value: boolean) {
		paused = value; pauseButton.textContent = paused ? 'Resume' : 'Pause'; pauseButton.setAttribute('aria-pressed', String(paused));
	};
	const step = function () {
		const dt = 1 / 60; time += dt; ticks++;
		const nextPhase: Phase = motion === 'showcase' ? time % 26 < 6 ? 'walk' : time % 26 < 11 ? 'reverse' : time % 26 < 16 ? 'turn' : time % 26 < 22 ? 'aim' : 'fire' : motion;
		if (nextPhase !== phase) phaseTime = 0;
		phase = nextPhase; phaseTime += dt;
		const targetSpeed = (phase === 'walk' ? 90 : phase === 'reverse' ? -48 : phase === 'aim' ? 52 : 0) * throttle;
		speed += (targetSpeed - speed) * (1 - Math.exp(-dt * 3.5));
		const heading = body.angle + (phase === 'turn' ? dt * 0.65 : 0);
		body = { x: body.x + Math.cos(heading) * speed * dt, y: body.y + Math.sin(heading) * speed * dt, angle: heading };
		gait = advanceGait(gait, body, dt);
		const targetAim = body.angle + (phase === 'aim' ? Math.sin(phaseTime * 0.9) * 1.3 : phase === 'turn' ? -Math.sin(phaseTime * 0.5) * 0.55 : 0);
		aim += (targetAim - aim) * (1 - Math.exp(-dt * 5));
		const shotAge = phaseTime % 0.85; const recoil = phase === 'fire' ? Math.max(0, 1 - shotAge / 0.19) : 0;
		model.pose(gait, aim, { recoil, hit: 0, heat: 0, time });
		// Follow the chassis. Ground markings move by the same displacement as
		// the planted feet, so the contact phase is visible without foot sliding.
		grid.position.set(-body.x % 50, -0.25, -body.y % 50);
		deck.position.set(-body.x, 0, -body.y);
	};
	for (const button of modeButtons) button.addEventListener('click', function () { const value = button.dataset['motion']; if (isMotion(value)) selectMotion(value); }, { signal: abort.signal });
	pauseButton.addEventListener('click', function () { setPaused(!paused); }, { signal: abort.signal });
	orbitButton.addEventListener('click', function () { controls.autoRotate = !controls.autoRotate; orbitButton.setAttribute('aria-pressed', String(controls.autoRotate)); }, { signal: abort.signal });
	throttleInput.addEventListener('input', function () { throttle = Math.max(0.25, Math.min(1, Number(throttleInput.value) / 100)); throttleOutput.textContent = `${Math.round(throttle * 100)}%`; }, { signal: abort.signal });
	playbackInput.addEventListener('change', function () { const value = Number(playbackInput.value); if (value === 1 || value === 0.5 || value === 0.25) playback = value; }, { signal: abort.signal });
	viewInput.addEventListener('change', function () { const value = viewInput.value; if (value === 'side' || value === 'game' || value === 'three-quarter') { view = value; setView(); } }, { signal: abort.signal });
	window.addEventListener('keydown', function (event) { if (event.code === 'Space' && (event.target === document.body || event.target === canvas)) { event.preventDefault(); setPaused(!paused); } }, { signal: abort.signal });
	canvas.addEventListener('webglcontextlost', function (event) { event.preventDefault(); contextLost = true; boot.hidden = false; boot.textContent = 'The 3D view lost its graphics context. Waiting for recovery…'; }, { signal: abort.signal });
	canvas.addEventListener('webglcontextrestored', function () { contextLost = false; boot.hidden = true; }, { signal: abort.signal });
	document.addEventListener('visibilitychange', function () { previous = 0; accumulator = 0; }, { signal: abort.signal });
	const observer = new ResizeObserver(resize); observer.observe(canvas);
	const tick = function (now: number) {
		if (disposed) return;
		const elapsed = previous === 0 ? 0 : Math.min((now - previous) / 1000, 0.1); previous = now;
		if (!document.hidden && !contextLost) {
			if (!paused) {
				accumulator += elapsed * playback;
				while (accumulator >= 1 / 60) { step(); accumulator -= 1 / 60; }
			}
			controls.update(paused ? 0 : elapsed); renderer.render(scene, camera); rendered++;
			label.textContent = phase; description.textContent = descriptions[phase];
			stage.dataset['phase'] = phase; stage.dataset['ticks'] = String(ticks); stage.dataset['frames'] = String(rendered);
			stage.dataset['triangles'] = String(renderer.info.render.triangles); stage.dataset['calls'] = String(renderer.info.render.calls);
		}
		frame = requestAnimationFrame(tick);
	};
	const dispose = function () {
		if (disposed) return; disposed = true; cancelAnimationFrame(frame); abort.abort(); observer.disconnect(); controls.dispose();
		model.dispose(); for (const geometry of geometries) geometry.dispose(); for (const value of materials) value.dispose();
		grid.geometry.dispose(); if (Array.isArray(grid.material)) for (const value of grid.material) value.dispose(); else grid.material.dispose();
		key.shadow.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss();
	};
	window.addEventListener('pagehide', function (event) { if (!event.persisted) dispose(); }, { signal: abort.signal });
	setView(); resize(); model.pose(gait, 0); frame = requestAnimationFrame(tick);
	return dispose;
};

try { startStudy(); } catch (error) {
	const message = requireElement('error'); message.hidden = false;
	message.textContent = error instanceof Error ? error.message : 'Could not initialize the Warden motion study.';
}
