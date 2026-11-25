import { DoubleSide, Mesh, MeshBasicMaterial, Shape, ShapeGeometry } from 'three';
import { DROPSHIP_WIDTH } from './launch-berths';
import { drapeGroundGeometry } from './terrain-decals';
import { groundHeight } from './terrain-elevation';
import type { FieldTerrain } from './field-terrain';
import type { Point } from './simulation';

// Plan view of the transport, including both outboard lift pods.
const silhouette = [[-78, -207], [78, -207], [110, -155], [110, -92], [135, -92], [140, -148], [175, -130], [180, 101], [157, 143], [128, 136], [119, 95], [108, 95], [107, 196], [-107, 196], [-108, 95], [-119, 95], [-128, 136], [-157, 143], [-180, 101], [-175, -130], [-140, -148], [-135, -92], [-110, -92], [-110, -155]] as const;

export const createDropshipShadow = function (yaw: number) {
	const shape = new Shape();
	for (const [index, [x, z]] of silhouette.entries()) {
		if (index === 0) shape.moveTo(x * DROPSHIP_WIDTH / 360, -z);
		else shape.lineTo(x * DROPSHIP_WIDTH / 360, -z);
	}
	shape.closePath();
	const geometry = new ShapeGeometry(shape).rotateX(-Math.PI / 2);
	const paint = new MeshBasicMaterial({ color: '#141a20', side: DoubleSide, transparent: true, opacity: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
	const root = new Mesh(geometry, paint); root.name = 'transport-ground-shadow'; root.rotation.y = yaw;
	return {
		root,
		update: function (terrain: FieldTerrain | undefined, hull: Point, altitude: number) {
			const at = { x: hull.x + 15 + altitude * .37, y: hull.y + 8 + altitude * .32 };
			root.position.set(at.x, groundHeight(terrain, at) + 1.05, at.y);
			drapeGroundGeometry(geometry, terrain, at, -root.rotation.y);
			paint.opacity = Math.max(.15, .45 - altitude * .0005);
		},
		dispose: function () { root.removeFromParent(); geometry.dispose(); paint.dispose(); },
	};
};
