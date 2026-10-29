/**
 * Cheap pre-flight geometry: can a mini be laid on the print bed at all? The answer only needs the
 * convex hull of its top-down footprint, which is a few dozen points even for a very detailed model.
 */

/** Convex hull (monotone chain) of a mesh's XY footprint, as x,y pairs. */
export function footprintHull(tris: Float32Array): Float32Array {
  const n = tris.length / 3;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const X = (i: number) => tris[i * 3], Y = (i: number) => tris[i * 3 + 1];
  idx.sort((a, b) => X(a) - X(b) || Y(a) - Y(b));
  const cross = (o: number, a: number, b: number) => (X(a) - X(o)) * (Y(b) - Y(o)) - (Y(a) - Y(o)) * (X(b) - X(o));

  const hull: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  const lower = hull.length + 1;
  for (let k = n - 2; k >= 0; k--) {
    const i = idx[k];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  hull.pop(); // the last point repeats the first
  const out = new Float32Array(hull.length * 2);
  hull.forEach((i, k) => { out[k * 2] = X(i); out[k * 2 + 1] = Y(i); });
  return out;
}

/** True when the hull fits inside a w x d rectangle at some rotation (tried every `stepDeg` degrees). */
export function fitsInRect(hull: Float32Array, w: number, d: number, stepDeg = 5): boolean {
  if (w <= 0 || d <= 0 || hull.length === 0) return false;
  for (let deg = 0; deg < 180; deg += stepDeg) {
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < hull.length; i += 2) {
      const x = hull[i] * c + hull[i + 1] * s, y = -hull[i] * s + hull[i + 1] * c;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX - minX <= w + 1e-6 && maxY - minY <= d + 1e-6) return true;
  }
  return false;
}
