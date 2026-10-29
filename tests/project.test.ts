import { describe, expect, it } from 'vitest';
import { restoreFrom, sanitizePose } from '../src/project';
import type { SavedProject } from '../src/storage';

const pose = { rx: 0, ry: 0, rz: 0, scale: 1 };
const mesh = () => new Float32Array(27);
const base = (over: Partial<SavedProject> = {}): SavedProject => ({
  version: 1, savedAt: 1, nextId: 10, colorIndex: 2,
  groups: [{ id: 1, name: 'Heroes', color: '#111' }, { id: 4, name: 'Bosses', color: '#222' }],
  minis: [{ id: 5, name: 'orc', pose, group: 4, count: 3 }],
  ...over,
});
const meshes = (...ids: number[]) => new Map(ids.map((id) => [id, mesh()]));

describe('restoring a saved project', () => {
  it('brings back a healthy project unchanged', () => {
    const r = restoreFrom(base(), meshes(5));
    expect(r.repaired).toBe(false);
    expect(r.groups.map((g) => g.name)).toEqual(['Heroes', 'Bosses']);
    expect(r.minis[0]).toMatchObject({ id: 5, name: 'orc', group: 4, count: 3 });
    expect(r.colorIndex).toBe(2);
    expect(r.lost).toEqual([]);
  });

  it('hands out new ids above everything already used', () => {
    const r = restoreFrom(base({ nextId: 3 }), meshes(5)); // a stale counter must not cause a clash
    expect(r.nextId).toBeGreaterThan(5);
    expect(r.nextId).toBeGreaterThan(Math.max(...r.groups.map((g) => g.id)));
  });

  it('repairs two groups that were saved with the same id', () => {
    const r = restoreFrom(base({
      groups: [{ id: 1, name: 'Heroes', color: '#111' }, { id: 1, name: 'Boss fights', color: '#222' }],
      minis: [{ id: 2, name: 'orc', pose, group: 1, count: 1 }],
    }), meshes(2));
    const ids = r.groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    expect(r.groups.map((g) => g.name)).toEqual(['Heroes', 'Boss fights']);
    expect(r.minis[0].group).toBe(1); // stays with the first of the two
    expect(r.repaired).toBe(true);
    expect(r.nextId).toBeGreaterThan(Math.max(...ids));
  });

  it('moves a mini whose group no longer exists to the first group', () => {
    const r = restoreFrom(base({ minis: [{ id: 5, name: 'orc', pose, group: 99, count: 1 }] }), meshes(5));
    expect(r.minis[0].group).toBe(r.groups[0].id);
    expect(r.repaired).toBe(true);
  });

  it('reports minis whose mesh is gone and keeps the rest', () => {
    const r = restoreFrom(base({
      minis: [{ id: 5, name: 'orc', pose, group: 1, count: 1 }, { id: 6, name: 'lost one', pose, group: 1, count: 1 }],
    }), meshes(5));
    expect(r.minis.map((m) => m.name)).toEqual(['orc']);
    expect(r.lost).toEqual(['lost one']);
  });

  it('copes with a project that lost its groups', () => {
    const r = restoreFrom(base({ groups: [] }), meshes(5));
    expect(r.groups).toHaveLength(1);
    expect(r.minis[0].group).toBe(r.groups[0].id);
  });

  it('clamps quantities and ignores junk entries', () => {
    const r = restoreFrom(base({
      minis: [
        { id: 5, name: 'a', pose, group: 1, count: 500 },
        { id: 6, name: 'b', pose, group: 1, count: -3 },
        { id: 7, name: 'c', pose, group: 1, count: NaN },
        null as never,
        { id: 5, name: 'dup', pose, group: 1, count: 1 },
      ],
    }), meshes(5, 6, 7));
    expect(r.minis.map((m) => m.count)).toEqual([99, 1, 1]);
    expect(r.minis.map((m) => m.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('saved orientation', () => {
  it('keeps good values', () => {
    expect(sanitizePose({ rx: 90, ry: 0, rz: 15, scale: 1.2 })).toEqual({ rx: 90, ry: 0, rz: 15, scale: 1.2 });
  });

  it('replaces bad values with safe ones', () => {
    expect(sanitizePose({ rx: NaN, ry: Infinity, rz: 'x' as never, scale: 0 })).toEqual({ rx: 0, ry: 0, rz: 0, scale: 0.01 });
    expect(sanitizePose(undefined)).toEqual({ rx: 0, ry: 0, rz: 0, scale: 1 });
    expect(sanitizePose({ scale: 5000 }).scale).toBe(10);
  });
});
