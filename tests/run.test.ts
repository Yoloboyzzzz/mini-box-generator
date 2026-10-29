import { describe, expect, it } from 'vitest';
import { snapshotRun } from '../src/run';
import { sanitizeSettings } from '../src/settings';
import { DEFAULTS } from '../src/types';

const tris = (n: number) => new Float32Array(n * 9);
const mini = (name: string, group: number, count: number, n = 3) => ({ name, group, count, posed: { tris: tris(n) } });

describe('a generation run snapshot', () => {
  it('keeps groups in order and drops the empty ones', () => {
    const jobs = snapshotRun(
      [{ id: 1, name: 'A' }, { id: 2, name: 'Empty' }, { id: 3, name: 'C' }],
      [mini('x', 1, 1), mini('y', 3, 2), mini('z', 1, 4)],
    );
    expect(jobs.map((j) => j.name)).toEqual(['A', 'C']);
    expect(jobs[0].minis.map((m) => m.name)).toEqual(['x', 'z']);
    expect(jobs[0].minis.map((m) => m.count)).toEqual([1, 4]);
  });

  it('is not affected by edits made after it was taken', () => {
    const groups = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
    const minis = [mini('x', 1, 1), mini('y', 2, 1)];
    const jobs = snapshotRun(groups, minis);

    // the user keeps editing while the first group is being built
    groups[1].name = 'Renamed';
    minis[1].count = 9;
    minis[1].group = 1;
    minis[0].name = 'changed';
    minis.push(mini('late', 2, 1));
    groups.push({ id: 3, name: 'New' });

    expect(jobs.map((j) => j.name)).toEqual(['A', 'B']);
    expect(jobs[1].minis).toHaveLength(1);
    expect(jobs[1].minis[0].count).toBe(1);
    expect(jobs[0].minis[0].name).toBe('x');
  });

  it('keeps pointing at the mesh as it was, even when the mini is re-posed afterwards', () => {
    const m = mini('x', 1, 1);
    const original = m.posed.tris;
    const [job] = snapshotRun([{ id: 1, name: 'A' }], [m]);
    m.posed = { tris: tris(5) }; // rotating or scaling replaces the mesh
    expect(job.minis[0].tris).toBe(original);
  });

  it('needs nothing to be in the project', () => {
    expect(snapshotRun([], [])).toEqual([]);
    expect(snapshotRun([{ id: 1, name: 'A' }], [])).toEqual([]);
  });

  it('settings are copied too, so a later edit cannot reach a running job', () => {
    const live = { ...DEFAULTS };
    const snap = sanitizeSettings(live);
    live.tolerance = 1.5;
    live.bedX = 50;
    expect(snap.tolerance).toBe(DEFAULTS.tolerance);
    expect(snap.bedX).toBe(DEFAULTS.bedX);
    expect(snap).not.toBe(live);
  });
});
