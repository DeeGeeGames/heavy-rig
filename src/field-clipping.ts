import { Plane, Vector3 } from 'three';
import type { MissionMap } from './campaign-types';

type FieldBounds = Pick<MissionMap, 'width' | 'height'>;
const planesByField = new WeakMap<FieldBounds, Plane[]>();

// Three.js clips in world coordinates. All four planes face into the playable
// rectangle so a diagonal approach also reveals correctly at a corner.
export const fieldClippingPlanes = function (bounds: FieldBounds): Plane[] {
	const cached = planesByField.get(bounds);
	if (cached) return cached;
	const planes = [
		new Plane(new Vector3(1, 0, 0)), new Plane(new Vector3(0, 0, 1)),
		new Plane(new Vector3(-1, 0, 0), bounds.width), new Plane(new Vector3(0, 0, -1), bounds.height),
	];
	planesByField.set(bounds, planes);
	return planes;
};
