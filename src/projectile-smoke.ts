import { Color, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { Shot, CombatStateView } from './simulation';

const LIFETIME = 1;
const SPACING = 4;
interface Puff { position: Vector3; born: number; seed: number }
interface Track { position: Vector3; time: number; remaining: number }

// Smoke belongs to the world, not the projectile mesh: a hit must leave the
// existing streak behind. One instanced draw handles all soft, camera-facing puffs.
export const createProjectileSmoke = function () {
	const geometry = new InstancedBufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
	geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
	geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.instanceCount = 0;
	const surface = new ShaderMaterial({
		transparent: true, depthWrite: false, fog: true,
		uniforms: UniformsUtils.merge([UniformsLib.fog, { smokeColor: { value: new Color('#c1c9c6') } }]),
		vertexShader: `
			attribute vec3 smokeCenter;
			attribute vec2 smokeAgeSeed;
			varying vec2 vUv;
			varying float vOpacity;
			varying float vSeed;
			#include <fog_pars_vertex>
			void main() {
				float age = smokeAgeSeed.x;
				vSeed = smokeAgeSeed.y;
				float radius = mix(3.8, 12.0, age) * (0.85 + 0.3 * fract(vSeed));
				vec3 drift = vec3(sin(vSeed) * 2.0, 9.0, cos(vSeed) * 2.0) * age;
				vec4 mvPosition = modelViewMatrix * vec4(smokeCenter + drift, 1.0);
				mvPosition.xy += position.xy * radius;
				gl_Position = projectionMatrix * mvPosition;
				vUv = uv;
				vOpacity = 0.4 * (1.0 - age) * (1.0 - age);
				#include <fog_vertex>
			}
		`,
		fragmentShader: `
			uniform vec3 smokeColor;
			varying vec2 vUv;
			varying float vOpacity;
			varying float vSeed;
			#include <fog_pars_fragment>
			float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
			float noise(vec2 p) {
				vec2 cell = floor(p);
				vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
				return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
					mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x), f.y);
			}
			void main() {
				vec2 p = vUv * 2.0 - 1.0;
				float density = (1.0 - smoothstep(0.15, 1.0, length(p)))
					* mix(0.45, 1.0, noise(p * 3.0 + vSeed));
				gl_FragColor = vec4(smokeColor, density * vOpacity);
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
				#include <fog_fragment>
			}
		`,
	});
	const root = new Mesh(geometry, surface); root.name = 'projectile-smoke'; root.frustumCulled = false;
	let centers = new InstancedBufferAttribute(new Float32Array(0), 3);
	let ages = new InstancedBufferAttribute(new Float32Array(0), 2);
	let puffs: Puff[] = [];
	let tracks = new Map<Shot, Track>();
	let previousState: CombatStateView | undefined;
	let previousTime = 0; let sequence = 0; let disposed = false;
	return {
		root,
		update: function (state: CombatStateView, positions: ReadonlyMap<Shot, Vector3>) {
			if (disposed) return;
			if (previousState !== state || state.time < previousTime) { puffs = []; tracks.clear(); sequence = 0; }
			previousState = state; previousTime = state.time;
			puffs = puffs.filter(function (puff) { return state.time - puff.born < LIFETIME; });
			const emit = function (position: Vector3, born: number) {
				if (state.time - born < LIFETIME) puffs.push({ position, born, seed: sequence++ * 2.399963 });
			};
			const nextTracks = new Map<Shot, Track>();
			for (const [shot, position] of positions) {
				const previous = tracks.get(shot);
				let remaining = previous?.remaining ?? SPACING;
				if (!previous) emit(position.clone(), state.time);
				else if (state.time > previous.time) {
					const distance = previous.position.distanceTo(position);
					// Space emissions along the actual rendered path, interpolating their
					// age so low frame rates cannot leave gaps or extend smoke lifetime.
					for (; remaining <= distance; remaining += SPACING) {
						const fraction = remaining / distance;
						emit(previous.position.clone().lerp(position, fraction), previous.time + (state.time - previous.time) * fraction);
					}
					remaining -= distance;
				}
				nextTracks.set(shot, { position: position.clone(), time: state.time, remaining });
			}
			tracks = nextTracks;
			if (puffs.length > centers.count) {
				const capacity = Math.max(256, centers.count * 2, puffs.length);
				centers = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
				ages = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
				// Release the old attribute buffers when a larger salvo needs capacity.
				geometry.dispose(); geometry.setAttribute('smokeCenter', centers); geometry.setAttribute('smokeAgeSeed', ages);
			}
			for (const [index, puff] of puffs.entries()) {
				centers.setXYZ(index, puff.position.x, puff.position.y, puff.position.z);
				ages.setXY(index, (state.time - puff.born) / LIFETIME, puff.seed);
			}
			geometry.instanceCount = puffs.length; root.visible = puffs.length > 0;
			centers.needsUpdate = ages.needsUpdate = true;
		},
		dispose: function () {
			if (disposed) return; disposed = true;
			geometry.dispose(); surface.dispose(); root.removeFromParent(); puffs = []; tracks.clear(); previousState = undefined;
		},
	};
};
