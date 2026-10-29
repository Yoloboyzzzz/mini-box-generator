/**
 * Finger notches: half circles cut into the open rim of the lid's skirt so there is somewhere to get a
 * fingertip in when the lid fits snugly. They sit in the middle of the two longer sides, where there is
 * the most room and the lid can be pinched from opposite sides.
 */

/**
 * The radius that actually fits: at least 4 mm of full-height skirt stays at each end of the side, and at
 * least 1 mm of skirt stays above the ceiling. Returns 0 when what fits is too small to be useful.
 */
export function fitNotchRadius(requestedMm: number, sideLengthMm: number, skirtDepthMm: number): number {
  const r = Math.min(requestedMm, (sideLengthMm - 8) / 2, skirtDepthMm - 1);
  return r >= 2 ? r : 0;
}

/**
 * Lowers the skirt along a half circle of radius `radiusMm`, centred on the middle of each long side.
 * The lid is stored in print orientation (ceiling down), so the rim is the top of the heights, and the
 * notch opens upward: nothing has to bridge. Only ever lowers cells. Edits `lh` in place.
 */
export function cutFingerNotches(
  lh: Uint16Array, lnx: number, lny: number, wallC: number, skirtU: number, ceilU: number,
  cell: number, zs: number, radiusMm: number,
): void {
  if (radiusMm <= 0) return;
  const alongX = lnx >= lny;
  const lengthCells = alongX ? lnx : lny;
  const crossCells = alongX ? lny : lnx;

  for (let c = 0; c < crossCells; c++) {
    // only the two wall bands of the long sides, not the ceiling area or the short sides
    if (c >= wallC && c < crossCells - wallC) continue;
    for (let a = 0; a < lengthCells; a++) {
      const u = (a + 0.5 - lengthCells / 2) * cell;
      if (Math.abs(u) >= radiusMm) continue;
      const depthU = Math.round(Math.sqrt(radiusMm * radiusMm - u * u) / zs);
      const idx = alongX ? c * lnx + a : a * lnx + c;
      lh[idx] = Math.max(ceilU + 1, Math.min(lh[idx], skirtU - depthU));
    }
  }
}
