import { describe, expect, it } from 'vitest';
import { DETAIL_MAX_MM, DETAIL_STEPS, describeDetail, detailToSlider, sliderToDetail } from '../src/detail';
import { LIMITS } from '../src/settings';
import { DEFAULTS } from '../src/types';

describe('detail slider mapping', () => {
  it('puts the highest detail (exact floors) at the right end and the smallest files at the left', () => {
    expect(sliderToDetail(DETAIL_STEPS)).toBe(0); // far right: exact, the original behaviour
    expect(sliderToDetail(0)).toBe(DETAIL_MAX_MM); // far left: what the app did by default after the size fix
    expect(detailToSlider(0)).toBe(DETAIL_STEPS);
    expect(detailToSlider(DETAIL_MAX_MM)).toBe(0);
  });

  it('round-trips every step', () => {
    for (let n = 0; n <= DETAIL_STEPS; n++) expect(detailToSlider(sliderToDetail(n))).toBe(n);
  });

  it('only gets simpler to the left: more slider means less simplification', () => {
    for (let n = 1; n <= DETAIL_STEPS; n++) expect(sliderToDetail(n)).toBeLessThan(sliderToDetail(n - 1));
  });

  it('clamps saved values that fall outside the slider', () => {
    expect(detailToSlider(5)).toBe(0);
    expect(detailToSlider(-1)).toBe(DETAIL_STEPS);
    expect(detailToSlider(NaN)).toBe(detailToSlider(DEFAULTS.floorSimplify));
  });

  it('agrees with the setting limits and the default', () => {
    expect(LIMITS.floorSimplify.min).toBe(0);
    expect(LIMITS.floorSimplify.max).toBe(DETAIL_MAX_MM);
    expect(DEFAULTS.floorSimplify).toBeLessThanOrEqual(DETAIL_MAX_MM);
  });

  it('describes both ends in plain words', () => {
    expect(describeDetail(0)).toMatch(/highest detail/i);
    expect(describeDetail(DETAIL_MAX_MM)).toMatch(/smallest files/i);
    expect(describeDetail(1)).toMatch(/1(\.0)? mm/);
  });
});
