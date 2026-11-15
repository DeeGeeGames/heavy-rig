import { Color, DirectionalLight, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { loadAuthoredWarden } from './authored-mech';
import { advanceGait, createGait } from './gait';
import { FRAME_RIGS } from './frame-rig';
import { getFrame } from './frames';

const element = function (id: string) {
	const result = document.getElementById(id);
	if (!result) throw new Error(`Missing stress-test element: ${id}`);
	return result;
};
const start = function (factory: Awaited<ReturnType<typeof loadAuthoredWarden>>) {
	const canvas = element('stage'); const count = element('count'); const resolution = element('resolution');
	if (!(canvas instanceof HTMLCanvasElement) || !(count instanceof HTMLInputElement) || !(resolution instanceof HTMLSelectElement)) throw new Error('Invalid stress-test controls');
	const renderer = new WebGLRenderer({ canvas, antialias: true });
	const scene = new Scene(); scene.background = new Color('#102027');
	scene.add(new HemisphereLight('#d6e6e0', '#243337', 2.2));
	const key = new DirectionalLight('#ffe2b8', 3.4); key.position.set(140, 300, 100); scene.add(key);
	const camera = new OrthographicCamera(-1000, 1000, 1000, -1000, 1, 10000);
	camera.position.set(0, 3000, 1800); camera.lookAt(0, 0, 0);
	const definition = getFrame('warden');
	type Walker = { model: ReturnType<typeof factory.create>; gait: ReturnType<typeof createGait>; authoredPose: ReturnType<typeof factory.advancePose>; phase: number; radius: number; cx: number; cy: number };
	const walkers: Walker[] = [];
	const abort = new AbortController();
	let frame = 0; let previous = 0; let accumulator = 0; let time = 0; let disposed = false; let lost = false;
	let samples: number[] = []; let sampleTime = 0; let warmup = 0; let reportAt = 0;
	const reset = function () { samples = []; sampleTime = 0; warmup = performance.now() + 2000; element('stats').textContent = 'Warming up for 2 seconds…'; };
	const resize = function () {
		const width = canvas.clientWidth; const height = canvas.clientHeight;
		if (width <= 0 || height <= 0) return;
		renderer.setPixelRatio(Math.min(devicePixelRatio, Number(resolution.value)));
		renderer.setSize(width, height, false);
		const aspect = width / height; const half = 1100;
		camera.left = -half * Math.max(1, aspect); camera.right = -camera.left;
		camera.top = half * Math.max(1, 1 / aspect); camera.bottom = -camera.top; camera.updateProjectionMatrix(); reset();
	};
	const apply = function (delta = 0) {
		const value = Number(count.value);
		if (!Number.isFinite(value)) return;
		const target = Math.max(0, Math.min(1000, Math.round(value) + delta)); count.value = String(target);
		while (walkers.length > target) walkers.pop()?.model.dispose();
		while (walkers.length < target) {
			const phase = Math.random() * Math.PI * 2; const radius = 100 + Math.random() * 180;
			const cx = (Math.random() - 0.5) * 1150; const cy = (Math.random() - 0.5) * 1150;
			const body = { x: cx + Math.cos(phase) * radius, y: cy + Math.sin(phase) * radius, angle: phase + Math.PI / 2 };
			const model = factory.create(); scene.add(model.root);
			walkers.push({ model, authoredPose: factory.advancePose(undefined, body, time), phase, radius, cx, cy, gait: createGait(body, definition.size, FRAME_RIGS.warden) });
		}
		reset();
	};
	const tick = function (now: number) {
		if (disposed || lost) return;
		frame = requestAnimationFrame(tick);
		if (document.hidden) { previous = 0; return; }
		const elapsed = previous ? now - previous : 0; previous = now;
		accumulator += Math.min(elapsed / 1000, 0.1);
		while (accumulator >= 1 / 60) {
			time += 1 / 60; accumulator -= 1 / 60;
			for (const walker of walkers) {
				walker.phase += definition.speed * 0.65 / walker.radius / 60;
				const body = { x: walker.cx + Math.cos(walker.phase) * walker.radius, y: walker.cy + Math.sin(walker.phase) * walker.radius, angle: walker.phase + Math.PI / 2 };
				walker.authoredPose = factory.advancePose(walker.authoredPose, body, time);
				walker.gait = advanceGait(walker.gait, body, 1 / 60, definition.size, definition.stride, FRAME_RIGS.warden);
			}
		}
		for (const walker of walkers) {
			walker.model.pose(walker.gait, walker.gait.body.angle + Math.sin(time * 0.6) * 0.4, { recoil: 0, hit: 0, heat: 0, time, authoredPose: walker.authoredPose });
			walker.model.root.position.set(walker.gait.body.x, 0, walker.gait.body.y);
		}
		renderer.render(scene, camera);
		if (elapsed > 0 && now >= warmup) { samples.push(elapsed); sampleTime += elapsed; }
		if (now - reportAt < 500) return;
		reportAt = now;
		if (samples.length > 0) {
			const ordered = [...samples].sort(function (a, b) { return a - b; });
			const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0;
			const fps = samples.length * 1000 / sampleTime;
			const slow = samples.filter(function (ms) { return ms > 20; }).length / samples.length * 100;
			element('stats').textContent = `${walkers.length} Wardens · ${fps.toFixed(1)} FPS · p95 ${p95.toFixed(1)} ms · ${slow.toFixed(1)}% frames >20ms · ${(sampleTime / 1000).toFixed(0)}s measured`;
			// Bound memory and sorting cost while retaining the latest roughly 10 seconds.
			while (sampleTime > 10000 && samples.length > 1) sampleTime -= samples.shift() ?? 0;
		}
		element('details').textContent = `${renderer.domElement.width} × ${renderer.domElement.height} pixels · DPR ${renderer.getPixelRatio().toFixed(2)} · ${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} triangles`;
	};
	const listen = function (id: string, action: () => void) { element(id).addEventListener('click', action, { signal: abort.signal }); };
	listen('apply', function () { apply(); }); listen('less', function () { apply(-10); }); listen('more', function () { apply(10); }); listen('reset', reset);
	resolution.addEventListener('change', resize, { signal: abort.signal });
	document.addEventListener('visibilitychange', function () { previous = 0; accumulator = 0; reset(); }, { signal: abort.signal });
	canvas.addEventListener('webglcontextlost', function (event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); element('stats').textContent = 'Graphics context lost. Reload and try fewer Wardens.'; }, { signal: abort.signal });
	const observer = new ResizeObserver(resize); observer.observe(canvas);
	window.addEventListener('pagehide', function (event) {
		if (event.persisted) { previous = 0; accumulator = 0; reset(); return; }
		disposed = true; cancelAnimationFrame(frame); observer.disconnect(); abort.abort();
		for (const walker of walkers) walker.model.dispose();
		scene.clear(); renderer.dispose(); renderer.forceContextLoss(); factory.dispose();
	}, { signal: abort.signal });
	apply(); resize(); frame = requestAnimationFrame(tick);
};
try {
	element('stats').textContent = 'Loading authored Warden model…';
	const factory = await loadAuthoredWarden('./assets/mechs/warden/game-ready.glb');
	try { start(factory); } catch (error) { factory.dispose(); throw error; }
} catch (error) { const output = element('error'); output.hidden = false; output.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}`; }
