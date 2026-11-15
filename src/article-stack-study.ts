type ViewName = 'top' | 'side' | 'front' | 'back';
interface InputView { name: ViewName; image: string; width: number; height: number }
interface SliceSheet { image: string; width: number; height: number; count: number }
interface Dataset { id: string; label: string; views: InputView[]; slices: SliceSheet; notes: string[] }
interface StudyData { version: 1; articleUrl: string; datasets: Dataset[]; defaultDataset: string }
interface LoadedDataset { data: Dataset; views: { data: InputView; image: HTMLImageElement }[]; slices: HTMLImageElement; pixels: ImageData }
interface State { yaw: number; squash: number; spacing: number; layer: number; rotating: boolean }

const record = function (value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const number = function (value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
};
const integer = function (value: unknown, minimum: number, maximum: number): value is number {
	return number(value, minimum, maximum) && Number.isInteger(value);
};
const png = function (value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length > 22;
};
const viewName = function (value: unknown): value is ViewName {
	return value === 'top' || value === 'side' || value === 'front' || value === 'back';
};
const parseView = function (value: unknown): InputView {
	if (!record(value) || !viewName(value['name']) || !png(value['image']) || !integer(value['width'], 1, 256) || !integer(value['height'], 1, 256)) throw new Error('Invalid orthographic source image.');
	return { name: value['name'], image: value['image'], width: value['width'], height: value['height'] };
};
const parseDataset = function (value: unknown): Dataset {
	if (!record(value) || typeof value['id'] !== 'string' || !/^[a-z0-9-]+$/.test(value['id']) || typeof value['label'] !== 'string' || !Array.isArray(value['views']) || !Array.isArray(value['notes']) || !record(value['slices'])) throw new Error('Invalid article study dataset.');
	const views = value['views'].map(parseView); const slices = value['slices'];
	if (views.length !== 4 || new Set(views.map(function (view) { return view.name; })).size !== 4) throw new Error('Each dataset needs exactly four named views.');
	if (!png(slices['image']) || !integer(slices['width'], 1, 256) || !integer(slices['height'], 1, 256) || !integer(slices['count'], 1, 256)) throw new Error('Invalid horizontal slice sheet.');
	const notes = value['notes'].map(function (note: unknown) { if (typeof note !== 'string') throw new Error('Invalid dataset note.'); return note; });
	return { id: value['id'], label: value['label'], views, slices: { image: slices['image'], width: slices['width'], height: slices['height'], count: slices['count'] }, notes };
};
const parseData = function (value: unknown): StudyData {
	if (!record(value) || value['version'] !== 1 || typeof value['articleUrl'] !== 'string' || !value['articleUrl'].startsWith('https://') || typeof value['defaultDataset'] !== 'string' || !Array.isArray(value['datasets'])) throw new Error('Invalid embedded article study.');
	const datasets = value['datasets'].map(parseDataset);
	if (!datasets.length || new Set(datasets.map(function (dataset) { return dataset.id; })).size !== datasets.length || !datasets.some(function (dataset) { return dataset.id === value['defaultDataset']; })) throw new Error('Invalid dataset selection.');
	return { version: 1, articleUrl: value['articleUrl'], datasets, defaultDataset: value['defaultDataset'] };
};
const element = function (id: string) { const result = document.getElementById(id); if (!result) throw new Error(`Missing article study element: ${id}`); return result; };
const input = function (id: string) { const result = element(id); if (!(result instanceof HTMLInputElement)) throw new Error(`Invalid article control: ${id}`); return result; };
const button = function (id: string) { const result = element(id); if (!(result instanceof HTMLButtonElement)) throw new Error(`Invalid article button: ${id}`); return result; };
const canvas = function (id: string) { const result = element(id); if (!(result instanceof HTMLCanvasElement)) throw new Error(`Invalid article canvas: ${id}`); return result; };
const context = function (surface: HTMLCanvasElement) { const result = surface.getContext('2d'); if (!result) throw new Error('Canvas2D is unavailable.'); result.imageSmoothingEnabled = false; return result; };
const loadImage = function (source: string, width: number, height: number): Promise<HTMLImageElement> {
	return new Promise(function (resolve, reject) {
		const image = new Image(); image.onload = function () {
			if (image.naturalWidth !== width || image.naturalHeight !== height) { reject(new Error('Decoded source dimensions differ from the manifest.')); return; }
			resolve(image);
		}; image.onerror = function () { reject(new Error('An embedded study PNG could not be decoded.')); }; image.src = source;
	});
};
const decodePixels = function (source: HTMLImageElement) {
	const surface = document.createElement('canvas');
	surface.width = source.width; surface.height = source.height;
	const target = context(surface);
	target.drawImage(source, 0, 0);
	const pixels = target.getImageData(0, 0, source.width, source.height);
	for (let index = 3; index < pixels.data.length; index += 4) {
		if (pixels.data[index] !== 0 && pixels.data[index] !== 255) throw new Error('Slice sheets require binary transparency.');
	}
	return pixels;
};
const frame = function (sheet: SliceSheet, spacing: number) {
	const radius = Math.ceil(Math.hypot(sheet.width, sheet.height) / 2);
	const lift = Math.round((sheet.count - 1) * Math.max(1, spacing));
	return { width: radius * 2 + 8, height: radius * 2 + lift + 8, x: radius + 4, y: radius + 4 + lift };
};
const displayScale = function (surface: HTMLCanvasElement, stage: HTMLElement, maximumHeight: number, maximumScale: number) {
	const available = Math.max(1, stage.clientWidth - 16);
	const scale = Math.max(1, Math.min(maximumScale, Math.floor(available / surface.width), Math.floor(maximumHeight / surface.height)));
	surface.style.width = `${surface.width * scale}px`; surface.style.height = `${surface.height * scale}px`;
	return scale;
};
const drawStack = function (target: CanvasRenderingContext2D, dataset: LoadedDataset, state: State, bounds: ReturnType<typeof frame>) {
	const sheet = dataset.data.slices; const source = dataset.pixels;
	const output = target.createImageData(bounds.width, bounds.height);
	const angle = state.yaw * Math.PI / 180; const cardinal = Number.isInteger(state.yaw / 90);
	const cosine = cardinal ? Math.round(Math.cos(angle)) : Math.cos(angle);
	const sine = cardinal ? Math.round(Math.sin(angle)) : Math.sin(angle);
	const centerX = Math.floor(sheet.width / 2); const centerY = Math.floor(sheet.height / 2);
	// Nearest texel lookup through the inverse article transform. Sampling at
	// pixel centers avoids Canvas drawImage's quad-edge AA and scale rounding.
	for (let z = 0; z < sheet.count; z += 1) {
		const originY = bounds.y - Math.round(z * state.spacing);
		for (let y = 0; y < bounds.height; y += 1) {
			const planeY = (y + 0.5 - originY) / state.squash;
			for (let x = 0; x < bounds.width; x += 1) {
				const planeX = x + 0.5 - bounds.x;
				const sx = Math.floor(cosine * planeX + sine * planeY + centerX);
				const sy = Math.floor(-sine * planeX + cosine * planeY + centerY);
				if (sx < 0 || sx >= sheet.width || sy < 0 || sy >= sheet.height) continue;
				const from = (sy * source.width + z * sheet.width + sx) * 4;
				const alpha = source.data[from + 3];
				if (alpha === 0) continue;
				const red = source.data[from]; const green = source.data[from + 1]; const blue = source.data[from + 2];
				if (alpha !== 255 || red === undefined || green === undefined || blue === undefined) throw new Error('Invalid decoded slice pixel.');
				const to = (y * bounds.width + x) * 4;
				output.data[to] = red; output.data[to + 1] = green; output.data[to + 2] = blue; output.data[to + 3] = 255;
			}
		}
	}
	target.putImageData(output, 0, 0);
};

const start = async function () {
	const embedded: unknown = JSON.parse(element('article-data').textContent ?? ''); const data = parseData(embedded);
	const datasets: LoadedDataset[] = await Promise.all(data.datasets.map(async function (dataset) {
		const [slices, ...images] = await Promise.all([
			loadImage(dataset.slices.image, dataset.slices.width * dataset.slices.count, dataset.slices.height),
			...dataset.views.map(function (view) { return loadImage(view.image, view.width, view.height); }),
		]);
		if (!slices) throw new Error('The decoded slice sheet is missing.');
		const views = dataset.views.map(function (view, index) { const image = images[index]; if (!image) throw new Error('A decoded input view is missing.'); return { data: view, image }; });
		return { data: dataset, views, slices, pixels: decodePixels(slices) };
	}));
	const initial = datasets.find(function (dataset) { return dataset.data.id === data.defaultDataset; }); if (!initial) throw new Error('The default dataset is missing.');
	let current = initial;
	const selector = element('article-dataset'); if (!(selector instanceof HTMLSelectElement)) throw new Error('Invalid dataset selector.');
	const articleLink = element('article-source'); if (!(articleLink instanceof HTMLAnchorElement)) throw new Error('Invalid source link.'); articleLink.href = data.articleUrl;
	for (const dataset of datasets) { const option = document.createElement('option'); option.value = dataset.data.id; option.textContent = dataset.data.label; selector.append(option); } selector.value = current.data.id;
	const resultCanvas = canvas('article-result'); const resultContext = context(resultCanvas); const resultStage = element('article-result-stage');
	const sliceCanvas = canvas('article-selected-slice'); const sliceContext = context(sliceCanvas); const sliceStage = element('article-slice-stage');
	const sourceSurfaces = (['top', 'side', 'front', 'back'] as const).map(function (name) { const surface = canvas(`article-view-${name}`); return { name, surface, context: context(surface), stage: element(`article-stage-${name}`) }; });
	const yaw = input('article-yaw'); const squash = input('article-squash'); const spacing = input('article-spacing'); const layer = input('article-layer');
	const reset = button('article-reset'); const rotate = button('article-rotate');
	const state: State = { yaw: 0, squash: 0.75, spacing: 1, layer: 0, rotating: false };
	const events = new AbortController(); let animation = 0; let lastTime = 0; let disposed = false;
	const resize = function () {
		const scale = displayScale(resultCanvas, resultStage, 360, 8); displayScale(sliceCanvas, sliceStage, 240, 10);
		const maximumWidth = Math.max(...sourceSurfaces.map(function (view) { return view.surface.width; }));
		const maximumHeight = Math.max(...sourceSurfaces.map(function (view) { return view.surface.height; }));
		const sourceWidth = Math.max(1, Math.min(...sourceSurfaces.map(function (view) { return view.stage.clientWidth; })) - 16);
		const sourceScale = Math.max(1, Math.min(6, Math.floor(sourceWidth / maximumWidth), Math.floor(144 / maximumHeight)));
		for (const view of sourceSurfaces) { view.surface.style.width = `${view.surface.width * sourceScale}px`; view.surface.style.height = `${view.surface.height * sourceScale}px`; }
		element('article-scale').textContent = `${resultCanvas.width} × ${resultCanvas.height} logical frame · ${scale}× display`;
	};
	const drawInputs = function () {
		for (const view of sourceSurfaces) {
			const source = current.views.find(function (item) { return item.data.name === view.name; }); if (!source) throw new Error(`Missing ${view.name} input.`);
			view.surface.width = source.data.width; view.surface.height = source.data.height; view.context.imageSmoothingEnabled = false; view.context.drawImage(source.image, 0, 0);
			element(`article-size-${view.name}`).textContent = `${source.data.width} × ${source.data.height}`;
		}
		const notes = element('article-notes'); notes.replaceChildren();
		for (const text of current.data.notes) { const note = document.createElement('li'); note.textContent = text; notes.append(note); }
		element('article-sheet-info').textContent = `${current.data.slices.count} horizontal slices · ${current.data.slices.width} × ${current.data.slices.height} pixels each`;
		layer.max = String(current.data.slices.count - 1);
	};
	const render = function () {
		const sheet = current.data.slices; const bounds = frame(sheet, state.spacing);
		if (resultCanvas.width !== bounds.width || resultCanvas.height !== bounds.height) { resultCanvas.width = bounds.width; resultCanvas.height = bounds.height; }
		resultContext.setTransform(1, 0, 0, 1, 0, 0); resultContext.imageSmoothingEnabled = false; resultContext.clearRect(0, 0, bounds.width, bounds.height);
		drawStack(resultContext, current, state, bounds);
		if (sliceCanvas.width !== sheet.width || sliceCanvas.height !== sheet.height) { sliceCanvas.width = sheet.width; sliceCanvas.height = sheet.height; }
		sliceContext.setTransform(1, 0, 0, 1, 0, 0); sliceContext.imageSmoothingEnabled = false; sliceContext.clearRect(0, 0, sheet.width, sheet.height);
		sliceContext.drawImage(current.slices, state.layer * sheet.width, 0, sheet.width, sheet.height, 0, 0, sheet.width, sheet.height);
		yaw.value = state.yaw.toFixed(1); squash.value = String(state.squash); spacing.value = String(state.spacing); layer.value = String(state.layer);
		element('article-yaw-value').textContent = `${state.yaw.toFixed(1)}°`; element('article-squash-value').textContent = state.squash.toFixed(2);
		element('article-spacing-value').textContent = `${state.spacing.toFixed(2)} px`; element('article-layer-value').textContent = `${state.layer} / ${sheet.count - 1}`;
		rotate.textContent = state.rotating ? 'Stop rotation' : 'Rotate'; rotate.setAttribute('aria-pressed', String(state.rotating));
		resultCanvas.dataset['ready'] = 'true'; resultCanvas.dataset['renderer'] = 'canvas2d-sprite-stacks'; resultCanvas.dataset['yaw'] = String(state.yaw);
		resultCanvas.dataset['squash'] = String(state.squash); resultCanvas.dataset['spacing'] = String(state.spacing); resultCanvas.dataset['dataset'] = current.data.id;
		sliceCanvas.dataset['layer'] = String(state.layer); resize();
	};
	const stop = function () { state.rotating = false; cancelAnimationFrame(animation); animation = 0; lastTime = 0; };
	const resetState = function () { stop(); state.yaw = 0; state.squash = 0.75; state.spacing = 1; state.layer = 0; };
	const tick = function (time: number) { if (disposed || !state.rotating) return; const delta = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000); lastTime = time; state.yaw = (state.yaw + delta * 24) % 360; render(); animation = requestAnimationFrame(tick); };
	selector.addEventListener('change', function () {
		const selected = datasets.find(function (dataset) { return dataset.data.id === selector.value; }); if (!selected) throw new Error('Unknown selected dataset.'); current = selected; resetState(); drawInputs(); render();
	}, { signal: events.signal });
	reset.addEventListener('click', function () { resetState(); render(); }, { signal: events.signal });
	rotate.addEventListener('click', function () { if (state.rotating) stop(); else { state.rotating = true; animation = requestAnimationFrame(tick); } render(); }, { signal: events.signal });
	yaw.addEventListener('input', function () { const value = Number(yaw.value); if (!number(value, 0, 360)) return; stop(); state.yaw = value; render(); }, { signal: events.signal });
	squash.addEventListener('input', function () { const value = Number(squash.value); if (!number(value, 0.5, 1)) return; state.squash = value; render(); }, { signal: events.signal });
	spacing.addEventListener('input', function () { const value = Number(spacing.value); if (!number(value, 0, 3)) return; state.spacing = value; render(); }, { signal: events.signal });
	layer.addEventListener('input', function () { const value = Number(layer.value); if (!integer(value, 0, current.data.slices.count - 1)) return; state.layer = value; render(); }, { signal: events.signal });
	const observer = new ResizeObserver(resize); observer.observe(resultStage); observer.observe(sliceStage); for (const view of sourceSurfaces) observer.observe(view.stage);
	window.addEventListener('pagehide', function () { disposed = true; stop(); events.abort(); observer.disconnect(); }, { once: true, signal: events.signal });
	drawInputs(); render(); element('article-loading').hidden = true; element('article-controls').removeAttribute('disabled'); selector.disabled = false;
};

void start().catch(function (error: unknown) {
	const status = document.getElementById('article-loading'); if (status) { status.hidden = false; status.textContent = error instanceof Error ? error.message : 'The article reproduction could not start.'; status.dataset['error'] = 'true'; }
	const result = document.getElementById('article-result'); if (result) result.dataset['ready'] = 'error';
});
