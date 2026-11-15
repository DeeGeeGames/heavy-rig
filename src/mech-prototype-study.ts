import { ACESFilmicToneMapping, AnimationMixer, ArrowHelper, Bone, Box3, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Line, LoopOnce, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, SkinnedMesh, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const element = function (id: string) {
	const value = document.getElementById(id);
	if (!value) throw new Error(`Missing prototype control: ${id}`);
	return value;
};
const input = function (id: string) {
	const value = element(id);
	if (!(value instanceof HTMLInputElement)) throw new Error(`Invalid input: ${id}`);
	return value;
};
const button = function (id: string) {
	const value = element(id);
	if (!(value instanceof HTMLButtonElement)) throw new Error(`Invalid button: ${id}`);
	return value;
};
const select = function (id: string) {
	const value = element(id);
	if (!(value instanceof HTMLSelectElement)) throw new Error(`Invalid select: ${id}`);
	return value;
};
const start = async function () {
	const canvas = element('prototype-canvas');
	if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing prototype canvas');
	const status = element('status'); const timeline = input('timeline'); const heading = input('heading'); const aim = input('aim'); const guides = input('guides');
	const comparison = select('comparison'); const wireframe = input('wireframe');
	const play = button('play'); const restart = button('restart'); const step = button('step'); const speed = select('speed'); const view = select('view');
	const renderer = new WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap; renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
	const scene = new Scene(); scene.background = new Color('#18282d');
	const camera = new PerspectiveCamera(33, 1, 1, 3000);
	const orbit = new OrbitControls(camera, canvas); orbit.enablePan = false; orbit.minDistance = 160; orbit.maxDistance = 1200; orbit.maxPolarAngle = Math.PI * 0.48;
	scene.add(new HemisphereLight('#e0e9df', '#42514e', 2.2));
	const key = new DirectionalLight('#fff0d9', 3); key.position.set(150, 260, 180); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
	key.shadow.camera.left = -180; key.shadow.camera.right = 180; key.shadow.camera.top = 220; key.shadow.camera.bottom = -180; key.shadow.camera.far = 800; key.shadow.normalBias = 0.25; scene.add(key);
	const rim = new DirectionalLight('#b5d8df', 1.6); rim.position.set(-150, 180, -120); scene.add(rim);
	const floor = new Mesh(new PlaneGeometry(3000, 3000), new MeshStandardMaterial({ color: '#304346', roughness: 1 }));
	floor.rotation.x = -Math.PI / 2; floor.position.y = -1; floor.receiveShadow = true; scene.add(floor);
	const grid = new GridHelper(2400, 48, '#687b72', '#435b58'); grid.position.y = 0; scene.add(grid);
	const models = ['master', 'candidate'].map(function (name) {
		const hull = new Group(); const normalized = new Group(); hull.add(normalized); hull.visible = false; scene.add(hull);
		return { name, hull, normalized, pose: function () {}, triangles: 0, draws: 0 };
	});
	const abort = new AbortController(); let disposed = false; let contextLost = false; let frame = 0; let previous = 0; let playing = false; let time = 0; let accumulator = 0;
	const mixers: AnimationMixer[] = []; let duration = 8;
	const setPlaying = function (value: boolean) { playing = value; previous = 0; accumulator = 0; play.textContent = value ? 'Pause' : time >= duration ? 'Replay walk' : 'Play walk'; };
	const frameView = function () {
		const direction = view.value === 'chest' ? new Vector3(1, 0.06, 0) : view.value === 'side' ? new Vector3(0, 0.16, 1) : view.value === 'rear' ? new Vector3(-1, 0.4, -1) : view.value.startsWith('game') ? new Vector3(1, 1, 1) : new Vector3(1.2, 0.5, 1);
		const distance = (view.value === 'chest' ? 40 : view.value === 'game-small' ? 250 : 110) / Math.tan(camera.fov * Math.PI / 360) / Math.min(1, camera.aspect);
		orbit.target.set(0, view.value === 'chest' ? 112 : 80, 0); camera.position.copy(direction.normalize().multiplyScalar(distance)).add(orbit.target); orbit.update();
	};
	const resize = function () {
		if (!canvas.clientWidth || !canvas.clientHeight) return;
		renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight / (comparison.value === 'both' ? 2 : 1); camera.updateProjectionMatrix(); frameView();
	};
	const observer = new ResizeObserver(resize); observer.observe(canvas);
	const dispose = function () {
		if (disposed) return; disposed = true; cancelAnimationFrame(frame); abort.abort(); observer.disconnect(); orbit.dispose(); for (const mixer of mixers) mixer.stopAllAction();
		scene.traverse(function (object) {
			if (object instanceof Mesh || object instanceof Line) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); }
			if (object instanceof SkinnedMesh) object.skeleton.dispose();
		});
		for (const mixer of mixers) mixer.uncacheRoot(mixer.getRoot()); key.shadow.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss();
	};
	window.addEventListener('pagehide', function (event) { if (!event.persisted) dispose(); else previous = 0; }, { signal: abort.signal });
	document.addEventListener('visibilitychange', function () { previous = 0; accumulator = 0; }, { signal: abort.signal });
	canvas.addEventListener('webglcontextlost', function (event) { event.preventDefault(); contextLost = true; previous = 0; status.textContent = 'Graphics context lost. Waiting for recovery…'; }, { signal: abort.signal });
	canvas.addEventListener('webglcontextrestored', function () { contextLost = false; previous = 0; status.textContent = 'Graphics restored. Prototype ready.'; }, { signal: abort.signal });
	const refresh = function () { for (const model of models) model.pose(); timeline.value = String(time); element('time').textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`; };
	const advance = function () { time = Math.min(duration, time + 1 / 60); refresh(); if (time >= duration) setPlaying(false); };
	play.addEventListener('click', function () { if (time >= duration) { time = 0; refresh(); } setPlaying(!playing); }, { signal: abort.signal });
	restart.addEventListener('click', function () { time = 0; setPlaying(false); refresh(); }, { signal: abort.signal });
	step.addEventListener('click', function () { setPlaying(false); advance(); }, { signal: abort.signal });
	timeline.addEventListener('input', function () { setPlaying(false); time = Math.max(0, Math.min(duration, Number(timeline.value))); refresh(); }, { signal: abort.signal });
	for (const control of [heading, aim, guides]) control.addEventListener('input', refresh, { signal: abort.signal });
	comparison.addEventListener('change', function () {
		element('left-label').textContent = comparison.value === 'candidate' ? 'Reduced candidate' : 'Approved master';
		element('right-label').hidden = comparison.value !== 'both';
		element('left-label').style.width = comparison.value === 'both' ? '50%' : '100%'; resize();
	}, { signal: abort.signal });
	wireframe.addEventListener('input', function () { scene.traverse(function (object) { if (object instanceof SkinnedMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof MeshStandardMaterial) material.wireframe = wireframe.checked; }); }, { signal: abort.signal });
	view.addEventListener('change', frameView, { signal: abort.signal }); button('reset-view').addEventListener('click', frameView, { signal: abort.signal });
	const tick = function (now: number) {
		if (disposed) return;
		const elapsed = previous ? Math.min(0.1, (now - previous) / 1000) : 0; previous = now;
		if (!document.hidden && !contextLost) {
			if (playing) { accumulator += elapsed * Number(speed.value); while (accumulator >= 1 / 60 && playing) { accumulator -= 1 / 60; advance(); } }
			orbit.update();
			const width = canvas.clientWidth; const height = canvas.clientHeight; const split = Math.floor(width / 2);
			renderer.setScissorTest(true);
			const visible = models.filter(function (model) { return comparison.value === 'both' || comparison.value === model.name; });
			for (const [index, model] of visible.entries()) {
				for (const other of models) other.hull.visible = other === model;
				const left = comparison.value === 'both' ? index * split : 0; const paneWidth = comparison.value === 'both' ? (index === 0 ? split : width - split) : width;
				renderer.setViewport(left, 0, paneWidth, height); renderer.setScissor(left, 0, paneWidth, height); renderer.render(scene, camera);
			}
			renderer.setScissorTest(false);
			canvas.dataset['time'] = String(time); canvas.dataset['playing'] = String(playing);
		}
		frame = requestAnimationFrame(tick);
	};
	resize(); frame = requestAnimationFrame(tick);
	try {
		let referenceScale = 0; let referenceFloor = 0;
		for (const model of models) {
			const { hull, normalized } = model;
			const url = document.body.dataset[model.name === 'master' ? 'modelUrl' : 'candidateUrl']; if (!url) throw new Error('Missing prototype model URL');
			// Fetch is cancellable, including navigation away while the GLB is downloading.
			const response = await fetch(url, { signal: abort.signal }); if (!response.ok) throw new Error(`Model request failed (${response.status})`);
			const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
			normalized.add(gltf.scene);
			if (disposed) { gltf.scene.traverse(function (object) { if (object instanceof Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); } if (object instanceof SkinnedMesh) object.skeleton.dispose(); }); return; }
			const clip = gltf.animations[0]; const pelvis = gltf.scene.getObjectByName('pelvis'); const torso = gltf.scene.getObjectByName('torso');
			if (!clip || !(pelvis instanceof Bone) || !(torso instanceof Bone)) throw new Error('The prototype requires its approved walk, pelvis, and torso bones.');
			const mixer = new AnimationMixer(normalized); mixers.push(mixer); const animation = mixer.clipAction(clip); animation.setLoop(LoopOnce, 1); animation.clampWhenFinished = true; animation.play();
			const startTime = Math.min(...clip.tracks.map(function (track) { return track.times[0] ?? 0; }));
			mixer.setTime(startTime); normalized.updateMatrixWorld(true);
			gltf.scene.traverse(function (object) { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof MeshStandardMaterial) material.wireframe = wireframe.checked; } });
			const bounds = new Box3().setFromObject(gltf.scene); const height = bounds.max.y - bounds.min.y;
			if (!Number.isFinite(height) || height <= 0) throw new Error('Invalid prototype dimensions');
			if (model.name === 'master') { referenceScale = 160 / height; referenceFloor = -bounds.min.y * referenceScale; }
			const scale = referenceScale; normalized.scale.setScalar(scale); normalized.rotation.y = Math.PI / 2;
			const initial = pelvis.position.clone(); const yaw = new Quaternion(); const axis = new Vector3(0, 1, 0); const travel = new Vector3();
			const arrows = [-1, 1].map(function (side) {
				// Source GLB coordinates: launcher faces at x ±.19, y .863, z .145.
				const arrow = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(side * 0.19, 0.269, 0.09), 0.3, 0xe9b457, 0.035, 0.018); arrow.visible = guides.checked; torso.add(arrow); return arrow;
			});
			const clipDuration = Math.round((clip.duration - startTime) * 1e6) / 1e6;
			if (model.name === 'candidate' && clipDuration !== duration) throw new Error('Candidate animation duration differs from the master.');
			duration = clipDuration; timeline.max = String(duration);
			const activeMixer = mixer; const animatedTorso = torso.quaternion.clone();
			model.pose = function () {
				torso.quaternion.copy(animatedTorso);
				animation.paused = false; activeMixer.setTime(time + startTime); animatedTorso.copy(torso.quaternion);
				torso.quaternion.premultiply(yaw.setFromAxisAngle(axis, Number(aim.value) * Math.PI / 180));
				hull.rotation.y = Number(heading.value) * Math.PI / 180;
				travel.set(pelvis.position.x - initial.x, 0, pelvis.position.z - initial.z).multiplyScalar(scale).applyAxisAngle(axis, Math.PI / 2);
				normalized.position.copy(travel).negate(); normalized.position.y = referenceFloor;
				travel.applyAxisAngle(axis, hull.rotation.y); grid.position.set(-travel.x, 0, -travel.z);
				for (const arrow of arrows) arrow.visible = guides.checked;
				element('heading-value').textContent = `${heading.value}°`; element('aim-value').textContent = `${aim.value}°`;
			};
			model.pose();
			gltf.scene.traverse(function (object) { if (object instanceof SkinnedMesh) { model.triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3; model.draws++; } });
		}
		element('stats').textContent = models.map(function (model) { return `${model.name === 'master' ? 'Master' : 'Candidate'}: ${model.triangles.toLocaleString()} triangles · ${model.draws} mesh draws`; }).join(' / ');
		refresh(); frameView(); play.disabled = false; restart.disabled = false; step.disabled = false; timeline.disabled = false;
		status.textContent = 'Reduced candidate versus approved master · same scale and animation · no roster assignment'; canvas.dataset['ready'] = 'true';
	} catch (error) {
		if (!disposed) { status.textContent = error instanceof Error ? error.message : 'Could not load the prototype.'; status.dataset['error'] = 'true'; }
	}
};
void start().catch(function (error: unknown) { const status = element('status'); status.textContent = error instanceof Error ? error.message : 'Could not initialize the prototype.'; status.dataset['error'] = 'true'; });
