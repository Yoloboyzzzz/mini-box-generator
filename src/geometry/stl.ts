/** Parse a binary or ASCII STL into a triangle soup (9 floats per triangle). */
export function parseSTL(buf: ArrayBuffer): Float32Array {
  if (buf.byteLength >= 84) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const base = 84 + t * 50 + 12; // skip normal
        for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(base + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(buf);
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length === 0 || vals.length % 9 !== 0) throw new Error('Not a valid STL file');
  return Float32Array.from(vals);
}

/** Write a triangle soup as binary STL. */
export function writeSTL(tris: Float32Array): ArrayBuffer {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const b = 84 + t * 50;
    dv.setFloat32(b, nx, true);
    dv.setFloat32(b + 4, ny, true);
    dv.setFloat32(b + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(b + 12 + k * 4, tris[o + k], true);
  }
  return buf;
}
