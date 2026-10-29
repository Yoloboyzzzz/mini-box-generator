/** Closed cylinder along z from 0 to h, centred on the origin. */
export function cylinder(r: number, h: number, seg = 64): Float32Array {
  const t: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
    t.push(x0, y0, 0, x1, y1, 0, 0, 0, 0); // bottom
    t.push(x0, y0, h, 0, 0, h, x1, y1, h); // top
    t.push(x0, y0, 0, x1, y1, h, x1, y1, 0, x0, y0, 0, x0, y0, h, x1, y1, h); // side
  }
  return Float32Array.from(t);
}

/** Cone with base radius r at z = 0 and apex at z = h. */
export function cone(r: number, h: number, seg = 48): Float32Array {
  const t: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
    t.push(x0, y0, 0, x1, y1, 0, 0, 0, 0);
    t.push(x0, y0, 0, 0, 0, h, x1, y1, 0);
  }
  return Float32Array.from(t);
}

/** Axis-aligned box [x0,x1] x [y0,y1] x [z0,z1] as 12 triangles. */
export function cuboid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const v = (x: number, y: number, z: number) => [x, y, z];
  const p = [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((tri) => tri.flatMap((i) => p[i]));
}

/** A fat base with a very thin spike on top, like a spear tip. */
export function baseWithSpike(): Float32Array {
  return Float32Array.from([...cuboid(-5, -5, 0, 5, 5, 10), ...cuboid(-0.15, -0.15, 10, 0.15, 0.15, 25)]);
}
