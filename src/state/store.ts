// App state (Zustand). Heavy audio objects live outside the store in `media`
// so React never diffs or clones them.
import { create } from 'zustand';
import { channelsOf, decodeFile, toWhisperMono, WHISPER_SAMPLE_RATE } from '../audio/decode';
import { Player } from '../audio/player';
import {
  deleteWords,
  displayWords,
  findPauses,
  fullSegments,
  isFillerText,
  moveWords as moveInEdit,
  newId,
  outputDuration,
  PARAGRAPH_PAD,
  shortenPauses as shortenInEdit,
  sourceToOutput,
  type Pause,
} from '../engine/edl';
import { renderEdit, silenceThreshold, snapToQuiet, speechEnd } from '../engine/render';
import { highlightWords } from '../engine/highlights';
import { toSaved, type ProjectSummary } from '../engine/save';
import type { HighlightColor, Project, Segment, Speaker, Word } from '../engine/types';
import { clampView, computePeaks, paragraphMove, paragraphs, searchHits, zoomAround, type Paragraph, type ZoomView } from '../engine/view';
import type { ExportMessage, ExportRequest } from '../workers/export.worker';
import type { TranscribeMessage, TranscribeRequest } from '../workers/transcribe.worker';
import { ago } from '../ui/time';
import * as library from './library';

/** 'off': this project is not being saved (storage blocked or full); see `message`. */
export type SaveStatus = 'off' | 'saving' | 'saved' | 'error';

export type Phase = 'empty' | 'decoding' | 'downloading' | 'transcribing' | 'ready' | 'exporting' | 'error';

export type Settings = {
  model: string;
  /** Whisper language name, or '' for English-only (.en) models. */
  language: string;
  device: 'webgpu' | 'wasm';
  theme: 'auto' | 'light' | 'dark';
  /** Pauses longer than this (seconds) get a chip in the transcript and can be shortened. */
  pauseMin: number;
  /** What a shortened pause becomes (seconds). */
  pauseKeep: number;
  /** Show the strip of the original recording under the edited waveform. */
  showOriginal: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  model: 'Xenova/whisper-base.en',
  language: '',
  device: 'wasm',
  theme: 'auto',
  pauseMin: 1,
  pauseKeep: 0.4,
  showOriginal: false,
};
const SETTINGS_KEY = 'yarnit.settings';

// Settings are a per-browser convenience; storage can be missing or blocked, so never rely on it.
function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore: settings just won't persist
  }
}

/** One undo step. Words are included because speaker changes relabel them. */
type Snapshot = Pick<Project, 'segments' | 'words' | 'speakers' | 'highlights'>;
const snapshot = (p: Project): Snapshot => ({ segments: p.segments, words: p.words, speakers: p.speakers, highlights: p.highlights });

/** The right-hand side panel: at most one at a time. */
export type Panel = 'help' | 'highlights' | 'projects' | null;
const HISTORY_LIMIT = 200;
/** Waveform resolution per track (the timeline shows the whole recording). */
const PEAK_BUCKETS = 3000;

/** Non-reactive media: decoded audio, the Whisper copy, the player. */
export const media = {
  buffers: new Map<string, AudioBuffer>(),
  mono16k: null as Float32Array | null,
  /** Level below which the 16 kHz copy counts as silence (estimated per file). */
  silence: 0.002,
  player: null as Player | null,
};

type State = {
  project: Project | null;
  phase: Phase;
  progress: number;
  message: string;
  settings: Settings;
  selection: string[];
  past: Snapshot[];
  future: Snapshot[];
  /** Word ids cut with Cut / Cmd+X, waiting to be pasted before another word. */
  clipboard: string[];
  playing: boolean;
  /** Waveform overview per track id. */
  peaks: Record<string, Float32Array>;
  query: string;
  hitIndex: number;
  panel: Panel;
  /** False while the current project is still being transcribed. */
  transcribed: boolean;
  saveStatus: SaveStatus;
  savedAt: number;
  /** Saved projects, newest first (the start screen's recent list). */
  library: ProjectSummary[];
  /** How the transcript is shown: full text, or one line per paragraph to reorder. */
  view: 'transcript' | 'outline';
  /** Visible part of the edited timeline, or null to fit the whole edit. */
  zoom: ZoomView | null;
  /** Key of the paragraph that just moved, so it can glow where it landed. */
  moved: string | null;
  /** A short message shown for a few seconds (for example after reopening a project). */
  notice: string;

  loadFile: (file: File) => Promise<void>;
  setSettings: (s: Partial<Settings>) => void;
  select: (ids: string[]) => void;
  applyEdit: (segments: Segment[]) => void;
  deleteSelection: () => void;
  moveWords: (ids: string[], targetId: string, side: 'before' | 'after') => void;
  removeFillers: () => void;
  /** Bring back every cut and undo every move (undoable). Transcript, highlights and speakers stay. */
  resetTimeline: () => void;
  undo: () => void;
  redo: () => void;
  togglePlay: () => void;
  seekToWord: (w: Word) => void;
  /** Seek by source time (original strip); a cut moment jumps to the next kept audio. */
  seekSource: (t: number) => void;
  /** Seek by edited (playback) time, as on the edited waveform. */
  seekOutput: (t: number) => void;
  setQuery: (q: string) => void;
  /** Step to the next (+1) or previous (-1) search hit: selects and seeks to it. */
  stepHit: (dir: 1 | -1) => void;
  deleteHits: () => void;
  exportAudio: (format: 'wav' | 'mp3') => Promise<void>;
  setPanel: (panel: Panel) => void;
  /** Colour the selected words (null clears), then deselect so the highlight shows. */
  highlightSelection: (color: HighlightColor | null) => void;
  highlightWordIds: (ids: string[], color: HighlightColor | null) => void;
  nameHighlight: (color: HighlightColor, name: string) => void;
  cut: () => void;
  /** Move the clipboard before (default) or after the single selected word. */
  paste: (side?: 'before' | 'after') => void;
  clearClipboard: () => void;
  /** Shorten the given pauses (default: all over settings.pauseMin) to settings.pauseKeep. */
  shortenPauses: (pauses?: Pause[]) => void;
  renameSpeaker: (id: string, name: string) => void;
  /** Relabel words; 'new' creates the next "Speaker N". Returns the speaker id used. */
  assignSpeaker: (wordIds: string[], speakerId: string | 'new') => string | undefined;
  refreshLibrary: () => Promise<void>;
  setView: (view: 'transcript' | 'outline') => void;
  setZoom: (zoom: ZoomView | null) => void;
  /** Zoom in (> 1) or out (< 1) around `anchor` (output seconds; default: the playhead if visible, else the middle). */
  zoomBy: (factor: number, anchor?: number) => void;
  /** Move a paragraph (by key) one up, one down, or to position `to` (0 = top). */
  moveParagraph: (key: string, to: 'up' | 'down' | number) => void;
  /** Select every kept word of a paragraph and jump to it. */
  selectParagraph: (key: string) => void;
  /** On page load: reopen the most recently saved project, if there is one. */
  resumeLast: () => Promise<void>;
  setNotice: (notice: string) => void;
  /** Reopen a saved project; one saved mid-transcription is transcribed again. */
  openSaved: (id: string) => Promise<void>;
  deleteSaved: (summary: ProjectSummary) => Promise<void>;
  /** Save, then go back to the start screen. */
  closeProject: () => Promise<void>;
};

/** Apply an undoable change to the project and keep the player in sync. */
function commit(set: (p: Partial<State>) => void, get: () => State, change: Partial<Snapshot>) {
  const { project, past } = get();
  if (!project) return;
  if (change.segments) media.player?.setSegments(change.segments);
  set({ project: { ...project, ...change }, past: [...past, snapshot(project)].slice(-HISTORY_LIMIT), future: [] });
}

// Transcript and outline compute the same paragraphs from the same arrays; cache the last result.
let parasCache: { words: Word[]; segments: Segment[]; paras: Paragraph[] } | null = null;
export function currentParagraphs(project: Project): Paragraph[] {
  if (parasCache?.words !== project.words || parasCache.segments !== project.segments)
    parasCache = { words: project.words, segments: project.segments, paras: paragraphs(displayWords(project.words, project.segments)) };
  return parasCache.paras;
}

/** Decode-side setup shared by a new file and a reopened project. */
async function attachAudio(buffer: AudioBuffer, trackId: string, set: (p: Partial<State>) => void) {
  media.buffers = new Map([[trackId, buffer]]);
  media.mono16k = await toWhisperMono(buffer);
  media.silence = silenceThreshold(media.mono16k, WHISPER_SAMPLE_RATE);
  set({ peaks: { [trackId]: computePeaks(media.mono16k, PEAK_BUCKETS) } });
  media.player!.setTracks([{ buffer, offset: 0 }]);
}

/** Stop whatever the previous project was doing (playback, a transcription still running). */
function resetSession(set: (p: Partial<State>) => void) {
  worker?.terminate();
  worker = null;
  media.player?.pause();
  media.player ??= new Player();
  media.player.onEnded = () => set({ playing: false });
  return media.player;
}

/** Everything that belongs to one open project, cleared when another opens. */
const FRESH = {
  selection: [],
  moved: null,
  zoom: null,
  past: [],
  future: [],
  clipboard: [],
  peaks: {},
  query: '',
  hitIndex: -1,
  playing: false,
} satisfies Partial<State>;

const snap = (t: number, lo: number, hi: number) =>
  media.mono16k ? snapToQuiet(media.mono16k, WHISPER_SAMPLE_RATE, t, lo, hi) : t;

export const useStore = create<State>((set, get) => ({
  project: null,
  phase: 'empty',
  progress: 0,
  message: '',
  settings: loadSettings(),
  selection: [],
  past: [],
  future: [],
  clipboard: [],
  playing: false,
  peaks: {},
  query: '',
  hitIndex: -1,
  panel: null,
  transcribed: false,
  saveStatus: 'off',
  savedAt: 0,
  library: [],
  notice: '',
  view: 'transcript',
  zoom: null,
  moved: null,

  async loadFile(file) {
    await flushSave();
    const player = resetSession(set);
    set({ ...FRESH, project: null, saveStatus: 'off', phase: 'decoding', progress: 0, message: `Decoding ${file.name}` });
    try {
      const buffer = await decodeFile(player.ctx, file);
      const trackId = newId('t');
      const speaker: Speaker = { id: newId('sp'), name: 'Speaker 1' };
      await attachAudio(buffer, trackId, set);
      // the original file is kept so the project can be reopened; without it there is nothing to save
      const stored = await library.saveAudio(trackId, file).then(
        () => true,
        () => false,
      );
      if (stored) library.requestPersistence();
      const project: Project = {
        id: newId('p'),
        name: file.name,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        tracks: [{ id: trackId, fileName: file.name, offset: 0, speakerId: speaker.id }],
        speakers: [speaker],
        words: [],
        segments: fullSegments(buffer.duration),
        highlights: [],
        highlightNames: {},
      };
      player.setSegments(project.segments);
      set({
        project,
        transcribed: false,
        saveStatus: stored ? 'saving' : 'off',
        phase: 'downloading',
        message: stored ? 'Loading speech model' : 'Loading speech model. This browser is not letting Yarnit save, so edits are lost when you close the tab.',
      });
      transcribe(trackId, set, get);
    } catch (err) {
      set({ phase: 'error', message: `Could not open file: ${(err as Error).message}` });
    }
  },

  setSettings(s) {
    const settings = { ...get().settings, ...s };
    saveSettings(settings);
    set({ settings });
  },
  select: (ids) => set({ selection: ids }),

  applyEdit(segments) {
    const { project } = get();
    if (project) commit(set, get, { segments });
  },

  deleteSelection() {
    const { project, selection } = get();
    if (!project || !selection.length) return;
    get().applyEdit(deleteWords(project.segments, project.words, selection, snap));
    set({ selection: [] });
  },

  moveWords(ids, targetId, side) {
    const { project } = get();
    if (!project || !ids.length) return;
    get().applyEdit(moveInEdit(project.segments, project.words, ids, targetId, side));
  },

  removeFillers() {
    const { project } = get();
    if (!project) return;
    const kept = new Set(displayWords(project.words, project.segments).filter((d) => !d.deleted).map((d) => d.word.id));
    const ids = project.words.filter((w) => w.isFiller && kept.has(w.id)).map((w) => w.id);
    if (ids.length) get().applyEdit(deleteWords(project.segments, project.words, ids, snap));
  },

  resetTimeline() {
    const { project } = get();
    if (!project) return;
    get().applyEdit(fullSegments(project.duration));
    set({ selection: [], clipboard: [], zoom: null });
  },

  undo() {
    const { project, past, future } = get();
    const prev = past.at(-1);
    if (!project || !prev) return;
    media.player?.setSegments(prev.segments);
    set({ project: { ...project, ...prev }, past: past.slice(0, -1), future: [snapshot(project), ...future] });
  },

  redo() {
    const { project, past, future } = get();
    const next = future[0];
    if (!project || !next) return;
    media.player?.setSegments(next.segments);
    set({ project: { ...project, ...next }, past: [...past, snapshot(project)], future: future.slice(1) });
  },

  togglePlay() {
    const p = media.player;
    if (!p) return;
    if (p.playing) p.pause();
    else void p.play();
    set({ playing: !get().playing });
  },

  seekToWord(w) {
    const { project } = get();
    if (!project) return;
    // a snapped cut can clip a word's first few ms, so fall back to its midpoint
    const t =
      sourceToOutput(project.segments, w.start + 0.001) ?? sourceToOutput(project.segments, (w.start + w.end) / 2);
    if (t != null) media.player?.seek(t);
  },

  seekSource(t) {
    const { project } = get();
    if (!project) return;
    let out = sourceToOutput(project.segments, t);
    if (out == null) {
      // inside a cut: jump to the start of the next kept segment in source order
      const next = project.segments.filter((s) => s.start >= t).sort((a, b) => a.start - b.start)[0];
      if (next) out = sourceToOutput(project.segments, next.start);
    }
    if (out != null) media.player?.seek(out);
  },

  seekOutput: (t) => media.player?.seek(Math.max(0, t)),

  setQuery: (query) => set({ query, hitIndex: -1 }),
  setPanel: (panel) => set({ panel }),

  highlightSelection(color) {
    const { selection } = get();
    if (!selection.length) return;
    get().highlightWordIds(selection, color);
    set({ selection: [] });
  },

  highlightWordIds(ids, color) {
    const { project } = get();
    if (!project || !ids.length) return;
    commit(set, get, { highlights: highlightWords(project.highlights, project.words, ids, color) });
  },

  nameHighlight(color, name) {
    const { project } = get();
    if (!project) return;
    const highlightNames = { ...project.highlightNames, [color]: name.trim() || undefined };
    set({ project: { ...project, highlightNames } });
  },

  cut() {
    const { selection } = get();
    if (selection.length) set({ clipboard: selection, selection: [] });
  },

  paste(side = 'before') {
    const { clipboard, selection } = get();
    if (!clipboard.length || selection.length !== 1 || clipboard.includes(selection[0])) return;
    get().moveWords(clipboard, selection[0], side);
    set({ clipboard: [], selection: [] });
  },

  clearClipboard: () => set({ clipboard: [] }),

  shortenPauses(pauses) {
    const { project, settings } = get();
    if (!project) return;
    const list = pauses ?? findPauses(displayWords(project.words, project.segments), project.segments, settings.pauseMin);
    if (list.length) get().applyEdit(shortenInEdit(project.segments, list, settings.pauseKeep));
  },

  renameSpeaker(id, name) {
    const { project } = get();
    const clean = name.trim();
    if (!project || !clean) return;
    commit(set, get, { speakers: project.speakers.map((s) => (s.id === id ? { ...s, name: clean } : s)) });
  },

  assignSpeaker(wordIds, speakerId) {
    const { project } = get();
    if (!project || !wordIds.length) return;
    let speakers = project.speakers;
    let id = speakerId;
    if (id === 'new') {
      id = newId('sp');
      speakers = [...speakers, { id, name: `Speaker ${speakers.length + 1}` }];
    }
    const ids = new Set(wordIds);
    const words = project.words.map((w) => (ids.has(w.id) ? { ...w, speakerId: id } : w));
    commit(set, get, { words, speakers });
    return id;
  },

  async refreshLibrary() {
    try {
      set({ library: await library.listProjects() });
    } catch {
      set({ library: [] });
    }
  },

  async resumeLast() {
    // once per page load (React's dev mode runs mount effects twice)
    if (resumed) return;
    resumed = true;
    await get().refreshLibrary();
    const last = get().library[0];
    if (!last || get().project || get().phase !== 'empty') return;
    await get().openSaved(last.id);
    if (get().project?.id === last.id) set({ notice: `Reopened ${last.name}, saved ${ago(last.savedAt, Date.now())}` });
  },

  setNotice: (notice) => set({ notice }),
  setView: (view) => set({ view }),
  setZoom(zoom) {
    const { project } = get();
    set({ zoom: project ? clampView(zoom, outputDuration(project.segments)) : null });
  },
  zoomBy(factor, anchor) {
    const { project, zoom } = get();
    if (!project) return;
    const total = outputDuration(project.segments);
    const v = zoom ?? { start: 0, span: total };
    const head = media.player?.currentTime ?? 0;
    const at = anchor ?? (head >= v.start && head <= v.start + v.span ? head : v.start + v.span / 2);
    set({ zoom: zoomAround(zoom, total, factor, at) });
  },

  moveParagraph(key, to) {
    const { project } = get();
    if (!project) return;
    const paras = currentParagraphs(project);
    const from = paras.findIndex((p) => p.key === key);
    if (from < 0) return;
    const m = paragraphMove(paras, from, to === 'up' ? from - 1 : to === 'down' ? from + 2 : to);
    if (!m) return;
    get().applyEdit(moveInEdit(project.segments, project.words, m.ids, m.targetId, m.side, PARAGRAPH_PAD));
    set({ moved: key });
  },

  selectParagraph(key) {
    const { project } = get();
    const para = project && currentParagraphs(project).find((p) => p.key === key);
    const kept = para?.words.filter((d) => !d.deleted).map((d) => d.word) ?? [];
    if (!kept.length) return;
    set({ selection: kept.map((w) => w.id) });
    get().seekToWord(kept[0]);
  },

  async openSaved(id) {
    await flushSave();
    const player = resetSession(set);
    const name = get().library.find((p) => p.id === id)?.name ?? 'project';
    set({ ...FRESH, project: null, saveStatus: 'off', phase: 'decoding', progress: 0, message: `Opening ${name}` });
    try {
      const saved = await library.loadProject(id);
      if (!saved) throw new Error('it was saved by a newer version of Yarnit, or is damaged');
      const { project, transcribed } = saved;
      const track = project.tracks[0];
      const file = await library.loadAudio(track.id);
      if (!file) throw new Error('its audio is missing from browser storage');
      const buffer = await decodeFile(player.ctx, file);
      await attachAudio(buffer, track.id, set);
      player.setSegments(project.segments);
      if (transcribed) {
        set({ project, transcribed, saveStatus: 'saving', phase: 'ready', message: `Opened ${project.name}` });
      } else {
        // closed mid-transcription: start over (edits made meanwhile only touched segments, which stay)
        set({ project: { ...project, words: [] }, transcribed, saveStatus: 'saving', phase: 'downloading', message: 'Loading speech model' });
        transcribe(track.id, set, get);
      }
    } catch (err) {
      set({ phase: 'error', message: `Could not open ${name}: ${(err as Error).message}` });
    }
  },

  async deleteSaved(summary) {
    try {
      if (get().project?.id === summary.id) await get().closeProject();
      await library.deleteProject(summary);
    } catch {
      // nothing useful to tell the user; the list below shows what is still there
    }
    await get().refreshLibrary();
  },

  async closeProject() {
    await flushSave();
    resetSession(set);
    set({ ...FRESH, project: null, transcribed: false, saveStatus: 'off', phase: 'empty', progress: 0, message: '' });
    await get().refreshLibrary();
  },

  stepHit(dir) {
    const { project, query, hitIndex } = get();
    if (!project) return;
    const hits = searchHits(displayWords(project.words, project.segments), query);
    if (!hits.length) return;
    const i = (hitIndex + dir + hits.length) % hits.length;
    const first = project.words.find((w) => w.id === hits[i][0]);
    set({ hitIndex: i, selection: hits[i] });
    if (first) get().seekToWord(first);
  },

  deleteHits() {
    const { project, query } = get();
    if (!project) return;
    const ids = searchHits(displayWords(project.words, project.segments), query).flat();
    if (ids.length) get().applyEdit(deleteWords(project.segments, project.words, ids, snap));
    set({ selection: [], hitIndex: -1 });
  },

  async exportAudio(format) {
    const { project } = get();
    if (!project) return;
    set({ phase: 'exporting', progress: 0, message: `Exporting ${format.toUpperCase()}` });
    const tracks = project.tracks.map((t) => ({ channels: channelsOf(media.buffers.get(t.id)!), offset: t.offset }));
    const channels = renderEdit(tracks, project.segments, project.sampleRate);
    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
    const req: ExportRequest = { channels, sampleRate: project.sampleRate, format };
    worker.postMessage(req, channels.map((c) => c.buffer as ArrayBuffer));
    await new Promise<void>((resolve) => {
      worker.onerror = () => {
        set({ phase: 'ready', message: 'Export failed: the export worker could not load. Reload the page and try again.' });
        resolve();
      };
      worker.onmessage = (e: MessageEvent<ExportMessage>) => {
        const m = e.data;
        if (m.type === 'progress') set({ progress: m.progress });
        if (m.type === 'error') {
          set({ phase: 'ready', message: `Export failed: ${m.message}` });
          resolve();
        }
        if (m.type === 'done') {
          const base = project.name.replace(/\.[^.]+$/, '');
          download(new Blob([m.data], { type: m.mimeType }), `${base}-edited${m.extension}`);
          set({ phase: 'ready', message: 'Export finished' });
          resolve();
        }
      };
    });
    worker.terminate();
  },
}));

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

let worker: Worker | null = null;
let resumed = false;

function transcribe(trackId: string, set: (p: Partial<State>) => void, get: () => State) {
  worker?.terminate();
  worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' });
  const { model, language, device } = get().settings;
  const audio = media.mono16k!.slice(); // copy: we keep the original for snapping
  const req: TranscribeRequest = { audio, model, device, ...(language ? { language } : {}) };
  // a worker that fails to load (dev server gone, offline) never posts a message: say so instead of hanging
  worker.onerror = () =>
    set({ phase: 'error', message: 'Transcription could not start: the speech worker failed to load. Reload the page and try again.' });
  worker.postMessage(req, [audio.buffer]);
  worker.onmessage = (e: MessageEvent<TranscribeMessage>) => {
    const m = e.data;
    const project = get().project;
    if (!project) return;
    if (m.type === 'download') set({ phase: 'downloading', progress: m.progress });
    if (m.type === 'ready') set({ phase: 'transcribing', progress: 0, message: `Transcribing (${m.device})` });
    if (m.type === 'words') {
      const mono = media.mono16k!;
      const words: Word[] = m.words.map((w) => ({
        id: newId('w'),
        ...w,
        // Whisper stretches word ends over pauses; trim to where the sound stops
        end: speechEnd(mono, WHISPER_SAMPLE_RATE, w.start, w.end, media.silence),
        trackId,
        speakerId: project.tracks.find((t) => t.id === trackId)?.speakerId,
        isFiller: isFillerText(w.text),
      }));
      set({ project: { ...project, words: [...project.words, ...words] }, progress: m.progress });
    }
    if (m.type === 'done') set({ phase: 'ready', progress: 1, transcribed: true, message: 'Transcript ready' });
    if (m.type === 'error') set({ phase: 'error', message: `Transcription failed: ${m.message}` });
  };
}

// Autosave: every change to the project (edits, transcript words as they arrive, names) is written
// to IndexedDB shortly after it happens. Undo history is not saved: a reopened project starts fresh.
const SAVE_DELAY_MS = 800;
let pendingSave: ReturnType<typeof setTimeout> | undefined;

useStore.subscribe((s, prev) => {
  if (!s.project || s.saveStatus === 'off') return;
  if (s.project === prev.project && s.transcribed === prev.transcribed && prev.saveStatus !== 'off') return;
  clearTimeout(pendingSave);
  pendingSave = setTimeout(() => void flushSave(), SAVE_DELAY_MS);
});

async function flushSave() {
  if (pendingSave === undefined) return;
  clearTimeout(pendingSave);
  pendingSave = undefined;
  const { project, transcribed, saveStatus } = useStore.getState();
  if (!project || saveStatus === 'off') return;
  useStore.setState({ saveStatus: 'saving' });
  try {
    const now = Date.now();
    await library.saveProject(toSaved(project, transcribed, now));
    // a different project may have opened while this one was writing
    if (useStore.getState().project?.id === project.id) useStore.setState({ saveStatus: 'saved', savedAt: now });
  } catch {
    useStore.setState({ saveStatus: 'error' });
  }
}

// the tab is closing or going to the background: write now instead of waiting for the timer
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushSave());
}
