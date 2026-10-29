/**
 * Offsets (dx, dy) of every cell whose square lies within `r` cells of the centre cell's square.
 * Painting these around a covered cell yields every cell touched by (cell ⊕ disk(r)), so the
 * clearance is at least r cells no matter where inside the cell the real surface was.
 */
export function regionOffsets(r: number): Int32Array {
  const m = Math.ceil(r) + 1;
  const list: number[] = [];
  for (let dy = -m; dy <= m; dy++) {
    for (let dx = -m; dx <= m; dx++) {
      const ex = Math.max(Math.abs(dx) - 1, 0), ey = Math.max(Math.abs(dy) - 1, 0);
      if (Math.hypot(ex, ey) <= r + 1e-9) list.push(dx, dy);
    }
  }
  return Int32Array.from(list);
}

/** Offsets whose centre lies within radius `r` (in cells) of the origin. */
export function diskOffsets(r: number): Int32Array {
  const m = Math.floor(r);
  const list: number[] = [];
  for (let dy = -m; dy <= m; dy++) {
    for (let dx = -m; dx <= m; dx++) {
      if (Math.hypot(dx, dy) <= r + 1e-9) list.push(dx, dy);
    }
  }
  return Int32Array.from(list);
}

/** out[n] = min of src over all cells that have n inside their offset neighbourhood. Infinity = empty. */
export function minSpread(src: Float32Array, nx: number, ny: number, offs: Int32Array): Float32Array {
  const out = new Float32Array(nx * ny).fill(Infinity);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const v = src[y * nx + x];
      if (v === Infinity) continue;
      for (let k = 0; k < offs.length; k += 2) {
        const px = x + offs[k], py = y + offs[k + 1];
        if (px < 0 || py < 0 || px >= nx || py >= ny) continue;
        const idx = py * nx + px;
        if (v < out[idx]) out[idx] = v;
      }
    }
  }
  return out;
}
