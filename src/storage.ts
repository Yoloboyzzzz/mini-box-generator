import type { Pose } from './geometry/transform';

/**
 * Saves the user's minis in this browser (IndexedDB), so a reload does not mean uploading 20 big files again.
 * Everything stays on this device: nothing here touches the network.
 *
 * Two stores: the small project description (groups, orientation, quantities) is rewritten often, and each
 * mesh is written once, when the mini is added. localStorage cannot hold 3D meshes, hence IndexedDB.
 */

export interface SavedMini { id: number; name: string; pose: Pose; group: number; count: number }
export interface SavedGroup { id: number; name: string; color: string }
export interface SavedProject {
  version: 1;
  savedAt: number;
  nextId: number;
  colorIndex: number;
  groups: SavedGroup[];
  minis: SavedMini[];
}

const DB_NAME = 'minibox-project';
const META = 'meta';
const MESHES = 'meshes';
const PROJECT_KEY = 'project';

export const storageAvailable = () => typeof indexedDB !== 'undefined';

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META);
        req.result.createObjectStore(MESHES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The saved minis are open in another tab. Close it and reload.'));
    });
    opening.catch(() => { opening = null; }); // allow a retry after a failed open
  }
  return opening;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = work(tx);
    tx.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Saving was cancelled'));
  });
}

/** True for the error a full disk or an exhausted browser quota produces. */
export const isQuotaError = (err: unknown) =>
  err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');

export async function saveMesh(id: number, tris: Float32Array): Promise<void> {
  await run([MESHES], 'readwrite', (tx) => tx.objectStore(MESHES).put(tris, id));
}

export async function deleteMesh(id: number): Promise<void> {
  await run([MESHES], 'readwrite', (tx) => tx.objectStore(MESHES).delete(id));
}

export async function saveProject(project: SavedProject): Promise<void> {
  await run([META], 'readwrite', (tx) => tx.objectStore(META).put(project, PROJECT_KEY));
}

export async function loadProject(): Promise<{ project: SavedProject | null; meshes: Map<number, Float32Array> }> {
  const project = ((await run<SavedProject>([META], 'readonly', (tx) => tx.objectStore(META).get(PROJECT_KEY))) ?? null) as SavedProject | null;
  const meshes = new Map<number, Float32Array>();
  if (project && project.version === 1) {
    for (const m of project.minis) {
      const tris = await run<Float32Array>([MESHES], 'readonly', (tx) => tx.objectStore(MESHES).get(m.id));
      if (tris instanceof Float32Array && tris.length > 0 && tris.length % 9 === 0) meshes.set(m.id, tris);
    }
  }
  return { project: project && project.version === 1 ? project : null, meshes };
}

export async function clearProject(): Promise<void> {
  await run([META, MESHES], 'readwrite', (tx) => {
    tx.objectStore(META).clear();
    tx.objectStore(MESHES).clear();
  });
}
