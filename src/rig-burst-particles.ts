import { BoxGeometry, Color, Group, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { RIG_ARMOR_BURSTS } from './rig-defeat-timing';
import { randomSource } from './universe';
import { createWeaponParticleBatch } from './weapon-particle-batch';

export interface RigArmorBurst {
	born: number;
	origin: Vector3;
	direction: Vector3;
	armorVelocity: Vector3;
	diameter: number;
	seed: number;
}

const up = new Vector3(0, 1, 0);
const hot = new Color('#fff0a0'), gold = new Color('#ffb450'), ember = new Color('#fb7933');
const cold = new Color('#653725');
const smokeTints = [new Color('#917969'), new Color('#564c49'), new Color('#42494d')] as const;

const fireMaterial = function (seed: number) {
	const phase = { value: 0 };
	const material = new ShaderMaterial({
		transparent: true, depthWrite: false, fog: true, toneMapped: false,
		uniforms: { ...UniformsUtils.clone(UniformsLib.fog), phase, seed: { value: seed } },
		vertexShader: `
			varying vec2 at;
			#include <fog_pars_vertex>
			void main() {
				at = uv;
				vec4 mvPosition = modelViewMatrix[3];
				mvPosition.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}
		`,
		fragmentShader: `
			varying vec2 at;
			uniform float phase, seed;
			#include <fog_pars_fragment>
			float hash(vec2 p) {
				vec3 h = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
				h += dot(h, h.yzx + 33.33);
				return fract((h.x + h.y) * h.z);
			}
			float noise2(vec2 p) {
				vec2 i = floor(p), f = fract(p);
				f = f*f*(3.-2.*f);
				return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
				           mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
			}
			float billow(vec2 p) {
				mat2 turn = mat2(.8,.6,-.6,.8);
				return .58*noise2(p) + .28*noise2(turn*p*2.08 + 8.1) + .14*noise2(p*4.3 - 7.6);
			}
			void main() {
				vec2 p = at * 2. - 1.;
				vec2 flow = vec2(seed, seed*.37 - phase*1.9);
				float broad = billow(p*2.85 + flow);
				float cell = billow(p*4.2 + flow + vec2(1.2*broad, -.7*broad));
				float nose = length((p - vec2(-.08,-.08)) / vec2(.72,.63));
				float cap = length((p - vec2(-.13,.25)) / vec2(.46,.50));
				float side = length((p - vec2(.24,.08)) / vec2(.49,.52));
				float inside = 1. - min(nose, min(cap,side)) + .72*(broad-.49) + .22*(cell-.50);
				float alpha = smoothstep(-.06,.12,inside) * (1. - smoothstep(.57,1.,phase));
				if(alpha < .004) discard;
				float heat = clamp(.36 + .42*clamp(inside,0.,1.) + 1.38*(cell-.47)
				                   + .36*(1.-smoothstep(.02,.34,phase)) - .37*phase, 0., 1.);
				vec3 color = mix(vec3(.13,.018,.004), vec3(.98,.115,.008), smoothstep(.04,.38,heat));
				color = mix(color, vec3(1.,.55,.047), smoothstep(.32,.64,heat));
				color = mix(color, vec3(1.,.93,.64), smoothstep(.59,.85,heat));
				color = mix(color, vec3(1.,.992,.90), smoothstep(.80,1.,heat));
				gl_FragColor = vec4(color,alpha);
				#include <colorspace_fragment>
				#include <fog_fragment>
			}
		`,
	});
	return { material, phase };
};

interface Puff {
	born: number; life: number; color: Color; origin: Vector3; velocity: Vector3;
	size: number; opacity: number; roll: number;
}

interface Spark {
	born: number; life: number; color: Color; origin: Vector3; velocity: Vector3;
	width: number; length: number;
}

export const createRigBurstParticles = function () {
	const root = new Group();
	root.name = 'rig-armor-bursts';
	root.userData['nativeEffects'] = true;
	const burstCount = RIG_ARMOR_BURSTS.length;
	const worldScale = new Vector3(), velocity = new Vector3();
	// Smoke and glow are camera-facing batches. Their shader places the center
	// in world space and draws the quad in view space, so scale the quad too.
	const smoke = createWeaponParticleBatch<Puff>('smoke', new PlaneGeometry(), burstCount * 9, function (p, age, progress, transform) {
		transform.position.copy(p.origin).addScaledVector(p.velocity, -Math.expm1(-2.2 * age) / 2.2);
		transform.position.y += 11 * age;
		transform.scale.copy(worldScale).multiplyScalar(p.size * (0.38 + 1.15 * Math.sqrt(progress)));
		transform.rotation.z = p.roll + progress * 0.26;
		return p.opacity * Math.min(1, age * 14) * (1 - progress) ** 1.28;
	});
	const glow = createWeaponParticleBatch<Puff>('glow', new PlaneGeometry(), burstCount, function (p, age, progress, transform) {
		transform.position.copy(p.origin).addScaledVector(p.velocity, age);
		transform.scale.copy(worldScale).multiplyScalar(p.size * (0.70 + 0.65 * Math.sqrt(progress)));
		return p.opacity * (1 - progress) ** 2;
	});
	const sparks = createWeaponParticleBatch<Spark>('solid', new BoxGeometry(), burstCount * 16, function (p, age, progress, transform, color) {
		transform.position.copy(p.origin).addScaledVector(p.velocity, age);
		transform.position.y -= 57 * age * age;
		velocity.copy(p.velocity); velocity.y -= 114 * age;
		transform.quaternion.setFromUnitVectors(up, velocity.normalize());
		const width = p.width * Math.min(1, (1 - progress) * 4);
		transform.scale.set(width, p.length * (1 - 0.8 * progress), width * 0.80);
		color.lerp(cold, progress ** 1.65);
		return 1;
	});
	root.add(smoke.mesh, sparks.mesh, glow.mesh);
	smoke.mesh.renderOrder = 5;
	glow.mesh.renderOrder = 7;
	const plane = new PlaneGeometry();
	const fireballs: { mesh: Mesh<PlaneGeometry, ShaderMaterial>; phase: { value: number }; burst: RigArmorBurst; life: number }[] = [];

	const emit = function (burst: RigArmorBurst) {
		const { born, direction, diameter, origin, armorVelocity, seed } = burst;
		const large = diameter > 38;
		const { material, phase } = fireMaterial(seed);
		const mesh = new Mesh(plane, material);
		mesh.frustumCulled = false; mesh.renderOrder = 6;
		root.add(mesh);
		fireballs.push({ mesh, phase, burst, life: large ? 0.39 : 0.31 });

		const random = randomSource(Math.round(seed * 65536) + 193984);
		const across = new Vector3().crossVectors(up, direction).normalize();
		glow.add({
			born, life: 0.19, color: gold, origin: origin.clone().add(direction),
			velocity: direction.clone().multiplyScalar(28).add(armorVelocity), size: diameter * 1.32, opacity: 0.84, roll: 0,
		});
		for (let i = 0; i < (large ? 9 : 7); i++) {
			const spread = (random() - 0.5) * 1.2;
			const drift = direction.clone().multiplyScalar(13 + random() * 17).addScaledVector(across, spread * 29).addScaledVector(up, 6 + random() * 22);
			const delay = 0.045 + i * 0.025;
			const offset = origin.clone().addScaledVector(direction, 2 + random() * 4).addScaledVector(across, spread * 3).addScaledVector(armorVelocity, delay);
			smoke.add({
				born: born + delay, life: 0.48 + random() * 0.36, origin: offset, velocity: drift.addScaledVector(armorVelocity, 0.75),
				color: smokeTints[i % 3] ?? smokeTints[0], size: diameter * (0.43 + random() * 0.22),
				opacity: 0.60 + random() * 0.20, roll: random() * 6.28,
			});
		}
		for (let i = 0; i < (large ? 16 : 10); i++) {
			const angle = random() * Math.PI * 2;
			const drift = direction.clone().multiplyScalar(19 + random() * 38)
				.addScaledVector(across, Math.cos(angle) * (22 + random() * 50)).addScaledVector(up, Math.sin(angle) * 41 + random() * 21);
			const delay = random() * 0.065;
			sparks.add({
				born: born + delay, life: 0.26 + random() * 0.32, origin: origin.clone().addScaledVector(direction, 1.3).addScaledVector(armorVelocity, delay),
				velocity: drift.add(armorVelocity), color: i % 3 === 0 ? hot : i % 3 === 1 ? gold : ember,
				width: 0.53 + random() * 0.57, length: 1.6 + random() * 4.7,
			});
		}
	};

	const update = function (time: number) {
		root.getWorldScale(worldScale);
		smoke.update(time); glow.update(time); sparks.update(time);
		for (const { mesh, phase, burst, life } of fireballs) {
			const age = Math.max(0, time - burst.born);
			mesh.visible = age < life;
			if (!mesh.visible) continue;
			const progress = age / life, expansion = -Math.expm1(-progress * 7.2);
			phase.value = progress;
			mesh.position.copy(burst.origin).addScaledVector(burst.direction, burst.diameter * (0.04 + 0.26 * expansion));
			mesh.position.addScaledVector(burst.armorVelocity, -Math.expm1(-2 * age) / 2);
			mesh.position.y += burst.diameter * 0.15 * progress;
			const width = burst.diameter * (0.19 + 0.72 * expansion + 0.14 * progress);
			mesh.scale.set(width, width * (0.90 + 0.23 * progress), width);
		}
		root.visible = smoke.mesh.visible || glow.mesh.visible || sparks.mesh.visible || fireballs.some(function (ball) { return ball.mesh.visible; });
	};
	// Ordinary completion and early model disposal both remove this child.
	root.addEventListener('removed', function dispose() {
		root.removeEventListener('removed', dispose);
		for (const { mesh } of fireballs) mesh.material.dispose();
		plane.dispose(); smoke.dispose(); glow.dispose(); sparks.dispose();
	});
	return { root, emit, update };
};
