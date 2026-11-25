import { AdditiveBlending, Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, NormalBlending, Object3D, ShaderMaterial, UniformsLib, UniformsUtils, type BufferGeometry } from 'three';

interface Particle {
	born: number;
	life: number;
	color: Color;
}

type Shape = 'solid' | 'flame' | 'smoke' | 'glow' | 'scuff' | 'wave';

// Each shape takes one draw for the entire battlefield. Only the visible prefix
// of the fixed-size instance buffers is uploaded as the simulation advances.
export const createWeaponParticleBatch = function <T extends Particle>(
	shape: Shape, geometry: BufferGeometry, capacity: number,
	pose: (particle: T, age: number, progress: number, transform: Object3D, tint: Color) => number,
) {
	const additive = shape === 'flame' || shape === 'glow';
	const surface = new ShaderMaterial({
		fog: true, toneMapped: false, transparent: shape !== 'solid', depthWrite: shape === 'solid',
		blending: additive ? AdditiveBlending : NormalBlending, side: DoubleSide, forceSinglePass: true,
		uniforms: UniformsUtils.clone(UniformsLib.fog),
		defines: { [shape.toUpperCase() + '_PARTICLE']: 1 },
		vertexShader: `
			attribute vec4 particleColor;
			varying vec4 vColor; varying vec2 vUv;
			#include <fog_pars_vertex>
			void main() {
				vColor = particleColor; vUv = uv;
				#if defined(SMOKE_PARTICLE) || defined(GLOW_PARTICLE)
					vec4 mvPosition = modelViewMatrix * instanceMatrix[3];
					mvPosition.xy += mat2(instanceMatrix) * position.xy;
				#else
					vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
				#endif
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}
		`,
		fragmentShader: `
			varying vec4 vColor; varying vec2 vUv;
			#include <fog_pars_fragment>
			void main() {
				gl_FragColor = vColor;
				vec2 p = vUv * 2.0 - 1.0;
				#if defined(SMOKE_PARTICLE)
					float r = length(p);
					float lobes = sin(p.x * 8.0 + p.y * 3.0) * cos(p.y * 7.0 - p.x * 2.0);
					gl_FragColor.a *= (1.0 - smoothstep(0.13, 0.94, r - 0.12 * lobes)) * (0.80 + 0.20 * lobes);
				#elif defined(GLOW_PARTICLE)
					float r = dot(p, p);
					gl_FragColor.rgb = mix(vColor.rgb, vec3(1.0, 0.93, 0.76), exp(-16.0 * r) * 0.74);
					gl_FragColor.a *= exp(-5.0 * r) * (1.0 - smoothstep(0.65, 1.0, r));
				#elif defined(SCUFF_PARTICLE)
					gl_FragColor.rgb *= mix(0.38, 1.0, smoothstep(0.61, 0.82, length(p)));
				#endif
				#include <colorspace_fragment>
				#include <fog_fragment>
				#if defined(USE_FOG) && (defined(FLAME_PARTICLE) || defined(GLOW_PARTICLE))
					gl_FragColor.a *= 1.0 - fogFactor;
				#endif
			}
		`,
	});
	const colors = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
	geometry.setAttribute('particleColor', colors);
	const mesh = new InstancedMesh(geometry, surface, capacity);
	mesh.name = `weapon-${shape}`; mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false;
	mesh.instanceMatrix.setUsage(DynamicDrawUsage);
	const particles: T[] = [];
	const transform = new Object3D(); const tint = new Color();
	return {
		mesh,
		add: function (particle: T) {
			if (particles.length === capacity) particles.shift();
			particles.push(particle);
		},
		clear: function () { particles.length = 0; },
		update: function (time: number) {
			let live = 0; let drawn = 0;
			for (const particle of particles) {
				const age = time - particle.born;
				if (age >= particle.life) continue;
				particles[live++] = particle;
				if (age < 0) continue;
				tint.copy(particle.color);
				const opacity = pose(particle, age, age / particle.life, transform, tint);
				transform.updateMatrix(); mesh.setMatrixAt(drawn, transform.matrix);
				colors.setXYZW(drawn++, tint.r, tint.g, tint.b, opacity);
			}
			particles.length = live; mesh.count = drawn; mesh.visible = drawn > 0;
			if (!drawn) return;
			mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, drawn * 16);
			colors.clearUpdateRanges(); colors.addUpdateRange(0, drawn * 4);
			mesh.instanceMatrix.needsUpdate = colors.needsUpdate = true;
		},
		dispose: function () { particles.length = 0; mesh.dispose(); geometry.dispose(); surface.dispose(); },
	};
};
