// App state (Zustand). Heavy audio objects live outside the store in `media`
// so React never diffs or clones them.
import { create } from 'zustand';
import { channelsOf, decodeFile, toWhisperMono, WHISPER_SAMPLE_RATE } from '../audio/decode';
import { Player } from '../audio/player';
import { deleteWords, displayWords, fullSegments, isFillerText, moveWords as moveInEdit, newId, sourceToOutput } from '../engine/edl';
import { renderEdit, silenceThreshold, snapToQuiet, speechEnd } from '../engine/render';
import type { Project, Segment, Word } from '../engine/types';
import { computePeaks, searchHits } from '../engine/view';
import type { ExportMessage, ExportRequest } from '../workers/export.worker';
import type { TranscribeMessage, TranscribeRequest } from '../workers/transcribe.worker';

export type Phase = 'empty' | 'decoding' | 'downloading' | 'transcribing' | 'ready' | 'exporting' | 'error';

export type Settings = {
  model: string;
  /** Whisper language name, or '' for English-only (.en) models. */
  language: string;
  device: 'webgpu' | 'wasm';
};

const DEFAULT_SETTINGS: Settings = { model: 'Xenova/whisper-base.en', language: '', device: 'wasm' };
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
  past: Segment[][];
  future: Segment[][];
  playing: boolean;
  /** Waveform overview per track id. */
  peaks: Record<string, Float32Array>;
  query: string;
  hitIndex: number;
  helpOpen: boolean;

  loadFile: (file: File) => Promise<void>;
  setSettings: (s: Partial<Settings>) => void;
  select: (ids: string[]) => void;
  applyEdit: (segments: Segment[]) => void;
  deleteSelection: () => void;
  moveWords: (ids: string[], targetId: string, side: 'before' | 'after') => void;
  removeFillers: () => void;
  undo: () => void;
  redo: () => void;
  togglePlay: () => void;
  seekToWord: (w: Word) => void;
  /** Seek by source time (timeline click); a cut moment jumps to the next kept audio. */
  seekSource: (t: number) => void;
  setQuery: (q: string) => void;
  /** Step to the next (+1) or previous (-1) search hit: selects and seeks to it. */
  stepHit: (dir: 1 | -1) => void;
  deleteHits: () => void;
  exportAudio: (format: 'wav' | 'mp3') => Promise<void>;
  setHelp: (open: boolean) => void;
};

const snap = (t: number, lo: number, hi: number) =>
  media.mono16k ? snapToQuiet(media.mono16k, WHISPER_SAMPLE_RATE, t, lo, hi) : t;

export const useStore = create<State>((set, get) => ({
  project: null,
  phase: 'empty',
  progress: 0,
  message: '',
  settings: DEFAULT_SETTINGS,
  selection: [],
  past: [],
  future: [],
  playing: false,
  peaks: {},
  query: '',
  hitIndex: -1,
  helpOpen: false,

  async loadFile(file) {
    media.player?.pause();
    media.player ??= new Player();
    const player = media.player;
    player.onEnded = () => set({ playing: false });
    set({ phase: 'decoding', progress: 0, message: `Decoding ${file.name}`, selection: [], past: [], future: [], peaks: {}, query: '', hitIndex: -1 });
    try {
      const buffer = await decodeFile(player.ctx, file);
      const trackId = newId('t');
      media.buffers = new Map([[trackId, buffer]]);
      media.mono16k = await toWhisperMono(buffer);
      media.silence = silenceThreshold(media.mono16k, WHISPER_SAMPLE_RATE);
      set({ peaks: { [trackId]: computePeaks(media.mono16k, PEAK_BUCKETS) } });
      const project: Project = {
        id: newId('p'),
        name: file.name,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        tracks: [{ id: trackId, fileName: file.name, offset: 0 }],
        speakers: [],
        words: [],
        segments: fullSegments(buffer.duration),
      };
      player.setTracks([{ buffer, offset: 0 }]);
      player.setSegments(project.segments);
      set({ project, phase: 'downloading', message: 'Loading speech model' });
      transcribe(trackId, set, get);
    } catch (err) {
      set({ phase: 'error', message: `Could not open file: ${(err as Error).message}` });
    }
  },

  setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
  select: (ids) => set({ selection: ids }),

  applyEdit(segments) {
    const { project, past } = get();
    if (!project) return;
    media.player?.setSegments(segments);
    set({
      project: { ...project, segments },
      past: [...past, project.segments].slice(-HISTORY_LIMIT),
      future: [],
    });
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

  undo() {
    const { project, past, future } = get();
    const prev = past.at(-1);
    if (!project || !prev) return;
    media.player?.setSegments(prev);
    set({ project: { ...project, segments: prev }, past: past.slice(0, -1), future: [project.segments, ...future] });
  },

  redo() {
    const { project, past, future } = get();
    const next = future[0];
    if (!project || !next) return;
    media.player?.setSegments(next);
    set({ project: { ...project, segments: next }, past: [...past, project.segments], future: future.slice(1) });
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

  setQuery: (query) => set({ query, hitIndex: -1 }),
  setHelp: (helpOpen) => set({ helpOpen }),

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

function transcribe(trackId: string, set: (p: Partial<State>) => void, get: () => State) {
  worker?.terminate();
  worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' });
  const { model, language, device } = get().settings;
  const audio = media.mono16k!.slice(); // copy: we keep the original for snapping
  const req: TranscribeRequest = { audio, model, device, ...(language ? { language } : {}) };
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
        isFiller: isFillerText(w.text),
      }));
      set({ project: { ...project, words: [...project.words, ...words] }, progress: m.progress });
    }
    if (m.type === 'done') set({ phase: 'ready', progress: 1, message: 'Transcript ready' });
    if (m.type === 'error') set({ phase: 'error', message: `Transcription failed: ${m.message}` });
  };
}
