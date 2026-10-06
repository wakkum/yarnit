// Saved projects in IndexedDB. Stores:
//   projects   SavedProject per project id (name, recording order)
//   recordings SavedRecording per recording id (transcript and edit)
//   summaries  RecordingSummary per recording id (for the sidebar and the Projects drawer)
//   audio      the original files as Blobs, keyed by track id (the browser keeps Blobs on disk)
// One database per browser profile; nothing leaves the computer.
import {
  fromSavedProject,
  fromSavedRecording,
  migrateV1,
  summarizeProject,
  summarizeRecording,
  type ProjectSummary,
  type RecordingSummary,
  type SavedProject,
  type SavedRecording,
} from '../engine/save';

const DB_NAME = 'yarnit';
const DB_VERSION = 2;
const PROJECTS = 'projects';
const RECORDINGS = 'recordings';
const SUMMARIES = 'summaries';
const AUDIO = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      for (const name of [PROJECTS, RECORDINGS, SUMMARIES, AUDIO]) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name);
      // version 1 kept one recording per "project": split each into a project and its recording
      if (e.oldVersion === 1) {
        const t = req.transaction!;
        const all = t.objectStore(PROJECTS).getAll();
        const keys = t.objectStore(PROJECTS).getAllKeys();
        // requests in one transaction complete in the order they were made, so keys is ready after all
        all.onsuccess = () =>
          (keys.onsuccess = () => {
            all.result.forEach((old, i) => {
              const m = migrateV1(old);
              if (!m) return;
              t.objectStore(PROJECTS).delete(keys.result[i]);
              t.objectStore(PROJECTS).put(m.project, m.project.project.id);
              t.objectStore(RECORDINGS).put(m.recording, m.recording.recording.id);
              t.objectStore(SUMMARIES).put(summarizeRecording(m.recording), m.recording.recording.id);
            });
          });
      }
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
const done = () => undefined;

export function saveRecording(saved: SavedRecording) {
  return tx([RECORDINGS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(RECORDINGS).put(saved, saved.recording.id);
    t.objectStore(SUMMARIES).put(summarizeRecording(saved), saved.recording.id);
    return done;
  });
}

export async function loadRecording(id: string): Promise<SavedRecording | null> {
  return fromSavedRecording(await tx([RECORDINGS], 'readonly', (t) => read<unknown>(t, RECORDINGS, id)));
}

/** Summaries of the given recordings, in the given order (missing ones are skipped). */
export async function recordingSummaries(ids: string[]): Promise<RecordingSummary[]> {
  const all = await tx([SUMMARIES], 'readonly', (t) => read<RecordingSummary[]>(t, SUMMARIES));
  const byId = new Map(all.map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is RecordingSummary => !!s);
}

export function saveProject(saved: SavedProject) {
  return tx([PROJECTS], 'readwrite', (t) => {
    t.objectStore(PROJECTS).put(saved, saved.project.id);
    return done;
  });
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  return fromSavedProject(await tx([PROJECTS], 'readonly', (t) => read<unknown>(t, PROJECTS, id)));
}

/** Every project, most recently saved first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const [projects, summaries] = await tx([PROJECTS, SUMMARIES], 'readonly', (t) => {
    const p = read<unknown[]>(t, PROJECTS);
    const s = read<RecordingSummary[]>(t, SUMMARIES);
    return () => [p(), s()] as const;
  });
  return projects
    .map(fromSavedProject)
    .filter((p): p is SavedProject => !!p)
    .map((p) => summarizeProject(p, summaries))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveAudio(trackId: string, file: Blob) {
  return tx([AUDIO], 'readwrite', (t) => {
    t.objectStore(AUDIO).put(file, trackId);
    return done;
  });
}

export function loadAudio(trackId: string) {
  return tx([AUDIO], 'readonly', (t) => read<Blob | undefined>(t, AUDIO, trackId));
}

export function deleteRecording({ id, trackIds }: Pick<RecordingSummary, 'id' | 'trackIds'>) {
  return tx([RECORDINGS, SUMMARIES, AUDIO], 'readwrite', (t) => {
    t.objectStore(RECORDINGS).delete(id);
    t.objectStore(SUMMARIES).delete(id);
    for (const tid of trackIds) t.objectStore(AUDIO).delete(tid);
    return done;
  });
}

/** Delete a project with all its recordings and their audio. */
export async function deleteProject(id: string) {
  const saved = await loadProject(id);
  const recordings = saved ? await recordingSummaries(saved.project.recordingIds) : [];
  return tx([PROJECTS, RECORDINGS, SUMMARIES, AUDIO], 'readwrite', (t) => {
    t.objectStore(PROJECTS).delete(id);
    for (const r of recordings) {
      t.objectStore(RECORDINGS).delete(r.id);
      t.objectStore(SUMMARIES).delete(r.id);
      for (const tid of r.trackIds) t.objectStore(AUDIO).delete(tid);
    }
    return done;
  });
}

/** Ask the browser not to clear our storage when the disk runs low. It may say no; saving still works. */
export function requestPersistence() {
  void navigator.storage?.persist?.().catch(() => false);
}
