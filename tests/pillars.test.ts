import { describe, expect, it } from 'vitest';
import { generateBoxes } from '../src/geometry/generate';
import { lowerPillars } from '../src/geometry/pillars';
import { checkMesh } from '../src/geometry/validate';
import { DEFAULTS } from '../src/types';

const TOP = 100;

/** A grid with a full-height rim and one cavity (floor 20); `island` cells inside it stay at the top. */
function gridWithIsland(nx = 60, ny = 60, island = { x0: 25, y0: 25, x1: 35, y1: 35 }) {
  const h = new Uint16Array(nx * ny).fill(TOP);
  for (let y = 5; y < ny - 5; y++) for (let x = 5; x < nx - 5; x++) h[y * nx + x] = 20;
  for (let y = island.y0; y < island.y1; y++) for (let x = island.x0; x < island.x1; x++) h[y * nx + x] = TOP;
  return { h, nx, ny };
}

describe('free-standing pillars', () => {
  it('lowers an island inside a cavity by the requested amount', () => {
    const { h, nx, ny } = gridWithIsland();
    expect(lowerPillars(h, nx, ny, TOP, 40)).toBe(1);
    expect(h[30 * nx + 30]).toBe(TOP - 40);
    expect(h[25 * nx + 25]).toBe(TOP - 40); // every cell of the island
    expect(h[34 * nx + 34]).toBe(TOP - 40);
  });

  it('leaves the walls and the rim exactly as they were', () => {
    const { h, nx, ny } = gridWithIsland();
    const before = h.slice();
    lowerPillars(h, nx, ny, TOP, 40);
    for (let i = 0; i < h.length; i++) {
      const x = i % nx, y = (i - x) / nx;
      const inIsland = x >= 25 && x < 35 && y >= 25 && y < 35;
      if (!inIsland) expect(h[i]).toBe(before[i]);
    }
  });

  it('only lowers, and keeps the island at least as high as the floor beside it', () => {
    const { h, nx, ny } = gridWithIsland();
    const before = h.slice();
    lowerPillars(h, nx, ny, TOP, 95); // asks for more than the pillar's height above the floor
    for (let i = 0; i < h.length; i++) expect(h[i]).toBeLessThanOrEqual(before[i]);
    expect(h[30 * nx + 30]).toBe(20); // stops at the floor next to it, never a pit
  });

  it('does not touch a wall that joins the rim, even a thin one', () => {
    const { h, nx, ny } = gridWithIsland(60, 60, { x0: 0, y0: 0, x1: 0, y1: 0 });
    for (let y = 5; y < 30; y++) for (let x = 28; x < 31; x++) h[y * nx + x] = TOP; // a divider reaching the rim
    const before = h.slice();
    expect(lowerPillars(h, nx, ny, TOP, 40)).toBe(0);
    expect(Array.from(h)).toEqual(Array.from(before));
  });

  it('handles several islands independently', () => {
    const { h, nx, ny } = gridWithIsland();
    for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) h[y * nx + x] = TOP; // a second one
    expect(lowerPillars(h, nx, ny, TOP, 30)).toBe(2);
    expect(h[12 * nx + 12]).toBe(TOP - 30);
    expect(h[30 * nx + 30]).toBe(TOP - 30);
  });

  it('does nothing when switched off', () => {
    const { h, nx, ny } = gridWithIsland();
    const before = h.slice();
    expect(lowerPillars(h, nx, ny, TOP, 0)).toBe(0);
    expect(Array.from(h)).toEqual(Array.from(before));
  });
});

/** A tube: outer radius ro, inner radius ri, height h. Its top-down outline is a ring with a hole in the middle. */
function tube(ro: number, ri: number, h: number, seg = 72): Float32Array {
  const t: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    const P = (r: number, a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
    quad(P(ro, a0, 0), P(ro, a1, 0), P(ro, a1, h), P(ro, a0, h)); // outer wall
    quad(P(ri, a1, 0), P(ri, a0, 0), P(ri, a0, h), P(ri, a1, h)); // inner wall
    quad(P(ri, a0, h), P(ro, a0, h), P(ro, a1, h), P(ri, a1, h)); // top
    quad(P(ri, a0, 0), P(ri, a1, 0), P(ro, a1, 0), P(ro, a0, 0)); // bottom
  }
  return Float32Array.from(t);
}

describe('pillars in a generated box', () => {
  const ring = [{ name: 'ring', tris: tube(12, 5, 24) }];
  const run = (pillarLowering: number) => {
    const debug: Parameters<typeof generateBoxes>[4] = [];
    const [r] = generateBoxes('p', ring, { ...DEFAULTS, effort: 1, rotStep: 30, pillarLowering }, undefined, debug);
    return { r, d: debug![0] };
  };

  it('lowers the island in the middle of a ring-shaped mini, and only by the set amount', () => {
    const full = run(0), lowered = run(6);
    const centre = (g: typeof full) => {
      const cx = Math.round(g.d.nx / 2), cy = Math.round(g.d.ny / 2);
      return g.d.heights[cy * g.d.nx + cx] * g.d.zs;
    };
    expect(centre(full)).toBeCloseTo(full.r.height, 1); // flush with the lid
    expect(centre(lowered)).toBeCloseTo(full.r.height - 6, 1); // 6 mm below the top
    expect(lowered.r.height).toBeCloseTo(full.r.height, 5); // the box itself is the same height
  }, 60000);

  it('is still a watertight box, and the walls around the ring are not lowered', () => {
    const { r, d } = run(6);
    expect(checkMesh(r.box).badEdges).toBe(0);
    // the outer wall / rim: the top-left corner cell is still at full height
    expect(d.heights[0] * d.zs).toBeCloseTo(r.height, 1);
  }, 60000);
});
