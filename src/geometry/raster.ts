/** Rigid XY transform applied while rasterising: rotate by (cos, sin), then translate. */
export interface Xf {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
  tz: number;
}

const A = new Float64Array(32);
const B = new Float64Array(32);
const A2 = new Float64Array(32);

/** Sutherland-Hodgman clip of a polygon (xyz triplets) against one axis-aligned half-plane. */
function clip(src: Float64Array, n: number, dst: Float64Array, axis: 0 | 1, bound: number, keepGreater: boolean): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = i === 0 ? n - 1 : i - 1;
    const cv = src[i * 3 + axis], pv = src[j * 3 + axis];
    const cin = keepGreater ? cv >= bound : cv <= bound;
    const pin = keepGreater ? pv >= bound : pv <= bound;
    if (cin !== pin) {
      const t = (bound - pv) / (cv - pv);
      for (let k = 0; k < 3; k++) {
        dst[m * 3 + k] = src[j * 3 + k] + (src[i * 3 + k] - src[j * 3 + k]) * t;
      }
      dst[m * 3 + axis] = bound;
      m++;
    }
    if (cin) {
      dst[m * 3] = src[i * 3]; dst[m * 3 + 1] = src[i * 3 + 1]; dst[m * 3 + 2] = src[i * 3 + 2];
      m++;
    }
  }
  return m;
}

/**
 * Conservative underside raster: for every grid cell touched by a triangle, store the minimum z the
 * triangle reaches inside that cell (exact, via polygon clipping). `out` must be pre-filled with Infinity.
 * Thin features are never skipped because coverage is by overlap, not by sampling the cell centre.
 */
export function rasterMinZ(tris: Float32Array, out: Float32Array, nx: number, ny: number, cell: number, xf: Xf): void {
  const inv = 1 / cell;
  const eps = cell * 1e-4; // cells touched only along their boundary do not count
  const { cos, sin, tx, ty, tz } = xf;
  for (let o = 0; o < tris.length; o += 9) {
    for (let v = 0; v < 3; v++) {
      const x = tris[o + v * 3], y = tris[o + v * 3 + 1];
      A[v * 3] = x * cos - y * sin + tx;
      A[v * 3 + 1] = x * sin + y * cos + ty;
      A[v * 3 + 2] = tris[o + v * 3 + 2] + tz;
    }
    const minx = Math.min(A[0], A[3], A[6]), maxx = Math.max(A[0], A[3], A[6]);
    const miny = Math.min(A[1], A[4], A[7]), maxy = Math.max(A[1], A[4], A[7]);
    const i0 = Math.max(0, Math.floor((minx + eps) * inv)), i1 = Math.min(nx - 1, Math.floor((maxx - eps) * inv));
    const j0 = Math.max(0, Math.floor((miny + eps) * inv)), j1 = Math.min(ny - 1, Math.floor((maxy - eps) * inv));
    if (i0 > i1 && !(maxx - minx < eps)) continue;
    if (j0 > j1 && !(maxy - miny < eps)) continue;
    const ii0 = Math.min(i0, i1), ii1 = Math.max(i0, i1), jj0 = Math.min(j0, j1), jj1 = Math.max(j0, j1);
    if (ii1 < 0 || jj1 < 0 || ii0 >= nx || jj0 >= ny) continue;
    if (ii0 === ii1 && jj0 === jj1) {
      const z = Math.min(A[2], A[5], A[8]);
      const idx = jj0 * nx + ii0;
      if (z < out[idx]) out[idx] = z;
      continue;
    }
    for (let j = jj0; j <= jj1; j++) {
      const y0 = j * cell + eps, y1 = (j + 1) * cell - eps;
      for (let i = ii0; i <= ii1; i++) {
        const x0 = i * cell + eps, x1 = (i + 1) * cell - eps;
        let n = clip(A, 3, B, 0, x0, true);
        if (n) n = clip(B, n, A2, 0, x1, false);
        if (n) n = clip(A2, n, B, 1, y0, true);
        if (n) n = clip(B, n, A2, 1, y1, false);
        if (!n) continue;
        let z = Infinity;
        for (let k = 0; k < n; k++) if (A2[k * 3 + 2] < z) z = A2[k * 3 + 2];
        const idx = j * nx + i;
        if (z < out[idx]) out[idx] = z;
      }
    }
  }
}
