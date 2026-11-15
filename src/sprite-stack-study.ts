interface Atlas { image: string; sliceCount: number; zMin: number }
interface Anchor { x: number; y: number; z: number }
interface StackFrame { atlas: Atlas; anchor: Anchor }
interface StackMotion { duration: number; frames: readonly StackFrame[] }
interface StudyData {
	version: 1;
	grid: { size: number; columns: number; pitch: number };
	torso: Atlas;
	motions: { walk: StackMotion; run: StackMotion; backward: StackMotion };
	source: { commit: string };
	palette: readonly string[];
}
type MotionChoice = 'walk' | 'run' | 'backward' | 'idle';
interface Layer { image: HTMLImageElement; index: number; height: number; x: number; y: number; angle: number }

const isRecord = function (value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); };
const finite = function (value: unknown, low: number, high: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high; };
const parseAtlas = function (value: unknown): Atlas {
	if (!isRecord(value) || typeof value['image'] !== 'string' || !value['image'].startsWith('data:image/png;base64,') || !finite(value['sliceCount'], 1, 256) || !Number.isInteger(value['sliceCount']) || !finite(value['zMin'], -256, 256)) throw new Error('Invalid embedded slice sheet');
	return { image: value['image'], sliceCount: value['sliceCount'], zMin: value['zMin'] };
};
const parseAnchor = function (value: unknown): Anchor {
	if (!isRecord(value) || !finite(value['x'], -256, 256) || !finite(value['y'], -256, 256) || !finite(value['z'], -256, 256)) throw new Error('Invalid embedded waist position');
	return { x: value['x'], y: value['y'], z: value['z'] };
};
const parseMotion = function (value: unknown): StackMotion {
	if (!isRecord(value) || !finite(value['duration'], 0.01, 60) || !Array.isArray(value['frames']) || value['frames'].length < 1 || value['frames'].length > 240) throw new Error('Invalid embedded motion');
	return {
		duration: value['duration'],
		frames: value['frames'].map(function (frame: unknown) {
			if (!isRecord(frame)) throw new Error('Invalid embedded animation frame');
			return { atlas: parseAtlas(frame['atlas']), anchor: parseAnchor(frame['anchor']) };
		}),
	};
};
const parseData = function (value: unknown): StudyData {
	if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['grid']) || !isRecord(value['motions']) || !isRecord(value['source'])) throw new Error('Invalid sprite stack study data');
	const grid = value['grid']; const motions = value['motions']; const source = value['source']; const palette = value['palette'];
	if (!finite(grid['size'], 16, 512) || !Number.isInteger(grid['size']) || !finite(grid['columns'], 1, 32) || !Number.isInteger(grid['columns']) || !finite(grid['pitch'], 0.00001, 10) || typeof source['commit'] !== 'string' || !Array.isArray(palette) || !palette.every(function (color: unknown) { return typeof color === 'string'; })) throw new Error('Invalid sprite stack grid or provenance');
	return {
		version: 1, grid: { size: grid['size'], columns: grid['columns'], pitch: grid['pitch'] },
		torso: parseAtlas(value['torso']), motions: { walk: parseMotion(motions['walk']), run: parseMotion(motions['run']), backward: parseMotion(motions['backward']) },
		source: { commit: source['commit'] }, palette,
	};
};
const element = function (id: string) { const found = document.getElementById(id); if (!found) throw new Error(`Missing study element: ${id}`); return found; };
const input = function (id: string) { const found = element(id); if (!(found instanceof HTMLInputElement)) throw new Error(`Invalid study input: ${id}`); return found; };
const select = function (id: string) { const found = element(id); if (!(found instanceof HTMLSelectElement)) throw new Error(`Invalid study selector: ${id}`); return found; };
const button = function (id: string) { const found = element(id); if (!(found instanceof HTMLButtonElement)) throw new Error(`Invalid study button: ${id}`); return found; };
const canvas = function (id: string) { const found = element(id); if (!(found instanceof HTMLCanvasElement)) throw new Error(`Invalid study canvas: ${id}`); return found; };
const context = function (surface: HTMLCanvasElement) { const found = surface.getContext('2d'); if (!found) throw new Error('Canvas 2D is unavailable'); found.imageSmoothingEnabled = false; return found; };
const loadImage = function (atlas: Atlas, size: number, columns: number): Promise<HTMLImageElement> {
	return new Promise(function (resolve, reject) {
		const image = new Image();
		image.onload = function () {
			if (image.width !== size * columns || image.height !== Math.ceil(atlas.sliceCount / columns) * size) { reject(new Error('Slice sheet dimensions do not match the manifest')); return; }
			resolve(image);
		};
		image.onerror = function () { reject(new Error('A slice sheet could not be decoded')); };
		image.src = atlas.image;
	});
};
const radians = function (degrees: number) { return degrees * Math.PI / 180; };
const wrapAngle = function (angle: number) { return ((angle % 360) + 360) % 360; };
const motionChoice = function (value: string): MotionChoice {
	if (value === 'walk' || value === 'run' || value === 'backward' || value === 'idle') return value;
	throw new Error('Unknown motion choice');
};

const start = async function () {
	const embedded: unknown = JSON.parse(element('sprite-stack-data').textContent ?? '');
	const data = parseData(embedded);
	const sheets = [data.torso, ...Object.values(data.motions).flatMap(function (motion) { return motion.frames.map(function (frame) { return frame.atlas; }); })];
	const images = new Map<Atlas, HTMLImageElement>();
	await Promise.all(sheets.map(async function (sheet) { images.set(sheet, await loadImage(sheet, data.grid.size, data.grid.columns)); }));
	const getImage = function (atlas: Atlas) { const image = images.get(atlas); if (!image) throw new Error('A decoded slice sheet is missing'); return image; };
	const mainCanvas = canvas('stack-canvas'); const mainContext = context(mainCanvas);
	const nativeCanvas = canvas('native-canvas'); const nativeContext = context(nativeCanvas);
	const atlasCanvas = canvas('atlas-canvas'); const atlasContext = context(atlasCanvas);
	const viewport = element('stack-viewport'); const summary = element('stack-summary'); const readout = element('frame-readout'); const atlasSummary = element('atlas-summary');
	const motionInput = select('motion'); const atlasInput = select('atlas-choice');
	const hullInput = input('hull-angle'); const torsoInput = input('torso-angle'); const cameraInput = input('camera'); const spacingInput = input('spacing'); const timelineInput = input('timeline');
	const pauseButton = button('pause'); const turnButton = button('turntable'); const aimButton = button('aim-sweep'); const explodeButton = button('explode');
	const hullValue = element('hull-value'); const torsoValue = element('torso-value'); const cameraValue = element('camera-value'); const spacingValue = element('spacing-value'); const timelineValue = element('timeline-value');
	const inspector = element('atlas-inspector');
	const surface = document.createElement('canvas'); surface.width = 320; surface.height = 512; const surfaceContext = context(surface);
	let choice: MotionChoice = 'walk'; let time = 0; let sweepTime = 0; let paused = false; let turning = false; let sweeping = true;
	let hullAngle = 135; let torsoAngle = 135; let spacing = 1; let cameraAngle = 35; let previous = 0; let animation = 0; let disposed = false;
	let lastAtlas: Atlas | undefined;
	const abort = new AbortController();
	const setPressed = function (control: HTMLButtonElement, state: boolean) { control.setAttribute('aria-pressed', String(state)); };
	const syncPause = function () { setPressed(pauseButton, paused); pauseButton.textContent = paused ? 'Resume' : 'Pause'; };
	const currentMotion = function () { return data.motions[choice === 'idle' ? 'walk' : choice]; };
	const currentIndex = function () { const motion = currentMotion(); return choice === 'idle' ? 0 : Math.min(motion.frames.length - 1, Math.floor((time % motion.duration) / motion.duration * motion.frames.length + 1e-8)); };
	const currentFrame = function () { const frame = currentMotion().frames[currentIndex()]; if (!frame) throw new Error('Motion frame is missing'); return frame; };
	const drawAtlas = function (frame: StackFrame) {
		if (!(inspector instanceof HTMLDetailsElement) || !inspector.open) return;
		const atlas = atlasInput.value === 'legs' ? frame.atlas : data.torso;
		if (lastAtlas === atlas) return;
		lastAtlas = atlas;
		const image = getImage(atlas); atlasCanvas.width = image.width; atlasCanvas.height = image.height; atlasContext.imageSmoothingEnabled = false;
		atlasContext.fillStyle = '#0b171b'; atlasContext.fillRect(0, 0, image.width, image.height);
		atlasContext.drawImage(image, 0, 0);
		atlasContext.strokeStyle = '#314146'; atlasContext.lineWidth = 1;
		for (let index = 0; index < atlas.sliceCount; index++) {
			const x = index % data.grid.columns * data.grid.size; const y = Math.floor(index / data.grid.columns) * data.grid.size;
			atlasContext.strokeRect(x + 0.5, y + 0.5, data.grid.size - 1, data.grid.size - 1);
		}
		atlasSummary.textContent = `${atlas.sliceCount} slices · ${data.grid.size} × ${data.grid.size} pixels per slice`;
	};
	const resize = function () {
		const scale = Math.max(1, Math.floor(viewport.clientWidth / mainCanvas.width));
		mainCanvas.style.width = `${mainCanvas.width * scale}px`; mainCanvas.style.height = `${mainCanvas.height * scale}px`;
	};
	const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(viewport); resize();
	const draw = function () {
		const frame = currentFrame(); const index = currentIndex(); const motion = currentMotion();
		const hull = radians(hullAngle); const torso = radians(torsoAngle + (sweeping ? Math.sin(sweepTime * 0.7) * 38 : 0));
		const squash = Math.sin(radians(cameraAngle)); const elevation = Math.cos(radians(cameraAngle));
		const anchorX = frame.anchor.x * Math.cos(hull) - frame.anchor.y * Math.sin(hull);
		const anchorY = frame.anchor.x * Math.sin(hull) + frame.anchor.y * Math.cos(hull);
		const layers: Layer[] = [
			...Array.from({ length: frame.atlas.sliceCount }, function (_, layer) { return { image: getImage(frame.atlas), index: layer, height: frame.atlas.zMin + layer, x: 0, y: 0, angle: hull }; }),
			...Array.from({ length: data.torso.sliceCount }, function (_, layer) { return { image: getImage(data.torso), index: layer, height: frame.anchor.z + data.torso.zMin + layer, x: anchorX, y: anchorY, angle: torso }; }),
		].sort(function (a, b) { return a.height - b.height; });
		surfaceContext.setTransform(1, 0, 0, 1, 0, 0); surfaceContext.clearRect(0, 0, surface.width, surface.height);
		const baseline = 378; const center = 160;
		surfaceContext.fillStyle = '#15272c'; surfaceContext.fillRect(0, baseline - 65, surface.width, 130);
		surfaceContext.strokeStyle = '#20343a'; surfaceContext.lineWidth = 1;
		for (let row = -5; row <= 5; row++) {
			surfaceContext.beginPath(); surfaceContext.moveTo(0, baseline + row * 14); surfaceContext.lineTo(surface.width, baseline + row * 14); surfaceContext.stroke();
			surfaceContext.beginPath(); surfaceContext.moveTo(center + row * 28 - 70, baseline - 65); surfaceContext.lineTo(center + row * 28 + 70, baseline + 65); surfaceContext.stroke();
		}
		surfaceContext.fillStyle = '#091417'; surfaceContext.beginPath(); surfaceContext.ellipse(center, baseline + 4, 35, 15 * squash, 0, 0, Math.PI * 2); surfaceContext.fill();
		for (const layer of layers) {
			surfaceContext.setTransform(1, 0, 0, 1, Math.round(center + layer.x), Math.round(baseline + layer.y * squash - layer.height * elevation * spacing));
			surfaceContext.scale(1, squash); surfaceContext.rotate(layer.angle);
			surfaceContext.drawImage(layer.image, layer.index % data.grid.columns * data.grid.size, Math.floor(layer.index / data.grid.columns) * data.grid.size, data.grid.size, data.grid.size, -data.grid.size / 2, -data.grid.size / 2, data.grid.size, data.grid.size);
		}
		surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
		mainContext.clearRect(0, 0, mainCanvas.width, mainCanvas.height); mainContext.fillStyle = '#0b171b'; mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
		const footprintRadius = data.grid.size / Math.SQRT2;
		const top = baseline - (frame.anchor.z + data.torso.zMin + data.torso.sliceCount) * elevation * spacing - footprintRadius * squash - 6;
		const bottom = baseline + footprintRadius * squash + 6;
		const expandedSize = Math.ceil(bottom - top);
		const crop = spacing > 1 ? { x: center - expandedSize / 2, y: Math.floor(top), size: expandedSize } : { x: 72, y: 234, size: 176 };
		mainContext.drawImage(surface, crop.x, crop.y, crop.size, crop.size, 0, 0, mainCanvas.width, mainCanvas.height);
		nativeContext.clearRect(0, 0, nativeCanvas.width, nativeCanvas.height); nativeContext.fillStyle = '#0b171b'; nativeContext.fillRect(0, 0, nativeCanvas.width, nativeCanvas.height);
		nativeContext.drawImage(surface, crop.x, crop.y, crop.size, crop.size, 0, 0, 112, 112);
		const actualTorso = wrapAngle(torso * 180 / Math.PI);
		hullInput.value = String(Math.round(wrapAngle(hullAngle))); torsoInput.value = String(Math.round(actualTorso));
		hullValue.textContent = `${Math.round(wrapAngle(hullAngle))}°`; torsoValue.textContent = `${Math.round(actualTorso)}°`;
		cameraValue.textContent = `${cameraAngle}°`; spacingValue.textContent = `${spacing.toFixed(1)}×`;
		timelineInput.max = String(motion.frames.length - 1); timelineInput.value = String(index); timelineInput.disabled = choice === 'idle'; timelineValue.textContent = `${index + 1} / ${motion.frames.length}`;
		summary.textContent = `${frame.atlas.sliceCount + data.torso.sliceCount} stacked layers · ${choice === 'idle' ? 'Idle pose' : `${choice.charAt(0).toUpperCase()}${choice.slice(1)} cycle`}`;
		readout.textContent = `Frame ${index + 1} / ${motion.frames.length}`;
		mainCanvas.dataset['frame'] = String(index); mainCanvas.dataset['motion'] = choice; mainCanvas.dataset['hull'] = wrapAngle(hullAngle).toFixed(2); mainCanvas.dataset['torso'] = actualTorso.toFixed(2); mainCanvas.dataset['spacing'] = spacing.toFixed(1);
		drawAtlas(frame);
	};
	const listen = function (target: EventTarget, event: string, callback: EventListener) { target.addEventListener(event, callback, { signal: abort.signal }); };
	listen(motionInput, 'change', function () { choice = motionChoice(motionInput.value); time = 0; draw(); });
	listen(pauseButton, 'click', function () { paused = !paused; syncPause(); draw(); });
	listen(turnButton, 'click', function () { turning = !turning; setPressed(turnButton, turning); });
	listen(aimButton, 'click', function () { if (sweeping) torsoAngle = Number(torsoInput.value); sweepTime = 0; sweeping = !sweeping; setPressed(aimButton, sweeping); draw(); });
	listen(explodeButton, 'click', function () { spacing = spacing > 1 ? 1 : 2.4; spacingInput.value = String(spacing); setPressed(explodeButton, spacing > 1); draw(); });
	listen(hullInput, 'input', function () { hullAngle = Number(hullInput.value); turning = false; setPressed(turnButton, false); draw(); });
	listen(torsoInput, 'input', function () { torsoAngle = Number(torsoInput.value); sweeping = false; turning = false; setPressed(aimButton, false); setPressed(turnButton, false); draw(); });
	listen(cameraInput, 'input', function () { cameraAngle = Number(cameraInput.value); draw(); });
	listen(spacingInput, 'input', function () { spacing = Number(spacingInput.value); setPressed(explodeButton, spacing > 1); draw(); });
	listen(timelineInput, 'input', function () { paused = true; syncPause(); time = Number(timelineInput.value) / currentMotion().frames.length * currentMotion().duration; draw(); });
	listen(atlasInput, 'change', function () { lastAtlas = undefined; draw(); });
	listen(inspector, 'toggle', function () { lastAtlas = undefined; draw(); });
	listen(document, 'keydown', function (event) {
		if (!(event instanceof KeyboardEvent) || event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
		event.preventDefault(); paused = !paused; syncPause(); draw();
	});
	const loop = function (now: number) {
		if (disposed) return;
		const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0; previous = now;
		if (!paused) { time += delta; sweepTime += delta; if (turning) { hullAngle = wrapAngle(hullAngle + delta * 18); torsoAngle = wrapAngle(torsoAngle + delta * 18); } }
		draw(); animation = requestAnimationFrame(loop);
	};
	listen(window, 'pagehide', function () { disposed = true; cancelAnimationFrame(animation); resizeObserver.disconnect(); abort.abort(); });
	mainCanvas.dataset['renderer'] = 'canvas2d-sprite-stacks'; mainCanvas.dataset['ready'] = 'true';
	draw(); animation = requestAnimationFrame(loop);
};

void start().catch(function (error: unknown) {
	const message = error instanceof Error ? error.message : 'The sprite stack study could not start';
	const output = document.getElementById('error'); if (output) { output.hidden = false; output.textContent = message; }
	console.error('Sprite stack study:', message);
});
