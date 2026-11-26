import { Matrix4, Mesh, Vector3, type Group, type Object3D } from 'three';
import { createRigBurstParticles } from './rig-burst-particles';
import { startRigCollapse, type CollapseAnatomy, type CollapseSite } from './rig-collapse';
import { RIG_ARMOR_BURSTS, RIG_DEFEAT_SECONDS } from './rig-defeat-timing';

type BurstPart = typeof RIG_ARMOR_BURSTS[number]['part'];
type ChassisVector = readonly [forward: number, right: number, up: number];
interface Ignition {
	offset: ChassisVector;
	outward: ChassisVector;
	diameter: number;
	seed: number;
	carryMotion: boolean;
}

const patterns: Readonly<Record<BurstPart, Ignition>> = {
	chest: { offset: [21, 12, 15], outward: [0.76, 0.69, 0.49], diameter: 31, seed: 13.67, carryMotion: false },
	gun: { offset: [-13, 14, 4], outward: [-0.34, 0.95, 0.54], diameter: 23, seed: 27.94, carryMotion: true },
	shoulder: { offset: [-17, 13, 18], outward: [-0.47, 0.91, 0.96], diameter: 43, seed: 48.28, carryMotion: false },
	'opposite-shoulder': { offset: [-4, -10, 21], outward: [0.19, -0.64, 1], diameter: 29, seed: 74.13, carryMotion: true },
	hull: { offset: [23, 7, 5], outward: [0.30, 0.40, 1], diameter: 28, seed: 89.57, carryMotion: true },
};
const up = new Vector3(0, 1, 0);

const armorSites = function (root: Group, site: CollapseSite, anatomy: CollapseAnatomy) {
	root.updateWorldMatrix(true, true);
	const inverse = root.matrixWorld.clone().invert();
	const position = function (node: Object3D) { return new Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse); };
	const center = position(anatomy.torso);
	const guns = anatomy.guns.map(function (gun) { return gun.pivot; });
	const pods = anatomy.pods;
	// A pair of hardpoints supplies the torso's bearing independently of the
	// legs. A single offset gun still supplies its own line of fire.
	const acrossPair = function (mounts: readonly Object3D[]) {
		const first = mounts[0], last = mounts.at(-1);
		if (!first || !last || first === last) return undefined;
		const left = position(first), right = position(last);
		const across = right.clone().sub(left); across.y = 0; across.normalize();
		return left.sub(center).dot(across) < -0.5 && right.sub(center).dot(across) > 0.5 ? across : undefined;
	};
	const reference = new Vector3(Math.cos(site.heading), 0, Math.sin(site.heading)).transformDirection(inverse);
	for (const gun of anatomy.guns) {
		if (!gun.muzzle) continue;
		const direction = position(gun.muzzle).sub(position(gun.pivot)); direction.y = 0;
		if (direction.lengthSq() > 0.0001) { reference.copy(direction); break; }
	}
	const right = acrossPair(guns) ?? acrossPair(pods) ?? reference.cross(up).normalize();
	const forward = new Vector3().crossVectors(up, right).normalize();
	const vector = function ([ahead, across, height]: ChassisVector) {
		return forward.clone().multiplyScalar(ahead).addScaledVector(right, across).addScaledVector(up, height);
	};

	// Assign every visible mesh to its closest moving joint. This lets armor
	// ruptures follow a mount through the fold even on kit and procedural rigs.
	const joints = new Set([anatomy.pelvis, anatomy.torso, ...guns, ...pods,
		...anatomy.legs.flatMap(function (leg) { return [leg.thigh, leg.shin, leg.foot]; })]);
	const surfaces = new Map<Object3D, Mesh[]>();
	for (const branch of root.children) branch.traverseVisible(function (mesh) {
		if (!(mesh instanceof Mesh) || !mesh.geometry.hasAttribute('position')) return;
		let owner: Object3D | null = mesh;
		while (owner && !joints.has(owner)) owner = owner.parent;
		if (!owner) return;
		const list = surfaces.get(owner);
		if (list) list.push(mesh); else surfaces.set(owner, [mesh]);
	});
	const onSide = function (mounts: readonly Object3D[], sign: number) {
		let outermost = 0.5, mount: Object3D | undefined;
		for (const node of mounts) {
			const across = position(node).sub(center).dot(right) * sign;
			if (surfaces.has(node) && across > outermost) { outermost = across; mount = node; }
		}
		return mount;
	};
	const hull = surfaces.has(anatomy.torso) ? anatomy.torso : anatomy.pelvis;
	const anchors: Record<BurstPart, Object3D> = {
		chest: hull, hull, gun: onSide(guns, 1) ?? hull,
		shoulder: onSide(pods, 1) ?? hull, 'opposite-shoulder': onSide(pods, -1) ?? hull,
	};
	const matrix = new Matrix4(), local = new Vector3(), probe = new Vector3();
	return RIG_ARMOR_BURSTS.flatMap(function ({ at, part }) {
		const anchor = anchors[part], pattern = patterns[part];
		const target = position(anchor).add(vector(pattern.offset));
		let closest = Infinity, plate: Mesh | undefined;
		const vertex = new Vector3();
		for (const mesh of surfaces.get(anchor) ?? []) {
			matrix.multiplyMatrices(inverse, mesh.matrixWorld);
			const vertices = mesh.geometry.getAttribute('position');
			for (let i = 0; i < vertices.count; i++) {
				local.fromBufferAttribute(vertices, i);
				const distance = probe.copy(local).applyMatrix4(matrix).distanceToSquared(target);
				if (distance < closest) { closest = distance; plate = mesh; vertex.copy(local); }
			}
		}
		if (!plate) return [];
		const surface = plate;
		const point = function () { return root.worldToLocal(surface.localToWorld(vertex.clone())); };
		return [{ at, point, outward: vector(pattern.outward).normalize(), pattern }];
	});
};

export const beginRigDefeat = function (root: Group, site: CollapseSite, anatomy: CollapseAnatomy) {
	const pose = startRigCollapse(root, site, anatomy);
	let active: { sites: ReturnType<typeof armorSites>; particles: ReturnType<typeof createRigBurstParticles>; next: number } | undefined;
	let previous = -Infinity;
	return function (elapsed: number) {
		const time = Math.max(0, elapsed);
		if (time === previous) return pose(time);
		const withinSequence = time + 1e-8 >= RIG_ARMOR_BURSTS[0].at && time < RIG_DEFEAT_SECONDS;
		if (active && (!withinSequence || time < previous)) {
			active.particles.root.removeFromParent();
			active = undefined;
		}
		previous = time;
		if (!withinSequence) return pose(time);
		if (!active) {
			// Old wrecks entering the view beyond the effect lifetime never get
			// particle buffers, shaders or a scan of their armor.
			pose(0);
			const sites = armorSites(root, site, anatomy), particles = createRigBurstParticles();
			root.add(particles.root);
			active = { sites, particles, next: 0 };
		}
		for (let cue = active.sites[active.next]; cue && cue.at <= time + 1e-8; cue = active.sites[++active.next]) {
			pose(cue.at);
			const origin = cue.point(), armorVelocity = new Vector3();
			if (cue.pattern.carryMotion) {
				// The flash, fragments and smoke inherit the velocity of the armor
				// over ignition, then travel independently of the falling mech.
				const opening = 0.1;
				pose(cue.at + opening);
				armorVelocity.copy(cue.point()).sub(origin).divideScalar(opening);
			}
			active.particles.emit({ born: cue.at, origin: origin.addScaledVector(cue.outward, 0.8), direction: cue.outward,
				diameter: cue.pattern.diameter, seed: cue.pattern.seed, armorVelocity });
		}
		active.particles.update(time);
		return pose(time);
	};
};
