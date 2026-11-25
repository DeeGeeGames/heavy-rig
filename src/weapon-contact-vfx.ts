import { BoxGeometry, CircleGeometry, Color, ConeGeometry, Group, PlaneGeometry, RingGeometry, Vector3, type Object3D } from 'three';
import type { CombatStateView, Effect } from './simulation';
import type { WeaponCue } from './weapon-feedback';
import { createWeaponParticleBatch } from './weapon-particle-batch';

const up = new Vector3(0, 1, 0), localZ = new Vector3(0, 0, 1);
const tint = {
	flame: new Color('#ff9c42'), ember: new Color('#fff3cc'), exhaust: new Color('#ffb16a'),
	brass: new Color('#cb9c53'), oldBrass: new Color('#957443'), metal: new Color('#65717a'),
	hotMetal: new Color('#fff1a9'), coldMetal: new Color('#616976'), stone: new Color('#8f8879'),
	brightStone: new Color('#d2c9b1'), coldStone: new Color('#827b6c'), pock: new Color('#786c59'),
	soil: new Color('#aa987d'), dust: new Color('#c7bba1'), muzzleSmoke: new Color('#afb0a4'),
	blastSmoke: new Color('#85827b'), cannonSmoke: new Color('#a9a08b'), fireball: new Color('#ff8438'),
	blast: new Color('#ffa259'), wave: new Color('#e4b988'), pressureDust: new Color('#a79c83'),
};
const debris = {
	metal: { bright: tint.hotMetal, base: tint.metal, cold: tint.coldMetal },
	stone: { bright: tint.brightStone, base: tint.stone, cold: tint.coldStone },
	brass: { bright: tint.brass, base: tint.brass, cold: tint.oldBrass },
	wood: { bright: new Color('#be9970'), base: new Color('#8e7858'), cold: new Color('#635742') },
};
interface Particle { born: number; life: number; origin: Vector3; color: Color }
interface Puff extends Particle { velocity: Vector3; size: number; growth: number; opacity: number; roll: number }
interface Flame extends Particle { axis: Vector3; length: number; radius: number }
interface Chip extends Particle { velocity: Vector3; size: number; stretch: number; spin: number; cold: Color }
interface Mark extends Particle { normal: Vector3; roll: number; radius: number }
interface Wave extends Particle { radius: number }

export const createWeaponContactVfx = function () {
	const root = new Group(); root.name = 'weapon-contacts';
	const flames = createWeaponParticleBatch<Flame>('flame', new ConeGeometry(1, 1, 8), 128, function (p, _age, progress, transform) {
		const length = p.length * (1 - 0.78 * progress); const radius = p.radius * (1 - 0.5 * progress);
		transform.position.copy(p.origin).addScaledVector(p.axis, length / 2);
		transform.quaternion.setFromUnitVectors(up, p.axis); transform.scale.set(radius, length, radius);
		return (1 - progress) ** 2;
	});
	const chips = createWeaponParticleBatch<Chip>('solid', new BoxGeometry(1, 1, 1), 768, function (p, age, progress, transform, color) {
		transform.position.copy(p.origin).addScaledVector(p.velocity, age);
		transform.position.y = Math.max(0.5, transform.position.y - 135 * age * age);
		transform.rotation.set(age * p.spin, age * p.spin * 1.6, age * p.spin * 0.8);
		const scale = p.size * Math.min(1, (1 - progress) * 6);
		transform.scale.set(scale * p.stretch, scale * 0.72, scale);
		color.lerp(p.cold, Math.min(1, progress * 2)); return 1;
	});
	const puffPose = function (p: Puff, travel: number, progress: number, transform: Object3D) {
		transform.position.copy(p.origin).addScaledVector(p.velocity, travel);
		transform.rotation.z = p.roll; transform.scale.setScalar(p.size + p.growth * Math.sqrt(progress));
	};
	const smoke = createWeaponParticleBatch<Puff>('smoke', new PlaneGeometry(), 512, function (p, age, progress, transform) {
		puffPose(p, (1 - Math.exp(-age * 3)) / 3, progress, transform);
		return p.opacity * (1 - progress) ** 1.6 * Math.min(1, 0.22 + age * 16);
	});
	const glow = createWeaponParticleBatch<Puff>('glow', new PlaneGeometry(), 256, function (p, age, progress, transform) {
		puffPose(p, age, progress, transform); return p.opacity * (1 - progress) ** 2;
	});
	const waves = createWeaponParticleBatch<Wave>('wave', new RingGeometry(0.93, 1, 44), 64, function (p, _age, progress, transform) {
		transform.position.copy(p.origin); transform.rotation.x = -Math.PI / 2;
		transform.scale.setScalar(p.radius * (0.14 + 0.86 * (1 - (1 - progress) ** 2)));
		return 0.72 * (1 - progress) ** 2;
	});
	const scuffs = createWeaponParticleBatch<Mark>('scuff', new CircleGeometry(1, 9), 48, function (p, _age, progress, transform) {
		transform.position.copy(p.origin); transform.quaternion.setFromUnitVectors(localZ, p.normal);
		transform.rotateZ(p.roll); transform.scale.set(p.radius, p.radius * 0.8, 1);
		return 0.86 * Math.min(1, (1 - progress) * 4);
	});
	const batches = [chips, scuffs, waves, smoke, flames, glow];
	for (const batch of batches) root.add(batch.mesh);
	// Transparent instance groups sort as one object. Composite dust before the
	// hot center, which tests against the same world depth as the fragments.
	scuffs.mesh.renderOrder = 0; waves.mesh.renderOrder = 1; smoke.mesh.renderOrder = 2;
	flames.mesh.renderOrder = 3; glow.mesh.renderOrder = 4;

	let seen = new WeakSet<WeaponCue>(); let previous: CombatStateView | undefined; let previousTime = 0;
	let seed = 8917;
	const random = function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
	const cloud = function (kind: 'smoke' | 'glow', born: number, origin: Vector3, velocity: Vector3, life: number, size: number, growth: number, color: Color, opacity: number) {
		const batch = kind === 'smoke' ? smoke : glow;
		batch.add({ born, origin, velocity, life, size, growth, color, opacity, roll: random() * Math.PI * 2 });
	};
	const flake = function (born: number, origin: Vector3, axis: Vector3, small: boolean, material: keyof typeof debris) {
		const stone = material === 'stone'; const bright = random() > 0.5;
		const palette = debris[material];
		const velocity = axis.multiplyScalar(25 + random() * (small ? 58 : 115));
		velocity.y += 15 + random() * (small ? 29 : 58);
		chips.add({ born, origin, velocity, life: small ? 0.24 + random() * 0.16 : 0.4 + random() * 0.28,
			color: bright ? palette.bright : palette.base, cold: palette.cold, size: (small ? 0.55 : 1.3) * (1 + random()) * (stone ? 1.5 : 1),
			stretch: material === 'wood' ? 3 : bright && !stone ? 2.4 : 1.45, spin: 4 + random() * 8 });
	};
	const flame = function (born: number, origin: Vector3, axis: Vector3, length: number, radius: number, life: number, color: Color) {
		flames.add({ born, origin, axis, length, radius, life, color });
	};
	const muzzle = function (cue: WeaponCue, origin: Vector3, direction: Vector3, side: Vector3) {
		const time = cue.time; const scale = cue.heavy ? 1.25 : 1; const light = cue.family === 'bullet';
		if (cue.family === 'rocket' || cue.family === 'missile') {
			const back = direction.clone().negate(); const vent = origin.clone().addScaledVector(back, 14);
			flame(time, vent, back, 19 * scale, 5, 0.10, tint.exhaust);
			for (let i = 0; i < 3; i++) {
				const velocity = back.clone().multiplyScalar(24 + random() * 34).addScaledVector(side, (random() - 0.5) * 15);
				velocity.y += 9 + random() * 14;
				cloud('smoke', time, vent, velocity, 0.36 + random() * 0.22, 8, 21 * scale, tint.muzzleSmoke, 0.45);
			}
			return;
		}
		flame(time, origin, direction, (light ? 12 : 39) * scale, light ? 2.6 : 9, light ? 0.043 : 0.083, tint.flame);
		flame(time, origin, direction, (light ? 8 : 21) * scale, light ? 1.6 : 5.4, light ? 0.032 : 0.061, tint.ember);
		if (!light) {
			for (const sign of [-1, 1]) flame(time, origin, side.clone().multiplyScalar(sign).addScaledVector(direction, 0.28).normalize(), 16 * scale, 4.4, 0.072, tint.exhaust);
			for (let i = 0; i < 4; i++) {
				const velocity = direction.clone().multiplyScalar(47 + i * 16).addScaledVector(side, (i - 1.5) * 19);
				velocity.y += 9 + random() * 22;
				cloud('smoke', time, origin, velocity, 0.43 + random() * 0.23, 8, 23 * scale, tint.muzzleSmoke, 0.48);
			}
		}
		const breech = origin.clone().addScaledVector(direction, light ? -15 : -24);
		flake(time, breech, side.clone().addScaledVector(up, 0.7), true, 'brass');
	};
	const impact = function (cue: Extract<WeaponCue, { type: 'impact' }>, origin: Vector3, direction: Vector3, side: Vector3, size: number) {
		const time = cue.time; const light = cue.family === 'bullet';
		const explosive = cue.family === 'missile' || cue.family === 'rocket' || cue.family === 'artillery';
		const splash = explosive && cue.heavy;
		const stone = cue.surface === 'concrete' || cue.surface === 'ground'; const scale = cue.heavy ? 1.25 : 1;
		const normal = new Vector3();
		if (cue.normal) normal.set(cue.normal.x, cue.normal.elevation, cue.normal.y).normalize();
		if (normal.lengthSq() === 0) {
			if (cue.surface === 'ground') normal.copy(up); else normal.copy(direction).negate();
		}
		const contact = origin.clone().addScaledVector(normal, 0.8);
		// Flat fire fans back from the surface. A steep or overhead shell
		// spreads its debris across both axes of the ground plane.
		const cross = new Vector3(side.z, 0, -side.x).multiplyScalar(Math.abs(direction.y));
		const scatter = function (width: number) {
			return side.clone().multiplyScalar((random() - 0.5) * width).addScaledVector(cross, (random() - 0.5) * width);
		};
		if (cue.surface === 'armor' || explosive) cloud('glow', time, contact, new Vector3(0, 8, 0), light ? 0.075 : 0.16, (light ? 15 : explosive ? 39 : 31) * scale, light ? 1 : 18, explosive ? tint.blast : tint.ember, 1.4);
		if (stone) {
			if (cue.scuff) scuffs.add({ born: time, life: 8, origin: origin.clone().addScaledVector(normal, 0.32), normal, roll: random() * Math.PI,
				radius: light ? 2.3 : explosive ? 5 : 6, color: tint.pock });
			for (let i = 0; i < (light ? 2 : 5); i++) {
				const dust = scatter(53).addScaledVector(normal, 15 + random() * 51);
				dust.y += 9 + random() * 31;
				cloud('smoke', time, contact, dust, (light ? 0.29 : 0.53) + random() * 0.17, light ? 5 : 10, (light ? 13 : 36) * scale, cue.surface === 'ground' ? tint.soil : tint.dust, light ? 0.61 : 0.85);
			}
		}
		for (let i = 0; i < (light ? 3 : explosive ? 7 : 9); i++) {
			const velocity = scatter(1.9).addScaledVector(direction, -0.22 - random() * 0.6).addScaledVector(normal, 0.25 + random() * 0.4);
			velocity.y += 0.1 + random() * 0.7;
			flake(time, contact, velocity.normalize(), light, stone ? 'stone' : cue.surface === 'wood' ? 'wood' : 'metal');
		}
		if (light || cue.surface === 'wood' && !explosive) return;
		for (let i = 0; i < (splash ? 5 : 3); i++) {
			const velocity = scatter(68).addScaledVector(direction, (random() - 0.46) * 34);
			velocity.y += 18 + random() * 34;
			const birth = contact.clone().addScaledVector(side, (random() - 0.5) * 11);
			if (explosive && (splash || i === 0)) cloud('glow', time, birth, velocity, 0.17 + random() * 0.16, 18, 22 * scale, tint.fireball, 0.93);
			cloud('smoke', time, birth, velocity, (splash ? 0.65 : 0.47) + random() * 0.19, 9, (splash ? 48 : 27) * scale, explosive ? tint.blastSmoke : tint.cannonSmoke, splash ? 0.67 : 0.46);
		}
		if (!splash) return;
		const reach = cue.family === 'artillery' ? size * 0.65 : 67 * scale;
		// A ground pressure front can only reach the portion of the floor
		// within this blast. High aircraft keep their fireball in the air.
		if (origin.y >= reach) return;
		const radius = Math.sqrt(reach * reach - origin.y * origin.y);
		waves.add({ born: time, origin: new Vector3(origin.x, 0.8, origin.z), color: tint.wave, life: 0.49, radius });
		for (let i = 0; i < 6; i++) {
			const angle = random() * Math.PI * 2;
			const velocity = new Vector3(Math.cos(angle) * 56, 7 + random() * 10, Math.sin(angle) * 56).multiplyScalar(radius / reach);
			cloud('smoke', time, new Vector3(origin.x + velocity.x * 0.19, 2, origin.z + velocity.z * 0.19), velocity, 0.48 + random() * 0.17, 7, 22, tint.pressureDust, 0.53);
		}
	};
	const emit = function (effect: Effect, cue: WeaponCue) {
		const origin = new Vector3(effect.x, effect.elevation ?? 36, effect.y);
		const direction = new Vector3(cue.direction.x, cue.direction.elevation, cue.direction.y).normalize();
		const side = new Vector3(-direction.z, 0, direction.x);
		if (side.lengthSq() < 0.0001) side.set(1, 0, 0); else side.normalize();
		if (cue.type === 'fire') muzzle(cue, origin, direction, side);
		else impact(cue, origin, direction, side, effect.size);
	};
	return {
		root,
		update: function (state: CombatStateView, effects: readonly Effect[] = state.effects) {
			let changed = previous !== state || state.time < previousTime;
			if (changed) {
				for (const batch of batches) batch.clear();
				seen = new WeakSet(); seed = 8917;
			}
			for (const effect of effects) {
				const cue = effect.feedback;
				if (!cue || seen.has(cue)) continue;
				seen.add(cue); emit(effect, cue); changed = true;
			}
			if (changed || state.time !== previousTime) for (const batch of batches) batch.update(state.time);
			previous = state; previousTime = state.time;
		},
		dispose: function () { for (const batch of batches) batch.dispose(); root.removeFromParent(); previous = undefined; },
	};
};
