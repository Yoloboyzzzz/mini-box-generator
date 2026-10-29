import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { coarsenFloor } from '../src/geometry/coarsen';
import { generateBoxes } from '../src/geometry/generate';
import { meshHeightfield } from '../src/geometry/heightfield';
import { indexMesh } from '../src/geometry/indexMesh';
import { writeSTL } from '../src/geometry/stl';
import { build3MF } from '../src/geometry/threemf';
import { checkMesh } from '../src/geometry/validate';
import { DEFAULTS } from '../src/types';
import { cone, cuboid, cylinder } from './helpers';

/** A grid with a tall top (rim) and a smoothly sloping floor inside, like the underside of a rounded base. */
function slopedCavity(nx = 96, ny = 96, top = 200) {
  const h = new Uint16Array(nx * ny).fill(top);
  for (let y = 10; y < ny - 10; y++) {
    for (let x = 10; x < nx - 10; x++) {
      h[y * nx + x] = 15 + Math.round(((x - 10) + (y - 10)) * 0.4) + ((x * 7 + y * 13) % 3); // slope plus a little noise
    }
  }
  return { h, nx, ny, top };
}

describe('floor simplification', () => {
  it('only ever lowers the floor and never touches the outline', () => {
    const { h, nx, ny, top } = slopedCavity();
    const before = h.slice();
    coarsenFloor(h, nx, ny, top, 8);
    let lowered = 0;
    for (let i = 0; i < h.length; i++) {
      expect(h[i]).toBeLessThanOrEqual(before[i]);
      if (before[i] >= top) expect(h[i]).toBe(top); // solid top and rim unchanged
      else expect(h[i]).toBeLessThan(top); // cavity cells stay cavity
      if (h[i] < before[i]) lowered++;
      expect(before[i] - h[i]).toBeLessThanOrEqual(8); // never deeper than the allowed drop
    }
    expect(lowered).toBeGreaterThan(0);
  });

  it('keeps the lowest contact point exactly where it was', () => {
    const { h, nx, ny, top } = slopedCavity();
    const lowest = (g: Uint16Array) => g.reduce((m, v) => (v < m ? v : m), 65535);
    const before = lowest(h);
    coarsenFloor(h, nx, ny, top, 12);
    expect(lowest(h)).toBe(before);
  });

  it('does nothing when switched off', () => {
    const { h, nx, ny, top } = slopedCavity();
    const before = h.slice();
    coarsenFloor(h, nx, ny, top, 0);
    expect(Array.from(h)).toEqual(Array.from(before));
  });

  it('makes the mesh much smaller and still watertight', () => {
    const exact = slopedCavity();
    const simple = slopedCavity();
    coarsenFloor(simple.h, simple.nx, simple.ny, simple.top, 10);
    const a = meshHeightfield(exact.h, exact.nx, exact.ny, 0.1, 0.1);
    const b = meshHeightfield(simple.h, simple.nx, simple.ny, 0.1, 0.1);
    expect(b.length).toBeLessThan(a.length * 0.5);
    expect(checkMesh(b).badEdges).toBe(0);
  });

  it('shrinks real generated boxes without breaking the fit', () => {
    const minis = [{ name: 'a', tris: cone(9, 30) }, { name: 'b', tris: cylinder(7, 25) }];
    const run = (floorSimplify: number) => {
      const debug: Parameters<typeof generateBoxes>[4] = [];
      const [r] = generateBoxes('s', minis, { ...DEFAULTS, effort: 1, rotStep: 30, floorSimplify }, undefined, debug);
      return { r, d: debug![0] };
    };
    const exact = run(0), simple = run(2);
    expect(simple.r.box.length).toBeLessThanOrEqual(exact.r.box.length);
    expect(checkMesh(simple.r.box).badEdges).toBe(0);
    // every placed mini vertex still lies in empty space (floor at or below the mini)
    for (const p of simple.d.placed) {
      const t = minis[p.mini].tris;
      for (let i = 0; i < t.length; i += 3) {
        const x = t[i] * p.cos - t[i + 1] * p.sin + p.tx, y = t[i] * p.sin + t[i + 1] * p.cos + p.ty, z = t[i + 2] + p.tz;
        const cell = simple.d.heights[Math.floor(y / simple.d.cell) * simple.d.nx + Math.floor(x / simple.d.cell)];
        expect(cell * simple.d.zs).toBeLessThanOrEqual(z + 1e-4);
      }
    }
  }, 60000);
});

describe('indexed mesh', () => {
  it('welds a cube soup down to its 8 corners', () => {
    const soup = Float32Array.from(cuboid(0, 0, 0, 10, 20, 30));
    const { positions, indices } = indexMesh(soup);
    expect(soup.length / 3).toBe(36);
    expect(positions.length / 3).toBe(8);
    expect(indices.length).toBe(36);
    for (let i = 0; i < indices.length; i++) {
      expect(positions[indices[i] * 3]).toBe(soup[i * 3]);
      expect(positions[indices[i] * 3 + 1]).toBe(soup[i * 3 + 1]);
      expect(positions[indices[i] * 3 + 2]).toBe(soup[i * 3 + 2]);
    }
  });

  it('keeps distinct vertices distinct and handles many of them', () => {
    const n = 50000;
    const soup = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { soup[i * 3] = i * 0.05; soup[i * 3 + 1] = (i % 97) * 0.05; soup[i * 3 + 2] = (i % 13) * 0.1; }
    expect(indexMesh(soup).positions.length / 3).toBe(n);
  });
});

describe('3MF export', () => {
  it('reads back as the same watertight mesh, much smaller than STL', async () => {
    const [r] = generateBoxes('t', [{ name: 'x', tris: cylinder(8, 20) }], { ...DEFAULTS, effort: 1, rotStep: 30 });
    const blob = await build3MF([{ name: 'Box & "Lid"', tris: r.box }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['3D/', '3D/3dmodel.model', '[Content_Types].xml', '_rels/', '_rels/.rels'].sort());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('name="Box &amp; &quot;Lid&quot;"'); // names are escaped

    const verts = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) => [+m[1], +m[2], +m[3]]);
    const tris = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((m) => [+m[1], +m[2], +m[3]]);
    expect(tris.length).toBe(r.box.length / 9);
    for (const t of tris) for (const v of t) expect(v).toBeLessThan(verts.length);

    // expand back to a soup and check it is the same solid
    const soup = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => t.forEach((v, k) => soup.set(verts[v], i * 9 + k * 3)));
    const back = checkMesh(soup), orig = checkMesh(r.box);
    expect(back.badEdges).toBe(0);
    expect(back.volume).toBeCloseTo(orig.volume, 1);

    expect(blob.size).toBeLessThan(writeSTL(r.box).byteLength);
  }, 60000);
});
