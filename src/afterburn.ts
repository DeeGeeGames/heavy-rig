import {
	AdditiveBlending, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial,
	OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
} from 'three';
import { createDropship, createWayfarer } from './launch-ships';
import { createOrbitPlate } from './orbit-plate';
import type { createSolidInk } from './solid-ink';
import type { PlanetDefinition } from './universe';

const ignition = 2.18;
const dash = 0.045;
export const AFTERBURN_CUT = 3.05;
export const AFTERBURN_DURATION = 5.8;
const entry = AFTERBURN_CUT + 0.18;
const progress = function (time: number, start: number, duration: number) {
	return Math.max(0, Math.min(1, (time - start) / duration));
};

// A thin hot core inside each tapered plume keeps the four bells legible in broadside.
const createPlumeMaterial = function (headTaper: number, strength = { value: 1 }) {
	return new ShaderMaterial({
		uniforms: { strength, headTaper: { value: headTaper } },
		vertexShader: 'varying vec2 at; void main(){ at=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
		fragmentShader: `
			varying vec2 at;
			uniform float strength, headTaper;
			void main() {
				float tail = 1. - at.x;
				float width = (.20 + .77 * sqrt(at.x)) * (1. - .13 * cos(tail * 25.));
				float radius = abs(2. * at.y - 1.) / width;
				float glow = pow(max(0., 1. - radius), 1.6) * smoothstep(0., .62, at.x);
				float core = (1. - smoothstep(.08, .45, radius)) * at.x;
				vec3 tint = mix(vec3(.26,.43,1.), vec3(1.,.87,.64), core * core);
				gl_FragColor = vec4(tint, strength * glow * smoothstep(0., headTaper, tail));
				#include <colorspace_fragment>
			}`,
		transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
	});
};

const orbit = function (planet: PlanetDefinition) {
	const seed = Math.imul(Math.round(planet.x * 100), 65537) + Math.round(planet.y * 100);
	return createOrbitPlate(planet.biome, seed, 'broadside');
};

export const createAfterburn = function (origin: PlanetDefinition, destination: PlanetDefinition) {
	const scene = new Scene(); scene.background = new Color('#101827');
	const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 40000);
	camera.position.set(-3900, 4350, 10600); camera.lookAt(0, 0, 0); scene.add(camera);
	const sky = new HemisphereLight('#c8d8ee', origin.color, 1.45);
	const daylight = new Color(0xffffff);
	const key = new DirectionalLight(new Color(origin.color).lerp(daylight, .5), 3.2); key.position.set(-1700, 2500, 1400);
	const fill = new DirectionalLight('#b9d7ec', 1); fill.position.set(2000, 550, -1000);
	scene.add(sky, key, fill);

	const carrier = createWayfarer(), shuttle = createDropship();
	shuttle.root.position.set(-132, 0, 126); shuttle.root.rotation.y = Math.PI;
	shuttle.setRamp(0, 0); carrier.bay.add(shuttle.root); scene.add(carrier.root);
	const plates = [orbit(origin), orbit(destination)] as const;
	const plateMaterial = new MeshBasicMaterial({ map: plates[0], toneMapped: false });
	const plate = new Mesh(new PlaneGeometry(1, 1), plateMaterial);
	plate.position.z = -30000; camera.add(plate);

	const wakeStrength = { value: 1 };
	const nozzle = createPlumeMaterial(.004), trace = createPlumeMaterial(.21, wakeStrength);
	const ribbon = new PlaneGeometry(1, 1).translate(-0.5, 0, 0);
	const plumeGroup = function (material: ShaderMaterial) {
		const group = new Group(); group.userData['nativeEffects'] = true;
		for (const port of carrier.drivePorts) {
			const jet = new Mesh(ribbon, material);
			jet.position.copy(port); jet.position.x -= 4; group.add(jet);
		}
		return group;
	};
	const jets = plumeGroup(nozzle), wake = plumeGroup(trace);
	carrier.root.add(jets); scene.add(wake);

	const render = function (ink: ReturnType<typeof createSolidInk>, seconds: number, width: number, height: number) {
		if (width <= 0 || height <= 0) return 0;
		const aspect = width / height, span = Math.max(6700, 4210 * aspect), tall = span / aspect;
		camera.left = -span / 2; camera.right = span / 2; camera.top = tall * .46; camera.bottom = -tall * .54;
		camera.updateProjectionMatrix();
		const arrival = seconds >= AFTERBURN_CUT;
		const map = arrival ? plates[1] : plates[0];
		const planet = arrival ? destination : origin;
		if (plateMaterial.map !== map) {
			plateMaterial.map = map; plateMaterial.needsUpdate = true;
			sky.groundColor.set(planet.color);
			key.color.set(planet.color).lerp(daylight, .5);
			key.position.x = arrival ? 1700 : -1700;
		}
		plate.scale.set(span, tall, 1); plate.position.y = -.04 * tall;
		// Crop in texture pixels so the planet keeps its curvature on a tall screen.
		const cropY = Math.min(.60, .875 / aspect), cropX = cropY * aspect / .875;
		map.repeat.set(arrival ? -cropX : cropX, cropY);
		map.offset.set((1 - map.repeat.x) / 2, 1 - .363 - .36 * cropY);

		const spool = progress(seconds, .63, ignition - .63);
		const leap = progress(seconds, ignition, dash);
		const brake = progress(seconds, entry, .84);
		const departureX = -.105 + .095 * Math.pow(progress(seconds, 0, ignition), 1.7);
		// Both fixed cameras point across the starboard side. The carrier leaves and
		// enters the frame heading right; the cut happens while both orbits are empty.
		const position = arrival ? -.026 - 1.43 * Math.pow(1 - brake, 5) + .044 * progress(seconds, entry + .84, 1.75)
			: departureX + 1.48 * leap * leap;
		carrier.root.position.x = span * position;
		carrier.root.visible = arrival ? seconds >= entry : leap < 1;
		const power = arrival ? (seconds < entry ? 0 : .14 + .86 * Math.pow(1 - brake, 1.8))
			: leap === 1 ? 0 : .14 + .86 * spool * spool;
		const flicker = 1 + .045 * Math.sin(seconds * 51);
		for (const jet of jets.children) jet.scale.set((100 + 1420 * power * power) * flicker, 60 + 97 * power, 1);
		wake.visible = seconds >= ignition && seconds < ignition + .57;
		if (wake.visible) {
			const fade = progress(seconds, ignition + dash, .52);
			wake.position.x = span * (departureX + .47 * leap);
			for (const streak of wake.children) streak.scale.set((950 + 1850 * leap) * (1 - .32 * fade), 105 - 55 * fade, 1);
			wakeStrength.value = 1 - fade;
		}
		ink.render(scene, camera, width, height, { cell: Math.max(1.2, Math.min(width / 520, height / 300, 3)) });
		return power;
	};
	return { render, dispose: function () {
		shuttle.dispose(); carrier.dispose(); ribbon.dispose(); nozzle.dispose(); trace.dispose();
		for (const texture of plates) texture.dispose();
		plate.geometry.dispose(); plateMaterial.dispose(); scene.clear();
	} };
};
