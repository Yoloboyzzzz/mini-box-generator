export interface Pose {
  /** Euler rotation in degrees, applied in X, Y, Z order. */
  rx: number;
  ry: number;
  rz: number;
  scale: number;
}

export const IDENTITY_POSE: Pose = { rx: 0, ry: 0, rz: 0, scale: 1 };

export interface Posed {
  tris: Float32Array;
  /** Bounding box size after posing (mm). */
  size: [number, number, number];
}

/** Apply scale + rotation, then centre XY on the origin and drop the lowest point to z = 0. */
export function poseMesh(src: Float32Array, pose: Pose): Posed {
  const d = Math.PI / 180;
  const cx = Math.cos(pose.rx * d), sx = Math.sin(pose.rx * d);
  const cy = Math.cos(pose.ry * d), sy = Math.sin(pose.ry * d);
  const cz = Math.cos(pose.rz * d), sz = Math.sin(pose.rz * d);
  const out = new Float32Array(src.length);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < src.length; i += 3) {
    let x = src[i] * pose.scale, y = src[i + 1] * pose.scale, z = src[i + 2] * pose.scale;
    let t = y * cx - z * sx; z = y * sx + z * cx; y = t; // X
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t; // Y
    t = x * cz - y * sz; y = x * sz + y * cz; x = t; // Z
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= ox; out[i + 1] -= oy; out[i + 2] -= minZ;
  }
  return { tris: out, size: [maxX - minX, maxY - minY, maxZ - minZ] };
}
