import { sanitizeSettings } from '../settings';
import type { BoxResult, MiniInput, Settings } from '../types';
import { areaOpening } from './areaOpen';
import { coarsenFloor } from './coarsen';
import { meshHeightfield } from './heightfield';
import { lowerPillars } from './pillars';
import { cutFingerNotches, fitNotchRadius } from './lidNotch';
import { minSpread, regionOffsets } from './morph';
import { nest, type NestItem } from './nest';
import { rasterMinZ } from './raster';

/** Per-box data kept for verification in tests; never sent to the UI. */
export interface DebugBox {
  heights: Uint16Array;
  nx: number;
  ny: number;
  cell: number;
  zs: number;
  placed: { mini: number; cos: number; sin: number; tx: number; ty: number; tz: number }[];
}

type Progress = (message: string, fraction: number) => void;

function bounds(tris: Float32Array) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minY, maxX, maxY, maxZ };
}

/** Top-down silhouette of a mini as conservative cell centres (used for nesting only). */
function silhouette(tris: Float32Array, res: number): NestItem {
  const b = bounds(tris);
  const nx = Math.ceil((b.maxX - b.minX) / res) + 1, ny = Math.ceil((b.maxY - b.minY) / res) + 1;
  const grid = new Float32Array(nx * ny).fill(Infinity);
  rasterMinZ(tris, grid, nx, ny, res, { cos: 1, sin: 0, tx: -b.minX, ty: -b.minY, tz: 0 });
  const centers: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (grid[j * nx + i] !== Infinity) centers.push(b.minX + (i + 0.5) * res, b.minY + (j + 0.5) * res);
    }
  }
  return { centers: Float32Array.from(centers), half: res / 2 };
}

export function generateBoxes(
  groupName: string,
  minis: MiniInput[],
  settings: Settings,
  progress: Progress = () => {},
  debugOut?: DebugBox[],
): BoxResult[] {
  // Never trust the caller: out-of-range values (a rotation step of 0 would loop forever) are clamped.
  const s = sanitizeSettings(settings);
  const cell = s.cell, zs = s.zStep;
  const nc = cell * Math.max(1, Math.round(s.nestCell / cell));
  const margin = Math.ceil(Math.max(0, s.outerWall - s.wall / 2) / cell - 1e-9) * cell;
  const clrC = Math.round(s.lidClearance / cell);
  const wallC = Math.ceil(s.lidWall / cell - 1e-9);
  const lidSide = (clrC + wallC) * cell;
  const k = Math.ceil((s.tolerance + 2 * cell + s.wall / 2) / nc);
  const binW = Math.floor((s.bedX - 2 * lidSide - 2 * margin) / nc);
  const binH = Math.floor((s.bedY - 2 * lidSide - 2 * margin) / nc);
  if (binW < 1 || binH < 1) throw new Error('The print bed is too small for these wall and lid thicknesses. Increase the bed size or make the walls thinner in Print settings.');

  progress(`${groupName}: measuring silhouettes`, 0.05);
  // Each figure may appear several times; copies share one silhouette and one mesh.
  const entries: number[] = []; // entry index -> index into `minis`
  minis.forEach((m, u) => {
    for (let c = 0; c < Math.max(1, Math.round(m.count ?? 1)); c++) entries.push(u);
  });
  const heightOf = minis.map((m) => bounds(m.tris).maxZ);
  const silOf = minis.map((m) => silhouette(m.tris, nc / 2));
  const heights = entries.map((u) => heightOf[u]);
  const items = entries.map((u) => silOf[u]);

  progress(`${groupName}: nesting`, 0.2);
  const bins = nest(items, { nc, k, rotStep: s.rotStep, binW, binH, effort: s.effort });

  const offs = regionOffsets(s.tolerance / cell);
  const results: BoxResult[] = [];
  bins.forEach((bin, bi) => {
    progress(`${groupName}: building box ${bi + 1}/${bins.length}`, 0.3 + (0.7 * bi) / bins.length);
    const nx = Math.ceil(((bin.maxX - bin.minX) * nc + 2 * margin) / cell - 1e-9);
    const ny = Math.ceil(((bin.maxY - bin.minY) * nc + 2 * margin) / cell - 1e-9);
    const hmax = Math.max(...bin.placements.map((p) => heights[p.item]));
    const Hu = Math.ceil((s.floor + hmax) / zs - 1e-9);
    const H = Hu * zs;
    const lnx = nx + 2 * (clrC + wallC), lny = ny + 2 * (clrC + wallC);
    if (Math.max(lnx, lny) >= 8192 || Hu + Math.ceil(s.lidCeiling / zs) >= 65535) {
      throw new Error('This box is too large to build at the current detail level. Raise "Raster cell" under Advanced in Print settings, or split the minis into more groups.');
    }

    // Underside of every mini, lifted so its top sits exactly at the box top.
    const floorGrid = new Float32Array(nx * ny).fill(Infinity);
    const placed: DebugBox['placed'] = [];
    for (const p of bin.placements) {
      const rot = p.mask.rot;
      const xf = {
        cos: Math.cos(rot),
        sin: Math.sin(rot),
        tx: (p.x - p.mask.gx0 - bin.minX) * nc + margin,
        ty: (p.y - p.mask.gy0 - bin.minY) * nc + margin,
        tz: H - heights[p.item],
      };
      rasterMinZ(minis[entries[p.item]].tris, floorGrid, nx, ny, cell, xf);
      placed.push({ mini: entries[p.item], ...xf });
    }
    // Tolerance acts sideways: widen the cavity without lowering the mini.
    const widened = minSpread(floorGrid, nx, ny, offs);
    const hg = new Uint16Array(nx * ny);
    for (let i = 0; i < hg.length; i++) {
      const v = widened[i];
      hg[i] = v === Infinity ? Hu : Math.max(1, Math.min(Hu, Math.floor(v / zs + 1e-6)));
    }
    areaOpening(hg, nx, ny, Math.round(s.minPillar / (cell * cell)));
    coarsenFloor(hg, nx, ny, Hu, Math.round(s.floorSimplify / zs));
    lowerPillars(hg, nx, ny, Hu, Math.round(s.pillarLowering / zs));
    const box = meshHeightfield(hg, nx, ny, cell, zs);
    debugOut?.push({ heights: hg, nx, ny, cell, zs, placed });

    // Lid, in print orientation (ceiling on the bed, skirt pointing up).
    const ceilU = Math.max(1, Math.ceil(s.lidCeiling / zs - 1e-9));
    const skirtU = ceilU + Math.max(1, Hu - Math.round(s.skirtGap / zs));
    const chamfer = Math.min(s.chamfer, wallC * cell * 0.8);
    const lh = new Uint16Array(lnx * lny);
    for (let j = 0; j < lny; j++) {
      for (let i = 0; i < lnx; i++) {
        const ox = Math.max(wallC - (i + 0.5), i + 0.5 - (lnx - wallC), 0);
        const oy = Math.max(wallC - (j + 0.5), j + 0.5 - (lny - wallC), 0);
        if (ox === 0 && oy === 0) { lh[j * lnx + i] = ceilU; continue; }
        const drop = Math.max(0, chamfer - Math.hypot(ox, oy) * cell);
        lh[j * lnx + i] = Math.max(ceilU + 1, skirtU - Math.floor(drop / zs + 1e-6));
      }
    }
    const notchR = s.fingerNotch > 0
      ? fitNotchRadius(s.fingerNotch, Math.max(lnx, lny) * cell, (skirtU - ceilU) * zs)
      : 0;
    cutFingerNotches(lh, lnx, lny, wallC, skirtU, ceilU, cell, zs, notchR);
    const lid = meshHeightfield(lh, lnx, lny, cell, zs);

    results.push({
      name: bins.length > 1 ? `${groupName} ${bi + 1}` : groupName,
      box,
      lid,
      width: nx * cell,
      depth: ny * cell,
      height: H,
      lidHeight: skirtU * zs,
      fingerNotch: notchR,
      fingerNotchWanted: s.fingerNotch,
      lidOffset: -(clrC + wallC) * cell,
      lidCeiling: ceilU * zs,
      minis: [...bin.placements.reduce((acc, p) => {
        const name = minis[entries[p.item]].name;
        return acc.set(name, (acc.get(name) ?? 0) + 1);
      }, new Map<string, number>())].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)),
      miniCount: bin.placements.length,
      oversize: bin.oversize,
    });
  });
  progress(`${groupName}: done`, 1);
  return results;
}
