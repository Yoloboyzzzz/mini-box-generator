import { diskOffsets } from './morph';

/**
 * 2D nesting of mini silhouettes. Every cavity opens at the top of the box with the mini's full
 * top-down silhouette, so packing the (dilated) silhouettes is exact: there is no 3D interlock to exploit.
 * Masks are conservative (they only ever over-cover) so cavities can never overlap.
 */

export interface NestItem {
  /** Silhouette cell centres in the posed frame, x/y pairs (mm). */
  centers: Float32Array;
  /** Half the silhouette cell size (mm). */
  half: number;
}

export interface Mask {
  rot: number;
  /** Mask cell (i, j) covers rotated-frame x in [(gx0 + i) * nc, (gx0 + i + 1) * nc). */
  gx0: number;
  gy0: number;
  w: number;
  h: number;
  rowStart: Int32Array;
  runs: Int32Array;
  area: number;
}

export interface Placement {
  item: number;
  mask: Mask;
  /** Position of the mask's cell (0, 0) in the bin, in cells. */
  x: number;
  y: number;
}

export interface PackedBin {
  placements: Placement[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  oversize: boolean;
}

export interface NestOptions {
  /** Packing cell size (mm). */
  nc: number;
  /** Silhouette dilation in packing cells. */
  k: number;
  rotStep: number;
  /** Bin size in packing cells. */
  binW: number;
  binH: number;
  effort: number;
}

function buildMask(item: NestItem, rot: number, nc: number, k: number): Mask {
  const c = Math.cos(rot), s = Math.sin(rot);
  const ext = (Math.abs(c) + Math.abs(s)) * item.half;
  const cs = item.centers;
  let ixMin = Infinity, ixMax = -Infinity, iyMin = Infinity, iyMax = -Infinity;
  for (let i = 0; i < cs.length; i += 2) {
    const rx = cs[i] * c - cs[i + 1] * s, ry = cs[i] * s + cs[i + 1] * c;
    ixMin = Math.min(ixMin, Math.floor((rx - ext) / nc));
    ixMax = Math.max(ixMax, Math.floor((rx + ext - 1e-7) / nc));
    iyMin = Math.min(iyMin, Math.floor((ry - ext) / nc));
    iyMax = Math.max(iyMax, Math.floor((ry + ext - 1e-7) / nc));
  }
  const w = ixMax - ixMin + 1 + 2 * k, h = iyMax - iyMin + 1 + 2 * k;
  const base = new Uint8Array(w * h);
  for (let i = 0; i < cs.length; i += 2) {
    const rx = cs[i] * c - cs[i + 1] * s, ry = cs[i] * s + cs[i + 1] * c;
    const a0 = Math.floor((rx - ext) / nc) - ixMin + k, a1 = Math.floor((rx + ext - 1e-7) / nc) - ixMin + k;
    const b0 = Math.floor((ry - ext) / nc) - iyMin + k, b1 = Math.floor((ry + ext - 1e-7) / nc) - iyMin + k;
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) base[b * w + a] = 1;
  }
  const offs = diskOffsets(k + 0.5);
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!base[y * w + x]) continue;
      for (let o = 0; o < offs.length; o += 2) dil[(y + offs[o + 1]) * w + x + offs[o]] = 1;
    }
  }
  const rowStart = new Int32Array(h + 1);
  const runs: number[] = [];
  let area = 0;
  for (let y = 0; y < h; y++) {
    rowStart[y] = runs.length / 2;
    let x = 0;
    while (x < w) {
      if (!dil[y * w + x]) { x++; continue; }
      const x0 = x;
      while (x < w && dil[y * w + x]) x++;
      runs.push(x0, x);
      area += x - x0;
    }
  }
  rowStart[h] = runs.length / 2;
  return { rot, gx0: ixMin - k, gy0: iyMin - k, w, h, rowStart, runs: Int32Array.from(runs), area };
}

class Bin {
  occ: Uint8Array;
  pre: Int32Array;
  placements: Placement[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  constructor(readonly W: number, readonly H: number, public oversize = false) {
    this.occ = new Uint8Array(W * H);
    this.pre = new Int32Array(H * (W + 1));
  }
  fits(m: Mask, x: number, y: number): boolean {
    for (let r = 0; r < m.h; r++) {
      const base = (y + r) * (this.W + 1);
      for (let k = m.rowStart[r]; k < m.rowStart[r + 1]; k++) {
        if (this.pre[base + x + m.runs[2 * k + 1]] !== this.pre[base + x + m.runs[2 * k]]) return false;
      }
    }
    return true;
  }
  place(item: number, m: Mask, x: number, y: number): void {
    for (let r = 0; r < m.h; r++) {
      const row = y + r;
      for (let k = m.rowStart[r]; k < m.rowStart[r + 1]; k++) {
        this.occ.fill(1, row * this.W + x + m.runs[2 * k], row * this.W + x + m.runs[2 * k + 1]);
      }
      const base = row * (this.W + 1);
      let acc = 0;
      for (let c = 0; c < this.W; c++) {
        this.pre[base + c] = acc;
        acc += this.occ[row * this.W + c];
      }
      this.pre[base + this.W] = acc;
    }
    this.placements.push({ item, mask: m, x, y });
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x + m.w);
    this.maxY = Math.max(this.maxY, y + m.h);
  }
  /** Bottom-left first fit; returns null when the mask fits nowhere. */
  firstFit(m: Mask): [number, number] | null {
    if (m.w > this.W || m.h > this.H) return null;
    if (this.placements.length === 0) return [0, 0];
    const yMax = Math.min(this.H - m.h, Math.max(this.maxY, 0));
    for (let y = 0; y <= yMax; y++) {
      for (let x = 0; x <= this.W - m.w; x++) if (this.fits(m, x, y)) return [x, y];
    }
    return null;
  }
  bboxArea(): number {
    return this.placements.length ? (this.maxX - this.minX) * (this.maxY - this.minY) : 0;
  }
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nest(items: NestItem[], o: NestOptions): PackedBin[] {
  if (items.length === 0) return [];
  const nRot = Math.max(1, Math.round(360 / o.rotStep));
  // Copies of one figure share a NestItem object, so they share their masks too.
  const maskCache = new Map<NestItem, Mask[]>();
  const masksOf = (i: number): Mask[] => {
    let m = maskCache.get(items[i]);
    if (!m) {
      m = [];
      for (let r = 0; r < nRot; r++) m.push(buildMask(items[i], (r * 2 * Math.PI) / nRot, o.nc, o.k));
      maskCache.set(items[i], m);
    }
    return m;
  };

  const fitsEmpty = (i: number, W: number, H: number) => masksOf(i).some((m) => m.w <= W && m.h <= H);

  const pack = (order: number[], W: number, H: number): PackedBin[] => {
    const bins: Bin[] = [];
    const tryBin = (bin: Bin, i: number): boolean => {
      let best: { m: Mask; x: number; y: number; score: number } | null = null;
      for (const m of masksOf(i)) {
        const pos = bin.firstFit(m);
        if (!pos) continue;
        const [x, y] = pos;
        const w = Math.max(bin.maxX, x + m.w) - Math.min(bin.minX, x);
        const h = Math.max(bin.maxY, y + m.h) - Math.min(bin.minY, y);
        const score = w * h + (y * 1e-3 + x * 1e-6);
        if (!best || score < best.score) best = { m, x, y, score };
      }
      if (!best) return false;
      bin.place(i, best.m, best.x, best.y);
      return true;
    };
    for (const i of order) {
      let placed = false;
      for (const bin of bins) if ((placed = tryBin(bin, i))) break;
      if (placed) continue;
      if (fitsEmpty(i, W, H)) {
        const bin = new Bin(W, H);
        bins.push(bin);
        tryBin(bin, i);
      } else {
        // Larger than the print bed in every rotation: give it a bin of its own, flagged.
        const m = masksOf(i).reduce((a, b) => (b.w * b.h < a.w * a.h ? b : a));
        const bin = new Bin(m.w, m.h, true);
        bin.place(i, m, 0, 0);
        bins.push(bin);
      }
    }
    return bins.map((b) => ({
      placements: b.placements, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, oversize: b.oversize,
    }));
  };

  const score = (bins: PackedBin[]): [number, number] => [
    bins.length,
    bins.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY), 0),
  ];

  const base = items.map((_, i) => i);
  const area0 = items.map((_, i) => masksOf(i)[0].area);
  const maxDim = items.map((_, i) => Math.max(masksOf(i)[0].w, masksOf(i)[0].h));
  const orders: number[][] = [base.slice().sort((a, b) => area0[b] - area0[a])];
  const nShuffles = [0, 3, 8][Math.min(Math.max(o.effort, 1), 3) - 1];
  if (o.effort >= 2) orders.push(base.slice().sort((a, b) => maxDim[b] - maxDim[a]));
  const rnd = mulberry32(12345);
  for (let s = 0; s < nShuffles; s++) {
    const arr = orders[0].slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    orders.push(arr);
  }

  // Limiting the bin width makes the layout fill rows evenly instead of one long strip.
  const totalArea = area0.reduce((a, b) => a + b, 0);
  const factors = [[1.6], [1.25, 1.6, 2.2], [1.1, 1.3, 1.6, 2, 2.6]][Math.min(Math.max(o.effort, 1), 3) - 1];
  const widths = new Set<number>([o.binW]);
  for (const f of factors) {
    const w = Math.min(o.binW, Math.ceil(Math.sqrt(totalArea * f)));
    if (items.every((_, i) => fitsEmpty(i, w, o.binH))) widths.add(w);
  }

  let best: PackedBin[] | null = null;
  let bestScore: [number, number] = [Infinity, Infinity];
  for (const w of widths) {
    for (const order of orders) {
      const bins = pack(order, w, o.binH);
      const sc = score(bins);
      if (sc[0] < bestScore[0] || (sc[0] === bestScore[0] && sc[1] < bestScore[1])) {
        best = bins;
        bestScore = sc;
      }
    }
  }
  return best!;
}
