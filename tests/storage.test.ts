import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearProject, deleteMesh, isQuotaError, loadProject, saveMesh, saveProject, storageAvailable, type SavedProject } from '../src/storage';

const pose = { rx: 0, ry: 90, rz: 15, scale: 1 };
const mesh = (n: number) => Float32Array.from({ length: n * 9 }, (_, i) => i * 0.5);
const project = (minis: SavedProject['minis']): SavedProject => ({
  version: 1,
  savedAt: 123,
  nextId: 9,
  colorIndex: 2,
  groups: [{ id: 1, name: 'Heroes', color: '#3f7fbf' }, { id: 4, name: 'Boss fights', color: '#2a8f85' }],
  minis,
});

beforeEach(async () => { await clearProject(); });

describe('saved project', () => {
  it('is available where IndexedDB exists', () => {
    expect(storageAvailable()).toBe(true);
  });

  it('starts empty', async () => {
    const { project: p, meshes } = await loadProject();
    expect(p).toBeNull();
    expect(meshes.size).toBe(0);
  });

  it('round-trips the project and every mesh exactly', async () => {
    const a = mesh(40), b = mesh(7);
    await saveMesh(2, a);
    await saveMesh(5, b);
    const saved = project([
      { id: 2, name: 'orc', pose, group: 1, count: 3 },
      { id: 5, name: '兽人 😀', pose: { rx: 0, ry: 0, rz: 0, scale: 1.25 }, group: 4, count: 1 },
    ]);
    await saveProject(saved);

    const back = await loadProject();
    expect(back.project).toEqual(saved);
    expect(Array.from(back.meshes.get(2)!)).toEqual(Array.from(a));
    expect(Array.from(back.meshes.get(5)!)).toEqual(Array.from(b));
    expect(back.meshes.get(2)).toBeInstanceOf(Float32Array);
  });

  it('keeps big meshes intact', async () => {
    const big = mesh(200_000); // about 7 MB, the size of a detailed figure
    await saveMesh(1, big);
    await saveProject(project([{ id: 1, name: 'big', pose, group: 1, count: 1 }]));
    const back = await loadProject();
    expect(back.meshes.get(1)!.length).toBe(big.length);
    expect(back.meshes.get(1)![big.length - 1]).toBe(big[big.length - 1]);
  });

  it('skips a mini whose mesh is missing instead of failing the whole project', async () => {
    await saveMesh(1, mesh(3));
    await saveProject(project([
      { id: 1, name: 'ok', pose, group: 1, count: 1 },
      { id: 2, name: 'lost', pose, group: 1, count: 1 },
    ]));
    const back = await loadProject();
    expect(back.project!.minis.length).toBe(2);
    expect(back.meshes.has(1)).toBe(true);
    expect(back.meshes.has(2)).toBe(false);
  });

  it('ignores a damaged mesh', async () => {
    await saveMesh(1, new Float32Array(10)); // not a whole number of triangles
    await saveProject(project([{ id: 1, name: 'bad', pose, group: 1, count: 1 }]));
    expect((await loadProject()).meshes.size).toBe(0);
  });

  it('removes a mesh when its mini is deleted', async () => {
    await saveMesh(1, mesh(3));
    await saveMesh(2, mesh(3));
    await deleteMesh(1);
    await saveProject(project([{ id: 1, name: 'a', pose, group: 1, count: 1 }, { id: 2, name: 'b', pose, group: 1, count: 1 }]));
    const back = await loadProject();
    expect(back.meshes.has(1)).toBe(false);
    expect(back.meshes.has(2)).toBe(true);
  });

  it('overwrites the project description when saved again', async () => {
    await saveMesh(1, mesh(3));
    await saveProject(project([{ id: 1, name: 'a', pose, group: 1, count: 1 }]));
    await saveProject({ ...project([{ id: 1, name: 'a', pose, group: 1, count: 5 }]), savedAt: 456 });
    const back = await loadProject();
    expect(back.project!.minis[0].count).toBe(5);
    expect(back.project!.savedAt).toBe(456);
  });

  it('forgets everything on clear', async () => {
    await saveMesh(1, mesh(3));
    await saveProject(project([{ id: 1, name: 'a', pose, group: 1, count: 1 }]));
    await clearProject();
    const back = await loadProject();
    expect(back.project).toBeNull();
    expect(back.meshes.size).toBe(0);
  });

  it('refuses a project written by a different version', async () => {
    await saveMesh(1, mesh(3));
    await saveProject({ ...project([{ id: 1, name: 'a', pose, group: 1, count: 1 }]), version: 2 } as unknown as SavedProject);
    expect((await loadProject()).project).toBeNull();
  });
});

describe('quota errors', () => {
  it('are recognised', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new DOMException('x', 'DataError'))).toBe(false);
    expect(isQuotaError(new Error('QuotaExceededError'))).toBe(false);
  });
});
