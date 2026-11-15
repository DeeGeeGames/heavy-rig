interface SliceAtlas { image: string; sliceCount: number; zMin: number }
interface TorsoData {
	version: 1;
	grid: { size: number; columns: number; occupiedRadius: number };
	layers: SliceAtlas;
	unpainted: SliceAtlas;
	reference: { image: string; width: number; height: number };
	frame: { width: number; height: number };
	camera: { yaw: number; elevation: number; origin: { x: number; y: number } };
	metrics: { silhouetteIoU: number; colorMeanError: number; matchedPixelCount: number };
	source: { scope: string; paintMethod: string };
	voxelCount: number;
}
interface ViewState { yaw: number; elevation: number; plain: boolean; exploded: boolean; overlay: number; rotating: boolean }
interface ViewFrame { width: number; height: number; offsetX: number; offsetY: number }

const isRecord = function (value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const finite = function (value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
};
const integer = function (value: unknown, minimum: number, maximum: number): value is number {
	return finite(value, minimum, maximum) && Number.isInteger(value);
};
const png = function (value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length > 22;
};
const parseAtlas = function (value: unknown): SliceAtlas {
	if (!isRecord(value) || !png(value['image']) || !integer(value['sliceCount'], 1, 256) || !integer(value['zMin'], -256, 256)) throw new Error('Invalid embedded slice atlas.');
	return { image: value['image'], sliceCount: value['sliceCount'], zMin: value['zMin'] };
};
const parseData = function (value: unknown): TorsoData {
	if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['grid']) || !isRecord(value['reference']) || !isRecord(value['frame']) || !isRecord(value['camera']) || !isRecord(value['metrics']) || !isRecord(value['source'])) throw new Error('Invalid embedded torso data.');
	const grid = value['grid']; const reference = value['reference']; const frame = value['frame'];
	const camera = value['camera']; const metrics = value['metrics']; const source = value['source'];
	if (!integer(grid['size'], 8, 256) || !integer(grid['columns'], 1, 32) || !integer(frame['width'], 8, 256) || !integer(frame['height'], 8, 256)) throw new Error('Invalid torso grid or comparison frame.');
	if (!finite(grid['occupiedRadius'], 1, grid['size'] * Math.SQRT2 / 2 + 1)) throw new Error('Invalid occupied torso bounds.');
	if (!png(reference['image']) || reference['width'] !== frame['width'] || reference['height'] !== frame['height']) throw new Error('Reference and result must use the same logical frame.');
	if (!finite(camera['yaw'], -360, 360) || !finite(camera['elevation'], 5, 75) || !isRecord(camera['origin'])) throw new Error('Invalid matched camera.');
	const origin = camera['origin'];
	if (!finite(origin['x'], 0, frame['width']) || !finite(origin['y'], 0, frame['height'])) throw new Error('Invalid torso origin.');
	if (!finite(metrics['silhouetteIoU'], 0, 1) || !finite(metrics['colorMeanError'], 0, 255) || !integer(metrics['matchedPixelCount'], 0, frame['width'] * frame['height'])) throw new Error('Invalid comparison diagnostics.');
	if (typeof source['scope'] !== 'string' || typeof source['paintMethod'] !== 'string' || !integer(value['voxelCount'], 1, 256 * 256 * 256)) throw new Error('Invalid torso provenance.');
	const layers = parseAtlas(value['layers']); const unpainted = parseAtlas(value['unpainted']);
	if (unpainted.sliceCount !== layers.sliceCount || unpainted.zMin !== layers.zMin) throw new Error('Painted and plain atlases must describe the same volume.');
	return {
		version: 1,
		grid: { size: grid['size'], columns: grid['columns'], occupiedRadius: grid['occupiedRadius'] }, layers, unpainted,
		reference: { image: reference['image'], width: frame['width'], height: frame['height'] },
		frame: { width: frame['width'], height: frame['height'] },
		camera: { yaw: camera['yaw'], elevation: camera['elevation'], origin: { x: origin['x'], y: origin['y'] } },
		metrics: { silhouetteIoU: metrics['silhouetteIoU'], colorMeanError: metrics['colorMeanError'], matchedPixelCount: metrics['matchedPixelCount'] },
		source: { scope: source['scope'], paintMethod: source['paintMethod'] }, voxelCount: value['voxelCount'],
	};
};
const element = function (id: string) {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing torso viewer element: ${id}`);
	return found;
};
const input = function (id: string) {
	const found = element(id);
	if (!(found instanceof HTMLInputElement)) throw new Error(`Invalid torso input: ${id}`);
	return found;
};
const button = function (id: string) {
	const found = element(id);
	if (!(found instanceof HTMLButtonElement)) throw new Error(`Invalid torso button: ${id}`);
	return found;
};
const canvas = function (id: string) {
	const found = element(id);
	if (!(found instanceof HTMLCanvasElement)) throw new Error(`Invalid torso canvas: ${id}`);
	return found;
};
const context = function (surface: HTMLCanvasElement) {
	const found = surface.getContext('2d');
	if (!found) throw new Error('Canvas 2D is unavailable.');
	found.imageSmoothingEnabled = false;
	return found;
};
const loadImage = function (source: string, width: number, height: number): Promise<HTMLImageElement> {
	return new Promise(function (resolve, reject) {
		const image = new Image();
		image.onload = function () {
			if (image.naturalWidth !== width || image.naturalHeight !== height) { reject(new Error('Decoded PNG dimensions do not match the torso manifest.')); return; }
			resolve(image);
		};
		image.onerror = function () { reject(new Error('An embedded torso PNG could not be decoded.')); };
		image.src = source;
	});
};
const radians = function (degrees: number) { return degrees * Math.PI / 180; };
const wrapAngle = function (degrees: number) { return ((degrees % 360) + 360) % 360; };
const diagnosticFrame = function (data: TorsoData, spacing: number): ViewFrame {
	const radius = data.grid.occupiedRadius;
	const highest = Math.max(0, data.layers.zMin + data.layers.sliceCount - 1) * spacing;
	const lowest = Math.min(0, data.layers.zMin) * spacing;
	const left = Math.max(4, Math.ceil(radius - data.camera.origin.x) + 4);
	const right = Math.max(4, Math.ceil(radius - (data.frame.width - data.camera.origin.x)) + 4);
	const top = Math.max(4, Math.ceil(highest + radius - data.camera.origin.y) + 4);
	const bottom = Math.max(4, Math.ceil(-lowest + radius - (data.frame.height - data.camera.origin.y)) + 4);
	return { width: data.frame.width + left + right, height: data.frame.height + top + bottom, offsetX: left, offsetY: top };
};

const start = async function () {
	const embedded: unknown = JSON.parse(element('torso-data').textContent ?? '');
	const data = parseData(embedded);
	const atlasWidth = data.grid.size * data.grid.columns;
	const atlasHeight = Math.ceil(data.layers.sliceCount / data.grid.columns) * data.grid.size;
	const [painted, plain, reference] = await Promise.all([
		loadImage(data.layers.image, atlasWidth, atlasHeight),
		loadImage(data.unpainted.image, atlasWidth, atlasHeight),
		loadImage(data.reference.image, data.reference.width, data.reference.height),
	]);
	const referenceCanvas = canvas('torso-reference'); const referenceContext = context(referenceCanvas);
	const resultCanvas = canvas('torso-result'); const resultContext = context(resultCanvas);
	const referenceStage = element('reference-stage'); const resultStage = element('result-stage');
	const yawInput = input('torso-yaw'); const elevationInput = input('torso-elevation'); const overlayInput = input('torso-overlay');
	const resetButton = button('torso-reset'); const rotateButton = button('torso-rotate');
	const explodeButton = button('torso-explode'); const plainButton = button('torso-plain');
	const state: ViewState = { yaw: wrapAngle(data.camera.yaw), elevation: data.camera.elevation, plain: false, exploded: false, overlay: 0, rotating: false };
	const normalFrame: ViewFrame = { ...data.frame, offsetX: 0, offsetY: 0 };
	const cameraFrame = diagnosticFrame(data, 1); const explodedFrame = diagnosticFrame(data, 2.3);
	const events = new AbortController(); let animation = 0; let lastTime = 0; let disposed = false;
	const matchedCamera = function () {
		return Math.abs(wrapAngle(state.yaw - data.camera.yaw + 180) - 180) < 0.000001 && Math.abs(state.elevation - data.camera.elevation) < 0.000001;
	};
	const viewFrame = function () { return state.exploded ? explodedFrame : state.rotating || !matchedCamera() ? cameraFrame : normalFrame; };
	const resize = function () {
		const frame = viewFrame();
		const availableWidth = Math.max(1, Math.min(referenceStage.clientWidth, resultStage.clientWidth) - 16);
		const scale = Math.max(1, Math.min(8, Math.floor(availableWidth / frame.width), Math.floor(384 / frame.height)));
		for (const surface of [referenceCanvas, resultCanvas]) {
			surface.style.width = `${frame.width * scale}px`; surface.style.height = `${frame.height * scale}px`;
		}
		element('torso-scale').textContent = `${frame.width} × ${frame.height} logical pixels · ${scale}× display`;
	};
	const render = function () {
		const frame = viewFrame();
		for (const surface of [referenceCanvas, resultCanvas]) {
			if (surface.width !== frame.width || surface.height !== frame.height) { surface.width = frame.width; surface.height = frame.height; }
		}
		referenceContext.setTransform(1, 0, 0, 1, 0, 0); referenceContext.imageSmoothingEnabled = false;
		referenceContext.clearRect(0, 0, frame.width, frame.height);
		referenceContext.drawImage(reference, frame.offsetX, frame.offsetY);
		resultContext.setTransform(1, 0, 0, 1, 0, 0); resultContext.imageSmoothingEnabled = false;
		resultContext.clearRect(0, 0, frame.width, frame.height);
		const elevation = radians(state.elevation); const spacing = state.exploded ? 2.3 : 1;
		const image = state.plain ? plain : painted;
		for (let index = 0; index < data.layers.sliceCount; index += 1) {
			resultContext.save();
			resultContext.translate(Math.round(data.camera.origin.x + frame.offsetX), Math.round(data.camera.origin.y + frame.offsetY - (data.layers.zMin + index) * Math.cos(elevation) * spacing));
			resultContext.scale(1, Math.sin(elevation)); resultContext.rotate(radians(state.yaw));
			resultContext.drawImage(image, (index % data.grid.columns) * data.grid.size, Math.floor(index / data.grid.columns) * data.grid.size, data.grid.size, data.grid.size, -data.grid.size / 2, -data.grid.size / 2, data.grid.size, data.grid.size);
			resultContext.restore();
		}
		if (state.overlay > 0) {
			resultContext.save(); resultContext.globalAlpha = state.overlay;
			resultContext.drawImage(reference, frame.offsetX, frame.offsetY); resultContext.restore();
		}
		yawInput.value = state.yaw.toFixed(1); elevationInput.value = state.elevation.toFixed(1); overlayInput.value = String(Math.round(state.overlay * 100));
		element('torso-yaw-value').textContent = `${state.yaw.toFixed(1)}°`;
		element('torso-elevation-value').textContent = `${state.elevation.toFixed(1)}°`;
		element('torso-overlay-value').textContent = `${Math.round(state.overlay * 100)}%`;
		rotateButton.textContent = state.rotating ? 'Stop rotation' : 'Rotate'; rotateButton.setAttribute('aria-pressed', String(state.rotating));
		explodeButton.setAttribute('aria-pressed', String(state.exploded)); plainButton.setAttribute('aria-pressed', String(state.plain));
		const matched = matchedCamera() && !state.rotating && !state.plain && !state.exploded && state.overlay === 0;
		element('torso-view-note').textContent = matched ? 'Matched reference view · fixed A2 paint' : state.exploded ? 'Expanded layer diagnostic · reset for the matched reference view' : frame !== normalFrame ? 'Expanded camera diagnostic · reset for the matched reference view' : 'Diagnostic view · reset for the matched reference view';
		element('torso-overlay-note').hidden = state.overlay === 0;
		resultCanvas.dataset['ready'] = 'true'; resultCanvas.dataset['renderer'] = 'canvas2d-sprite-stacks';
		resultCanvas.dataset['yaw'] = String(state.yaw); resultCanvas.dataset['elevation'] = String(state.elevation);
		resultCanvas.dataset['mode'] = state.plain ? 'plain' : 'painted'; resultCanvas.dataset['exploded'] = String(state.exploded); resultCanvas.dataset['overlay'] = String(state.overlay);
		resultCanvas.dataset['frame'] = frame !== normalFrame ? 'expanded' : 'matched';
		resize();
	};
	const stopRotation = function () {
		state.rotating = false; cancelAnimationFrame(animation); animation = 0; lastTime = 0;
	};
	const tick = function (time: number) {
		if (disposed || !state.rotating) return;
		const delta = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000); lastTime = time;
		state.yaw = wrapAngle(state.yaw + delta * 24); render(); animation = requestAnimationFrame(tick);
	};
	resetButton.addEventListener('click', function () {
		stopRotation(); state.yaw = wrapAngle(data.camera.yaw); state.elevation = data.camera.elevation;
		state.plain = false; state.exploded = false; state.overlay = 0; render();
	}, { signal: events.signal });
	rotateButton.addEventListener('click', function () {
		if (state.rotating) stopRotation(); else { state.rotating = true; animation = requestAnimationFrame(tick); }
		render();
	}, { signal: events.signal });
	explodeButton.addEventListener('click', function () { state.exploded = !state.exploded; render(); }, { signal: events.signal });
	plainButton.addEventListener('click', function () { state.plain = !state.plain; render(); }, { signal: events.signal });
	yawInput.addEventListener('input', function () {
		const value = Number(yawInput.value); if (!finite(value, 0, 360)) return;
		stopRotation(); state.yaw = value; render();
	}, { signal: events.signal });
	elevationInput.addEventListener('input', function () {
		const value = Number(elevationInput.value); if (!finite(value, 5, 75)) return;
		state.elevation = value; render();
	}, { signal: events.signal });
	overlayInput.addEventListener('input', function () {
		const value = Number(overlayInput.value); if (!finite(value, 0, 100)) return;
		state.overlay = value / 100; render();
	}, { signal: events.signal });
	element('torso-iou').textContent = `${(data.metrics.silhouetteIoU * 100).toFixed(1)}%`;
	element('torso-paint-error').textContent = `${data.metrics.colorMeanError.toFixed(1)} / 255`;
	element('torso-matched-pixels').textContent = data.metrics.matchedPixelCount.toLocaleString();
	element('torso-volume').textContent = `${data.voxelCount.toLocaleString()} occupied voxels · ${data.layers.sliceCount} PNG layers`;
	element('torso-scope').textContent = data.source.scope; element('torso-paint-method').textContent = data.source.paintMethod;
	const observer = new ResizeObserver(resize); observer.observe(referenceStage); observer.observe(resultStage);
	window.addEventListener('pagehide', function () { disposed = true; stopRotation(); events.abort(); observer.disconnect(); }, { once: true, signal: events.signal });
	render(); element('torso-loading').hidden = true; element('torso-controls').removeAttribute('disabled');
};

void start().catch(function (error: unknown) {
	const message = error instanceof Error ? error.message : 'The isolated torso viewer could not start.';
	const status = document.getElementById('torso-loading');
	if (status) { status.hidden = false; status.textContent = message; status.setAttribute('data-error', 'true'); }
	const result = document.getElementById('torso-result');
	if (result) result.dataset['ready'] = 'error';
});
