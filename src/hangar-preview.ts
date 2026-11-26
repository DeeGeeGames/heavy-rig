import { ACESFilmicToneMapping, Box3, DirectionalLight, HemisphereLight, PCFShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { FRAME_RIGS } from './frame-rig';
import { getFrame, type FrameId } from './frames';
import { createGait } from './gait';
import { createMech } from './mech-3d';
import { createSolidInk } from './solid-ink';
import { getLiveryPreset, supportsMechSkin, type LiveryPresetId } from './mech-skin';

// This view owns no campaign state, input listeners, or animation loop. Its
// caller renders only while the Mech Bay is visible and disposes it on teardown.
export const createHangarPreview = function (canvas: HTMLCanvasElement) {
	const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true });
	const ink = createSolidInk(renderer);
	const scene = new Scene();
	const camera = new PerspectiveCamera(33, 1, 1, 2200);
	const key = new DirectionalLight('#ffe2b8', 3.2);
	const rim = new DirectionalLight('#a2acda', 1.6);
	const marker = canvas.parentElement?.querySelector<HTMLElement>('.mount-pin');
	let shownSlot: number | null = null;
	let model: ReturnType<typeof createMech> | undefined;
	let selectedFrame: FrameId | undefined;
	let selectedSlots = 'all';
	let width = 0;
	let height = 0;
	let invalidated = true;
	let lost = false;
	let failed = false;
	let disposed = false;
	const bounds = new Box3();
	const center = new Vector3();
	const direction = new Vector3(1.2, 0.36, 1).normalize();
	const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
	const up = new Vector3().crossVectors(direction, right).normalize();
	const point = new Vector3();

	const contextLost = function (event: Event) {
		event.preventDefault();
		lost = true;
		if (marker) marker.hidden = true;
		canvas.dataset['hangarState'] = 'context-lost';
	};
	const contextRestored = function () {
		lost = false;
		failed = false;
		invalidated = true;
		renderer.shadowMap.needsUpdate = true;
		canvas.dataset['hangarState'] = 'restoring';
	};
	const dispose = function () {
		if (disposed) return;
		disposed = true;
		canvas.removeEventListener('webglcontextlost', contextLost);
		canvas.removeEventListener('webglcontextrestored', contextRestored);
		ink.dispose();
		model?.dispose();
		model = undefined;
		key.shadow.dispose();
		scene.clear();
		renderer.dispose();
		renderer.forceContextLoss();
		canvas.dataset['hangarState'] = 'disposed';
	};
	let selectedSkin: LiveryPresetId = 'original';
	const setFrame = function (frameId: FrameId, equippedSlots?: readonly number[], skin: LiveryPresetId = 'original') {
		const slots = equippedSlots?.join(',') ?? 'all';
		const finish = supportsMechSkin(frameId) ? skin : 'original';
		if (disposed || frameId === selectedFrame && slots === selectedSlots && finish === selectedSkin) return;
		const next = createMech(undefined, false, frameId, getLiveryPreset(finish).finish);
		try {
			next.pose(createGait({ x: 0, y: 0, angle: 0 }, getFrame(frameId).size, FRAME_RIGS[frameId]), 0,
				{ recoil: 0, hit: 0, heat: 0, time: 0, ...(equippedSlots ? { equippedSlots } : {}) });
			bounds.setFromObject(next.root);
		}
		catch (error: unknown) { next.dispose(); throw error; }
		model?.dispose();
		model = next;
		selectedFrame = frameId;
		selectedSlots = slots;
		selectedSkin = finish;
		scene.add(next.root);
		invalidated = true;
		failed = false;
		renderer.shadowMap.needsUpdate = true;
		canvas.dataset['hangarFrame'] = frameId;
		canvas.dataset['hangarSkin'] = finish;
	};
	const frameCamera = function () {
		bounds.getCenter(center);
		const verticalTangent = Math.tan(camera.fov * Math.PI / 360);
		const horizontalTangent = verticalTangent * camera.aspect;
		let distance = 1;
		// Fit every corner in camera space, including the nearest gun barrels and
		// toes. Horizontal FOV changes with the actual canvas aspect ratio.
		for (const x of [bounds.min.x, bounds.max.x]) {
			for (const y of [bounds.min.y, bounds.max.y]) {
				for (const z of [bounds.min.z, bounds.max.z]) {
					point.set(x, y, z).sub(center);
					const horizontal = Math.abs(point.dot(right)) / horizontalTangent;
					const vertical = Math.abs(point.dot(up)) / verticalTangent;
					distance = Math.max(distance, point.dot(direction) + Math.max(horizontal * 1.1, vertical * 1.03));
				}
			}
		}
		camera.position.copy(center).addScaledVector(direction, distance);
		camera.lookAt(center);
		camera.far = Math.max(2200, distance * 2);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
	};

	try {
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.2;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = PCFShadowMap;
		renderer.shadowMap.autoUpdate = false;
		renderer.setClearColor(0x000000, 0);
		scene.add(new HemisphereLight('#ede9da', '#383644', 2));
		key.position.set(140, 300, 100);
		key.target.position.set(0, 55, 0);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.camera.left = -170;
		key.shadow.camera.right = 170;
		key.shadow.camera.top = 200;
		key.shadow.camera.bottom = -150;
		key.shadow.camera.near = 20;
		key.shadow.camera.far = 700;
		key.shadow.normalBias = 0.3;
		key.shadow.bias = -0.0001;
		rim.position.set(-130, 160, -100);
		scene.add(key, key.target, rim);
		canvas.addEventListener('webglcontextlost', contextLost);
		canvas.addEventListener('webglcontextrestored', contextRestored);
		setFrame('warden');
		canvas.dataset['hangarState'] = 'ready';
	}
	catch (error: unknown) { dispose(); throw error; }

	return {
		setFrame,
		render: function (slot: number | null = null) {
			if (disposed || lost || failed || !canvas.isConnected) return;
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			if (w <= 0 || h <= 0) return;
			const redraw = invalidated || w !== width || h !== height;
			if (!redraw && slot === shownSlot) return;
			try {
				if (redraw) {
					width = w; height = h;
					const scale = Math.min(1, 290 / h, 520 / w);
					const rasterWidth = Math.max(1, Math.round(w * scale));
					const rasterHeight = Math.max(1, Math.round(h * scale));
					renderer.setSize(rasterWidth, rasterHeight, false);
					camera.aspect = w / h;
					frameCamera();
					ink.render(scene, camera, rasterWidth, rasterHeight, { anchor: center, cell: 1.15 });
					invalidated = false;
					canvas.dataset['hangarState'] = 'rendered';
				}
				shownSlot = slot;
				if (marker) {
					const muzzle = slot === null ? undefined : model?.muzzles[slot];
					marker.hidden = !muzzle;
					if (muzzle && model && slot !== null) {
						model.root.localToWorld(point.copy(muzzle)).project(camera);
						marker.style.left = `${(point.x + 1) * 50}%`;
						marker.style.top = `${(1 - point.y) * 50}%`;
						marker.textContent = String(slot + 1).padStart(2, '0');
					}
				}
			}
			catch (error: unknown) {
				failed = true;
				if (marker) marker.hidden = true;
				canvas.dataset['hangarState'] = 'unavailable';
				console.warn('Hangar preview unavailable', error);
			}
		},
		dispose,
	};
};
