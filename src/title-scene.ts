import { ACESFilmicToneMapping, AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, FogExp2, Group, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Scene, SpotLight, WebGLRenderer } from 'three';
import { createMech } from './mech-3d';
import { createGait } from './gait';

// A presentation-only scene: no simulation, campaign state, or combat inputs.
export const createTitleScene = function (canvas: HTMLCanvasElement) {
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;
	renderer.shadowMap.autoUpdate = false;
	renderer.shadowMap.needsUpdate = true;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.25;
	const scene = new Scene();
	scene.background = new Color('#0a1419');
	scene.fog = new FogExp2('#0a1419', 0.0028);
	const camera = new PerspectiveCamera(35, 1, 1, 2200);
	const geometry = new BoxGeometry(1, 1, 1);
	const materials: MeshStandardMaterial[] = [];
	const material = function (color: string, glow?: string) {
		const value = new MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.5, ...(glow ? { emissive: glow, emissiveIntensity: 3 } : {}) });
		materials.push(value); return value;
	};
	const steel = material('#203139'); const dark = material('#0d1b23'); const floor = material('#2b383b');
	const amber = material('#ba7e32'); const light = material('#d0eee5', '#b1e5e5'); const warm = material('#ffb450', '#ff9d35');
	const box = function (parent: Group | Scene, x: number, y: number, z: number, w: number, h: number, d: number, surface: MeshStandardMaterial) {
		const mesh = new Mesh(geometry, surface); mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
		mesh.receiveShadow = true; mesh.castShadow = true; parent.add(mesh); return mesh;
	};
	box(scene, 0, -5, 0, 1600, 10, 1600, floor);
	// Recessed maintenance platform and painted deck markings.
	const platformGeometry = new CylinderGeometry(91, 99, 4, 48);
	const platform = new Mesh(platformGeometry, steel); platform.position.y = -1; platform.receiveShadow = true; scene.add(platform);
	for (const side of [-1, 1]) {
		box(scene, side * 113, 0.2, 10, 2, 0.2, 250, amber);
		box(scene, side * 128, 2, -3, 3, 3, 180, light);
		for (let i = 0; i < 9; i++) box(scene, side * 109, 0.4, i * 22 - 110, 12, 0.3, 6, amber).rotation.y = -0.45;
	}
	for (let i = -3; i <= 3; i++) {
		box(scene, i * 125, 0.15, 0, 0.8, 0.2, 1300, dark);
		box(scene, 0, 0.15, i * 125, 1300, 0.2, 0.8, dark);
	}
	// Deep hangar ribs, service gantry, and practical strip lighting.
	for (let i = 0; i < 5; i++) {
		const z = -170 - i * 115;
		for (const side of [-1, 1]) {
			box(scene, side * 225, 150, z, 17, 300, 24, steel);
			box(scene, side * 215, 130, z + 15, 3, 180, 3, light);
			box(scene, side * 225, 20, z + 16, 20, 35, 4, amber);
		}
		box(scene, 0, 290, z, 460, 15, 24, steel);
		box(scene, 0, 280, z, 130, 2, 7, light);
	}
	box(scene, 0, 95, -720, 450, 190, 12, dark);
	box(scene, 0, 120, -708, 140, 2, 2, warm);
	for (const side of [-1, 1]) {
		box(scene, side * 150, 60, -110, 28, 120, 25, dark);
		box(scene, side * 150, 118, -87, 28, 4, 72, steel);
		box(scene, side * 150, 125, -107, 22, 2, 8, warm);
	}
	const mech = createMech(); scene.add(mech.root);
	mech.pose(createGait({ x: 0, y: 0, angle: 0.12 }), 0.12);
	scene.add(new AmbientLight('#99c4d3', 0.85));
	const key = new DirectionalLight('#ffe0b1', 3.8); key.position.set(100, 210, 130); key.castShadow = true;
	key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -150; key.shadow.camera.right = 150; key.shadow.camera.top = 150; key.shadow.camera.bottom = -150;
	key.shadow.normalBias = 0.7; scene.add(key);
	const rim = new SpotLight('#9cdbec', 1000000, 650, 0.7, 0.8, 2); rim.position.set(-130, 230, -130); rim.target.position.set(0, 45, 0); scene.add(rim, rim.target);
	const fill = new DirectionalLight('#72a0ac', 1.2); fill.position.set(-100, 80, 150); scene.add(fill);
	let width = 0; let height = 0; let lastRender = 0; let invalidated = true;
	const invalidate = function () { invalidated = true; renderer.shadowMap.needsUpdate = true; };
	canvas.addEventListener('webglcontextrestored', invalidate);
	return {
		render: function (now: number) {
			const w = canvas.clientWidth; const h = canvas.clientHeight;
			if (w <= 0 || h <= 0) return;
			const changed = w !== width || h !== height || invalidated;
			if (!changed && now - lastRender < 1000 / 30) return;
			lastRender = now; invalidated = false;
			if (w !== width || h !== height) { width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
			const portrait = w / h < 0.85;
			const drift = Math.sin(now / 14000) * 3;
			const distance = portrait ? 1.8 : 1;
			camera.position.set((190 + drift) * distance, 46 + 67 * distance, 205 * distance);
			camera.lookAt(0, 46, 0);
			camera.setViewOffset(w, h, portrait ? -w * 0.16 : -w * 0.23, portrait ? h * 0.045 : -h * 0.015, w, h);
			camera.updateProjectionMatrix();
			renderer.render(scene, camera);
		},
		dispose: function () { canvas.removeEventListener('webglcontextrestored', invalidate); mech.dispose(); geometry.dispose(); platformGeometry.dispose(); materials.forEach(function (value) { value.dispose(); }); key.shadow.dispose(); scene.clear(); renderer.dispose(); },
	};
};
