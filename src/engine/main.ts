// The main timeline: clips copied from recordings, laid out on lanes and mixed. Pure: the player
// (src/audio/mix.ts) and export both use `layout`, `clipEntries` and `fadeGain`, so they agree.
import { deleteWords, displayWords, newId, normalize, outputDuration, sourceSlices, sourceToOutput, type DisplayWord, type Snap } from './edl';
import { FADE_SECONDS } from './render';
import { isSpeech, type MainClip, type MainTimeline, type Recording, type Segment } from './types';

export const EMPTY_MAIN: MainTimeline = { clips: [] };
/** Room left around sent words so they don't start or end abruptly, at most half the gap to a neighbour. */
export const SEND_PAD = 0.25;
/** Longest fade the controls offer, seconds. */
export const MAX_FADE = 10;
/** Loudest a clip can be turned up (1 = as recorded). */
export const MAX_GAIN = 2;

export const clipLength = (c: Pick<MainClip, 'segments'>) => outputDuration(c.segments);

export type Placed = MainClip & { start: number; length: number };

/** Where every clip sits: speech in running order after its gap, music and effects at `at`. */
export function layout(main: MainTimeline): Placed[] {
  let cursor = 0;
  return main.clips.map((c) => {
    const length = clipLength(c);
    if (!isSpeech(c.kind)) return { ...c, start: Math.max(0, c.at), length };
    const start = cursor + Math.max(0, c.gap);
    cursor = start + length;
    return { ...c, start, length };
  });
}

export const mainDuration = (placed: Placed[]) => placed.reduce((m, c) => Math.max(m, c.start + c.length), 0);

/** Fades never overlap: if they add up to more than the clip, both shrink in proportion. */
export function clampFades(length: number, fadeIn: number, fadeOut: number): [number, number] {
  const a = Math.max(0, fadeIn);
  const b = Math.max(0, fadeOut);
  const k = a + b > length && a + b > 0 ? length / (a + b) : 1;
  return [a * k, b * k];
}

/** Volume envelope at `t` seconds into a clip: its gain times an equal-power fade in and out. */
export function fadeGain(t: number, c: Pick<Placed, 'length' | 'gain' | 'fadeIn' | 'fadeOut'>): number {
  const [fi, fo] = clampFades(c.length, c.fadeIn, c.fadeOut);
  let g = c.gain;
  if (fi > 0 && t < fi) g *= Math.sin((Math.max(0, t) / fi) * (Math.PI / 2));
  if (fo > 0 && t > c.length - fo) g *= Math.sin((Math.max(0, c.length - t) / fo) * (Math.PI / 2));
  return g;
}

/** One stretch of source audio to play: `dur` seconds from `from` in track `trackId`, at main time `at`. */
export type Entry = { clipId: string; trackId: string; at: number; from: number; dur: number };

/** Every stretch of audio on the main timeline, by start time. */
export function clipEntries(placed: Placed[]): Entry[] {
  const out: Entry[] = [];
  for (const c of placed) {
    let at = c.start;
    for (const s of c.segments) {
      out.push({ clipId: c.id, trackId: c.trackId, at, from: s.start, dur: s.end - s.start });
      at += s.end - s.start;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Mix the main timeline. `audio` holds each track's channels at `sampleRate`. Every stretch gets the
 * seam fade (no clicks where a cut or clip starts) and its clip's volume envelope.
 */
export function renderMix(main: MainTimeline, audio: Map<string, Float32Array[]>, sampleRate: number, fadeSeconds = FADE_SECONDS): Float32Array[] {
  const placed = layout(main);
  const numChannels = Math.max(1, ...placed.map((c) => audio.get(c.trackId)?.length ?? 1));
  const total = Math.round(mainDuration(placed) * sampleRate);
  const out = Array.from({ length: numChannels }, () => new Float32Array(total));
  const byId = new Map(placed.map((c) => [c.id, c]));
  for (const e of clipEntries(placed)) {
    const c = byId.get(e.clipId)!;
    const src = audio.get(e.trackId);
    if (!src) continue;
    const dst0 = Math.round(e.at * sampleRate);
    const src0 = Math.round(e.from * sampleRate);
    const len = Math.min(Math.round(e.dur * sampleRate), total - dst0);
    const edge = Math.min(Math.round(fadeSeconds * sampleRate), Math.floor(len / 2));
    for (let i = 0; i < len; i++) {
      if (src0 + i < 0 || src0 + i >= src[0].length) continue;
      let g = fadeGain((dst0 + i) / sampleRate - c.start, c);
      if (i < edge) g *= Math.sin((i / edge) * (Math.PI / 2));
      if (len - 1 - i < edge) g *= Math.sin(((len - 1 - i) / edge) * (Math.PI / 2));
      if (g === 0) continue;
      for (let ch = 0; ch < numChannels; ch++) out[ch][dst0 + i] += src[Math.min(ch, src.length - 1)][src0 + i] * g;
    }
  }
  return out;
}

// ---- sending: copies made from a recording ----

const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;

/**
 * Source spans for some kept words, as they play: each run of consecutive kept words (playback order)
 * from its first word's start to its last word's end, padded by up to SEND_PAD but never past half
 * the gap to the neighbouring kept word.
 */
export function wordsToSegments(display: DisplayWord[], segments: Segment[], ids: Iterable<string>): Segment[] {
  const want = new Set(ids);
  const kept = display.filter((d) => !d.deleted).map((d) => d.word);
  const outStart = (w: (typeof kept)[number]) => (sourceToOutput(segments, mid(w)) ?? 0) - (mid(w) - w.start);
  const outEnd = (w: (typeof kept)[number]) => (sourceToOutput(segments, mid(w)) ?? 0) + (w.end - mid(w));
  const total = outputDuration(segments);
  const out: Segment[] = [];
  for (let i = 0; i < kept.length; i++) {
    if (!want.has(kept[i].id)) continue;
    let j = i;
    while (j + 1 < kept.length && want.has(kept[j + 1].id)) j++;
    const a = outStart(kept[i]);
    const b = outEnd(kept[j]);
    const before = i > 0 ? (a - outEnd(kept[i - 1])) / 2 : a;
    const after = j < kept.length - 1 ? (outStart(kept[j + 1]) - b) / 2 : total - b;
    const from = Math.max(0, a - Math.max(0, Math.min(SEND_PAD, before)));
    const to = Math.min(total, b + Math.max(0, Math.min(SEND_PAD, after)));
    for (const [s, e] of sourceSlices(segments, from, to)) out.push({ id: newId(), start: s, end: e });
    i = j;
  }
  return normalize(out);
}

/** Source spans of a part as they play in the recording's edit (music is never cut, so it is the part itself). */
export function partSegments(recording: Recording, part: { start: number; end: number }): Segment[] {
  const out: Segment[] = [];
  for (const s of recording.segments) {
    const lo = Math.max(s.start, part.start);
    const hi = Math.min(s.end, part.end);
    if (hi > lo) out.push({ id: newId(), start: lo, end: hi });
  }
  return normalize(out);
}

/** A clip copied from `recording` playing `segments`: words inside them are copied with new ids. */
export function makeClip(recording: Recording, segments: Segment[], name: string, at = 0): MainClip {
  const words = isSpeech(recording.kind)
    ? displayWords(recording.words, segments)
        .filter((d) => !d.deleted)
        .map((d) => ({ ...d.word, id: newId('w') }))
    : [];
  return {
    id: newId('c'),
    name,
    kind: recording.kind,
    recordingId: recording.id,
    trackId: recording.tracks[0].id,
    segments: segments.map((s) => ({ ...s, id: newId() })),
    words,
    speakers: recording.speakers.map((s) => ({ ...s })),
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    gap: 0,
    at: Math.max(0, at),
  };
}

/** Add clips: speech joins the end of the running order, music and effects keep their `at`. */
export const addClips = (main: MainTimeline, clips: MainClip[]): MainTimeline => ({ clips: [...main.clips, ...clips] });

export const updateClip = (main: MainTimeline, id: string, patch: Partial<MainClip>): MainTimeline => ({
  clips: main.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
});

export const removeClips = (main: MainTimeline, ids: Iterable<string>): MainTimeline => {
  const gone = new Set(ids);
  return { clips: main.clips.filter((c) => !gone.has(c.id)) };
};

/** Move a speech clip one place earlier (-1) or later (+1) in the running order. */
export function moveSpeechClip(main: MainTimeline, id: string, dir: -1 | 1): MainTimeline {
  const speech = main.clips.filter((c) => isSpeech(c.kind));
  const i = speech.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= speech.length) return main;
  [speech[i], speech[j]] = [speech[j], speech[i]];
  let k = 0;
  return { clips: main.clips.map((c) => (isSpeech(c.kind) ? speech[k++] : c)) };
}

/** Cut words out of the clips holding them; a clip with nothing left is removed. */
export function deleteClipWords(main: MainTimeline, ids: Iterable<string>, snap?: (clip: MainClip) => Snap | undefined): MainTimeline {
  const want = new Set(ids);
  const clips: MainClip[] = [];
  for (const c of main.clips) {
    const mine = c.words.filter((w) => want.has(w.id)).map((w) => w.id);
    if (!mine.length) {
      clips.push(c);
      continue;
    }
    const segments = deleteWords(c.segments, c.words, mine, snap?.(c));
    if (outputDuration(segments) > 0.01) clips.push({ ...c, segments });
  }
  return { clips };
}

/** Main-timeline time of every kept word's start, for seeking and the current word. */
export function wordTimes(placed: Placed[]): { id: string; clipId: string; at: number; end: number }[] {
  const out: { id: string; clipId: string; at: number; end: number }[] = [];
  for (const c of placed) {
    if (!isSpeech(c.kind)) continue;
    for (const d of displayWords(c.words, c.segments)) {
      if (d.deleted) continue;
      const m = sourceToOutput(c.segments, mid(d.word));
      if (m == null) continue;
      out.push({ id: d.word.id, clipId: c.id, at: c.start + m - (mid(d.word) - d.word.start), end: c.start + m + (d.word.end - mid(d.word)) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
