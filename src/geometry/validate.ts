export interface MeshCheck {
  triangles: number;
  /** Directed edges that are not matched by exactly one opposite edge. */
  badEdges: number;
  /** Signed volume in mm³ (positive when normals point outwards). */
  volume: number;
}

/** Checks that every edge is shared by exactly two triangles with opposite orientation. */
export function checkMesh(tris: Float32Array): MeshCheck {
  const ids = new Map<string, number>();
  const idOf = (o: number): number => {
    const key = `${tris[o]},${tris[o + 1]},${tris[o + 2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    return id;
  };
  const directed = new Map<number, number>();
  const edge = (a: number, b: number) => a * 1073741824 + b;
  let volume = 0;
  const n = tris.length / 9;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const a = idOf(o), b = idOf(o + 3), c = idOf(o + 6);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.set(edge(u, v), (directed.get(edge(u, v)) ?? 0) + 1);
    volume += (tris[o] * (tris[o + 4] * tris[o + 8] - tris[o + 5] * tris[o + 7])
      - tris[o + 1] * (tris[o + 3] * tris[o + 8] - tris[o + 5] * tris[o + 6])
      + tris[o + 2] * (tris[o + 3] * tris[o + 7] - tris[o + 4] * tris[o + 6])) / 6;
  }
  let bad = 0;
  for (const [key, count] of directed) {
    const a = Math.floor(key / 1073741824), b = key - a * 1073741824;
    if (count !== 1 || directed.get(edge(b, a)) !== 1) bad++;
  }
  return { triangles: n, badEdges: bad, volume };
}
