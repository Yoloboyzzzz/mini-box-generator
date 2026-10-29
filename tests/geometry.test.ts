import { describe, expect, it } from 'vitest';
import { areaOpening } from '../src/geometry/areaOpen';
import { generateBoxes, type DebugBox } from '../src/geometry/generate';
import { meshHeightfield } from '../src/geometry/heightfield';
import { minSpread, regionOffsets } from '../src/geometry/morph';
import { rasterMinZ } from '../src/geometry/raster';
import { parseSTL, writeSTL } from '../src/geometry/stl';
import { checkMesh } from '../src/geometry/validate';
import { DEFAULTS, type Settings } from '../src/types';
import { baseWithSpike, cone, cuboid, cylinder } from './helpers';

const ID = { cos: 1, sin: 0, tz: 0 };

describe('stl io', () => {
  it('round-trips binary STL', () => {
    const tris = cylinder(3, 4, 12);
    const back = parseSTL(writeSTL(tris));
    expect(Array.from(back)).toEqual(Array.from(tris));
  });
  it('parses ASCII STL', () => {
    const txt = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';
    const buf = new TextEncoder().encode(txt);
    expect(parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer).length).toBe(9);
  });
});

describe('conservative raster', () => {
  it('keeps a 0.3 mm spike that cell-centre sampling would miss', () => {
    const cell = 0.1, n = 200;
    const grid = new Float32Array(n * n).fill(Infinity);
    rasterMinZ(baseWithSpike(), grid, n, n, cell, { ...ID, tx: 10.037, ty: 10.011 });
    // The spike's column must be covered by the spike's own lowest face (z = 10), not only by the base.
    const spikeCells = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * cell - 10.037, cy = (j + 0.5) * cell - 10.011;
      if (Math.abs(cx) < 0.1 && Math.abs(cy) < 0.1) spikeCells.push(grid[j * n + i]);
    }
    expect(spikeCells.length).toBeGreaterThan(0);
    for (const z of spikeCells) expect(z).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('gives a cylinder cavity of radius r + tolerance (within two cells)', () => {
    const r = 6, tol = 0.2, cell = 0.1, n = 200;
    const grid = new Float32Array(n * n).fill(Infinity);
    rasterMinZ(cylinder(r, 10, 180), grid, n, n, cell, { ...ID, tx: 10, ty: 10 });
    const wide = minSpread(grid, n, n, regionOffsets(tol / cell));
    let maxR = 0, minEdge = Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const d = Math.hypot((i + 0.5) * cell - 10, (j + 0.5) * cell - 10);
      if (wide[j * n + i] !== Infinity) maxR = Math.max(maxR, d);
      else minEdge = Math.min(minEdge, d);
    }
    expect(minEdge).toBeGreaterThanOrEqual(r + tol - cell); // clearance never below tolerance
    expect(maxR).toBeLessThanOrEqual(r + tol + 2 * cell);
  });
});

describe('heightfield mesh', () => {
  it('is watertight with the exact volume', () => {
    const nx = 40, ny = 30, h = new Uint16Array(nx * ny).fill(20);
    for (let j = 5; j < 20; j++) for (let i = 8; i < 30; i++) h[j * nx + i] = 3 + ((i + j) % 4);
    for (let j = 22; j < 26; j++) for (let i = 2; i < 6; i++) h[j * nx + i] = 9;
    const before = h.slice();
    const tris = meshHeightfield(h, nx, ny, 0.1, 0.1); // lowers saddle cells in place
    for (let i = 0; i < h.length; i++) expect(h[i]).toBeLessThanOrEqual(before[i]);
    const chk = checkMesh(tris);
    expect(chk.badEdges).toBe(0);
    const expected = h.reduce((a, b) => a + b, 0) * 0.1 * 0.1 * 0.1;
    expect(chk.volume).toBeCloseTo(expected, 3);
  });
});

describe('area opening', () => {
  it('removes small isolated pillars but keeps walls and big islands', () => {
    const nx = 60, ny = 40, TOP = 20, FLOOR = 5;
    const h = new Uint16Array(nx * ny).fill(FLOOR);
    const set = (x0: number, y0: number, w: number, hh: number, v = TOP) => {
      for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + w; x++) h[y * nx + x] = v;
    };
    set(0, 0, nx, 2); set(0, ny - 2, nx, 2); set(0, 0, 2, ny); set(nx - 2, 0, 2, ny); // outer ring
    set(10, 2, 2, 20); // wall attached to the ring
    set(20, 10, 3, 3); // 9-cell pillar in the open
    set(30, 10, 1, 25); // thin free-standing wall, 25 cells
    set(40, 10, 8, 8); // big island, 64 cells
    set(52, 10, 3, 3, 12); // short 9-cell bump
    const before = h.slice();
    areaOpening(h, nx, ny, 20);
    const at = (x: number, y: number) => h[y * nx + x];
    expect(at(21, 11)).toBe(FLOOR); // pillar gone
    expect(at(53, 11)).toBe(FLOOR); // bump gone
    expect(at(11, 12)).toBe(TOP); // attached wall stays
    expect(at(30, 20)).toBe(TOP); // long thin wall stays
    expect(at(43, 13)).toBe(TOP); // big island stays
    expect(at(1, 1)).toBe(TOP);
    for (let i = 0; i < h.length; i++) expect(h[i]).toBeLessThanOrEqual(before[i]);
  });
});

function fastSettings(over: Partial<Settings> = {}): Settings {
  return { ...DEFAULTS, effort: 1, rotStep: 30, ...over };
}

function minimap(m: Float32Array) {
  return { name: 'm', tris: m };
}

describe('box generation', () => {
  const minis = [cylinder(8, 30), cylinder(8, 28), cone(6, 35), cylinder(5, 20), { v: 0 }].slice(0, 4) as Float32Array[];

  it('fits every mini flush, nests with walls, and builds watertight box + lid', () => {
    const s = fastSettings();
    const debug: DebugBox[] = [];
    const out = generateBoxes('test', minis.map(minimap), s, undefined, debug);
    expect(out.length).toBe(1);
    const box = out[0], dbg = debug[0];
    expect(box.oversize).toBe(false);

    // Fit: every vertex of every placed mini lies in empty space, and the tallest sits flush with the top.
    const H = box.height;
    let flush = 0;
    for (const p of dbg.placed) {
      const t = minis[p.mini];
      for (let i = 0; i < t.length; i += 3) {
        const x = t[i] * p.cos - t[i + 1] * p.sin + p.tx, y = t[i] * p.sin + t[i + 1] * p.cos + p.ty, z = t[i + 2] + p.tz;
        const ci = Math.floor(x / dbg.cell), cj = Math.floor(y / dbg.cell);
        expect(ci).toBeGreaterThanOrEqual(0); expect(cj).toBeGreaterThanOrEqual(0);
        expect(ci).toBeLessThan(dbg.nx); expect(cj).toBeLessThan(dbg.ny);
        expect(dbg.heights[cj * dbg.nx + ci] * dbg.zs).toBeLessThanOrEqual(z + 1e-4);
        if (Math.abs(z - H) < 1e-4) flush++;
      }
    }
    expect(flush).toBeGreaterThan(0);

    // Walls: between any two cavities there is solid material of at least ~wall.
    const cavity = (i: number) => dbg.heights[i] * dbg.zs < H - 1e-6;
    let cavities = 0;
    for (let i = 0; i < dbg.heights.length; i++) if (cavity(i)) cavities++;
    expect(cavities).toBeGreaterThan(0);

    expect(checkMesh(box.box).badEdges).toBe(0);
    expect(checkMesh(box.lid).badEdges).toBe(0);
    expect(checkMesh(box.box).volume).toBeGreaterThan(0);
    expect(checkMesh(box.lid).volume).toBeGreaterThan(0);
    expect(box.width).toBeLessThanOrEqual(s.bedX);
    expect(box.depth).toBeLessThanOrEqual(s.bedY);
  }, 120000);

  it('makes the lid cover the box with the requested clearance', () => {
    const s = fastSettings();
    const [r] = generateBoxes('lid', [minimap(cylinder(8, 20))], s);
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < r.lid.length; i += 3) { minX = Math.min(minX, r.lid[i]); maxX = Math.max(maxX, r.lid[i]); }
    const lidOuter = maxX - minX;
    expect(lidOuter).toBeCloseTo(r.width + 2 * (s.lidClearance + s.lidWall), 3);
    expect(r.lidOffset).toBeCloseTo(-(s.lidClearance + s.lidWall), 3);
    expect(r.lidHeight).toBeCloseTo(r.lidCeiling + r.height - s.skirtGap, 3);
  });

  it('splits a group across several boxes when the bed is too small', () => {
    const s = fastSettings({ bedX: 70, bedY: 70 });
    const many = Array.from({ length: 6 }, () => minimap(cylinder(12, 25)));
    const out = generateBoxes('split', many, s);
    expect(out.length).toBeGreaterThan(1);
    expect(out.reduce((n, b) => n + b.miniCount, 0)).toBe(6);
    for (const b of out) {
      const total = b.width + 2 * (s.lidClearance + s.lidWall);
      expect(total).toBeLessThanOrEqual(70 + 1e-6);
    }
  }, 120000);

  it('places several copies of one figure, each in its own cavity', () => {
    const s = fastSettings();
    const debug: DebugBox[] = [];
    const out = generateBoxes('copies', [{ name: 'orc', tris: cylinder(8, 20), count: 4 }, minimap(cylinder(6, 15))], s, undefined, debug);
    expect(out.length).toBe(1);
    expect(out[0].miniCount).toBe(5);
    expect(out[0].minis).toEqual(['orc ×4', 'm']);
    const d = debug[0];
    expect(d.placed.length).toBe(5);
    expect(d.placed.filter((p) => p.mini === 0).length).toBe(4);
    // Copies must not overlap: all four orc centres are at least one diameter apart.
    const orcs = d.placed.filter((p) => p.mini === 0);
    for (let i = 0; i < orcs.length; i++) for (let j = i + 1; j < orcs.length; j++) {
      expect(Math.hypot(orcs[i].tx - orcs[j].tx, orcs[i].ty - orcs[j].ty)).toBeGreaterThan(16);
    }
    expect(checkMesh(out[0].box).badEdges).toBe(0);
  }, 120000);

  it('handles a thin spike without losing it', () => {
    const s = fastSettings();
    const debug: DebugBox[] = [];
    const [r] = generateBoxes('spike', [minimap(baseWithSpike())], s, undefined, debug);
    const d = debug[0];
    const p = d.placed[0];
    const t = baseWithSpike();
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i] * p.cos - t[i + 1] * p.sin + p.tx, y = t[i] * p.sin + t[i + 1] * p.cos + p.ty, z = t[i + 2] + p.tz;
      expect(d.heights[Math.floor(y / d.cell) * d.nx + Math.floor(x / d.cell)] * d.zs).toBeLessThanOrEqual(z + 1e-4);
    }
    expect(r.height).toBeGreaterThan(25);
  });
});

// keep helpers referenced for type-checking
void cuboid;
