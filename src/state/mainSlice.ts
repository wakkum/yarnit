// The main timeline's part of the store (mockups/main-a-lanes.html, one lane per kind, picked
// 7 Oct 2026): opening it, sending clips to it from a recording, editing clips, its own undo, export.
// The timeline itself lives in the project (`project.main`) and is saved with it on every change.
import { MixPlayer } from '../audio/mix';
import { Player } from '../audio/player';
import { decodeFile } from '../audio/decode';
import { displayWords } from '../engine/edl';
import { passages, wordColors } from '../engine/highlights';
import {
  addClips,
  clipLength,
  cutPoint,
  deleteClipWords,
  EMPTY_MAIN,
  layout,
  mainDuration,
  makeClip,
  moveSpeechClip,
  partSegments,
  removeClips,
  renderMix,
  splitClip,
  updateClip,
  wordsToSegments,
  type Placed,
} from '../engine/main';
import { snapToQuiet } from '../engine/render';
import { isSpeech, type HighlightColor, type MainClip, type MainTimeline } from '../engine/types';
import { computePeaks } from '../engine/view';
import * as library from './library';
import { media } from './media';
import type { State } from './store';

const HISTORY_LIMIT = 200;
const PEAK_BUCKETS = 3000;

/** What to send from the open recording. */
export type SendWhat = { type: 'all' } | { type: 'selection' } | { type: 'colors'; colors: HighlightColor[] } | { type: 'part'; id: string } | { type: 'parts' };

export type MainSlice = {
  /** The main timeline is open (instead of a recording). */
  mainOpen: boolean;
  mainPast: MainTimeline[];
  mainFuture: MainTimeline[];
  /** The selected clip; its volume and fades show under the lanes. */
  mainClip: string | null;
  /** Where sent music and effects land: the main timeline's playhead when it was last open. */
  mainPlayhead: number;
  openMain: () => Promise<void>;
  sendToMain: (what: SendWhat) => void;
  /** Show a change while dragging, without saving or an undo step. */
  previewMain: (main: MainTimeline) => void;
  /** One undoable, saved change; `before` is the state to undo to (for drags that previewed). */
  commitMain: (main: MainTimeline, before?: MainTimeline) => void;
  updateClip: (id: string, patch: Partial<MainClip>) => void;
  moveClip: (id: string, dir: -1 | 1) => void;
  removeClip: (id: string) => void;
  /** Split a clip in two at main-timeline time `t` (a voice clip: in the nearest gap between words). */
  cutClip: (id: string, t: number) => void;
  /** The main timeline's playhead, live while playing. */
  mainTime: () => number;
  selectClip: (id: string | null) => void;
  playClip: (id: string) => void;
  seekMain: (t: number) => void;
  deleteMainSelection: () => void;
  mainUndo: () => void;
  mainRedo: () => void;
  exportMain: (format: 'wav' | 'mp3') => Promise<void>;
};

type Helpers = {
  persistProject: (set: (p: Partial<State>) => void, project: NonNullable<State['project']>) => void;
  flushSave: () => Promise<void>;
  resetSession: (set: (p: Partial<State>) => void) => Player;
  fresh: Partial<State>;
  runExport: (channels: Float32Array[], sampleRate: number, format: 'wav' | 'mp3', name: string) => Promise<void>;
};

export const mainOf = (s: Pick<State, 'project'>) => s.project?.main ?? EMPTY_MAIN;

/** The mix player, created on first use on the recording player's AudioContext. */
function mixPlayer(set: (p: Partial<State>) => void) {
  media.player ??= new Player();
  if (!media.mix) {
    media.mix = new MixPlayer(media.player.ctx);
    media.mix.onEnded = () => set({ playing: false });
  }
  return media.mix;
}

/** Decode the audio of every clip that isn't loaded yet; returns the track ids that are missing. */
async function loadClipAudio(main: MainTimeline, set: (p: Partial<State>) => void, get: () => State) {
  const missing: string[] = [];
  const ctx = (media.player ??= new Player()).ctx;
  const peaks = { ...get().peaks };
  for (const id of new Set(main.clips.map((c) => c.trackId))) {
    if (!media.mainBuffers.has(id)) {
      const blob = await library.loadAudio(id).catch(() => undefined);
      if (!blob) {
        missing.push(id);
        continue;
      }
      media.mainBuffers.set(id, await decodeFile(ctx, blob));
    }
    // opening a recording clears `peaks`, so they come back from the cache each time
    if (!media.mainPeaks.has(id)) media.mainPeaks.set(id, computePeaks(media.mainBuffers.get(id)!.getChannelData(0), PEAK_BUCKETS));
    peaks[id] = media.mainPeaks.get(id)!;
  }
  set({ peaks });
  return missing;
}

/** Snapping cuts to quiet moments uses the clip's own audio at the context's rate. */
function snapFor(c: MainClip) {
  const b = media.mainBuffers.get(c.trackId);
  if (!b) return undefined;
  const ch = b.getChannelData(0);
  return (t: number, lo: number, hi: number) => snapToQuiet(ch, b.sampleRate, t, lo, hi);
}

let openingMain = 0;

export function createMainSlice(set: (p: Partial<State>) => void, get: () => State, h: Helpers): MainSlice {
  /** Put a new timeline in place: state, player, and (unless previewing) the saved project. */
  const apply = (main: MainTimeline, save: boolean) => {
    const project = get().project;
    if (!project) return;
    const next = { ...project, main };
    if (save) h.persistProject(set, next);
    else set({ project: next });
    if (get().mainOpen) mixPlayer(set).set(layout(main), media.mainBuffers);
  };

  return {
    mainOpen: false,
    mainPast: [],
    mainFuture: [],
    mainClip: null,
    mainPlayhead: 0,

    async openMain() {
      const project = get().project;
      if (!project) return;
      await h.flushSave();
      h.resetSession(set);
      const token = ++openingMain;
      set({ ...h.fresh, recording: null, mainOpen: true, mainClip: null, saveStatus: 'off', phase: 'decoding', progress: 0, message: 'Opening the main timeline' });
      if (!project.mainOpen) h.persistProject(set, { ...project, mainOpen: true });
      const main = mainOf(get());
      try {
        const missing = await loadClipAudio(main, set, get);
        if (token !== openingMain || !get().mainOpen) return;
        const mix = mixPlayer(set);
        mix.set(layout(main), media.mainBuffers);
        mix.seek(get().mainPlayhead);
        set({
          phase: 'ready',
          message: '',
          ...(missing.length ? { notice: `The audio of ${missing.length} clip source${missing.length === 1 ? ' is' : 's are'} missing from browser storage; those clips stay silent.` } : {}),
        });
      } catch (err) {
        if (token === openingMain) set({ phase: 'error', message: `Could not open the main timeline: ${(err as Error).message}` });
      }
    },

    sendToMain(what) {
      const { recording, selection } = get();
      if (!recording || !get().project) return;
      if (isSpeech(recording.kind) && !get().transcribed) {
        set({ notice: 'Wait for the transcript to finish before sending: the clip takes its words along.' });
        return;
      }
      const display = displayWords(recording.words, recording.segments);
      const at = isSpeech(recording.kind) ? 0 : get().mainPlayhead;
      let clips: MainClip[] = [];
      if (what.type === 'all') clips = [makeClip(recording, recording.segments, recording.name, at)];
      else if (what.type === 'selection' && selection.length) {
        const segs = wordsToSegments(display, recording.segments, selection);
        const words = display.filter((d) => !d.deleted && selection.includes(d.word.id)).map((d) => d.word.text);
        if (segs.length) clips = [makeClip(recording, segs, `${recording.name}: ${words.slice(0, 4).join(' ')}${words.length > 4 ? '…' : ''}`, at)];
      } else if (what.type === 'colors') {
        // passages in transcript order, numbered within their colour
        const label = (c: HighlightColor) => recording.highlightNames[c] || c[0].toUpperCase() + c.slice(1);
        const list = passages(display, recording.segments, wordColors(recording.words, recording.highlights)).filter((p) => what.colors.includes(p.color));
        const total = (c: HighlightColor) => list.filter((p) => p.color === c).length;
        const seen = new Map<HighlightColor, number>();
        clips = list
          .map((p) => {
            const n = (seen.get(p.color) ?? 0) + 1;
            seen.set(p.color, n);
            return makeClip(recording, wordsToSegments(display, recording.segments, p.wordIds), `${label(p.color)}${total(p.color) > 1 ? ` ${n}` : ''}`, at);
          })
          .filter((c) => c.segments.length);
      } else if (what.type === 'part') {
        const part = recording.parts.find((p) => p.id === what.id);
        const segs = part ? partSegments(recording, part) : [];
        if (part && segs.length) clips = [makeClip(recording, segs, part.name, at)];
      } else if (what.type === 'parts') {
        // every part in start order; music and effects line up one after another from the playhead
        let t = at;
        for (const part of recording.parts) {
          const segs = partSegments(recording, part);
          if (!segs.length) continue;
          const clip = makeClip(recording, segs, part.name, t);
          clips.push(clip);
          t += clipLength(clip);
        }
      }
      if (!clips.length) {
        set({ notice: 'Nothing to send: that is all cut from the edit.' });
        return;
      }
      get().commitMain(addClips(mainOf(get()), clips));
      const what2 = clips.length === 1 ? clips[0].name : `${clips.length} clips`;
      set({ notice: `Sent ${what2} to the main timeline${isSpeech(recording.kind) ? '' : ` at ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`}` });
    },

    previewMain: (main) => apply(main, false),

    commitMain(main, before) {
      const prev = before ?? mainOf(get());
      if (main === prev) return;
      set({ mainPast: [...get().mainPast, prev].slice(-HISTORY_LIMIT), mainFuture: [] });
      apply(main, true);
    },

    updateClip(id, patch) {
      get().commitMain(updateClip(mainOf(get()), id, patch));
    },

    moveClip(id, dir) {
      const main = mainOf(get());
      const next = moveSpeechClip(main, id, dir);
      if (next !== main) get().commitMain(next);
    },

    removeClip(id) {
      get().commitMain(removeClips(mainOf(get()), [id]));
      if (get().mainClip === id) set({ mainClip: null });
    },

    selectClip: (mainClip) => set({ mainClip }),

    cutClip(id, t) {
      const main = mainOf(get());
      const c = layout(main).find((x) => x.id === id);
      if (!c) return;
      const r = splitClip(main, id, cutPoint(c, t - c.start).t);
      if (!r) {
        set({ notice: 'Too close to the edge of the clip to cut there.' });
        return;
      }
      get().commitMain(r.main);
      set({ mainClip: id });
    },

    mainTime: () => (media.mix ? media.mix.currentTime : get().mainPlayhead),

    playClip(id) {
      const c = layout(mainOf(get())).find((x) => x.id === id);
      if (!c) return;
      void mixPlayer(set).play(c.start, c.start + c.length);
      set({ playing: true });
    },

    seekMain(t) {
      mixPlayer(set).seek(t);
      set({ mainPlayhead: Math.max(0, t) });
    },

    deleteMainSelection() {
      const { selection } = get();
      if (!selection.length) return;
      get().commitMain(deleteClipWords(mainOf(get()), selection, snapFor));
      set({ selection: [] });
    },

    mainUndo() {
      const { mainPast, mainFuture } = get();
      const prev = mainPast.at(-1);
      if (!prev) return;
      set({ mainPast: mainPast.slice(0, -1), mainFuture: [mainOf(get()), ...mainFuture] });
      apply(prev, true);
    },

    mainRedo() {
      const { mainPast, mainFuture } = get();
      const next = mainFuture[0];
      if (!next) return;
      set({ mainPast: [...mainPast, mainOf(get())], mainFuture: mainFuture.slice(1) });
      apply(next, true);
    },

    async exportMain(format) {
      const main = mainOf(get());
      if (!main.clips.length) return;
      const audio = new Map<string, Float32Array[]>();
      for (const [id, b] of media.mainBuffers) audio.set(id, Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)));
      const rate = media.player?.ctx.sampleRate ?? 48_000;
      await h.runExport(renderMix(main, audio, rate), rate, format, get().project?.name ?? 'Main timeline');
    },
  };
}

/** Clips as laid out right now (for the UI). */
export const placedOf = (s: Pick<State, 'project'>): Placed[] => layout(mainOf(s));
export const mainLength = (s: Pick<State, 'project'>) => mainDuration(placedOf(s));
