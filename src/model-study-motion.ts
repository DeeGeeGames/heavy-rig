import { Mesh, MeshBasicMaterial, OctahedronGeometry, type Scene } from 'three';
import type { MechAssetModel } from './mech-asset-registry';
import type { WalkerGait } from './gait';

const motions = ['showcase', 'walk', 'lap', 'reverse', 'turn', 'aim', 'fire', 'rest'] as const;
export type StudyMotion = typeof motions[number];
export type StudyPhase = Exclude<StudyMotion, 'showcase'>;
export const isStudyMotion = function (value: string | undefined): value is StudyMotion {
	return motions.some(function (motion) { return value === motion; });
};

export const advanceStudyTravel = function (
	body: WalkerGait['body'], speed: number, aim: number, phase: StudyPhase, phaseTime: number,
	throttle: number, forwardSpeed: number, reverseSpeed: number, dt: number,
) {
	if (phase === 'lap') {
		// The silhouette study used a twelve-second circle and two independent torso sweeps.
		const radius = 64;
		const angularSpeed = Math.PI / 6 * throttle / 0.65;
		const angle = body.angle + angularSpeed * dt;
		return {
			body: {
				x: body.x + radius * (Math.sin(angle) - Math.sin(body.angle)),
				y: body.y + radius * (Math.cos(body.angle) - Math.cos(angle)),
				angle,
			},
			speed: radius * angularSpeed,
			aim: angle + Math.sin(2 * angle + 0.23) * 64 * Math.PI / 180,
		};
	}
	const targetSpeed = (phase === 'walk' ? forwardSpeed : phase === 'reverse' ? -reverseSpeed : phase === 'aim' ? forwardSpeed * 0.58 : 0) * throttle;
	const velocity = speed + (targetSpeed - speed) * (1 - Math.exp(-dt * 3.5));
	const angle = body.angle + (phase === 'turn' ? dt * 0.65 : 0);
	const targetAim = angle + (phase === 'aim' ? Math.sin(phaseTime * 0.9) * 1.3 : phase === 'turn' ? -Math.sin(phaseTime * 0.5) * 0.55 : 0);
	return {
		body: { x: body.x + Math.cos(angle) * velocity * dt, y: body.y + Math.sin(angle) * velocity * dt, angle },
		speed: velocity,
		aim: aim + (targetAim - aim) * (1 - Math.exp(-dt * 5)),
	};
};

export const createStudyMuzzleFlash = function (scene: Scene) {
	const flash = new Mesh(new OctahedronGeometry(1), new MeshBasicMaterial({ color: '#ffe3a6', transparent: true, depthWrite: false, toneMapped: false }));
	flash.visible = false;
	scene.add(flash);
	return {
		update: function (model: MechAssetModel, phaseTime: number, intensity: number) {
			flash.visible = false;
			if (intensity <= 0 || !model.muzzles.length) return;
			const shot = Math.floor(phaseTime / 0.85);
			const slot = shot % model.muzzles.length;
			const tubes = model.rocketMuzzles[slot];
			const exit = tubes?.length ? tubes[Math.floor(shot / model.muzzles.length) % tubes.length] : model.muzzles[slot];
			if (!exit) return;
			flash.visible = true;
			flash.position.copy(exit);
			flash.scale.setScalar(2 + 5 * intensity);
			flash.material.opacity = intensity;
		},
		dispose: function () { flash.removeFromParent(); flash.geometry.dispose(); flash.material.dispose(); },
	};
};
