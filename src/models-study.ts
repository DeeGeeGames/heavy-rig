import { ACESFilmicToneMapping, Box3, Color, CylinderGeometry, DirectionalLight, Fog, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, type BufferGeometry } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FRAMES, getFrame, type FrameId } from './frames';
import { FRAME_RIGS, STANDARD_LEG_RIG } from './frame-rig';
import { advanceGait, createGait, mechScale } from './gait';
import { createMech } from './mech-3d';
import type { EnemyKind } from './simulation';

type Motion = 'showcase' | 'walk' | 'reverse' | 'turn' | 'aim' | 'fire' | 'rest';
type Phase = Exclude<Motion, 'showcase'>;
type View = 'three-quarter' | 'side' | 'game';
interface ModelChoice { id: string; frame: FrameId; kind?: EnemyKind; commander?: boolean }
const choices: readonly ModelChoice[] = [
	...FRAMES.map(function (frame) { return { id: frame.id, frame: frame.id }; }),
	{ id: 'scout', frame: 'warden', kind: 'scout' }, { id: 'striker', frame: 'warden', kind: 'striker' },
	{ id: 'siege', frame: 'warden', kind: 'siege' }, { id: 'commander', frame: 'warden', kind: 'siege', commander: true },
	{ id: 'helicopter', frame: 'warden', kind: 'helicopter' }, { id: 'vtol', frame: 'warden', kind: 'vtol' }, { id: 'tank', frame: 'warden', kind: 'tank' },
];
const getChoice = function (id: string) {
	const choice = choices.find(function (candidate) { return candidate.id === id; });
	if (!choice) throw new Error(`Unknown model study choice: ${id}`);
	return choice;
};
const isMotion = function (value: string | undefined): value is Motion { return value === 'showcase' || value === 'walk' || value === 'reverse' || value === 'turn' || value === 'aim' || value === 'fire' || value === 'rest'; };
const descriptions: Readonly<Record<Phase, string>> = {
	walk: 'Planted feet, loaded suspension, and working pistons.',
	reverse: 'Backward travel with the same foot-contact solver.',
	turn: 'The chassis turns while the feet step into the new heading.',
	aim: 'Independent turret tracking while the chassis walks.',
	fire: 'Recoil actuates the frame’s gun slides or launchers.',
	rest: 'Stationary inspection. Drag to inspect the silhouette and joints.',
};
const requireElement = function (id: string) {
	const value = document.getElementById(id);
	if (!value) throw new Error(`Missing model study element: ${id}`);
	return value;
};
const canvasElement = requireElement('model-canvas');
if (!(canvasElement instanceof HTMLCanvasElement)) throw new Error('Missing model study canvas');
const canvas = canvasElement;
const stage = requireElement('stage'); const label = requireElement('motion-name'); const description = requireElement('motion-description');
const pauseButton = requireElement('pause'); const orbitButton = requireElement('orbit'); const throttleOutput = requireElement('throttle-value');
const stepButton = requireElement('step'); const restartButton = requireElement('restart'); const timeOutput = requireElement('animation-time');
const throttleInput = requireElement('throttle'); const playbackInput = requireElement('playback'); const viewInput = requireElement('view'); const modelInput = requireElement('model');
if (!(throttleInput instanceof HTMLInputElement) || !(playbackInput instanceof HTMLSelectElement) || !(viewInput instanceof HTMLSelectElement) || !(modelInput instanceof HTMLSelectElement)) throw new Error('Invalid model study controls');

const startStudy = function () {
	modelInput.replaceChildren(...choices.map(function (choice) {
		return new Option(choice.kind ? choice.id.toUpperCase() : getFrame(choice.frame).name, choice.id);
	}));
	modelInput.value = 'warden';
	const renderer = new WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
	renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
	const scene = new Scene(); scene.background = new Color('#102027'); scene.fog = new Fog('#102027', 500, 1500);
	const camera = new PerspectiveCamera(33, 1, 1, 2200);
	const controls = new OrbitControls(camera, canvas); controls.enablePan = false;
	controls.minDistance = 120; controls.maxDistance = 1000; controls.maxPolarAngle = Math.PI * 0.48; controls.autoRotateSpeed = 0.9;
	let choice = getChoice('warden');
	let model = createMech(choice.kind, choice.commander ?? false, choice.frame); scene.add(model.root);
	scene.add(new HemisphereLight('#d6e6e0', '#243337', 2.2));
	const key = new DirectionalLight('#ffe2b8', 3.4); key.position.set(140, 300, 100); key.castShadow = true;
	key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -160; key.shadow.camera.right = 160;
	key.shadow.camera.top = 200; key.shadow.camera.bottom = -150; key.shadow.camera.near = 20; key.shadow.camera.far = 700;
	key.shadow.normalBias = 0.3; key.shadow.bias = -0.0001; key.target.position.set(0, 60, 0); scene.add(key, key.target);
	const rim = new DirectionalLight('#91c6d0', 1.6); rim.position.set(-130, 160, -100); scene.add(rim);
	const geometries = new Set<BufferGeometry>(); const materials: MeshStandardMaterial[] = [];
	const material = function (color: string) { const value = new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.1 }); materials.push(value); return value; };
	const own = function <T extends BufferGeometry>(value: T): T { geometries.add(value); return value; };
	const floor = new Mesh(own(new PlaneGeometry(4000, 4000)), material('#304346'));
	floor.rotation.x = -Math.PI / 2; floor.position.y = -0.3; floor.receiveShadow = true; scene.add(floor);
	const grid = new GridHelper(2400, 48, '#425451', '#3b4e4c'); grid.position.y = -0.25; scene.add(grid);
	const deck = new Group(); scene.add(deck);
	const pad = new Mesh(own(new CylinderGeometry(100, 102, 1, 48)), material('#2c3d40')); pad.position.y = -0.7; pad.receiveShadow = true; deck.add(pad);
	const markingGeometry = own(new PlaneGeometry(9, 2.5)); const markingMaterial = material('#a78145');
	for (let index = 0; index < 24; index++) {
		const angle = index / 24 * Math.PI * 2;
		const marking = new Mesh(markingGeometry, markingMaterial);
		marking.position.set(Math.cos(angle) * 110, -0.17, Math.sin(angle) * 110); marking.rotation.set(-Math.PI / 2, 0, -angle);
		deck.add(marking);
	}
	const boot = requireElement('error'); const abort = new AbortController();
	let motion: Motion = 'showcase'; let time = 0; let phaseTime = 0; let phase: Phase = 'walk';
	let paused = false; let throttle = 0.65; let playback = 1; let view: View = 'three-quarter';
	let body = { x: 0, y: 0, angle: 0 }; let speed = 0; let aim = 0;
	const sizeForChoice = function () { return choice.kind ? mechScale(choice.kind) : getFrame(choice.frame).size; };
	const rigForChoice = function () { return choice.kind ? STANDARD_LEG_RIG : FRAME_RIGS[choice.frame]; };
	let gait = createGait(body, sizeForChoice(), rigForChoice());
	let accumulator = 0; let previous = 0; let frame = 0; let ticks = 0; let rendered = 0; let contextLost = false; let disposed = false;
	const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-motion]')];
	const frameModel = function () {
		const bounds = new Box3().setFromObject(model.root); const dimensions = bounds.getSize(new Vector3());
		const targetHeight = Math.max(35, bounds.min.y + dimensions.y * 0.49);
		const radius = Math.max(dimensions.y * 0.65, Math.hypot(dimensions.x, dimensions.z) * 0.6 / camera.aspect);
		// Leave room for near-side toes and the upper-body sway at every angle.
		const distance = radius * 1.18 / Math.tan(camera.fov * Math.PI / 360);
		const direction = view === 'side' ? new Vector3(0, 0.12, 1) : view === 'game' ? new Vector3(1, 1.65, 1) : new Vector3(1, 0.45, 1.2);
		camera.position.copy(direction.normalize().multiplyScalar(distance)).add(new Vector3(0, targetHeight, 0));
		controls.target.set(0, targetHeight, 0); controls.update();
	};
	const resize = function () {
		const width = canvas.clientWidth; const height = canvas.clientHeight;
		if (width <= 0 || height <= 0) return;
		renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); frameModel();
	};
	const resetMotion = function () {
		body = { x: 0, y: 0, angle: 0 }; gait = createGait(body, sizeForChoice(), rigForChoice());
		speed = 0; aim = 0; time = 0; phaseTime = 0; accumulator = 0; previous = 0; ticks = 0;
		phase = motion === 'showcase' ? 'walk' : motion;
		grid.position.set(0, -0.25, 0); deck.position.set(0, 0, 0); model.pose(gait, aim);
	};
	const selectMotion = function (selected: Motion) {
		motion = selected; resetMotion();
		for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset['motion'] === motion));
	};
	const setPaused = function (value: boolean) {
		paused = value; previous = 0; accumulator = 0;
		pauseButton.textContent = paused ? 'Resume' : 'Pause'; pauseButton.setAttribute('aria-pressed', String(paused));
	};
	const selectModel = function (selected: ModelChoice) {
		const next = createMech(selected.kind, selected.commander ?? false, selected.frame);
		model.dispose(); choice = selected; model = next; scene.add(model.root);
		resetMotion(); frameModel();
	};
	const step = function () {
		const dt = 1 / 60; time += dt; ticks++;
		const nextPhase: Phase = motion === 'showcase' ? time % 26 < 6 ? 'walk' : time % 26 < 11 ? 'reverse' : time % 26 < 16 ? 'turn' : time % 26 < 22 ? 'aim' : 'fire' : motion;
		if (nextPhase !== phase) phaseTime = 0;
		phase = nextPhase; phaseTime += dt;
		const definition = getFrame(choice.frame); const size = sizeForChoice(); const rig = rigForChoice();
		const forwardSpeed = choice.kind ? choice.kind === 'scout' ? 100 : choice.kind === 'siege' ? 62 : 90 : definition.speed;
		const reverseSpeed = choice.kind ? forwardSpeed * 0.53 : definition.reverseSpeed;
		const targetSpeed = (phase === 'walk' ? forwardSpeed : phase === 'reverse' ? -reverseSpeed : phase === 'aim' ? forwardSpeed * 0.58 : 0) * throttle;
		speed += (targetSpeed - speed) * (1 - Math.exp(-dt * 3.5));
		const heading = body.angle + (phase === 'turn' ? dt * 0.65 : 0);
		body = { x: body.x + Math.cos(heading) * speed * dt, y: body.y + Math.sin(heading) * speed * dt, angle: heading };
		gait = advanceGait(gait, body, dt, size, choice.kind ? 1 : definition.stride, rig);
		const targetAim = body.angle + (phase === 'aim' ? Math.sin(phaseTime * 0.9) * 1.3 : phase === 'turn' ? -Math.sin(phaseTime * 0.5) * 0.55 : 0);
		aim += (targetAim - aim) * (1 - Math.exp(-dt * 5));
		const shotAge = phaseTime % 0.85; const recoil = phase === 'fire' ? Math.max(0, 1 - shotAge / 0.19) : 0;
		model.pose(gait, aim, { recoil, hit: 0, heat: phase === 'fire' ? 45 : 0, time });
		// The camera follows the chassis; move the ground equally so contacts
		// remain stationary relative to the same markings during stance.
		grid.position.set(-body.x % 50, -0.25, -body.y % 50); deck.position.set(-body.x, 0, -body.y);
	};
	for (const button of modeButtons) button.addEventListener('click', function () { const value = button.dataset['motion']; if (isMotion(value)) selectMotion(value); }, { signal: abort.signal });
	modelInput.addEventListener('change', function () { selectModel(getChoice(modelInput.value)); }, { signal: abort.signal });
	pauseButton.addEventListener('click', function () { setPaused(!paused); }, { signal: abort.signal });
	stepButton.addEventListener('click', function () { if (contextLost) return; setPaused(true); step(); }, { signal: abort.signal });
	restartButton.addEventListener('click', resetMotion, { signal: abort.signal });
	orbitButton.addEventListener('click', function () { controls.autoRotate = !controls.autoRotate; orbitButton.setAttribute('aria-pressed', String(controls.autoRotate)); }, { signal: abort.signal });
	throttleInput.addEventListener('input', function () { const value = Number(throttleInput.value); if (!Number.isFinite(value)) return; throttle = Math.max(0, Math.min(1, value / 100)); throttleOutput.textContent = `${Math.round(throttle * 100)}%`; }, { signal: abort.signal });
	playbackInput.addEventListener('change', function () { const value = Number(playbackInput.value); if (value === 1 || value === 0.5 || value === 0.25) playback = value; }, { signal: abort.signal });
	viewInput.addEventListener('change', function () { const value = viewInput.value; if (value === 'side' || value === 'game' || value === 'three-quarter') { view = value; frameModel(); } }, { signal: abort.signal });
	window.addEventListener('keydown', function (event) { if (event.code === 'Space' && (event.target === document.body || event.target === canvas)) { event.preventDefault(); setPaused(!paused); } }, { signal: abort.signal });
	canvas.addEventListener('webglcontextlost', function (event) { event.preventDefault(); contextLost = true; previous = 0; accumulator = 0; boot.hidden = false; boot.textContent = 'The 3D view lost its graphics context. Waiting for recovery…'; }, { signal: abort.signal });
	canvas.addEventListener('webglcontextrestored', function () { contextLost = false; previous = 0; accumulator = 0; boot.hidden = true; }, { signal: abort.signal });
	document.addEventListener('visibilitychange', function () { previous = 0; accumulator = 0; }, { signal: abort.signal });
	window.addEventListener('pageshow', function () { previous = 0; accumulator = 0; resize(); }, { signal: abort.signal });
	const observer = new ResizeObserver(resize); observer.observe(canvas);
	const tick = function (now: number) {
		if (disposed) return;
		const elapsed = previous === 0 ? 0 : Math.min((now - previous) / 1000, 0.1); previous = now;
		if (!document.hidden && !contextLost) {
			if (!paused) { accumulator += elapsed * playback; while (accumulator >= 1 / 60) { step(); accumulator -= 1 / 60; } }
			controls.update(paused ? 0 : elapsed); renderer.render(scene, camera); rendered++;
			label.textContent = phase;
			timeOutput.textContent = `${time.toFixed(3)} s · frame ${ticks}`;
			description.textContent = choice.kind === 'helicopter' ? 'Circling gunship with main and tail rotors, landing skids, and a tracking chin gun.' : choice.kind === 'vtol' ? 'Twin tilt-fan aircraft with independently aimed wing missile pods.' : choice.kind === 'tank' ? 'Tracked armor with a rotating cannon turret and vulnerable flanks.' : descriptions[phase];
			stage.dataset['model'] = choice.id; stage.dataset['motion'] = motion; stage.dataset['phase'] = phase;
			stage.dataset['ticks'] = String(ticks); stage.dataset['frames'] = String(rendered);
			stage.dataset['time'] = String(time); stage.dataset['paused'] = String(paused);
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
	window.addEventListener('pagehide', function (event) { if (!event.persisted) dispose(); else { previous = 0; accumulator = 0; } }, { signal: abort.signal });
	model.pose(gait, aim); resize(); frame = requestAnimationFrame(tick);
	return dispose;
};

try { startStudy(); } catch (error) {
	const message = requireElement('error'); message.hidden = false;
	message.textContent = error instanceof Error ? error.message : 'Could not initialize the model motion study.';
}
