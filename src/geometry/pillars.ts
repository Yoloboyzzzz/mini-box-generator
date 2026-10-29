/**
 * Free-standing pillars: islands of full-height material that are not connected to the box's outer wall
 * or its dividing walls, for example the gap between a mini's legs, or the middle of a ring-shaped base.
 * Left at full height they are flush with the lid and leave no room for fingers, so they are lowered a bit
 * to make it easy to reach in and lift the mini out.
 *
 * Only ever lowers cells, and never below the cavity floor right next to the pillar, so a pillar stays a
 * pillar instead of turning into a pit. Walls (anything connected to the border) are untouched.
 * Edits `h` in place and returns how many pillars were lowered.
 */
export function lowerPillars(h: Uint16Array, nx: number, ny: number, top: number, dropUnits: number): number {
  if (dropUnits <= 0) return 0;
  const n = nx * ny;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let lowered = 0;

  for (let start = 0; start < n; start++) {
    if (seen[start] || h[start] < top) continue;

    // flood-fill one connected region of full-height cells
    let head = 0, tail = 0, touchesBorder = false, tallestNeighbour = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % nx, y = (i - x) / nx;
      if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1) touchesBorder = true;
      const visit = (j: number) => {
        if (h[j] >= top) {
          if (!seen[j]) { seen[j] = 1; queue[tail++] = j; }
        } else if (h[j] > tallestNeighbour) {
          tallestNeighbour = h[j];
        }
      };
      if (x > 0) visit(i - 1);
      if (x + 1 < nx) visit(i + 1);
      if (y > 0) visit(i - nx);
      if (y + 1 < ny) visit(i + nx);
    }

    if (touchesBorder) continue; // part of the wall network, not a pillar
    const cap = Math.max(top - dropUnits, tallestNeighbour);
    if (cap >= top) continue; // the surroundings are already as high: nothing to lower
    for (let k = 0; k < tail; k++) h[queue[k]] = cap;
    lowered++;
  }
  return lowered;
}
