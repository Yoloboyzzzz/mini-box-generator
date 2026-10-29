/**
 * Simplifies the inside of the cavities to cut file size.
 *
 * The floor under a mini only has to be at or below the mini's underside, so merging neighbouring floor
 * cells into larger flat blocks is safe as long as each block is set to its lowest member: it can only get
 * deeper, never intrude. Two things stay exact:
 *  - the cavity outline: only cavity cells (below `top`) are ever changed, and a cell never changes
 *    between cavity and solid, so the clearance around the mini is untouched;
 *  - the lowest contact points: the lowest cell of a block keeps its own height, so the mini still rests
 *    where it did and stays flush with the lid.
 *
 * Blocks are chosen adaptively (a quadtree): a block is merged only when its cavity cells differ by at most
 * `maxDrop` units, so steep or detailed areas keep fine resolution and gentle slopes collapse into big flats.
 * Blocks along the outline are merged too (their solid cells are left alone), which matters because every
 * outline cell with its own floor height costs a separate tall wall quad. Edits `h` in place.
 */
export function coarsenFloor(h: Uint16Array, nx: number, ny: number, top: number, maxDrop: number, maxBlock = 64): void {
  if (maxDrop <= 0) return;

  const visit = (x0: number, y0: number, s: number) => {
    if (s < 2) return;
    if (x0 + s <= nx && y0 + s <= ny) {
      let lo = 65535, hi = 0, cavity = 0;
      for (let y = y0; y < y0 + s; y++) {
        const row = y * nx;
        for (let x = x0; x < x0 + s; x++) {
          const v = h[row + x];
          if (v >= top) continue; // solid top or outline: never touched
          cavity++;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (cavity === 0) return; // nothing to simplify here
      if (hi - lo <= maxDrop) {
        if (hi !== lo) {
          for (let y = y0; y < y0 + s; y++) {
            const row = y * nx;
            for (let x = x0; x < x0 + s; x++) if (h[row + x] < top) h[row + x] = lo;
          }
        }
        return;
      }
    }
    const half = s >> 1;
    visit(x0, y0, half);
    visit(x0 + half, y0, half);
    visit(x0, y0 + half, half);
    visit(x0 + half, y0 + half, half);
  };

  for (let y = 0; y < ny; y += maxBlock) for (let x = 0; x < nx; x += maxBlock) visit(x, y, maxBlock);
}
