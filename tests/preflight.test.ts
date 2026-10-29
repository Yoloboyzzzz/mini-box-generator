import { describe, expect, it } from 'vitest';
import { generateBoxes } from '../src/geometry/generate';
import { fitsInRect, footprintHull } from '../src/preflight';
import { DEFAULTS } from '../src/types';
import { cuboid, cylinder } from './helpers';

const box = (w: number, d: number) => Float32Array.from(cuboid(-w / 2, -d / 2, 0, w / 2, d / 2, 10));

describe('bed pre-flight', () => {
  it('finds the convex hull of a footprint', () => {
    const hull = footprintHull(box(50, 30));
    expect(hull.length / 2).toBe(4); // a rectangle has four corners
    const xs = [...hull].filter((_, i) => i % 2 === 0).map(Math.abs);
    expect(Math.max(...xs)).toBeCloseTo(25, 5);
  });

  it('is not fooled by detail inside the outline or by duplicate points', () => {
    const hull = footprintHull(cylinder(10, 5, 64));
    // 64 outline points; the closing vertex at angle 2π differs from the one at 0 by float rounding, so allow 66.
    expect(hull.length / 2).toBeLessThanOrEqual(66);
    expect(hull.length / 2).toBeGreaterThan(8);
  });

  it('fits a square only when the rectangle is big enough', () => {
    const hull = footprintHull(box(50, 50));
    expect(fitsInRect(hull, 60, 60)).toBe(true);
    expect(fitsInRect(hull, 49, 49)).toBe(false);
    expect(fitsInRect(hull, 50, 50)).toBe(true);
  });

  it('uses rotation: a long thin piece fits a square bed along the diagonal', () => {
    const hull = footprintHull(box(100, 10));
    expect(fitsInRect(hull, 120, 20)).toBe(true); // straight
    expect(fitsInRect(hull, 80, 80)).toBe(true); // diagonal needs about 77.8
    expect(fitsInRect(hull, 70, 70)).toBe(false);
    expect(fitsInRect(hull, 20, 120)).toBe(true); // bed turned the other way
  });

  it('says no for degenerate beds', () => {
    expect(fitsInRect(footprintHull(box(10, 10)), 0, 50)).toBe(false);
    expect(fitsInRect(footprintHull(box(10, 10)), -5, 50)).toBe(false);
  });
});

describe('generator error messages', () => {
  it('tells the user how to recover when the bed cannot hold the walls', () => {
    const s = { ...DEFAULTS, bedX: 20, bedY: 20, wall: 10, outerWall: 10, lidWall: 10, effort: 1 };
    expect(() => generateBoxes('x', [{ name: 'a', tris: cylinder(3, 8) }], s)).toThrow(/print bed.*Print settings/i);
  });
});
