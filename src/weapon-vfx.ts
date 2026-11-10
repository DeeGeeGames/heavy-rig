import { AdditiveBlending, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, ShaderMaterial, SphereGeometry, UniformsLib, UniformsUtils, Vector3, Object3D } from 'three';
import type { CombatStateView, Effect, Shot } from './simulation';

// Presentation only: every animation is sampled from simulation time. These
// materials supply local glow without bloom passes, lights, or external textures.
export const createWeaponVfx = function () {
	const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>();
	const ownGeometry = function <T extends BufferGeometry>(value: T): T { geometries.add(value); return value; };
	const ownMaterial = function <T extends Material>(value: T): T { materials.add(value); return value; };
	const cube = ownGeometry(new BoxGeometry(1, 1, 1));
	const cylinder = ownGeometry(new CylinderGeometry(1, 1, 1, 12, 1, true));
	const sphere = ownGeometry(new SphereGeometry(1, 12, 8));
	const nose = ownGeometry(new ConeGeometry(1, 1, 10).rotateZ(-Math.PI / 2));
	const plume = ownGeometry(new ConeGeometry(1, 1, 10).rotateZ(Math.PI / 2));
	const plane = ownGeometry(new PlaneGeometry(1, 1));
	const ring = ownGeometry(new RingGeometry(0.95, 1, 48));
	const clock = { value: 0 };
	const emissive = function (color: string, opacity = 1) {
		return ownMaterial(new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
	};
	const softBeam = function (color: string, strength: number, tapered = false) {
		return ownMaterial(new ShaderMaterial({
			transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: true,
			// Keep the clock reference: UniformsUtils.merge clones uniform values.
			uniforms: { ...UniformsUtils.clone(UniformsLib.fog), tint: { value: new Color(color) }, strength: { value: strength }, clock, taper: { value: tapered ? 1 : 0 }, afterglow: { value: 1 } },
			vertexShader: `
				varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
				#include <fog_pars_vertex>
				void main() {
					vUv = uv; vNormal = normalize(normalMatrix * normal);
					vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vView = -mvPosition.xyz;
					gl_Position = projectionMatrix * mvPosition;
					#include <fog_vertex>
				}
			`,
			fragmentShader: `
				uniform vec3 tint; uniform float strength; uniform float clock; uniform float taper; uniform float afterglow;
				varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
				#include <fog_pars_fragment>
				void main() {
					float facing = max(0.0, dot(normalize(vNormal), normalize(vView)));
					float ends = smoothstep(0.0, 0.025, vUv.y) * smoothstep(0.0, 0.025, 1.0 - vUv.y);
					float flow = 0.92 + 0.08 * sin(vUv.y * 65.0 - clock * 28.0);
					float tail = mix(1.0, smoothstep(0.0, 0.8, vUv.y), taper);
					gl_FragColor = vec4(tint, pow(facing, 2.8) * ends * flow * strength * tail * afterglow);
					#include <fog_fragment>
					#include <colorspace_fragment>
				}
			`,
		}));
	};
	const flare = function (color: string) {
		const tint = new Color(color); const opacity = { value: 1 };
		const surface = new ShaderMaterial({
			transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: true,
			uniforms: { ...UniformsUtils.clone(UniformsLib.fog), tint: { value: tint }, opacity },
			vertexShader: `
				varying vec2 vUv;
				#include <fog_pars_vertex>
				void main() {
					vUv = uv;
					vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
					vec2 size = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
					mvPosition.xy += position.xy * size; gl_Position = projectionMatrix * mvPosition;
					#include <fog_vertex>
				}
			`,
			fragmentShader: `
				uniform vec3 tint; uniform float opacity; varying vec2 vUv;
				#include <fog_pars_fragment>
				void main() {
					vec2 p = vUv * 2.0 - 1.0; float r = length(p);
					float glow = exp(-r * r * 5.5) * 0.5;
					float core = exp(-r * r * 85.0);
					float rays = exp(-abs(p.x * p.y) * 95.0) * exp(-r * r * 8.0) * 0.18;
					float alpha = (glow + core + rays) * (1.0 - smoothstep(0.65, 1.0, r));
					gl_FragColor = vec4(mix(tint, vec3(1.0), core * 0.8), alpha * opacity);
					#include <fog_fragment>
					#include <colorspace_fragment>
				}
			`,
		});
		return { surface, tint, opacity };
	};
	const sharedFlare = function (color: string) { const value = flare(color); ownMaterial(value.surface); return value.surface; };
	const white = emissive('#f4ffff'); const amber = emissive('#ffbd57');
	const violet = emissive('#ae83ff'); const hot = emissive('#fff1c4');
	const tealFlare = sharedFlare('#46e6cc'); const violetFlare = sharedFlare('#9165ff');
	const laserSheath = softBeam('#37d6bf', 0.44); const particleWake = softBeam('#8e67ff', 0.55, true);
	const metal = ownMaterial(new MeshStandardMaterial({ color: '#b4beb3', roughness: 0.65, metalness: 0.45 }));
	const rocketMetal = ownMaterial(new MeshStandardMaterial({ color: '#776f61', roughness: 0.7, metalness: 0.5 }));
	const finsMaterial = ownMaterial(new MeshStandardMaterial({ color: '#485252', roughness: 0.7, metalness: 0.5 }));
	const styles: Readonly<Record<Shot['kind'], { surface: MeshBasicMaterial; trail: Material; duration: number; width: number; length: number; radius: number }>> = {
		bullet: { surface: hot, trail: emissive('#ffbd57', 0.6), duration: 0.022, width: 0.48, length: 4.5, radius: 0.65 },
		cannon: { surface: hot, trail: softBeam('#ffa735', 0.65), duration: 0.05, width: 2, length: 7, radius: 1.7 },
		ppc: { surface: white, trail: particleWake, duration: 0.28, width: 8, length: 11, radius: 3.2 },
		missile: { surface: hot, trail: amber, duration: 0, width: 1, length: 4, radius: 1.7 },
		rocket: { surface: amber, trail: amber, duration: 0, width: 1, length: 4, radius: 2.1 },
		enemy: { surface: emissive('#ff8c5d'), trail: emissive('#f06f37', 0.6), duration: 0.04, width: 0.7, length: 5, radius: 1 },
	};
	const scratch = new Object3D(); const direction = new Vector3(); const up = new Vector3(0, 1, 0); const forward = new Vector3(1, 0, 0);
	const arcStart = new Vector3(); const arcEnd = new Vector3();
	const afterglowRoot = new Group(); afterglowRoot.name = 'particle-afterglow';
	interface Afterglow { mesh: Mesh<CylinderGeometry, ShaderMaterial>; fade: { value: number }; born: number }
	const afterglows: Afterglow[] = [];
	let particleTracks = new Set<Shot>();
	let previousState: CombatStateView | undefined; let previousTime = 0;
	const clearAfterglows = function () {
		for (const glow of afterglows) { glow.mesh.removeFromParent(); glow.mesh.material.dispose(); }
		afterglows.length = 0; particleTracks.clear();
	};
	const updateAfterglows = function (state: CombatStateView) {
		if (previousState !== state || state.time < previousTime) clearAfterglows();
		previousState = state; previousTime = state.time;
		const live = new Set(state.shots.filter(function (shot) { return shot.kind === 'ppc'; }));
		for (const shot of particleTracks) {
			if (live.has(shot)) continue;
			// The domain object retains its final swept position after ECS removal.
			// Clamp a ground crossing before freezing the remaining energy in place.
			const elevation = shot.elevation ?? 42; const verticalSpeed = shot.vElevation ?? 0;
			const overshoot = elevation < 0 && verticalSpeed < 0 ? elevation / verticalSpeed : 0;
			const length = Math.min(styles.ppc.duration, Math.max(0, (shot.age ?? styles.ppc.duration) - overshoot));
			if (length === 0) continue;
			const end = new Vector3(shot.x - shot.vx * overshoot, Math.max(0, elevation), shot.y - shot.vy * overshoot);
			direction.set(shot.vx, shot.vElevation ?? 0, shot.vy);
			const fade = { value: 1 }; const surface = particleWake.clone();
			surface.uniforms = { ...surface.uniforms, clock, afterglow: fade };
			const mesh = new Mesh(cylinder, surface); mesh.name = 'particle-wake';
			mesh.position.copy(end).addScaledVector(direction, -length / 2);
			mesh.scale.set(styles.ppc.width, direction.length() * length, styles.ppc.width);
			mesh.quaternion.setFromUnitVectors(up, direction.normalize()); afterglowRoot.add(mesh);
			afterglows.push({ mesh, fade, born: state.time });
		}
		particleTracks = live;
		for (let i = afterglows.length - 1; i >= 0; i--) {
			const glow = afterglows[i]; if (!glow) continue;
			const remaining = Math.max(0, 1 - (state.time - glow.born) / 0.12);
			glow.fade.value = remaining * remaining;
			if (remaining === 0) { glow.mesh.removeFromParent(); glow.mesh.material.dispose(); afterglows.splice(i, 1); }
		}
	};
	const createShot = function () {
		const root = new Group(); root.name = 'projectile';
		const trail = new Mesh<BufferGeometry, Material>(cylinder, amber); const head = new Mesh<BufferGeometry, Material>(sphere, hot);
		const halo = new Mesh(plane, violetFlare); root.add(trail, head, halo);
		const hardware = new Group(); root.add(hardware);
		const body = new Mesh(cylinder, metal); body.rotation.z = -Math.PI / 2; body.scale.set(1.7, 11, 1.7); body.position.x = -7;
		const finA = new Mesh(cube, finsMaterial); finA.position.x = -10; finA.scale.set(5, 0.5, 7);
		const finB = new Mesh(cube, finsMaterial); finB.position.x = -10; finB.scale.set(5, 7, 0.5);
		const exhaust = new Mesh(plume, amber); const exhaustCore = new Mesh(plume, hot);
		hardware.add(body, finA, finB, exhaust, exhaustCore);
		const corona = new InstancedMesh(cylinder, violet, 9); corona.frustumCulled = false; root.add(corona);
		return { root, trail, head, halo, hardware, body, exhaust, exhaustCore, corona, dispose: function () { corona.dispose(); } };
	};
	const updateShot = function (value: ReturnType<typeof createShot>, shot: Shot, time: number) {
		const style = styles[shot.kind];
		value.head.material = style.surface; value.trail.material = style.trail;
		value.head.geometry = shot.kind === 'missile' || shot.kind === 'rocket' ? nose : sphere;
		value.head.position.set(shot.x, shot.elevation ?? 42, shot.y);
		direction.set(shot.vx, shot.vElevation ?? 0, shot.vy);
		if (direction.lengthSq() > 0) value.head.quaternion.setFromUnitVectors(forward, direction.normalize());
		value.head.scale.set(style.length, style.radius, style.radius);
		value.halo.visible = value.corona.visible = shot.kind === 'ppc';
		value.hardware.visible = shot.kind === 'missile' || shot.kind === 'rocket';
		value.halo.position.copy(value.head.position); value.halo.scale.setScalar(shot.kind === 'ppc' ? 42 : 16);
		if (value.hardware.visible) {
			value.hardware.position.copy(value.head.position); value.hardware.quaternion.copy(value.head.quaternion);
			value.body.material = shot.kind === 'missile' ? metal : rocketMetal;
			const age = Math.max(0, shot.age ?? 1);
			const length = Math.min(Math.hypot(shot.vx, shot.vy) * age, (shot.kind === 'rocket' ? 24 : 17) * (0.92 + 0.08 * Math.sin(time * 53)));
			value.exhaust.position.x = -13 - length / 2; value.exhaust.scale.set(length, 2.8, 2.8);
			value.exhaustCore.position.x = -13 - length * 0.3; value.exhaustCore.scale.set(length * 0.6, 1.1, 1.1);
		}
		if (value.corona.visible) {
			value.corona.position.copy(value.head.position); value.corona.quaternion.copy(value.head.quaternion);
			const length = Math.min(288, Math.max(0, shot.age ?? 1) * Math.hypot(shot.vx, shot.vy));
			for (let i = 0; i < 9; i++) {
				const strand = Math.floor(i / 3); const part = i % 3; const phase = strand * 2.1 + time * 12;
				arcStart.set(-length * part / 3, Math.sin(phase + part * 2) * 3.5, Math.cos(phase + part * 2) * 3.5);
				arcEnd.set(-length * (part + 1) / 3, Math.sin(phase + (part + 1) * 2) * 3.5, Math.cos(phase + (part + 1) * 2) * 3.5);
				scratch.position.copy(arcStart).add(arcEnd).multiplyScalar(0.5); direction.subVectors(arcEnd, arcStart);
				scratch.scale.set(0.38, direction.length(), 0.38); scratch.quaternion.setFromUnitVectors(up, direction.normalize());
				scratch.updateMatrix(); value.corona.setMatrixAt(i, scratch.matrix);
			}
			value.corona.instanceMatrix.needsUpdate = true;
		}
	};
	const createBeam = function (slot: number) {
		const root = new Group(); root.name = slot === 0 ? 'laser' : `laser-${slot}`; root.visible = false;
		const halo = new Mesh(cylinder, laserSheath); const core = new Mesh(cylinder, white);
		const impact = new Mesh(plane, tealFlare); const emitter = new Mesh(plane, tealFlare);
		const sparks = new InstancedMesh(cylinder, white, 7); sparks.frustumCulled = false;
		root.add(halo, core, impact, emitter, sparks);
		return { root, halo, core, impact, emitter, sparks, dispose: function () { sparks.dispose(); } };
	};
	const updateBeam = function (value: ReturnType<typeof createBeam>, from: Vector3, to: Vector3, time: number, contact: boolean) {
		value.impact.position.copy(to); value.impact.scale.setScalar(30 + Math.sin(time * 31) * 2);
		value.impact.visible = value.sparks.visible = contact;
		value.emitter.position.copy(from); value.emitter.scale.setScalar(20);
		for (let i = 0; i < value.sparks.count; i++) {
			const age = (time * 4.5 + i * 0.173) % 1; const angle = i * 2.4;
			scratch.position.set(to.x + Math.cos(angle) * age * 16, to.y + Math.sin(angle * 1.7) * age * 14 - age * age * 9, to.z + Math.sin(angle) * age * 16);
			direction.set(Math.cos(angle), Math.sin(angle * 1.7) - age, Math.sin(angle)).normalize();
			scratch.quaternion.setFromUnitVectors(up, direction); scratch.scale.set(0.35 * (1 - age), 2 + age * 3, 0.35 * (1 - age));
			scratch.updateMatrix(); value.sparks.setMatrixAt(i, scratch.matrix);
		}
		value.sparks.instanceMatrix.needsUpdate = true;
	};
	const createEffect = function () {
		const root = new Group(); root.name = 'impact-effect';
		const light = flare('#ffce83'); const sparkSurface = new MeshBasicMaterial({ color: '#fff0bf', transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
		const halo = new Mesh(ring, sparkSurface); halo.rotation.x = -Math.PI / 2;
		const sparks = new InstancedMesh(cylinder, sparkSurface, 12); sparks.frustumCulled = false;
		const flash = new Mesh(plane, light.surface); root.add(halo, sparks, flash);
		return { root, halo, sparks, flash, light, sparkSurface, dispose: function () { sparks.dispose(); light.surface.dispose(); sparkSurface.dispose(); } };
	};
	const updateEffect = function (value: ReturnType<typeof createEffect>, effect: Effect) {
		const age = Math.max(0, 0.5 - effect.life); const progress = Math.min(1, age * 2); const muzzle = effect.source === 'muzzle';
		const energy = effect.color === '#b1a0ff';
		const fade = Math.max(0, 1 - age / (muzzle ? energy ? 0.14 : 0.085 : 0.22));
		value.light.tint.set(effect.color); value.light.opacity.value = fade;
		value.flash.scale.setScalar(effect.size * (muzzle ? 2.2 : 1.5) * (0.7 + progress));
		value.halo.visible = !muzzle && effect.size >= 65;
		value.halo.scale.setScalar(effect.size * progress * 0.65);
		value.halo.position.y = 0.3 - value.root.position.y;
		value.sparkSurface.color.set(energy ? '#c7afff' : '#ffdca0');
		value.sparkSurface.opacity = Math.max(0, 1 - age / (muzzle ? 0.16 : 0.5));
		const radius = effect.size * progress * (muzzle ? 0.4 : 0.85);
		for (let i = 0; i < value.sparks.count; i++) {
			const angle = i * 2.399963 + effect.x; const speed = 0.4 + (i % 5) * 0.13;
			direction.set(Math.cos(angle), 0.2 + Math.sin(i * 3.7) * 0.65, Math.sin(angle)).normalize();
			scratch.position.copy(direction).multiplyScalar(radius * speed); scratch.position.y -= age * age * 65;
			scratch.quaternion.setFromUnitVectors(up, direction);
			scratch.scale.set(muzzle ? 0.45 : 0.65, Math.max(0.1, (muzzle ? 4 : 7) * (1 - progress)), muzzle ? 0.45 : 0.65);
			scratch.updateMatrix(); value.sparks.setMatrixAt(i, scratch.matrix);
		}
		value.sparks.instanceMatrix.needsUpdate = true;
	};
	return {
		styles, createShot, updateShot, createBeam, updateBeam, createEffect, updateEffect, afterglowRoot, updateAfterglows,
		updateTime: function (time: number) { clock.value = time; },
		dispose: function () { clearAfterglows(); for (const value of geometries) value.dispose(); for (const value of materials) value.dispose(); },
	};
};
