// App state (Zustand). Heavy audio objects live outside the store in `media`
// so React never diffs or clones them.
import { create } from 'zustand';
import { FRESH_TOUR, readTour, type TourState } from '../engine/tour';
import { channelsOf, decodeFile, probeDuration, toWhisperMono, WHISPER_SAMPLE_RATE } from '../audio/decode';
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
  removeOutputRange,
  sourceSlices,
  PARAGRAPH_PAD,
  shortenPauses as shortenInEdit,
  sourceToOutput,
  type Pause,
} from '../engine/edl';
import { renderEdit, silenceThreshold, snapToQuiet, speechEnd } from '../engine/render';
import { highlightWords } from '../engine/highlights';
import { addPart, removePart, renamePart, spanFromSlices } from '../engine/parts';
import {
  baseName,
  guessKind,
  summarizeRecording,
  toSavedProject,
  toSavedRecording,
  type ProjectSummary,
  type RecordingSummary,
  type SavedRecording,
} from '../engine/save';
import { isSpeech, type HighlightColor, type Part, type Project, type Recording, type RecordingKind, type Segment, type Speaker, type Word } from '../engine/types';
import { clampView, computePeaks, editedPieces, toOutputSpans, paragraphMove, paragraphs, searchHits, zoomAround, type Paragraph, type ZoomView } from '../engine/view';
import type { ExportMessage, ExportRequest } from '../workers/export.worker';
import type { TranscribeMessage, TranscribeRequest } from '../workers/transcribe.worker';
import { ago } from '../ui/time';
import * as library from './library';
import { media } from './media';
import { createMainSlice, mainLength, type MainSlice } from './mainSlice';

/** 'off': this recording is not being saved (storage blocked or full); see `message`. */
export type SaveStatus = 'off' | 'saving' | 'saved' | 'error';

/** A file dropped or chosen, waiting for the "What is this recording?" answer. */
export type PendingFile = { file: File; duration: number; kind: RecordingKind };

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
  /** The project sidebar: full list, or folded to a rail of icons. */
  sidebar: 'open' | 'rail';
  /** Main timeline: dragged clips snap to clip edges and the playhead. */
  snap: boolean;
  /** First-run tour: which sections were shown, or switched off. */
  tour: TourState;
};

const DEFAULT_SETTINGS: Settings = {
  model: 'Xenova/whisper-base.en',
  language: '',
  device: 'wasm',
  theme: 'auto',
  pauseMin: 1,
  pauseKeep: 0.4,
  showOriginal: false,
  sidebar: 'open',
  snap: true,
  tour: FRESH_TOUR,
};
const SETTINGS_KEY = 'yarnit.settings';

// Settings are a per-browser convenience; storage can be missing or blocked, so never rely on it.
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...saved, tour: readTour(saved.tour) };
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
type Snapshot = Pick<Recording, 'segments' | 'words' | 'speakers' | 'highlights' | 'parts'>;
const snapshot = (p: Recording): Snapshot => ({ segments: p.segments, words: p.words, speakers: p.speakers, highlights: p.highlights, parts: p.parts });

/** The right-hand side panel: at most one at a time. */
export type Panel = 'help' | 'highlights' | 'projects' | null;
const HISTORY_LIMIT = 200;
/** Waveform resolution per track (the timeline shows the whole recording). */
const PEAK_BUCKETS = 3000;

export { media };

export type State = MainSlice & {
  /** The open project (null on the start screen). */
  project: Project | null;
  /** Its recordings, in sidebar order. */
  recordings: RecordingSummary[];
  /** The open recording. */
  recording: Recording | null;
  /** Background transcription: which recording, and how far. */
  transcribing: { id: string; stage: 'download' | 'transcribing'; progress: number } | null;
  /** Recordings waiting their turn to be transcribed. */
  queued: string[];
  /** Files waiting for the "What is this recording?" answer. */
  pendingFiles: PendingFile[] | null;
  /** False until the last project has been reopened (or there was none), so the start screen is not a flash. */
  booted: boolean;
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
  /** False while the current recording is still being transcribed. */
  transcribed: boolean;
  saveStatus: SaveStatus;
  savedAt: number;
  /** Saved projects, newest first (the Projects drawer). */
  library: ProjectSummary[];
  /** How the transcript is shown: full text, or one line per paragraph to reorder. */
  view: 'transcript' | 'outline';
  /** Visible part of the edited timeline, or null to fit the whole edit. */
  zoom: ZoomView | null;
  /** Key of the paragraph that just moved, so it can glow where it landed. */
  moved: string | null;
  /** A short message shown for a few seconds (for example after reopening a recording). */
  notice: string;
  /** Music and sound effects: the range dragged on the waveform, in output seconds. */
  waveSel: { start: number; end: number } | null;
  /** The part playing on its own (its pad shows pause). */
  playingPart: string | null;
  /** The part just added, so its pad opens with the name ready to type. */
  freshPart: string | null;
  /** The part whose name is being edited (from a click on it or ⋯ Rename). */
  renamingPart: string | null;

  /** Ask what each file is (opens the add dialog); `confirmAdd` then adds them to the project. */
  addFiles: (files: File[]) => Promise<void>;
  confirmAdd: (items: PendingFile[]) => Promise<void>;
  cancelAdd: () => void;
  newProject: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  renameProject: (name: string) => void;
  deleteProject: (id: string) => Promise<void>;
  openRecording: (id: string) => Promise<void>;
  renameRecording: (id: string, name: string) => Promise<void>;
  /** Change what a recording is; speech kinds get transcribed if they have no transcript yet. */
  setKind: (id: string, kind: RecordingKind) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
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
  setWaveSel: (sel: { start: number; end: number } | null) => void;
  /** Play output seconds start..end, then stop; `partId` marks which pad is playing. */
  playRange: (start: number, end: number, partId?: string) => void;
  playPart: (id: string) => void;
  /** Make a part of the waveform selection. */
  addPartFromSelection: () => void;
  /** Cut the waveform selection out of the edit (speech recordings). */
  deleteWaveSel: () => void;
  /** Show parts while an edge is dragged, without an undo step each frame. */
  previewParts: (parts: Part[]) => void;
  /** Finish a drag: one undo step back to `before`. */
  commitParts: (parts: Part[], before: Part[]) => void;
  renamePart: (id: string, name: string) => void;
  setRenamingPart: (id: string | null) => void;
  deletePart: (id: string) => void;
};

/** Apply an undoable change to the recording and keep the player in sync. */
function commit(set: (p: Partial<State>) => void, get: () => State, change: Partial<Snapshot>, before?: Partial<Snapshot>) {
  const { recording, past } = get();
  if (!recording) return;
  if (change.segments) media.player?.setSegments(change.segments);
  set({ recording: { ...recording, ...change }, past: [...past, { ...snapshot(recording), ...before }].slice(-HISTORY_LIMIT), future: [] });
}

// Transcript and outline compute the same paragraphs from the same arrays; cache the last result.
let parasCache: { words: Word[]; segments: Segment[]; paras: Paragraph[] } | null = null;
export function currentParagraphs(recording: Recording): Paragraph[] {
  if (parasCache?.words !== recording.words || parasCache.segments !== recording.segments)
    parasCache = { words: recording.words, segments: recording.segments, paras: paragraphs(displayWords(recording.words, recording.segments)) };
  return parasCache.paras;
}

/** The slow, side-effect-free part of opening audio: the 16 kHz copy and what is derived from it. */
async function prepareAudio(buffer: AudioBuffer) {
  const mono16k = await toWhisperMono(buffer);
  return { buffer, mono16k, silence: silenceThreshold(mono16k, WHISPER_SAMPLE_RATE), peaks: computePeaks(mono16k, PEAK_BUCKETS) };
}

/** Make prepared audio the open recording's. Synchronous, so it runs only after the last stale-check. */
function attachAudio(audio: Awaited<ReturnType<typeof prepareAudio>>, trackId: string, set: (p: Partial<State>) => void) {
  media.buffers = new Map([[trackId, audio.buffer]]);
  media.mono16k = audio.mono16k;
  media.silence = audio.silence;
  set({ peaks: { [trackId]: audio.peaks } });
  media.player!.setTracks([{ buffer: audio.buffer, offset: 0 }]);
}

/** Stop the previous recording's playback. (Transcription carries on in the background.) */
export function resetSession(set: (p: Partial<State>) => void) {
  media.player?.pause();
  // leaving the main timeline: remember where it was, so sent music lands there
  if (media.mix && useStore.getState().mainOpen) set({ mainPlayhead: media.mix.currentTime });
  media.mix?.pause();
  media.player ??= new Player();
  media.player.onEnded = () => set({ playing: false, playingPart: null });
  return media.player;
}

/** Everything that belongs to one open recording, cleared when another opens. */
export const FRESH = {
  selection: [],
  moved: null,
  zoom: null,
  mainFocus: null,
  past: [],
  future: [],
  clipboard: [],
  peaks: {},
  query: '',
  hitIndex: -1,
  playing: false,
  waveSel: null,
  playingPart: null,
  freshPart: null,
  renamingPart: null,
} satisfies Partial<State>;

const snap = (t: number, lo: number, hi: number) =>
  media.mono16k ? snapToQuiet(media.mono16k, WHISPER_SAMPLE_RATE, t, lo, hi) : t;

export const useStore = create<State>((set, get) => ({
  project: null,
  recordings: [],
  recording: null,
  transcribing: null,
  queued: [],
  pendingFiles: null,
  booted: false,
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
  waveSel: null,
  playingPart: null,
  freshPart: null,
  renamingPart: null,

  async addFiles(files) {
    const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus)$/i.test(f.name));
    if (!audio.length) {
      if (files.length) set({ notice: 'Those are not audio files. Yarnit opens MP3, WAV, M4A and similar.' });
      return;
    }
    const pendingFiles = await Promise.all(
      audio.map(async (file) => {
        const duration = await probeDuration(file);
        return { file, duration, kind: guessKind(duration) };
      }),
    );
    set({ pendingFiles });
  },

  cancelAdd: () => set({ pendingFiles: null }),

  async confirmAdd(items) {
    set({ pendingFiles: null });
    if (!items.length) return;
    if (!get().project) await createProject(set, get, baseName(items[0].file.name));
    const added: string[] = [];
    const speech: string[] = [];
    for (const [i, { file, kind }] of items.entries()) {
      set({ notice: `Adding ${file.name}${items.length > 1 ? ` (${i + 1} of ${items.length})` : ''}` });
      try {
        const buffer = await decodeBlob(file);
        const trackId = newId('t');
        const speaker: Speaker = { id: newId('sp'), name: 'Speaker 1' };
        const recording: Recording = {
          id: newId('r'),
          name: baseName(file.name),
          kind,
          sampleRate: buffer.sampleRate,
          duration: buffer.duration,
          tracks: [{ id: trackId, fileName: file.name, offset: 0, speakerId: speaker.id }],
          speakers: [speaker],
          words: [],
          segments: fullSegments(buffer.duration),
          highlights: [],
          highlightNames: {},
          parts: [],
        };
        // the original file is kept so the recording can be reopened
        await library.saveAudio(trackId, file);
        const saved = toSavedRecording(recording, !isSpeech(kind), Date.now());
        await library.saveRecording(saved);
        const project = get().project!;
        persistProject(set, { ...project, recordingIds: [...project.recordingIds, recording.id] });
        set({ recordings: [...get().recordings, summarizeRecording(saved)] });
        if (isSpeech(kind)) speech.push(recording.id);
        added.push(recording.id);
        // the first one is opened next: hand it the decoded audio so a long file is not decoded twice
        if (added.length === 1) handoff = { trackId, buffer };
      } catch (err) {
        const blocked = (err as Error).name === 'QuotaExceededError' || /storage|quota|IndexedDB/i.test(String(err));
        set({
          notice: blocked
            ? `Could not add ${file.name}: this browser is not letting Yarnit save (private window or full disk).`
            : `Could not add ${file.name}: ${readError(err)}`,
        });
      }
    }
    if (!added.length) return;
    library.requestPersistence();
    await get().openRecording(added[0]);
    handoff = null;
    // queued only now, so the open one is transcribed from the audio already in memory instead of a third decode
    speech.forEach(enqueueOpen);
    set({ notice: added.length > 1 ? `Added ${added.length} recordings` : '' });
  },

  async newProject() {
    await flushSave();
    resetSession(set);
    for (const id of [...get().queued]) dequeue(id);
    leaveMain(set);
    set({ ...FRESH, recording: null, saveStatus: 'off', phase: 'empty', progress: 0, message: '' });
    await createProject(set, get, 'Untitled project');
    await get().refreshLibrary();
  },

  async openProject(id) {
    await flushSave();
    resetSession(set);
    leaveMain(set);
    set({ ...FRESH, recording: null, saveStatus: 'off', phase: 'decoding', progress: 0, message: 'Opening project' });
    try {
      const saved = await library.loadProject(id);
      if (!saved) throw new Error('it was saved by a newer version of Yarnit, or is damaged');
      const { project } = saved;
      const recordings = await library.recordingSummaries(project.recordingIds);
      // only this project's recordings get transcribed in the background
      for (const q of [...get().queued]) if (!project.recordingIds.includes(q)) dequeue(q);
      if (running && !project.recordingIds.includes(running.id)) dequeue(running.id);
      set({ project, recordings });
      for (const r of recordings) if (isSpeech(r.kind) && !r.transcribed) enqueue(r.id);
      const target = recordings.find((r) => r.id === project.lastRecordingId) ?? recordings[0];
      if (project.mainOpen && project.main?.clips.length) await get().openMain();
      else if (target) await get().openRecording(target.id);
      else set({ phase: 'empty', message: '' });
    } catch (err) {
      set({ phase: 'error', message: `Could not open the project: ${(err as Error).message}` });
    }
  },

  renameProject(name) {
    const { project } = get();
    const clean = name.trim();
    if (project && clean && clean !== project.name) persistProject(set, { ...project, name: clean });
  },

  async deleteProject(id) {
    try {
      if (get().project?.id === id) {
        await flushSave();
        resetSession(set);
        for (const r of get().recordings) dequeue(r.id);
        leaveMain(set);
        set({ ...FRESH, project: null, recordings: [], recording: null, saveStatus: 'off', phase: 'empty', progress: 0, message: '' });
      }
      await library.deleteProject(id);
    } catch {
      // the list below shows what is still there
    }
    await get().refreshLibrary();
  },

  async openRecording(id) {
    await flushSave();
    const player = resetSession(set);
    opening = id;
    const name = get().recordings.find((r) => r.id === id)?.name ?? 'recording';
    set({ ...FRESH, recording: null, mainOpen: false, saveStatus: 'off', phase: 'decoding', progress: 0, message: `Opening ${name}` });
    try {
      const saved = await library.loadRecording(id);
      if (!saved) throw new Error('it was saved by a newer version of Yarnit, or is damaged');
      let { recording } = saved;
      const track = recording.tracks[0];
      let decoded = handoff?.trackId === track.id ? handoff.buffer : null;
      handoff = null;
      if (!decoded) {
        const file = await library.loadAudio(track.id);
        if (!file) throw new Error('its audio is missing from browser storage');
        decoded = await decodeFile(player.ctx, file);
      }
      const audio = await prepareAudio(decoded);
      if (opening !== id || get().mainOpen) return; // another recording, or the main timeline, was clicked meanwhile
      attachAudio(audio, track.id, set);
      player.setSegments(recording.segments);
      let restart = false;
      if (running?.id === id) recording = { ...recording, words: running.words };
      else if (!saved.transcribed && isSpeech(recording.kind)) {
        // unfinished transcript: it starts over (edits made meanwhile only touched segments, which stay)
        recording = { ...recording, words: [] };
        restart = true;
      }
      const t = get().transcribing;
      const phase = t?.id === id ? (t.stage === 'download' ? 'downloading' : 'transcribing') : 'ready';
      set({ recording, transcribed: saved.transcribed, saveStatus: 'saving', phase, message: phase === 'ready' ? '' : 'Transcribing' });
      // only once it is the open recording, so the queue uses the audio in memory instead of decoding it again
      if (restart) enqueueOpen(id);
      const project = get().project;
      if (project && (project.lastRecordingId !== id || project.mainOpen)) {
        const { mainOpen: _wasMain, ...rest } = project;
        persistProject(set, { ...rest, lastRecordingId: id });
      }
    } catch (err) {
      set({ phase: 'error', message: `Could not open ${name}: ${readError(err)}` });
    }
  },

  async renameRecording(id, name) {
    const clean = name.trim();
    if (clean) await updateRecording(set, get, id, (r) => ({ ...r, name: clean }));
  },

  async setKind(id, kind) {
    await updateRecording(set, get, id, (r) => ({ ...r, kind }), (saved) => {
      if (!isSpeech(kind)) {
        dequeue(id);
        return true; // nothing to transcribe
      }
      if (saved.transcribed && saved.recording.words.length) return true;
      enqueue(id);
      return false;
    });
  },

  async deleteRecording(id) {
    const { project, recordings, recording } = get();
    const summary = recordings.find((r) => r.id === id);
    if (!project || !summary) return;
    dequeue(id);
    const index = recordings.indexOf(summary);
    const rest = recordings.filter((r) => r.id !== id);
    if (recording?.id === id) {
      clearTimeout(pendingSave);
      pendingSave = undefined;
      resetSession(set);
      set({ ...FRESH, recording: null, saveStatus: 'off', phase: 'empty', progress: 0, message: '' });
    }
    try {
      await library.deleteRecording(summary);
    } catch {
      // still drop it from the project below
    }
    const { lastRecordingId, ...kept } = project;
    // its clips on the main timeline lose their audio, so they go too (and the main undo history, which may hold them)
    const main = project.main && { clips: project.main.clips.filter((c) => c.recordingId !== id) };
    const dropped = !!main && main.clips.length !== project.main!.clips.length;
    for (const t of summary.trackIds) {
      media.mainBuffers.delete(t);
      media.mainPeaks.delete(t);
    }
    persistProject(set, {
      ...kept,
      recordingIds: project.recordingIds.filter((r) => r !== id),
      ...(lastRecordingId !== id ? { lastRecordingId } : {}),
      ...(main ? { main } : {}),
    });
    if (dropped) {
      set({ mainPast: [], mainFuture: [] });
      if (get().mainOpen) get().previewMain(main!);
    }
    set({ recordings: rest });
    const next = rest[Math.min(index, rest.length - 1)];
    if (recording?.id === id && next) await get().openRecording(next.id);
    else if (recording?.id === id && get().project?.main?.clips.length) await get().openMain();
  },

  setSettings(s) {
    const settings = { ...get().settings, ...s };
    saveSettings(settings);
    set({ settings });
  },
  select: (ids) => set(ids.length ? { selection: ids, waveSel: null } : { selection: ids }),

  applyEdit(segments) {
    const { recording } = get();
    if (recording) commit(set, get, { segments });
  },

  deleteSelection() {
    const { recording, selection } = get();
    if (!recording || !selection.length) return;
    get().applyEdit(deleteWords(recording.segments, recording.words, selection, snap));
    set({ selection: [] });
  },

  moveWords(ids, targetId, side) {
    const { recording } = get();
    if (!recording || !ids.length) return;
    get().applyEdit(moveInEdit(recording.segments, recording.words, ids, targetId, side));
  },

  removeFillers() {
    const { recording } = get();
    if (!recording) return;
    const kept = new Set(displayWords(recording.words, recording.segments).filter((d) => !d.deleted).map((d) => d.word.id));
    const ids = recording.words.filter((w) => w.isFiller && kept.has(w.id)).map((w) => w.id);
    if (ids.length) get().applyEdit(deleteWords(recording.segments, recording.words, ids, snap));
  },

  resetTimeline() {
    const { recording } = get();
    if (!recording) return;
    get().applyEdit(fullSegments(recording.duration));
    set({ selection: [], clipboard: [], zoom: null });
  },

  undo() {
    if (get().mainOpen) return get().mainUndo();
    const { recording, past, future } = get();
    const prev = past.at(-1);
    if (!recording || !prev) return;
    media.player?.setSegments(prev.segments);
    set({ recording: { ...recording, ...prev }, past: past.slice(0, -1), future: [snapshot(recording), ...future] });
  },

  redo() {
    if (get().mainOpen) return get().mainRedo();
    const { recording, past, future } = get();
    const next = future[0];
    if (!recording || !next) return;
    media.player?.setSegments(next.segments);
    set({ recording: { ...recording, ...next }, past: [...past, snapshot(recording)], future: future.slice(1) });
  },

  togglePlay() {
    if (get().mainOpen) {
      const mix = media.mix;
      if (!mix) return;
      if (mix.playing) {
        mix.pause();
        set({ playing: false, mainPlayhead: mix.currentTime });
      } else {
        void mix.play();
        set({ playing: true });
      }
      return;
    }
    const p = media.player;
    if (!p) return;
    if (p.playing) p.pause();
    else void p.play();
    set({ playing: !get().playing, playingPart: null });
  },

  seekToWord(w) {
    const { recording } = get();
    if (!recording) return;
    // a snapped cut can clip a word's first few ms, so fall back to its midpoint
    const t =
      sourceToOutput(recording.segments, w.start + 0.001) ?? sourceToOutput(recording.segments, (w.start + w.end) / 2);
    if (t != null) media.player?.seek(t);
  },

  seekSource(t) {
    const { recording } = get();
    if (!recording) return;
    let out = sourceToOutput(recording.segments, t);
    if (out == null) {
      // inside a cut: jump to the start of the next kept segment in source order
      const next = recording.segments.filter((s) => s.start >= t).sort((a, b) => a.start - b.start)[0];
      if (next) out = sourceToOutput(recording.segments, next.start);
    }
    if (out != null) media.player?.seek(out);
  },

  seekOutput(t) {
    media.player?.seek(Math.max(0, t));
    set({ playingPart: null });
  },

  // a waveform selection and a word selection are never both active
  setWaveSel: (waveSel) => set(waveSel ? { waveSel, selection: [] } : { waveSel }),

  playRange(start, end, partId) {
    const p = media.player;
    if (!p || end <= start) return;
    void p.play(start, end);
    set({ playing: true, playingPart: partId ?? null });
  },

  playPart(id) {
    const { recording } = get();
    const part = recording?.parts.find((x) => x.id === id);
    if (!recording || !part) return;
    // parts are source spans: play from where the first kept bit of one plays to where the last ends
    const spans = toOutputSpans(editedPieces(recording.segments), [part]);
    if (!spans.length) return;
    get().playRange(Math.min(...spans.map((x) => x.outStart)), Math.max(...spans.map((x) => x.outEnd)), id);
  },

  addPartFromSelection() {
    const { recording, waveSel } = get();
    if (!recording || !waveSel) return;
    const span = spanFromSlices(sourceSlices(recording.segments, waveSel.start, waveSel.end));
    const added = span && addPart(recording.parts, span.start, span.end, recording.duration);
    if (!added) return;
    commit(set, get, { parts: added.parts });
    set({
      waveSel: null,
      freshPart: added.part.id,
      ...(span.whole ? {} : { notice: 'A part can not cross a moved passage, so it holds the longest piece of the selection.' }),
    });
  },

  deleteWaveSel() {
    const { recording, waveSel } = get();
    if (!recording || !waveSel) return;
    get().applyEdit(removeOutputRange(recording.segments, waveSel.start, waveSel.end));
    set({ waveSel: null });
  },

  previewParts(parts) {
    const { recording } = get();
    if (recording) set({ recording: { ...recording, parts } });
  },

  commitParts(parts, before) {
    if (get().recording) commit(set, get, { parts }, { parts: before });
  },

  renamePart(id, name) {
    const { recording } = get();
    if (!recording) return;
    const parts = renamePart(recording.parts, id, name);
    if (parts !== recording.parts) commit(set, get, { parts });
    set({ freshPart: null, renamingPart: null });
  },

  setRenamingPart(renamingPart) {
    set({ renamingPart });
  },

  deletePart(id) {
    const { recording } = get();
    if (recording) commit(set, get, { parts: removePart(recording.parts, id) });
  },

  setQuery: (query) => set({ query, hitIndex: -1 }),
  setPanel: (panel) => set({ panel }),

  highlightSelection(color) {
    const { selection } = get();
    if (!selection.length) return;
    get().highlightWordIds(selection, color);
    set({ selection: [] });
  },

  highlightWordIds(ids, color) {
    const { recording } = get();
    if (!recording || !ids.length) return;
    commit(set, get, { highlights: highlightWords(recording.highlights, recording.words, ids, color) });
  },

  nameHighlight(color, name) {
    const { recording } = get();
    if (!recording) return;
    const highlightNames = { ...recording.highlightNames, [color]: name.trim() || undefined };
    set({ recording: { ...recording, highlightNames } });
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
    const { recording, settings } = get();
    if (!recording) return;
    const list = pauses ?? findPauses(displayWords(recording.words, recording.segments), recording.segments, settings.pauseMin);
    if (list.length) get().applyEdit(shortenInEdit(recording.segments, list, settings.pauseKeep));
  },

  renameSpeaker(id, name) {
    const { recording } = get();
    const clean = name.trim();
    if (!recording || !clean) return;
    commit(set, get, { speakers: recording.speakers.map((s) => (s.id === id ? { ...s, name: clean } : s)) });
  },

  assignSpeaker(wordIds, speakerId) {
    const { recording } = get();
    if (!recording || !wordIds.length) return;
    let speakers = recording.speakers;
    let id = speakerId;
    if (id === 'new') {
      id = newId('sp');
      speakers = [...speakers, { id, name: `Speaker ${speakers.length + 1}` }];
    }
    const ids = new Set(wordIds);
    const words = recording.words.map((w) => (ids.has(w.id) ? { ...w, speakerId: id } : w));
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
    try {
      await get().refreshLibrary();
      const last = get().library[0];
      if (!last || get().project || get().phase !== 'empty') return;
      await get().openProject(last.id);
      if (get().project?.id === last.id) set({ notice: `Reopened ${last.name}, saved ${ago(last.savedAt, Date.now())}` });
    } finally {
      set({ booted: true });
    }
  },

  setNotice: (notice) => set({ notice }),
  setView: (view) => set({ view }),
  setZoom(zoom) {
    const total = viewLength(get());
    set({ zoom: total ? clampView(zoom, total) : null });
  },
  zoomBy(factor, anchor) {
    const { zoom } = get();
    const total = viewLength(get());
    if (!total) return;
    const v = zoom ?? { start: 0, span: total };
    const head = (get().mainOpen ? media.mix?.currentTime : media.player?.currentTime) ?? 0;
    const at = anchor ?? (head >= v.start && head <= v.start + v.span ? head : v.start + v.span / 2);
    set({ zoom: zoomAround(zoom, total, factor, at) });
  },

  moveParagraph(key, to) {
    const { recording } = get();
    if (!recording) return;
    const paras = currentParagraphs(recording);
    const from = paras.findIndex((p) => p.key === key);
    if (from < 0) return;
    const m = paragraphMove(paras, from, to === 'up' ? from - 1 : to === 'down' ? from + 2 : to);
    if (!m) return;
    get().applyEdit(moveInEdit(recording.segments, recording.words, m.ids, m.targetId, m.side, PARAGRAPH_PAD));
    set({ moved: key });
  },

  selectParagraph(key) {
    const { recording } = get();
    const para = recording && currentParagraphs(recording).find((p) => p.key === key);
    const kept = para?.words.filter((d) => !d.deleted).map((d) => d.word) ?? [];
    if (!kept.length) return;
    set({ selection: kept.map((w) => w.id) });
    get().seekToWord(kept[0]);
  },

  stepHit(dir) {
    const { recording, query, hitIndex } = get();
    if (!recording) return;
    const hits = searchHits(displayWords(recording.words, recording.segments), query);
    if (!hits.length) return;
    const i = (hitIndex + dir + hits.length) % hits.length;
    const first = recording.words.find((w) => w.id === hits[i][0]);
    set({ hitIndex: i, selection: hits[i] });
    if (first) get().seekToWord(first);
  },

  deleteHits() {
    const { recording, query } = get();
    if (!recording) return;
    const ids = searchHits(displayWords(recording.words, recording.segments), query).flat();
    if (ids.length) get().applyEdit(deleteWords(recording.segments, recording.words, ids, snap));
    set({ selection: [], hitIndex: -1 });
  },

  async exportAudio(format) {
    const { recording } = get();
    if (!recording) return;
    set({ phase: 'exporting', progress: 0, message: `Exporting ${format.toUpperCase()}` });
    const tracks = recording.tracks.map((t) => ({ channels: channelsOf(media.buffers.get(t.id)!), offset: t.offset }));
    // names have no extension since 6 Oct, so a dot in one ("Ep. 3") is part of the name
    await runExport(renderEdit(tracks, recording.segments, recording.sampleRate), recording.sampleRate, format, `${recording.name}-edited`);
  },

  ...createMainSlice(set, get, { persistProject, flushSave, resetSession, fresh: FRESH, runExport }),
}));

/** Encode rendered audio in the export worker and download it as `name` plus the format's extension. */
async function runExport(channels: Float32Array[], sampleRate: number, format: 'wav' | 'mp3', name: string) {
  const set = useStore.setState;
  set({ phase: 'exporting', progress: 0, message: `Exporting ${format.toUpperCase()}` });
  const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
  const req: ExportRequest = { channels, sampleRate, format };
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
        download(new Blob([m.data], { type: m.mimeType }), `${name}${m.extension}`);
        set({ phase: 'ready', message: 'Export finished' });
        resolve();
      }
    };
  });
  worker.terminate();
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Close the main timeline (another project opens or none): stop it and drop its audio and history. */
function leaveMain(set: (p: Partial<State>) => void) {
  media.mix?.pause();
  media.mainBuffers.clear();
  media.mainPeaks.clear();
  set({ mainOpen: false, mainPast: [], mainFuture: [], mainClip: null, mainFocus: null, mainPlayhead: 0 });
}

/** Length of what the timeline shows: the open recording's edit, or the main timeline. */
function viewLength(s: State) {
  if (s.mainOpen) return mainLength(s);
  return s.recording ? outputDuration(s.recording.segments) : 0;
}

let resumed = false;
/** The recording an openRecording call is decoding, so a slower earlier call can't win. */
let opening: string | null = null;
/** Audio just decoded by confirmAdd for the recording it opens next. */
let handoff: { trackId: string; buffer: AudioBuffer } | null = null;

/** The browser says "Unable to decode audio data" both for formats it can't read and when it runs out of memory. */
function readError(err: unknown): string {
  const e = err as Error;
  if (e?.name === 'EncodingError' || /decode audio data/i.test(e?.message ?? ''))
    return 'the browser could not read the audio. Very long files (over an hour or so) can need more memory than the browser allows: close other tabs and try again, or split the file. Otherwise the format may not be supported: MP3, WAV and M4A (AAC) work.';
  return e?.message ?? String(err);
}

async function decodeBlob(blob: Blob) {
  media.player ??= new Player();
  return decodeFile(media.player.ctx, blob);
}

export function persistProject(set: (p: Partial<State>) => void, project: Project) {
  set({ project });
  library.saveProject(toSavedProject(project, Date.now())).catch(() => set({ saveStatus: 'error' }));
}

async function createProject(set: (p: Partial<State>) => void, get: () => State, name: string) {
  const project: Project = { id: newId('pj'), name, recordingIds: [] };
  set({ project, recordings: [] });
  await library.saveProject(toSavedProject(project, Date.now())).catch(() => set({ saveStatus: 'error' }));
  void get().refreshLibrary();
}

/**
 * Change a recording whether or not it is open. `after` runs on the saved record and returns
 * whether it now counts as transcribed.
 */
async function updateRecording(
  set: (p: Partial<State>) => void,
  get: () => State,
  id: string,
  change: (r: Recording) => Recording,
  after?: (saved: SavedRecording) => boolean,
) {
  const open = get().recording;
  if (open?.id === id) {
    const recording = change(open);
    const transcribed = after ? after({ version: 0, savedAt: 0, transcribed: get().transcribed, recording }) : get().transcribed;
    // the sidebar shows the change now; autosave writes it a moment later
    set({ recording, transcribed, recordings: get().recordings.map((r) => (r.id === id ? { ...r, name: recording.name, kind: recording.kind, transcribed } : r)) });
    return;
  }
  const saved = await library.loadRecording(id);
  if (!saved) return;
  const recording = change(saved.recording);
  const transcribed = after ? after({ ...saved, recording }) : saved.transcribed;
  const next = toSavedRecording(recording, transcribed, Date.now());
  await library.saveRecording(next).catch(() => set({ saveStatus: 'error' }));
  set({ recordings: get().recordings.map((r) => (r.id === id ? summarizeRecording(next) : r)) });
}

// Background transcription: one recording at a time, in the order they were added. Words go into
// the open recording live; for a recording that isn't open they are kept here and saved at the end.
type Job = { id: string; words: Word[]; worker: Worker | null };
let running: Job | null = null;
const queue: string[] = [];

function enqueue(id: string) {
  if (running?.id === id || queue.includes(id)) return;
  queue.push(id);
  useStore.setState({ queued: [...queue] });
  void pump();
}

/** Queue a recording, and if it is the open one and starts right away, show that in its status line. */
function enqueueOpen(id: string) {
  enqueue(id);
  const { recording, transcribing } = useStore.getState();
  if (recording?.id === id && transcribing?.id === id)
    useStore.setState({ phase: transcribing.stage === 'download' ? 'downloading' : 'transcribing', message: 'Transcribing' });
}

function dequeue(id: string) {
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
  if (running?.id === id) {
    running.worker?.terminate();
    running = null;
    useStore.setState({ transcribing: null });
    void pump();
  }
  useStore.setState({ queued: [...queue] });
}

async function pump() {
  if (running || !queue.length) return;
  const job: Job = { id: queue.shift()!, words: [], worker: null };
  running = job;
  useStore.setState({ queued: [...queue], transcribing: { id: job.id, stage: 'download', progress: 0 } });
  try {
    const st = useStore.getState();
    let recording: Recording;
    let mono: Float32Array;
    let silence: number;
    if (st.recording?.id === job.id && media.mono16k) {
      recording = st.recording;
      mono = media.mono16k;
      silence = media.silence;
    } else {
      const saved = await library.loadRecording(job.id);
      if (!saved || !isSpeech(saved.recording.kind)) return;
      recording = saved.recording;
      const blob = await library.loadAudio(recording.tracks[0].id);
      if (!blob) return;
      mono = await toWhisperMono(await decodeBlob(blob));
      silence = silenceThreshold(mono, WHISPER_SAMPLE_RATE);
    }
    if (running !== job) return; // cancelled while decoding
    await runWorker(job, mono, silence, recording.tracks[0]);
  } catch {
    // a recording that can't be read is skipped; opening it shows the reason
  } finally {
    if (running === job) {
      running = null;
      useStore.setState({ transcribing: null });
    }
    void pump();
  }
}

function runWorker(job: Job, mono: Float32Array, silence: number, track: Recording['tracks'][number]) {
  const set = useStore.setState;
  const get = useStore.getState;
  const isOpen = () => get().recording?.id === job.id;
  const worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' });
  job.worker = worker;
  const { model, language, device } = get().settings;
  const audio = mono.slice(); // copy: the original stays for snapping
  const req: TranscribeRequest = { audio, model, device, ...(language ? { language } : {}) };
  return new Promise<void>((resolve) => {
    const fail = (message: string) => {
      if (isOpen()) set({ phase: 'error', message });
      else set({ notice: message });
      worker.terminate();
      resolve();
    };
    // a worker that fails to load (dev server gone, offline) never posts a message: say so instead of hanging
    worker.onerror = () => fail('Transcription could not start: the speech worker failed to load. Reload the page and try again.');
    worker.onmessage = async (e: MessageEvent<TranscribeMessage>) => {
      const m = e.data;
      if (running !== job) return;
      if (m.type === 'download') {
        set({ transcribing: { id: job.id, stage: 'download', progress: m.progress } });
        if (isOpen()) set({ phase: 'downloading', progress: m.progress, message: 'Loading speech model' });
      }
      if (m.type === 'ready') {
        set({ transcribing: { id: job.id, stage: 'transcribing', progress: 0 } });
        if (isOpen()) set({ phase: 'transcribing', progress: 0, message: `Transcribing (${m.device})` });
      }
      if (m.type === 'words') {
        const words: Word[] = m.words.map((w) => ({
          id: newId('w'),
          ...w,
          // Whisper stretches word ends over pauses; trim to where the sound stops
          end: speechEnd(mono, WHISPER_SAMPLE_RATE, w.start, w.end, silence),
          trackId: track.id,
          speakerId: track.speakerId,
          isFiller: isFillerText(w.text),
        }));
        job.words = [...job.words, ...words];
        set({ transcribing: { id: job.id, stage: 'transcribing', progress: m.progress } });
        const open = get().recording;
        if (open?.id === job.id) set({ recording: { ...open, words: job.words }, progress: m.progress });
      }
      if (m.type === 'done') {
        if (isOpen()) {
          set({ phase: 'ready', progress: 1, transcribed: true, message: 'Transcript ready' });
        } else {
          // not open: write the finished transcript into its saved record (which may hold newer edits)
          const saved = await library.loadRecording(job.id);
          if (saved) {
            const next = toSavedRecording({ ...saved.recording, words: job.words }, true, Date.now());
            await library.saveRecording(next).catch(() => undefined);
            set({ recordings: get().recordings.map((r) => (r.id === job.id ? summarizeRecording(next) : r)) });
          }
        }
        worker.terminate();
        resolve();
      }
      if (m.type === 'error') fail(`Transcription failed: ${m.message}`);
    };
    worker.postMessage(req, [audio.buffer]);
  });
}

// Autosave: every change to the recording (edits, transcript words as they arrive, names) is written
// to IndexedDB shortly after it happens. Undo history is not saved: a reopened recording starts fresh.
const SAVE_DELAY_MS = 800;
let pendingSave: ReturnType<typeof setTimeout> | undefined;

useStore.subscribe((s, prev) => {
  if (!s.recording || s.saveStatus === 'off') return;
  if (s.recording === prev.recording && s.transcribed === prev.transcribed && prev.saveStatus !== 'off') return;
  clearTimeout(pendingSave);
  pendingSave = setTimeout(() => void flushSave(), SAVE_DELAY_MS);
});

export async function flushSave() {
  if (pendingSave === undefined) return;
  clearTimeout(pendingSave);
  pendingSave = undefined;
  const { recording, transcribed, saveStatus } = useStore.getState();
  if (!recording || saveStatus === 'off') return;
  useStore.setState({ saveStatus: 'saving' });
  try {
    const now = Date.now();
    const saved = toSavedRecording(recording, transcribed, now);
    await library.saveRecording(saved);
    const st = useStore.getState();
    useStore.setState({ recordings: st.recordings.map((r) => (r.id === recording.id ? summarizeRecording(saved) : r)) });
    // a different recording may have opened while this one was writing
    if (st.recording?.id === recording.id) useStore.setState({ saveStatus: 'saved', savedAt: now });
  } catch {
    useStore.setState({ saveStatus: 'error' });
  }
}

// the tab is closing or going to the background: write now instead of waiting for the timer
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushSave());
}
