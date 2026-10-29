import type { MiniInput } from './types';

export interface RunJob {
  name: string;
  minis: MiniInput[];
}

/**
 * Everything a generation run needs, copied at the moment Generate is pressed. The run can take a while and
 * the sidebar stays editable, so reading groups, minis or quantities again later would mix old and new values
 * across the groups of one run. Edits made while it runs apply to the next run instead.
 */
export function snapshotRun(
  groups: { id: number; name: string }[],
  minis: { name: string; group: number; count: number; posed: { tris: Float32Array } }[],
): RunJob[] {
  return groups
    .map((g) => ({
      name: g.name,
      minis: minis
        .filter((m) => m.group === g.id)
        .map((m) => ({ name: m.name, tris: m.posed.tris, count: m.count })),
    }))
    .filter((job) => job.minis.length > 0);
}
