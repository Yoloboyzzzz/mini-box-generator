import { DEFAULTS } from './types';

/**
 * The detail slider is one control over how closely the floor under each mini follows its underside.
 * Far right is the exact floor (largest files); far left simplifies it by up to DETAIL_MAX_MM (smallest files).
 * The walls and the fit around the mini do not change anywhere on the slider.
 */
export const DETAIL_MAX_MM = 2;
export const DETAIL_STEPS = 20;
const STEP_MM = DETAIL_MAX_MM / DETAIL_STEPS;

/** Slider position (0 = smallest files .. DETAIL_STEPS = highest detail) for a simplification in mm. */
export function detailToSlider(mm: number): number {
  const v = Number.isFinite(mm) ? mm : DEFAULTS.floorSimplify;
  const clamped = Math.min(DETAIL_MAX_MM, Math.max(0, v));
  return DETAIL_STEPS - Math.round(clamped / STEP_MM);
}

/** Simplification in mm for a slider position. */
export function sliderToDetail(position: number): number {
  const p = Math.min(DETAIL_STEPS, Math.max(0, Math.round(position)));
  return Math.round((DETAIL_STEPS - p) * STEP_MM * 100) / 100;
}

export function describeDetail(mm: number): string {
  if (mm <= 0) return 'Highest detail: the floor follows every part of each mini. Largest files.';
  if (mm >= DETAIL_MAX_MM) return `Smallest files: the floor under each mini is simplified by up to ${DETAIL_MAX_MM} mm.`;
  return `The floor under each mini is simplified by up to ${mm.toFixed(1)} mm.`;
}
