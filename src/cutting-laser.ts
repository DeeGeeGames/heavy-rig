import { Group, InstancedMesh, Mesh, PlaneGeometry, Sphere, Vector3, Vector4 } from 'three';
import { getWeapon } from './arsenal';
import { groundHeight } from './terrain-elevation';
import type { Beam, CombatStateView } from './simulation';
import { cuttingBeamMaterial, cuttingImpactMaterial, CUTTER_SPARK_COUNT, CUTTER_SPARK_LIFETIME } from './cutting-laser-materials';

const sparkPhases = Array.from({ length: CUTTER_SPARK_COUNT }, function (_, i) {
	return { lifetime: CUTTER_SPARK_LIFETIME * (0.5 + 0.5 * ((i * 0.618034) % 1)), offset: (i * 0.754878) % 1 };
});
const plumeRadius = 88;
const createImpact = function (clock: { value: number }, quad: PlaneGeometry) {
	const lastContact = { value: -Infinity };
	// xyz stores the impact point and incident direction at birth. The fourth
	// component holds the birth time or lifetime, respectively.
	const sparks = sparkPhases.map(function ({ lifetime, offset }) {
		return { lifetime, offset, birth: new Vector4(0, 0, 0, -Infinity), direction: new Vector4(0, 1, 0, lifetime) };
	});
	const surface = cuttingImpactMaterial(clock, lastContact, sparks.map(spark => spark.birth), sparks.map(spark => spark.direction));
	const mesh = new InstancedMesh(quad, surface, 1 + CUTTER_SPARK_COUNT);
	const bounds = new Sphere(new Vector3(), plumeRadius); mesh.boundingSphere = bounds; mesh.name = 'laser-contact';
	const offset = new Vector3();
	return {
		mesh, lastContact,
		reset: function () {
			lastContact.value = -Infinity;
			for (const spark of sparks) spark.birth.w = -Infinity;
		},
		strike: function (point: Vector3, axis: Vector3, previousTime: number) {
			const now = clock.value;
			const since = lastContact.value === previousTime ? previousTime : now;
			let spreadSquared = 0;
			for (const { birth, direction, lifetime, offset: phase } of sparks) {
				const cycle = Math.floor(now / lifetime + phase);
				const born = (cycle - phase) * lifetime;
				if (born >= since && born > birth.w) {
					birth.set(point.x, point.y, point.z, born);
					direction.set(axis.x, axis.y, axis.z, lifetime);
				}
				if (now - birth.w < lifetime) {
					spreadSquared = Math.max(spreadSquared, offset.set(birth.x, birth.y, birth.z).distanceToSquared(point));
				}
			}
			// A fast sweep may leave visible sparks outside the new contact's plume.
			bounds.radius = plumeRadius + Math.sqrt(spreadSquared);
			lastContact.value = now; mesh.position.copy(point);
		},
		dispose: function () { mesh.dispose(); mesh.material.dispose(); },
	};
};

const playerName = function (slot: number) { return slot === 0 ? 'laser' : `laser-${slot}`; };
const beamName = function (beam: Beam) {
	if (beam.owner !== undefined) return `hostile-laser-${beam.owner}-${beam.slot}`;
	if (beam.squadmateId !== undefined) return `squad-laser-${beam.squadmateId}-${beam.slot}`;
	return playerName(beam.slot);
};

export const createCuttingLasers = function () {
	const root = new Group();
	const clock = { value: 0 };
	const friendly = cuttingBeamMaterial(clock, false), hostile = cuttingBeamMaterial(clock, true);
	const quad = new PlaneGeometry(1, 1);
	const shaftGeometry = new PlaneGeometry(1, 1, 3, 1);
	// The shader expands the quad past its endpoints for the muzzle flare.
	shaftGeometry.boundingSphere = new Sphere(new Vector3(), 1.25);
	const makeBeam = function (name: string, enemy: boolean, player: boolean) {
		const group = new Group(); group.name = name; group.visible = false;
		const shaft = new Mesh(shaftGeometry, enemy ? hostile : friendly);
		const impact = createImpact(clock, quad);
		group.add(shaft, impact.mesh); root.add(group);
		return { group, shaft, impact, player, dispose: function () {
			group.removeFromParent(); impact.dispose();
		} };
	};
	const views = new Map<string, ReturnType<typeof makeBeam>>();
	for (let slot = 0; slot < 4; slot++) {
		const name = playerName(slot); views.set(name, makeBeam(name, false, true));
	}
	const from = new Vector3(), to = new Vector3(), direction = new Vector3(), up = new Vector3(0, 1, 0);
	let previous: CombatStateView | undefined;

	return {
		root,
		update: function (state: CombatStateView, muzzles: readonly Vector3[]) {
			const reset = previous !== state || state.time < clock.value;
			const previousTime = clock.value;
			clock.value = state.time; previous = state;
			for (const view of views.values()) {
				view.shaft.visible = false;
				if (reset) view.impact.reset();
			}
			for (const beam of state.beams) {
				const enemy = beam.owner !== undefined;
				const player = !enemy && beam.squadmateId === undefined;
				const name = beamName(beam);
				const muzzle = player ? muzzles[beam.slot] : undefined;
				if (beam.origin) from.set(beam.origin.x, beam.origin.elevation, beam.origin.y);
				else if (muzzle) from.copy(muzzle);
				else {
					// Older endpoints may only carry their mount slot.
					const rig = player ? state.player : state.squadmates.find(function (mate) { return mate.pilotId === beam.squadmateId; });
					if (!rig) continue;
					from.set(rig.x, groundHeight(state.mission?.map.terrain, rig) + 42, rig.y);
				}
				let view = views.get(name);
				if (!view) {
					if (player) continue;
					view = makeBeam(name, enemy, false); views.set(name, view);
				}
				to.set(beam.x, beam.elevation ?? groundHeight(state.mission?.map.terrain, beam) + 42, beam.y);
				const length = direction.subVectors(to, from).length();
				view.shaft.visible = length > 0.0001;
				view.shaft.position.lerpVectors(from, to, 0.5);
				view.shaft.scale.set(32, length, 32);
				if (view.shaft.visible) view.shaft.quaternion.setFromUnitVectors(up, direction.normalize());
				if (beam.contact ?? (length < getWeapon('laser').range - 0.5)) {
					view.impact.strike(to, direction, previousTime);
					view.impact.mesh.quaternion.copy(view.shaft.quaternion);
				}
			}
			for (const [name, view] of views) {
				// On release the hot spot stays at its last contact in world space.
				view.impact.mesh.visible = state.time - view.impact.lastContact.value < CUTTER_SPARK_LIFETIME;
				view.group.visible = view.shaft.visible || view.impact.mesh.visible;
				if (!view.player && !view.group.visible) { view.dispose(); views.delete(name); }
			}
		},
		dispose: function () {
			for (const view of views.values()) view.dispose();
			views.clear(); shaftGeometry.dispose(); quad.dispose(); friendly.dispose(); hostile.dispose(); root.removeFromParent();
		},
	};
};
