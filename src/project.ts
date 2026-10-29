import type { Pose } from './geometry/transform';
import type { SavedGroup, SavedMini, SavedProject } from './storage';

export interface RestoredMini extends SavedMini {
  src: Float32Array;
}

export interface Restored {
  groups: SavedGroup[];
  minis: RestoredMini[];
  nextId: number;
  colorIndex: number;
  /** Names of minis that could not be restored (their mesh is gone). */
  lost: string[];
  /** True when something in the saved project had to be corrected, so it should be written back. */
  repaired: boolean;
}

const FALLBACK_COLOR = '#3f7fbf';

/** Orientation values come from storage, so they are checked like any other input. */
export function sanitizePose(p: Partial<Pose> | undefined | null): Pose {
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return { rx: n(p?.rx, 0), ry: n(p?.ry, 0), rz: n(p?.rz, 0), scale: Math.min(10, Math.max(0.01, n(p?.scale, 1))) };
}

/**
 * Turns whatever was saved into a project the app can rely on: unique ids, no mini pointing at a group that
 * does not exist, sane quantities and orientations, and no mini without its mesh. Older saves (and any save
 * written while a bug gave two groups the same id) are repaired instead of rejected.
 */
export function restoreFrom(project: SavedProject, meshes: Map<number, Float32Array>): Restored {
  let repaired = false;
  const savedGroups = Array.isArray(project.groups) ? project.groups : [];
  const savedMinis = Array.isArray(project.minis) ? project.minis : [];

  let maxId = Math.max(0, Math.floor(Number(project.nextId) || 1) - 1);
  for (const g of savedGroups) if (Number.isInteger(g?.id)) maxId = Math.max(maxId, g.id);
  for (const m of savedMinis) if (Number.isInteger(m?.id)) maxId = Math.max(maxId, m.id);

  const groups: SavedGroup[] = [];
  const seen = new Set<number>();
  for (const g of savedGroups) {
    if (!g || typeof g !== 'object') { repaired = true; continue; }
    let id = g.id;
    if (!Number.isInteger(id) || id < 0 || seen.has(id)) { id = ++maxId; repaired = true; }
    seen.add(id);
    const name = typeof g.name === 'string' && g.name.trim() ? g.name : `Group ${groups.length + 1}`;
    groups.push({ id, name, color: typeof g.color === 'string' && g.color ? g.color : FALLBACK_COLOR });
  }
  if (!groups.length) {
    groups.push({ id: ++maxId, name: 'Group 1', color: FALLBACK_COLOR });
    repaired = true;
  }

  const minis: RestoredMini[] = [];
  const lost: string[] = [];
  const seenMinis = new Set<number>();
  for (const m of savedMinis) {
    if (!m || typeof m !== 'object' || seenMinis.has(m.id)) { repaired = true; continue; }
    const src = meshes.get(m.id);
    const name = typeof m.name === 'string' && m.name ? m.name : 'mini';
    if (!src) { lost.push(name); continue; }
    seenMinis.add(m.id);
    const group = groups.some((g) => g.id === m.group) ? m.group : groups[0].id;
    if (group !== m.group) repaired = true;
    const count = Math.min(99, Math.max(1, Math.round(Number(m.count)) || 1));
    minis.push({ id: m.id, name, src, pose: sanitizePose(m.pose), group, count });
  }

  return {
    groups,
    minis,
    nextId: maxId + 1,
    colorIndex: Number.isInteger(project.colorIndex) && project.colorIndex >= 0 ? project.colorIndex : groups.length,
    lost,
    repaired,
  };
}
