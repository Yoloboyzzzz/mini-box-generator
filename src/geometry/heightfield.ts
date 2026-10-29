/**
 * Turns a height grid (solid from z = 0 up to h[cell]) into a watertight triangle mesh.
 *
 * Flat areas are merged into large rectangles so the file stays small; the T-junctions this would
 * create are repaired by splitting every rectangle edge at all vertices lying on it, so each edge
 * of the final mesh is shared by exactly two triangles.
 *
 * h is in integer z units (zs mm each); every cell must be > 0. Grid coordinates are integers < 8192.
 */
/** Where the triangles of a mesh came from; filled in by meshHeightfield when asked. */
export interface MeshStats { topRects: number; wallRects: number; triangles: number }

export function meshHeightfield(h: Uint16Array, nx: number, ny: number, cell: number, zs: number, stats?: MeshStats): Float32Array {
  removeSaddles(h, nx, ny);
  const rects: number[] = []; // 12 ints per rect: 4 corners (x, y, z), counter-clockwise seen from outside
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    rects.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  };

  // Top faces: greedy merge of equal-height cells.
  const seen = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (seen[y * nx + x]) continue;
      const z = h[y * nx + x];
      let x1 = x + 1;
      while (x1 < nx && !seen[y * nx + x1] && h[y * nx + x1] === z) x1++;
      let y1 = y + 1;
      grow: while (y1 < ny) {
        for (let k = x; k < x1; k++) if (seen[y1 * nx + k] || h[y1 * nx + k] !== z) break grow;
        y1++;
      }
      for (let yy = y; yy < y1; yy++) seen.fill(1, yy * nx + x, yy * nx + x1);
      quad([x, y, z], [x1, y, z], [x1, y1, z], [x, y1, z]);
    }
  }
  const topRects = rects.length / 12;
  // Bottom.
  quad([0, 0, 0], [0, ny, 0], [nx, ny, 0], [nx, 0, 0]);

  // Walls between neighbouring cells of different height (outside counts as height 0).
  for (let i = 0; i <= nx; i++) {
    let j = 0;
    while (j < ny) {
      const hl = i > 0 ? h[j * nx + i - 1] : 0, hr = i < nx ? h[j * nx + i] : 0;
      if (hl === hr) { j++; continue; }
      const j0 = j;
      while (j < ny && (i > 0 ? h[j * nx + i - 1] : 0) === hl && (i < nx ? h[j * nx + i] : 0) === hr) j++;
      const lo = Math.min(hl, hr), hi = Math.max(hl, hr);
      if (hl > hr) quad([i, j0, lo], [i, j, lo], [i, j, hi], [i, j0, hi]); // faces +x
      else quad([i, j0, lo], [i, j0, hi], [i, j, hi], [i, j, lo]); // faces -x
    }
  }
  for (let j = 0; j <= ny; j++) {
    let i = 0;
    while (i < nx) {
      const hs = j > 0 ? h[(j - 1) * nx + i] : 0, hn = j < ny ? h[j * nx + i] : 0;
      if (hs === hn) { i++; continue; }
      const i0 = i;
      while (i < nx && (j > 0 ? h[(j - 1) * nx + i] : 0) === hs && (j < ny ? h[j * nx + i] : 0) === hn) i++;
      const lo = Math.min(hs, hn), hi = Math.max(hs, hn);
      if (hs > hn) quad([i0, j, lo], [i0, j, hi], [i, j, hi], [i, j, lo]); // faces +y
      else quad([i0, j, lo], [i, j, lo], [i, j, hi], [i0, j, hi]); // faces -y
    }
  }

  const tris = triangulate(rects, cell, zs);
  if (stats) {
    stats.topRects = topRects;
    stats.wallRects = rects.length / 12 - topRects - 1;
    stats.triangles = tris.length / 9;
  }
  return tris;
}

/**
 * Where two diagonal cells stand higher than the other two, the shared vertical edge would carry four
 * faces (non-manifold, which slicers reject). Lower the shorter of the high pair until it no longer
 * pokes above the low pair. Only ever lowers cells, i.e. makes cavities deeper, never smaller. Edits `h`.
 */
export function removeSaddles(h: Uint16Array, nx: number, ny: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y + 1 < ny; y++) {
      for (let x = 0; x + 1 < nx; x++) {
        const ia = y * nx + x, ib = ia + 1, ic = ia + nx, id = ic + 1;
        const a = h[ia], b = h[ib], c = h[ic], d = h[id];
        const lowHi = Math.max(b, c);
        if (lowHi < Math.min(a, d)) {
          h[a <= d ? ia : id] = lowHi;
          changed = true;
        } else if (Math.max(a, d) < Math.min(b, c)) {
          h[b <= c ? ib : ic] = Math.max(a, d);
          changed = true;
        }
      }
    }
  }
}

const enc = (axis: number, a: number, b: number, c: number) => ((axis * 8192 + a) * 8192 + b) * 8192 + c;

function lowerBound(arr: Float64Array, n: number, v: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function triangulate(rects: number[], cell: number, zs: number): Float32Array {
  const nr = rects.length / 12;
  // Every rect corner registers itself on the three axis-parallel lines through it.
  const raw = new Float64Array(nr * 12);
  let m = 0;
  for (let r = 0; r < nr; r++) {
    for (let k = 0; k < 4; k++) {
      const x = rects[r * 12 + k * 3], y = rects[r * 12 + k * 3 + 1], z = rects[r * 12 + k * 3 + 2];
      raw[m++] = enc(0, y, z, x);
      raw[m++] = enc(1, x, z, y);
      raw[m++] = enc(2, x, y, z);
    }
  }
  raw.sort();
  let n = 0;
  for (let i = 0; i < m; i++) if (i === 0 || raw[i] !== raw[i - 1]) raw[n++] = raw[i];

  let out = new Float32Array(Math.max(1024, nr * 18));
  let o = 0;
  const pushVert = (x: number, y: number, z: number) => {
    if (o + 3 > out.length) {
      const bigger = new Float32Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[o++] = x * cell; out[o++] = y * cell; out[o++] = z * zs;
  };
  const tri = (a: number[], b: number[], c: number[]) => {
    pushVert(a[0], a[1], a[2]); pushVert(b[0], b[1], b[2]); pushVert(c[0], c[1], c[2]);
  };

  const poly: number[][] = [];
  for (let r = 0; r < nr; r++) {
    poly.length = 0;
    for (let k = 0; k < 4; k++) {
      const p = r * 12 + k * 3, q = r * 12 + ((k + 1) % 4) * 3;
      const P = [rects[p], rects[p + 1], rects[p + 2]], Q = [rects[q], rects[q + 1], rects[q + 2]];
      poly.push(P);
      const axis = P[0] !== Q[0] ? 0 : P[1] !== Q[1] ? 1 : 2;
      const a = axis === 0 ? P[1] : P[0];
      const b = axis === 2 ? P[1] : P[2];
      const c0 = Math.min(P[axis], Q[axis]), c1 = Math.max(P[axis], Q[axis]);
      const base = enc(axis, a, b, 0);
      const mids: number[] = [];
      for (let idx = lowerBound(raw, n, base + c0 + 1); idx < n && raw[idx] < base + c1; idx++) mids.push(raw[idx] - base);
      if (P[axis] > Q[axis]) mids.reverse();
      for (const c of mids) {
        const v = P.slice();
        v[axis] = c;
        poly.push(v);
      }
    }
    if (poly.length === 4) {
      tri(poly[0], poly[1], poly[2]);
      tri(poly[0], poly[2], poly[3]);
    } else {
      const cen = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        cen[0] += rects[r * 12 + k * 3] / 4;
        cen[1] += rects[r * 12 + k * 3 + 1] / 4;
        cen[2] += rects[r * 12 + k * 3 + 2] / 4;
      }
      for (let k = 0; k < poly.length; k++) tri(cen, poly[k], poly[(k + 1) % poly.length]);
    }
  }
  return out.slice(0, o);
}
