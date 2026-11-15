/** Bounded interface coverage against referenced triangles, never unused positions. */
import { Ray, Vector3 } from 'three';

export const verifyHousingCoverage = function (geometry, bounds, endpoint) {
 const positions = geometry.getAttribute('position');
 const index = geometry.getIndex();
 if (!positions || !index) throw new Error('Housing requires indexed exported triangles');
 const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
 let probes = 0;
 // Nine interior points on each contracted face. Cast from the inside outward:
 // a missing face cannot be concealed by unused vertices or a farther shell.
 for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
  const other = [0, 1, 2].filter(function (value) { return value !== axis; });
  for (const u of [.2, .5, .8]) for (const v of [.2, .5, .8]) {
   const origin = endpoint.clone();
   for (const [offset, fraction] of [[0, u], [1, v]]) {
    const component = other[offset];
    origin.setComponent(component, bounds[0][component] + fraction * (bounds[1][component] - bounds[0][component]));
   }
   const direction = new Vector3().setComponent(axis, side === 0 ? -1 : 1);
   const expected = (bounds[side][axis] - origin.getComponent(axis)) * (side === 0 ? -1 : 1);
   if (expected < 1e-5) throw new Error('Retained neck lies outside housing interior');
   const ray = new Ray(origin, direction);
   let boundaryHit = false;
   const start = Math.max(0, geometry.drawRange.start);
   const end = Math.min(index.count, start + geometry.drawRange.count);
   for (let i = start; i + 2 < end; i += 3) {
    a.fromBufferAttribute(positions, index.getX(i));
    b.fromBufferAttribute(positions, index.getX(i + 1));
    c.fromBufferAttribute(positions, index.getX(i + 2));
    if (ray.intersectTriangle(a, b, c, false, hit) && Math.abs(hit.distanceTo(origin) - expected) <= 1e-6) boundaryHit = true;
   }
   if (!boundaryHit) throw new Error(`Housing surface coverage missing: axis ${axis}, side ${side}, probe ${u}/${v}`);
   probes++;
  }
 }
 return probes;
};
