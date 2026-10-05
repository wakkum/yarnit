// Saved projects in IndexedDB: project JSON, a small summary per project for the recent list,
// and the original audio files as Blobs (the browser keeps Blobs on disk, so hours of audio are fine).
// One database per browser profile; nothing leaves the computer.
import { fromSaved, summarize, type ProjectSummary, type SavedProject } from '../engine/save';

const DB_NAME = 'yarnit';
const PROJECTS = 'projects';
const SUMMARIES = 'summaries';
/** Original audio files, keyed by track id. */
const AUDIO = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const name of [PROJECTS, SUMMARIES, AUDIO]) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // a failed open (private window, blocked storage) should not stick: allow a retry later
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

/** Run one transaction; resolves with `result()` once it has committed to disk. */
async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => () => T): Promise<T> {
  const t = (await db()).transaction(stores, mode);
  const result = run(t);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(result());
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Save was aborted'));
  });
}

const read = <T>(t: IDBTransaction, store: string, key?: IDBValidKey) => {
  const req = key === undefined ? t.objectStore(store).getAll() : t.objectStore(store).get(key);
  return () => req.result as T;
};

export function saveProject(saved: SavedProject) {
  return tx([PROJECTS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(PROJECTS).put(saved, saved.project.id);
    t.objectStore(SUMMARIES).put(summarize(saved), saved.project.id);
    return () => undefined;
  });
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  return fromSaved(await tx([PROJECTS], 'readonly', (t) => read<unknown>(t, PROJECTS, id)));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx([SUMMARIES], 'readonly', (t) => read<ProjectSummary[]>(t, SUMMARIES));
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveAudio(trackId: string, file: Blob) {
  return tx([AUDIO], 'readwrite', (t) => {
    t.objectStore(AUDIO).put(file, trackId);
    return () => undefined;
  });
}

export function loadAudio(trackId: string) {
  return tx([AUDIO], 'readonly', (t) => read<Blob | undefined>(t, AUDIO, trackId));
}

export function deleteProject({ id, trackIds }: Pick<ProjectSummary, 'id' | 'trackIds'>) {
  return tx([PROJECTS, SUMMARIES, AUDIO], 'readwrite', (t) => {
    t.objectStore(PROJECTS).delete(id);
    t.objectStore(SUMMARIES).delete(id);
    for (const tid of trackIds) t.objectStore(AUDIO).delete(tid);
    return () => undefined;
  });
}

/** Ask the browser not to clear our storage when the disk runs low. It may say no; saving still works. */
export function requestPersistence() {
  void navigator.storage?.persist?.().catch(() => false);
}
