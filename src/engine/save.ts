// Autosave format: the project as plain JSON plus a little metadata. The audio files are stored
// separately (src/state/library.ts), keyed by track id, so this record stays small.
import { HIGHLIGHT_COLORS, type Project } from './types';

export const SAVE_VERSION = 1;

export type SavedProject = {
  version: number;
  savedAt: number;
  /** False while transcription is still running: a reopened project transcribes again. */
  transcribed: boolean;
  project: Project;
};

/** What the recent-projects list shows, without loading every transcript. */
export type ProjectSummary = {
  id: string;
  name: string;
  duration: number;
  /** Length of the edit in seconds. */
  edited: number;
  words: number;
  highlights: number;
  transcribed: boolean;
  savedAt: number;
  /** Keys of the stored audio files, so a delete can remove them too. */
  trackIds: string[];
};

export const toSaved = (project: Project, transcribed: boolean, savedAt: number): SavedProject => ({
  version: SAVE_VERSION,
  savedAt,
  transcribed,
  project,
});

export function summarize(s: SavedProject): ProjectSummary {
  const p = s.project;
  return {
    id: p.id,
    name: p.name,
    duration: p.duration,
    edited: p.segments.reduce((t, seg) => t + seg.end - seg.start, 0),
    words: p.words.length,
    highlights: p.highlights.length,
    transcribed: s.transcribed,
    savedAt: s.savedAt,
    trackIds: p.tracks.map((t) => t.id),
  };
}

/**
 * Read a saved record back, filling fields added after it was written. Returns null for anything
 * that is not a project we can open (wrong shape, or saved by a newer Yarnit).
 */
export function fromSaved(data: unknown): SavedProject | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as Partial<SavedProject>;
  const p = s.project as Partial<Project> | undefined;
  if (typeof s.version !== 'number' || s.version > SAVE_VERSION) return null;
  if (!p || typeof p.id !== 'string' || !Array.isArray(p.tracks) || !p.tracks.length || !Array.isArray(p.segments))
    return null;
  const colors = new Set<string>(HIGHLIGHT_COLORS);
  return {
    version: SAVE_VERSION,
    savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0,
    transcribed: s.transcribed !== false,
    project: {
      id: p.id,
      name: p.name ?? 'Untitled',
      sampleRate: p.sampleRate ?? 48_000,
      duration: p.duration ?? 0,
      tracks: p.tracks,
      speakers: p.speakers ?? [],
      words: p.words ?? [],
      segments: p.segments,
      highlights: (p.highlights ?? []).filter((h) => colors.has(h.color)),
      highlightNames: p.highlightNames ?? {},
    },
  };
}
