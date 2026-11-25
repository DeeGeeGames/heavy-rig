import { CircleGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, RingGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA, type CombatStateView } from './simulation';
import { TORSO_LIMIT } from './torso-arc';
import { drapeGroundGeometry } from './terrain-decals';
import { groundHeight } from './terrain-elevation';

const radius = 192;
const stopStart = radius * 0.65;
const stopEnd = radius + 9;
const dotCount = 8;
const dotSpacing = 9.5;

export const createFiringArc = function () {
	const parts: BufferGeometry[] = [];
	const teal = new Color('#85efd4');
	const backing = new Color('#142d2c');
	const add = function (part: BufferGeometry, color: Color, opacity: number) {
		const colors = new Float32BufferAttribute(part.getAttribute('position').count * 4, 4);
		for (let i = 0; i < colors.count; i++) colors.setXYZW(i, color.r, color.g, color.b, opacity);
		part.setAttribute('color', colors);
		parts.push(part);
	};
	const band = function (width: number, color: Color, opacity: number) {
		const ring = new RingGeometry(radius - width / 2, radius + width / 2, 100, 1, -TORSO_LIMIT, TORSO_LIMIT * 2);
		add(ring.rotateX(-Math.PI / 2), color, opacity);
	};
	const mark = function (angle: number, start: number, end: number, width: number, color: Color, opacity: number) {
		const plane = new PlaneGeometry(end - start, width);
		add(plane.rotateX(-Math.PI / 2).translate((start + end) / 2, 0, 0).rotateY(-angle), color, opacity);
	};
	const dot = function (angle: number, distance: number, size: number, color: Color, opacity: number) {
		const circle = new CircleGeometry(size, 12);
		add(circle.rotateX(-Math.PI / 2).translate(distance * Math.cos(angle), 0, distance * Math.sin(angle)), color, opacity);
	};

	// The dark backing stabilizes contrast over terrain. Batch it and the
	// colored markings in draw order so the whole indicator uses one mesh.
	band(5, backing, 0.72);
	band(2, teal, 0.76);
	mark(0, radius - 8, radius + 8, 2.7, teal, 0.95);
	for (const angle of [-TORSO_LIMIT, TORSO_LIMIT]) {
		mark(angle, stopStart, stopEnd, 7, backing, 0.72);
		mark(angle, stopStart, stopEnd, 3.3, teal, 0.95);
		for (let i = 0; i < dotCount; i++) {
			const distance = stopEnd + (i + 1) * dotSpacing;
			const opacity = 0.95 - 0.30 * i / (dotCount - 1);
			dot(angle, distance, 2.6, backing, opacity * 0.8);
			dot(angle, distance, 1.9, teal, opacity);
		}
	}
	const geometry = mergeGeometries(parts);
	for (const part of parts) part.dispose();
	if (!geometry) throw new Error('Cannot batch firing arc geometry');

	// Keep the markings on the playable surface when a mech turns at its edge.
	const right = new Plane(new Vector3(-1, 0, 0), ARENA.width);
	const far = new Plane(new Vector3(0, 0, -1), ARENA.height);
	const material = new MeshBasicMaterial({
		vertexColors: true,
		transparent: true,
		depthWrite: false,
		toneMapped: false,
		clippingPlanes: [new Plane(new Vector3(1, 0, 0)), new Plane(new Vector3(0, 0, 1)), right, far],
	});
	const mesh = new Mesh(geometry, material);
	mesh.name = 'player-firing-arc';
	mesh.visible = false;
	mesh.renderOrder = 10;

	return {
		mesh,
		update: function (state: CombatStateView, visible: boolean) {
			mesh.visible = visible;
			if (!visible) return;
			const { player, mission } = state;
			const terrain = mission?.map.terrain;
			mesh.position.set(player.x, groundHeight(terrain, player) + 1.5, player.y);
			mesh.rotation.y = -player.angle;
			drapeGroundGeometry(geometry, terrain, player, player.angle);
			right.constant = mission?.map.width ?? ARENA.width;
			far.constant = mission?.map.height ?? ARENA.height;
		},
		dispose: function () { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
	};
};
