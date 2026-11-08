import { ACESFilmicToneMapping, Box3, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { FRAME_RIGS } from './frame-rig';
import { getFrame, type FrameId } from './frames';
import { createGait } from './gait';
import { createMech } from './mech-3d';

// This view owns no campaign state, input listeners, or animation loop. Its
// caller renders only while the Mech Bay is visible and disposes it on teardown.
export const createHangarPreview = function (canvas: HTMLCanvasElement) {
	const renderer = new WebGLRenderer({ canvas, antialias: true });
	const scene = new Scene();
	const camera = new PerspectiveCamera(33, 1, 1, 2200);
	const geometries = [new PlaneGeometry(1800, 1800), new CylinderGeometry(100, 104, 3, 48), new BoxGeometry(8, 0.3, 2)] as const;
	const materials = [
		new MeshStandardMaterial({ color: '#1b2a2e', roughness: 0.94, metalness: 0.1 }),
		new MeshStandardMaterial({ color: '#293d40', roughness: 0.83, metalness: 0.2 }),
		new MeshStandardMaterial({ color: '#bd9250', roughness: 0.86, metalness: 0.1 }),
	] as const;
	const key = new DirectionalLight('#ffe2b8', 3.2);
	const rim = new DirectionalLight('#91c6d0', 1.4);
	let model: ReturnType<typeof createMech> | undefined;
	let selectedFrame: FrameId | undefined;
	let width = 0;
	let height = 0;
	let pixelRatio = 0;
	let invalidated = true;
	let lost = false;
	let failed = false;
	let disposed = false;
	const bounds = new Box3();
	const center = new Vector3();
	const direction = new Vector3(1, 0.48, 1.2).normalize();
	const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
	const up = new Vector3().crossVectors(direction, right).normalize();
	const point = new Vector3();

	const contextLost = function (event: Event) {
		event.preventDefault();
		lost = true;
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
		model?.dispose();
		model = undefined;
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		key.shadow.dispose();
		scene.clear();
		renderer.dispose();
		renderer.forceContextLoss();
		canvas.dataset['hangarState'] = 'disposed';
	};
	const setFrame = function (frameId: FrameId) {
		if (disposed || frameId === selectedFrame) return;
		const next = createMech(undefined, false, frameId);
		try {
			next.pose(createGait({ x: 0, y: 0, angle: 0 }, getFrame(frameId).size, FRAME_RIGS[frameId]), 0);
			bounds.setFromObject(next.root);
		}
		catch (error: unknown) { next.dispose(); throw error; }
		model?.dispose();
		model = next;
		selectedFrame = frameId;
		scene.add(next.root);
		invalidated = true;
		failed = false;
		renderer.shadowMap.needsUpdate = true;
		canvas.dataset['hangarFrame'] = frameId;
	};
	const frameCamera = function () {
		bounds.getCenter(center);
		const verticalTangent = Math.tan(camera.fov * Math.PI / 360);
		const horizontalTangent = verticalTangent * camera.aspect;
		let distance = 80;
		// Fit every corner in camera space, including the nearest gun barrels and
		// toes. Horizontal FOV changes with the actual canvas aspect ratio.
		for (const x of [bounds.min.x, bounds.max.x]) {
			for (const y of [bounds.min.y, bounds.max.y]) {
				for (const z of [bounds.min.z, bounds.max.z]) {
					point.set(x, y, z).sub(center);
					const horizontal = Math.abs(point.dot(right)) / horizontalTangent;
					const vertical = Math.abs(point.dot(up)) / verticalTangent;
					distance = Math.max(distance, point.dot(direction) + Math.max(horizontal, vertical) * 1.16);
				}
			}
		}
		camera.position.copy(center).addScaledVector(direction, distance);
		camera.lookAt(center);
		camera.far = Math.max(2200, distance * 2);
		camera.updateProjectionMatrix();
	};

	try {
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.2;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = PCFShadowMap;
		renderer.shadowMap.autoUpdate = false;
		scene.background = new Color('#102027');
		scene.fog = new Fog('#102027', 450, 1500);
		const [floorGeometry, platformGeometry, markingGeometry] = geometries;
		const [floorMaterial, platformMaterial, markingMaterial] = materials;
		const floor = new Mesh(floorGeometry, floorMaterial);
		floor.rotation.x = -Math.PI / 2;
		floor.position.y = -3.15;
		floor.receiveShadow = true;
		scene.add(floor);
		const platform = new Mesh(platformGeometry, platformMaterial);
		platform.position.y = -1.5;
		platform.receiveShadow = true;
		scene.add(platform);
		const markings = new Group();
		for (let index = 0; index < 24; index++) {
			const angle = index / 24 * Math.PI * 2;
			const marking = new Mesh(markingGeometry, markingMaterial);
			marking.position.set(Math.cos(angle) * 91, 0.16, Math.sin(angle) * 91);
			marking.rotation.y = -angle;
			markings.add(marking);
		}
		scene.add(markings, new HemisphereLight('#d6e6e0', '#152329', 2));
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
		render: function () {
			if (disposed || lost || failed || !canvas.isConnected) return;
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			if (w <= 0 || h <= 0) return;
			const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
			if (!invalidated && w === width && h === height && ratio === pixelRatio) return;
			try {
				if (ratio !== pixelRatio) { pixelRatio = ratio; renderer.setPixelRatio(ratio); }
				if (w !== width || h !== height) {
					width = w; height = h;
					renderer.setSize(w, h, false);
					camera.aspect = w / h;
				}
				frameCamera();
				renderer.render(scene, camera);
				invalidated = false;
				canvas.dataset['hangarState'] = 'rendered';
			}
			catch (error: unknown) {
				failed = true;
				canvas.dataset['hangarState'] = 'unavailable';
				console.warn('Hangar preview unavailable', error);
			}
		},
		dispose,
	};
};
