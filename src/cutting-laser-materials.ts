import { AdditiveBlending, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, type Vector4 } from 'three';

// Both the shaft and the impact are oriented by the viewing direction. Their
// profiles are in world units, so they scale with the rest of the battlefield.
const viewAxis = `
	vec2 axisOf(vec2 delta) {
		float span = length(delta);
		return span > 0.0001 ? delta / span : vec2(1.0, 0.0);
	}
`;
const lightProfile = `
	#include <fog_pars_fragment>
	float glow(float x) { return exp(-x * x); }
	float spot(vec2 p, vec2 radius) {
		vec2 offset = p / radius;
		return exp(-dot(offset, offset));
	}
	float filament(float distanceToCore, float radius) {
		float aa = clamp(fwidth(distanceToCore) * 0.57, 0.18, 0.84);
		return 1.0 - smoothstep(max(0.0, radius - aa), radius + aa, abs(distanceToCore));
	}
`;
// Smoke/haze attenuates additive light. Mixing toward the fog color here
// would add a visible rectangle around an otherwise transparent effect.
const emit = `
	gl_FragColor = sRGBTransferEOTF(vec4(emission, 1.0));
	#include <colorspace_fragment>
	#ifdef USE_FOG
		#ifdef FOG_EXP2
			gl_FragColor.a = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
		#else
			gl_FragColor.a = 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
		#endif
	#endif
`;
const additive = { transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: true } as const;

export const cuttingBeamMaterial = function (clock: { value: number }, hostile: boolean) {
	return new ShaderMaterial({
		...additive,
		uniforms: { ...UniformsUtils.clone(UniformsLib.fog), clock, tint: { value: hostile ? new Vector3(0.96, 0.19, 0.065) : new Vector3(0.013, 0.84, 0.52) } },
		vertexShader: `
			#include <fog_pars_vertex>
			${viewAxis}
			varying vec2 beam;
			varying float span;
			void main() {
				vec3 start = (modelViewMatrix * vec4(0.0, -0.5, 0.0, 1.0)).xyz;
				vec3 end = (modelViewMatrix * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
				span = length(end.xy - start.xy);
				vec2 axis = axisOf(end.xy - start.xy);
				// Four vertex columns separate the caps from the actual segment.
				// Each cap stays at its endpoint depth, including near end-on views.
				float endColumn = step(0.5, uv.x);
				float padding = uv.x < 0.1 ? -16.0 : uv.x > 0.9 ? 16.0 : 0.0;
				beam = vec2(endColumn * span + padding, (uv.y - 0.5) * 44.0);
				vec2 positionXY = start.xy + axis * beam.x + vec2(-axis.y, axis.x) * beam.y;
				float depth = mix(start.z, end.z, endColumn);
				vec4 mvPosition = vec4(positionXY, depth + 0.25, 1.0);
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}
		`,
		fragmentShader: `
			${lightProfile}
			uniform float clock;
			uniform vec3 tint;
			varying vec2 beam;
			varying float span;
			void main() {
				float x = beam.x, y = beam.y;
				float u = clamp(x / max(span, 0.0001), 0.0, 1.0);
				float ripple = 0.5 + 0.5 * sin(x * 0.36 - clock * 27.0 + 1.1 * sin(x * 0.15 - clock * 13.0));
				float width = 2.65 + 0.74 * ripple + 1.65 * exp(-x * x / 370.0) + 1.5 * pow(u, 8.0);
				float gate = smoothstep(-0.3, 0.35, x) * (1.0 - smoothstep(span - 0.35, span + 0.3, x));
				vec3 white = vec3(0.90, 1.0, 0.97);
				vec3 emission = gate * (tint * (0.48 * glow(y / width) + 0.12 * glow(y / (width * 2.0)))
					+ white * filament(y, 0.83 + 0.22 * pow(u, 6.0)) * 1.12);
				float focus = 1.0 - smoothstep(0.0, 22.0, x);
				emission += white * spot(beam, vec2(1.6, 1.4)) + tint * (
					0.69 * spot(beam, vec2(6.0, 3.0)) + 0.36 * spot(beam, vec2(1.1, 7.5))
					+ 0.18 * spot(beam, vec2(8.0)) + 0.46 * gate * focus * glow(y / (0.65 + 4.0 * focus)));
				${emit}
			}
		`,
	});
};

export const CUTTER_SPARK_LIFETIME = 0.48;
export const CUTTER_SPARK_COUNT = 18;

export const cuttingImpactMaterial = function (clock: { value: number }, lastContact: { value: number }, births: Vector4[], directions: Vector4[]) {
	return new ShaderMaterial({
		...additive, uniforms: { ...UniformsUtils.clone(UniformsLib.fog), clock, lastContact, births: { value: births }, directions: { value: directions } },
		// Instance zero is the hot spot. Each remaining quad encloses one
		// streak, so only a handful of fragments shade each flying spark.
		vertexShader: `
			#include <fog_pars_vertex>
			${viewAxis}
			uniform float clock, lastContact;
			uniform vec4 births[${CUTTER_SPARK_COUNT}], directions[${CUTTER_SPARK_COUNT}];
			varying vec2 local;
			varying float streakLength, age, strength, radius;
			float hash(float id) { return fract(sin(id * 127.1 + 13.7) * 43758.5453); }
			void main() {
				vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				vec2 axis = axisOf((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy);
				vec2 across = vec2(-axis.y, axis.x);
				if (gl_InstanceID == 0) {
					local = (uv - 0.5) * 44.0;
					mvPosition.xy += axis * local.x + across * local.y;
					streakLength = -1.0;
					age = max(0.0, clock - lastContact);
					strength = 1.0; radius = 0.0;
				} else {
					int index = gl_InstanceID - 1;
					float id = float(index);
					vec4 birth = births[index], direction = directions[index];
					age = (clock - birth.w) / direction.w;
					if (age >= 1.0 || age < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
					mvPosition = viewMatrix * vec4(birth.xyz, 1.0);
					axis = axisOf((viewMatrix * vec4(direction.xyz, 0.0)).xy);
					across = vec2(-axis.y, axis.x);
					float seed = id * 3.3 + ceil(birth.w / direction.w) * 0.714;
					float angle = mix(1.0, 4.36, hash(seed + 1.4));
					vec2 velocity = (axis * cos(angle) + across * sin(angle)) * mix(15.0, 48.0, hash(seed + 3.9));
					vec2 gravity = vec2(0.0, -20.0) * (0.45 + hash(seed + 0.9));
					vec2 head = velocity * age + gravity * age * age;
					float tailAge = max(0.0, age - (0.082 + 0.088 * hash(id + 1.2)));
					vec2 tail = velocity * tailAge + gravity * tailAge * tailAge;
					vec2 along = axisOf(head - tail);
					streakLength = length(head - tail);
					local = vec2(mix(-4.5, streakLength + 4.5, uv.x), (uv.y - 0.5) * 9.0);
					mvPosition.xy += tail + along * local.x + vec2(-along.y, along.x) * local.y;
					radius = 0.36 + 0.34 * hash(id + 0.7);
					strength = (1.0 - smoothstep(0.32, 1.0, age)) * smoothstep(0.0, 0.052, age);
				}
				mvPosition.z += 0.25;
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}
		`,
		fragmentShader: `
			${lightProfile}
			uniform float clock;
			varying vec2 local;
			varying float streakLength, age, strength, radius;
			void main() {
				vec3 amber = vec3(1.0, 0.36, 0.047);
				vec3 emission;
				if (streakLength < 0.0) {
					float flicker = 0.82 + 0.13 * sin(clock * 48.0) + 0.06 * sin(clock * 83.0 + 0.4);
					vec2 p = vec2(local.x + 0.35 * local.y, local.y);
					emission = exp(-age * 12.0) * (vec3(1.0, 0.19, 0.025) * spot(p, vec2(9.0, 7.0)) * 0.84
						+ amber * spot(p, vec2(4.8, 6.2)) * flicker * 1.07
						+ vec3(1.0, 0.91, 0.72) * spot(p, vec2(2.8, 2.0)));
					if (age == 0.0) emission += vec3(1.0, 0.60, 0.19) * spot(p, vec2(0.85, 9.3)) * flicker * 0.72;
				} else {
					float d = length(local - vec2(clamp(local.x, 0.0, streakLength), 0.0));
					vec3 color = mix(vec3(1.0, 0.88, 0.49), vec3(1.0, 0.13, 0.015), age);
					emission = strength * (color * filament(d, radius) * 1.4 + amber * glow(d / 1.7) * 0.17);
				}
				${emit}
			}
		`,
	});
};
