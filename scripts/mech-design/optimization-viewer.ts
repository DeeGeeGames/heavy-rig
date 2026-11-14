/** Browser entry point bundled by optimization-review.ts; no external assets. */
import {
	ACESFilmicToneMapping,
	Box3,
	Color,
	DirectionalLight,
	HemisphereLight,
	InstancedMesh,
	Material,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	OrthographicCamera,
	PMREMGenerator,
	Scene,
	Sphere,
	Texture,
	Vector3,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const assetIds = ['source', 'candidate'] as const;
const views = {
	oblique: new Vector3(.8, .55, 1),
	front: new Vector3(0, .15, 1),
	rear: new Vector3(.8, .6, -1),
	side: new Vector3(1, .15, 0),
	'opposite-side': new Vector3(-1, .15, 0),
	underside: new Vector3(.8, -.7, .7),
};
type ViewName = keyof typeof views;

interface AssetEvidence {
	readonly id: string;
	readonly triangles: number;
	readonly meshSections: number;
	readonly materials: number;
}

declare global {
	interface Window {
		optimizationProofEvidence?: {
			readonly ready: boolean;
			readonly assets: readonly AssetEvidence[];
			readonly errors: readonly string[];
		};
	}
}

const viewName = function (value: string | undefined): ViewName {
	switch (value) {
		case 'front':
		case 'rear':
		case 'side':
		case 'opposite-side':
		case 'underside':
			return value;
		default:
			return 'oblique';
	}
};

const showStill = function (name: ViewName): void {
	for (const gallery of document.querySelectorAll('[data-still-view]')) {
		if (gallery instanceof HTMLElement) gallery.hidden = gallery.dataset['stillView'] !== name;
	}
};

const stillSelector = document.getElementById('still-view');
if (stillSelector instanceof HTMLSelectElement) {
	stillSelector.addEventListener('change', function () { showStill(viewName(stillSelector.value)); });
}

const boot = async function (): Promise<void> {
	const host = document.getElementById('viewport');
	const status = document.getElementById('viewer-status');
	if (!(host instanceof HTMLElement) || !(status instanceof HTMLElement)) throw new Error('Missing viewer elements');
	const assets = await Promise.all(assetIds.map(async function (id) {
		const element = document.getElementById(`asset-${id}`);
		if (!element?.textContent) throw new Error(`Missing embedded ${id} GLB`);
		const binary = atob(element.textContent.trim());
		const bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
		const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
		const materials = new Set<Material>();
		let triangles = 0;
		let meshSections = 0;
		gltf.scene.traverse(function (object) {
			if (!(object instanceof Mesh)) return;
			const positions = object.geometry.getAttribute('position');
			if (!positions) throw new Error(`Missing positions in ${object.name}`);
			triangles += (object.geometry.index?.count ?? positions.count) / 3 * (object instanceof InstancedMesh ? object.count : 1);
			meshSections++;
			for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
		});
		return { id, gltf, evidence: { id, triangles, meshSections, materials: materials.size } };
	}));
	const bounds = new Box3();
	for (const asset of assets) bounds.union(new Box3().setFromObject(asset.gltf.scene, true));
	const sphere = bounds.getBoundingSphere(new Sphere());
	if (bounds.isEmpty() || !Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('Models have no finite visible bounds');

	const renderer = new WebGLRenderer({ antialias: true, alpha: false });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;
	renderer.domElement.style.opacity = '0';
	host.appendChild(renderer.domElement);
	const pmrem = new PMREMGenerator(renderer);
	const room = new RoomEnvironment();
	const environment = pmrem.fromScene(room);
	room.dispose();
	pmrem.dispose();
	const camera = new OrthographicCamera(-1, 1, 1, -1, sphere.radius / 1000, sphere.radius * 20);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.target.copy(sphere.center);
	controls.enableDamping = false;
	controls.enablePan = false;
	controls.minZoom = .25;
	controls.maxZoom = 8;
	const setView = function (name: ViewName): void {
		camera.position.copy(sphere.center).addScaledVector(views[name].clone().normalize(), sphere.radius * 6);
		camera.lookAt(sphere.center);
		camera.zoom = 1;
		camera.updateProjectionMatrix();
		controls.update();
	};
	setView('oblique');

	const neutralMaterials = new Map<Material, MeshStandardMaterial>();
	const originalMaterials = new Set<Material>();
	const meshStates: { mesh: Mesh; original: Material | Material[]; neutral: Material | Material[] }[] = [];
	const neutralFor = function (material: Material): MeshStandardMaterial {
		const existing = neutralMaterials.get(material);
		if (existing) return existing;
		const neutral = new MeshStandardMaterial({
			color: new Color().setRGB(.24, .29, .32),
			metalness: .3,
			roughness: .42,
			side: material.side,
			map: null,
			normalMap: null,
			flatShading: material instanceof MeshStandardMaterial && material.flatShading,
		});
		neutralMaterials.set(material, neutral);
		return neutral;
	};
	const scenes = assets.map(function (asset) {
		const scene = new Scene();
		scene.background = new Color('#434b52');
		scene.environment = environment.texture;
		scene.environmentIntensity = .6;
		scene.add(asset.gltf.scene);
		for (const [position, color, intensity] of [
			[new Vector3(.5, .7, .7), 0xfff4e5, 3],
			[new Vector3(-.5, .3, .2), 0xc9defa, 1.5],
			[new Vector3(.3, .5, -.6), 0xffffff, 2],
		] as const) {
			const light = new DirectionalLight(color, intensity);
			light.position.copy(sphere.center).addScaledVector(position, sphere.radius * 6);
			light.target.position.copy(sphere.center);
			scene.add(light, light.target);
		}
		scene.add(new HemisphereLight(0xc2d1e0, 0x414149, 1));
		asset.gltf.scene.traverse(function (object) {
			if (!(object instanceof Mesh)) return;
			const materials = Array.isArray(object.material) ? object.material : [object.material];
			for (const material of materials) originalMaterials.add(material);
			meshStates.push({
				mesh: object,
				original: object.material,
				neutral: Array.isArray(object.material) ? materials.map(neutralFor) : neutralFor(object.material),
			});
		});
		return scene;
	});
	const render = function (): void {
		const width = host.clientWidth;
		const height = host.clientHeight;
		if (width <= 0 || height <= 0) return;
		renderer.setSize(width, height, false);
		renderer.setScissorTest(true);
		const panelWidth = Math.floor(width / scenes.length);
		const aspect = panelWidth / height;
		const span = sphere.radius * 2.3 / Math.min(1, aspect);
		camera.left = -span * aspect / 2;
		camera.right = span * aspect / 2;
		camera.top = span / 2;
		camera.bottom = -span / 2;
		camera.updateProjectionMatrix();
		for (const [index, scene] of scenes.entries()) {
			const x = index * panelWidth;
			const viewportWidth = index === scenes.length - 1 ? width - x : panelWidth;
			renderer.setViewport(x, 0, viewportWidth, height);
			renderer.setScissor(x, 0, viewportWidth, height);
			renderer.render(scene, camera);
		}
	};
	const observer = new ResizeObserver(render);
	observer.observe(host);
	controls.addEventListener('change', render);
	for (const button of document.querySelectorAll('[data-view]')) {
		if (!(button instanceof HTMLButtonElement)) continue;
		button.addEventListener('click', function () { setView(viewName(button.dataset['view'])); render(); });
	}
	const wireframe = document.getElementById('wireframe');
	if (wireframe instanceof HTMLInputElement) wireframe.addEventListener('change', function () {
		for (const material of [...originalMaterials, ...neutralMaterials.values()]) {
			if (material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial) material.wireframe = wireframe.checked;
		}
		render();
	});
	const details = document.getElementById('details');
	if (details instanceof HTMLInputElement) details.addEventListener('change', function () {
		for (const state of meshStates) state.mesh.material = details.checked ? state.original : state.neutral;
		render();
	});
	window.addEventListener('pagehide', function () {
		observer.disconnect();
		controls.dispose();
		const textures = new Set<Texture>();
		for (const material of [...originalMaterials, ...neutralMaterials.values()]) {
			for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
			material.dispose();
		}
		for (const texture of textures) texture.dispose();
		for (const { mesh } of meshStates) mesh.geometry.dispose();
		environment.dispose();
		renderer.dispose();
	}, { once: true });
	render();
	renderer.domElement.style.opacity = '1';
	document.getElementById('viewer-placeholder')?.remove();
	status.textContent = 'Drag to rotate both models · scroll to zoom';
	window.optimizationProofEvidence = { ready: true, assets: assets.map(function (asset) { return asset.evidence; }), errors: [] };
	console.log(`PROOF_READY ${JSON.stringify(window.optimizationProofEvidence)}`);
};

void boot().catch(function (error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	window.optimizationProofEvidence = { ready: false, assets: [], errors: [message] };
	console.error(`PROOF_FAILED ${message}`);
	const status = document.getElementById('viewer-status');
	if (status) status.textContent = '3D viewer unavailable here. Matched exported-model renders remain available below.';
});
