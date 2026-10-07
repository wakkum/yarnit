// Autosave format. A project and each of its recordings are saved as separate records, so editing
// one recording never rewrites the others. Audio files are stored apart (src/state/library.ts),
// keyed by track id. Version 1 (before 6 Oct 2026) saved one recording per "project".
import { MAX_GAIN } from './main';
import { HIGHLIGHT_COLORS, RECORDING_KINDS, type MainClip, type MainTimeline, type Project, type Recording, type RecordingKind } from './types';

export const SAVE_VERSION = 2;

export type SavedRecording = {
  version: number;
  savedAt: number;
  /** False while transcription is unfinished: it runs again. Always true for music and sound effects. */
  transcribed: boolean;
  recording: Recording;
};

export type SavedProject = { version: number; savedAt: number; project: Project };

/** What the sidebar shows per recording, without loading its transcript. */
export type RecordingSummary = {
  id: string;
  name: string;
  kind: RecordingKind;
  duration: number;
  /** Length of the edit in seconds. */
  edited: number;
  words: number;
  highlights: number;
  /** Music and sound effects: how many parts are marked. */
  parts: number;
  transcribed: boolean;
  savedAt: number;
  /** Keys of the stored audio files, so a delete can remove them too. */
  trackIds: string[];
};

/** What the Projects drawer shows per project. */
export type ProjectSummary = {
  id: string;
  name: string;
  recordings: number;
  /** Sum of the recordings' edited lengths. */
  duration: number;
  savedAt: number;
};

export const toSavedRecording = (recording: Recording, transcribed: boolean, savedAt: number): SavedRecording => ({
  version: SAVE_VERSION,
  savedAt,
  transcribed,
  recording,
});

export const toSavedProject = (project: Project, savedAt: number): SavedProject => ({ version: SAVE_VERSION, savedAt, project });

export function summarizeRecording(s: SavedRecording): RecordingSummary {
  const r = s.recording;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    duration: r.duration,
    edited: r.segments.reduce((t, seg) => t + seg.end - seg.start, 0),
    words: r.words.length,
    highlights: r.highlights.length,
    parts: r.parts.length,
    transcribed: s.transcribed,
    savedAt: s.savedAt,
    trackIds: r.tracks.map((t) => t.id),
  };
}

export function summarizeProject(p: SavedProject, recordings: RecordingSummary[]): ProjectSummary {
  const mine = recordings.filter((r) => p.project.recordingIds.includes(r.id));
  return {
    id: p.project.id,
    name: p.project.name,
    recordings: mine.length,
    duration: mine.reduce((t, r) => t + r.edited, 0),
    savedAt: Math.max(p.savedAt, ...mine.map((r) => r.savedAt)),
  };
}

/** A file name without its extension, for default names. */
export const baseName = (file: string) => file.replace(/\.[^.]+$/, '') || file;

/** Read a saved recording back, filling fields older saves lack. Null for anything we can't open. */
export function fromSavedRecording(data: unknown): SavedRecording | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as Partial<SavedRecording>;
  if (typeof s.version !== 'number' || s.version > SAVE_VERSION) return null;
  const r = readRecording(s.recording);
  return r && { version: SAVE_VERSION, savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0, transcribed: s.transcribed !== false, recording: r };
}

export function fromSavedProject(data: unknown): SavedProject | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as Partial<SavedProject>;
  const p = s.project as Partial<Project> | undefined;
  if (typeof s.version !== 'number' || s.version > SAVE_VERSION || !p || typeof p.id !== 'string') return null;
  return {
    version: SAVE_VERSION,
    savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0,
    project: {
      id: p.id,
      name: p.name || 'Untitled project',
      recordingIds: Array.isArray(p.recordingIds) ? p.recordingIds.filter((x) => typeof x === 'string') : [],
      ...(p.lastRecordingId ? { lastRecordingId: p.lastRecordingId } : {}),
      ...(p.mainOpen ? { mainOpen: true } : {}),
      ...(p.main ? { main: readMain(p.main) } : {}),
    },
  };
}

const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** The main timeline, dropping clips that can't play (no audio key, unknown kind, no spans). */
/** Keyframes survive only as a matching pair of arrays with sane numbers. */
function readKeys(c: MainClip): Pick<MainClip, 'keys' | 'levels'> {
  const { keys, levels } = c;
  if (!Array.isArray(keys) || !Array.isArray(levels) || !keys.length || levels.length !== keys.length + 1) return { keys: undefined, levels: undefined };
  if (![...keys, ...levels].every((v) => typeof v === 'number' && Number.isFinite(v))) return { keys: undefined, levels: undefined };
  return { keys: [...keys].sort((a, b) => a - b).map((k) => Math.max(0, k)), levels: levels.map((l) => Math.max(0, Math.min(1, l))) };
}

function readMain(data: unknown): MainTimeline {
  const clips = (data as Partial<MainTimeline>)?.clips;
  if (!Array.isArray(clips)) return { clips: [] };
  const kinds = new Set<string>(RECORDING_KINDS);
  return {
    clips: clips
      .filter(
        (c): c is MainClip =>
          !!c && typeof c.id === 'string' && typeof c.trackId === 'string' && kinds.has(c.kind) && Array.isArray(c.segments) && c.segments.length > 0,
      )
      .map((c) => ({
        ...c,
        name: c.name || 'Clip',
        words: Array.isArray(c.words) ? c.words : [],
        speakers: Array.isArray(c.speakers) ? c.speakers : [],
        gain: Math.min(MAX_GAIN, Math.max(0, num(c.gain, 1))),
        fadeIn: Math.max(0, num(c.fadeIn, 0)),
        fadeOut: Math.max(0, num(c.fadeOut, 0)),
        gap: Math.max(0, num(c.gap, 0)),
        at: Math.max(0, num(c.at, 0)),
        ...readKeys(c),
        duck: typeof c.duck === 'number' && Number.isFinite(c.duck) ? Math.max(0, Math.min(1, c.duck)) : undefined,
      })),
  };
}

/**
 * Version 1 saved one recording as a "project" (`{ version: 1, savedAt, transcribed, project }`).
 * It becomes a project of the same name holding that one recording.
 */
export function migrateV1(data: unknown): { project: SavedProject; recording: SavedRecording } | null {
  if (!data || typeof data !== 'object') return null;
  const old = data as { version?: number; savedAt?: number; transcribed?: boolean; project?: unknown };
  if (old.version !== 1) return null;
  const recording = fromSavedRecording({ version: 1, savedAt: old.savedAt, transcribed: old.transcribed, recording: old.project });
  if (!recording) return null;
  const r = recording.recording;
  const project: SavedProject = {
    version: SAVE_VERSION,
    savedAt: recording.savedAt,
    project: { id: `pj-${r.id}`, name: baseName(r.name), recordingIds: [r.id], lastRecordingId: r.id },
  };
  return { project, recording };
}

function readRecording(data: unknown): Recording | null {
  const p = data as Partial<Recording> | undefined;
  if (!p || typeof p.id !== 'string' || !Array.isArray(p.tracks) || !p.tracks.length || !Array.isArray(p.segments)) return null;
  const colors = new Set<string>(HIGHLIGHT_COLORS);
  return {
    id: p.id,
    name: p.name ?? 'Untitled',
    kind: (RECORDING_KINDS as readonly string[]).includes(p.kind as string) ? (p.kind as RecordingKind) : 'interview',
    sampleRate: p.sampleRate ?? 48_000,
    duration: p.duration ?? 0,
    tracks: p.tracks,
    speakers: p.speakers ?? [],
    words: p.words ?? [],
    segments: p.segments,
    highlights: (p.highlights ?? []).filter((h) => colors.has(h.color)),
    highlightNames: p.highlightNames ?? {},
    parts: (p.parts ?? [])
      .filter((x) => colors.has(x.color) && typeof x.start === 'number' && typeof x.end === 'number' && x.end > x.start)
      .sort((a, b) => a.start - b.start),
  };
}

/** Below this many seconds a new file is guessed to be a sound effect, otherwise an interview. */
export const SFX_GUESS_SECONDS = 15;
export const guessKind = (duration: number): RecordingKind => (duration > 0 && duration < SFX_GUESS_SECONDS ? 'sfx' : 'interview');
