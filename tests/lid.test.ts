import { describe, expect, it } from 'vitest';
import { generateBoxes } from '../src/geometry/generate';
import { cutFingerNotches, fitNotchRadius } from '../src/geometry/lidNotch';
import { checkMesh } from '../src/geometry/validate';
import { DEFAULTS } from '../src/types';
import { cylinder } from './helpers';

describe('finger notch radius', () => {
  it('keeps the requested size when there is room', () => {
    expect(fitNotchRadius(7, 60, 30)).toBe(7);
  });

  it('shrinks to leave 4 mm of skirt at each end of the side', () => {
    expect(fitNotchRadius(10, 24, 30)).toBe(8); // (24 - 8) / 2
  });

  it('never cuts through the ceiling: keeps 1 mm of skirt', () => {
    expect(fitNotchRadius(10, 80, 6)).toBe(5); // 6 - 1
  });

  it('gives up when what fits would be useless', () => {
    expect(fitNotchRadius(7, 11, 30)).toBe(0);
    expect(fitNotchRadius(7, 60, 2.5)).toBe(0);
    expect(fitNotchRadius(0, 60, 30)).toBe(0);
  });
});

describe('cutting the notches', () => {
  const lnx = 120, lny = 80, wallC = 16, ceilU = 16, skirtU = 300, cell = 0.1, zs = 0.1;
  const grid = () => {
    const lh = new Uint16Array(lnx * lny).fill(ceilU);
    for (let j = 0; j < lny; j++) for (let i = 0; i < lnx; i++) {
      if (i < wallC || i >= lnx - wallC || j < wallC || j >= lny - wallC) lh[j * lnx + i] = skirtU;
    }
    return lh;
  };

  it('makes a half circle: deepest in the middle, flush at the edges', () => {
    const lh = grid();
    cutFingerNotches(lh, lnx, lny, wallC, skirtU, ceilU, cell, zs, 5);
    const midRow = 3; // inside the front wall
    const depthAt = (i: number) => skirtU - lh[midRow * lnx + i];
    expect(depthAt(lnx / 2)).toBeGreaterThanOrEqual(49); // about the 5 mm radius, in 0.1 mm units
    expect(depthAt(lnx / 2)).toBeLessThanOrEqual(50);
    expect(depthAt(lnx / 2 + 25)).toBeGreaterThanOrEqual(42); // 2.5 mm off centre the circle is still sqrt(25 - 6.25) = 4.3 mm deep
    expect(depthAt(lnx / 2 + 25)).toBeLessThanOrEqual(44);
    expect(depthAt(lnx / 2 + 50)).toBe(0); // at the edge of the circle the rim is back to full height
    expect(depthAt(lnx / 2 + 60)).toBe(0);
  });

  it('is symmetric and leaves the corners and short sides alone', () => {
    const before = grid();
    const lh = grid();
    cutFingerNotches(lh, lnx, lny, wallC, skirtU, ceilU, cell, zs, 5);
    for (let i = 0; i < lnx; i++) expect(lh[3 * lnx + i]).toBe(lh[3 * lnx + (lnx - 1 - i)]);
    // short sides (left and right walls, away from the long-side bands) are untouched
    for (let j = wallC; j < lny - wallC; j++) {
      expect(lh[j * lnx + 3]).toBe(before[j * lnx + 3]);
      expect(lh[j * lnx + lnx - 4]).toBe(before[j * lnx + lnx - 4]);
    }
    // corners
    expect(lh[0]).toBe(before[0]);
    expect(lh[lnx - 1]).toBe(before[lnx - 1]);
  });

  it('notches both long sides, and only lowers', () => {
    const before = grid();
    const lh = grid();
    cutFingerNotches(lh, lnx, lny, wallC, skirtU, ceilU, cell, zs, 6);
    expect(lh[3 * lnx + lnx / 2]).toBeLessThan(skirtU); // front
    expect(lh[(lny - 4) * lnx + lnx / 2]).toBeLessThan(skirtU); // back
    for (let i = 0; i < lh.length; i++) {
      expect(lh[i]).toBeLessThanOrEqual(before[i]);
      expect(lh[i]).toBeGreaterThanOrEqual(ceilU);
    }
  });

  it('does nothing for a radius of 0', () => {
    const lh = grid();
    const before = lh.slice();
    cutFingerNotches(lh, lnx, lny, wallC, skirtU, ceilU, cell, zs, 0);
    expect(Array.from(lh)).toEqual(Array.from(before));
  });
});

describe('lid with finger notches', () => {
  const minis = [{ name: 'a', tris: cylinder(12, 30) }, { name: 'b', tris: cylinder(10, 25) }];
  const build = (fingerNotch: number) => generateBoxes('n', minis, { ...DEFAULTS, effort: 1, rotStep: 30, fingerNotch })[0];

  it('stays a watertight solid, with less material and a lower rim in the notch', () => {
    const plain = build(0), notched = build(7);
    expect(notched.fingerNotch).toBe(7);
    expect(plain.fingerNotch).toBe(0);
    expect(checkMesh(notched.lid).badEdges).toBe(0);
    expect(checkMesh(notched.lid).volume).toBeLessThan(checkMesh(plain.lid).volume);

    // the rim is lower by the notch radius in the middle of the front wall, and full height near the corner
    // The notches go on the longer pair of sides. The mesher merges the flat bottom of a notch into one big
    // rectangle, so look at a window around the middle rather than at one exact point.
    const alongX = notched.width >= notched.depth;
    const lengthTotal = (alongX ? notched.width : notched.depth) + 2 * (DEFAULTS.lidClearance + DEFAULTS.lidWall);
    const rimNear = (along: number, halfWindow: number) => {
      let top = 0;
      for (let i = 0; i < notched.lid.length; i += 3) {
        const a = alongX ? notched.lid[i] : notched.lid[i + 1];
        const across = alongX ? notched.lid[i + 1] : notched.lid[i];
        if (Math.abs(a - along) < halfWindow && across < DEFAULTS.lidWall - 0.1) top = Math.max(top, notched.lid[i + 2]);
      }
      return top;
    };
    expect(rimNear(lengthTotal / 2, 1.2)).toBeCloseTo(notched.lidHeight - 7, 0);
    expect(rimNear(1, 0.6)).toBeCloseTo(notched.lidHeight, 1);
  }, 60000);

  it('reports what it could not do', () => {
    const small = [{ name: 's', tris: cylinder(5, 12) }];
    const asked = generateBoxes('n', small, { ...DEFAULTS, effort: 1, rotStep: 30, fingerNotch: 20 })[0];
    expect(asked.fingerNotchWanted).toBe(20);
    expect(asked.fingerNotch).toBeGreaterThan(0);
    expect(asked.fingerNotch).toBeLessThan(20); // reduced to fit this lid
  }, 60000);
});
