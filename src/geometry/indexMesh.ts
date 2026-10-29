export interface IndexedMesh {
  /** x,y,z per unique vertex. */
  positions: Float32Array;
  /** Three vertex numbers per triangle, in the same winding as the input. */
  indices: Uint32Array;
}

/**
 * Turns a triangle soup into an indexed mesh by welding vertices that coincide (to 0.001 mm).
 * Uses an open-addressing hash table on typed arrays, so it stays fast and compact on meshes with
 * millions of vertices, where a Map keyed by strings would exhaust memory in a browser tab.
 */
export function indexMesh(tris: Float32Array): IndexedMesh {
  const n = tris.length / 3;
  const indices = new Uint32Array(n);
  let cap = 16;
  while (cap < n * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  const positions = new Float32Array(n * 3);
  let count = 0;

  for (let i = 0; i < n; i++) {
    const x = Math.round(tris[i * 3] * 1000), y = Math.round(tris[i * 3 + 1] * 1000), z = Math.round(tris[i * 3 + 2] * 1000);
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const t = table[slot];
      if (t === -1) {
        table[slot] = count;
        qx[count] = x; qy[count] = y; qz[count] = z;
        positions[count * 3] = tris[i * 3];
        positions[count * 3 + 1] = tris[i * 3 + 1];
        positions[count * 3 + 2] = tris[i * 3 + 2];
        indices[i] = count++;
        break;
      }
      if (qx[t] === x && qy[t] === y && qz[t] === z) {
        indices[i] = t;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  return { positions: positions.slice(0, count * 3), indices };
}
