/**
 * Grey-scale area opening: every free-standing "peak" (a 4-connected region standing above its
 * surroundings) whose footprint is smaller than `minArea` cells is flattened down to the level at which
 * it joins the rest of the material. Long walls survive because they are part of a large region; small
 * isolated pillars disappear. Only ever lowers cells, so cavities get bigger, never smaller. Edits `h`.
 *
 * Builds a max-tree with union-find (cells visited from highest to lowest), then filters it root-first.
 */
export function areaOpening(h: Uint16Array, nx: number, ny: number, minArea: number): void {
  const n = nx * ny;
  if (minArea <= 1 || n === 0) return;

  let maxH = 0;
  for (let i = 0; i < n; i++) if (h[i] > maxH) maxH = h[i];
  const start = new Int32Array(maxH + 2);
  for (let i = 0; i < n; i++) start[h[i]]++;
  let acc = 0;
  for (let v = maxH; v >= 0; v--) {
    const c = start[v];
    start[v] = acc;
    acc += c;
  }
  const order = new Int32Array(n); // cell indices, highest first
  for (let i = 0; i < n; i++) order[start[h[i]]++] = i;

  const parent = new Int32Array(n).fill(-1);
  const zpar = new Int32Array(n);
  const find = (x: number): number => {
    let r = x;
    while (zpar[r] !== r) r = zpar[r];
    while (zpar[x] !== r) {
      const next = zpar[x];
      zpar[x] = r;
      x = next;
    }
    return r;
  };
  const join = (p: number, q: number) => {
    if (parent[q] === -1) return; // not visited yet
    const r = find(q);
    if (r !== p) {
      parent[r] = p;
      zpar[r] = p;
    }
  };
  for (let k = 0; k < n; k++) {
    const p = order[k];
    parent[p] = p;
    zpar[p] = p;
    const x = p % nx, y = (p - x) / nx;
    if (x > 0) join(p, p - 1);
    if (x + 1 < nx) join(p, p + 1);
    if (y > 0) join(p, p - nx);
    if (y + 1 < ny) join(p, p + nx);
  }

  const area = new Int32Array(n).fill(1);
  for (let k = 0; k < n; k++) {
    const p = order[k];
    if (parent[p] !== p) area[parent[p]] += area[p];
  }

  // Root first: a cell keeps its height only if its region (at that height) is big enough.
  const out = new Uint16Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const p = order[k], q = parent[p];
    if (q === p) out[p] = h[p];
    else if (h[q] === h[p]) out[p] = out[q];
    else out[p] = area[p] >= minArea ? h[p] : out[q];
  }
  h.set(out);
}
