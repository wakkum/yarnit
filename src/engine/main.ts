// The main timeline: clips copied from recordings, laid out on lanes and mixed. Pure: the player
// (src/audio/mix.ts) and export both use `layout`, `clipEntries` and `fadeGain`, so they agree.
import { deleteWords, displayWords, newId, normalize, outputDuration, outputToSourceAt, sourceSlices, sourceToOutput, type DisplayWord, type Snap } from './edl';
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

/** `ducks`: for a clip with `duck` set, the stretches (clip time) where voice plays under it. */
export type Placed = MainClip & { start: number; length: number; ducks?: [number, number][] };

/** Where every clip sits: speech in running order after its gap, music and effects at `at`. */
export function layout(main: MainTimeline): Placed[] {
  let cursor = 0;
  const placed: Placed[] = main.clips.map((c) => {
    const length = clipLength(c);
    if (!isSpeech(c.kind)) return { ...c, start: Math.max(0, c.at), length };
    const start = cursor + Math.max(0, c.gap);
    cursor = start + length;
    return { ...c, start, length };
  });
  const voice = placed.filter((c) => isSpeech(c.kind)).map((c) => [c.start, c.start + c.length] as [number, number]);
  for (const c of placed) if (c.duck != null && !isSpeech(c.kind)) c.ducks = duckSpans(voice, c.start, c.length);
  return placed;
}

/** How long a keyframe's change takes, centred on it, seconds (less if the stretches are short). */
export const KEY_RAMP = 1;
/** How long music takes to go down before voice, and back up after it, seconds. */
export const DUCK_RAMP = 0.5;
/** Keyframes closer than this to each other or to the clip's ends are refused. */
export const MIN_KEY_GAP = 0.2;

/** S-curve from 0 to 1: starts and ends gently, so a change in volume tapers in and out. */
const ease = (x: number) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, x)))) / 2;

/**
 * Voice stretches under a clip at main time `start`, in clip time. Pauses shorter than both ramps
 * together are bridged, so the music doesn't pump up and down between two sentences.
 */
export function duckSpans(voice: [number, number][], start: number, length: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...voice].sort((x, y) => x[0] - y[0])) {
    const lo = a - start;
    const hi = b - start;
    if (hi <= -DUCK_RAMP || lo >= length + DUCK_RAMP) continue;
    const last = out.at(-1);
    if (last && lo - last[1] < 2 * DUCK_RAMP) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** Keyframe volume at clip time `t`: the stretch's level, eased across each keyframe. */
export function keyLevel(t: number, c: Pick<MainClip, 'keys' | 'levels'> & { length: number }): number {
  const keys = c.keys ?? [];
  const levels = c.levels ?? [];
  if (!keys.length || levels.length !== keys.length + 1) return 1;
  for (let j = 0; j < keys.length; j++) {
    const k = keys[j];
    const r = Math.min(KEY_RAMP, k - (keys[j - 1] ?? 0), (keys[j + 1] ?? c.length) - k);
    if (t < k - r / 2) return levels[j];
    if (t <= k + r / 2) return levels[j] + (levels[j + 1] - levels[j]) * ease((t - (k - r / 2)) / r);
  }
  return levels[keys.length];
}

/** Lower-under-voice factor at clip time `t`: `duck` during voice, easing over DUCK_RAMP either side. */
export function duckLevel(t: number, c: Pick<Placed, 'duck' | 'ducks'>): number {
  if (c.duck == null || !c.ducks?.length) return 1;
  let down = 0; // how far down, 0 to 1
  for (const [a, b] of c.ducks) {
    const d = t < a ? ease(1 - (a - t) / DUCK_RAMP) : t > b ? ease(1 - (t - b) / DUCK_RAMP) : 1;
    down = Math.max(down, d);
  }
  return 1 - down * (1 - c.duck);
}

export const mainDuration = (placed: Placed[]) => placed.reduce((m, c) => Math.max(m, c.start + c.length), 0);

/** Fades never overlap: if they add up to more than the clip, both shrink in proportion. */
export function clampFades(length: number, fadeIn: number, fadeOut: number): [number, number] {
  const a = Math.max(0, fadeIn);
  const b = Math.max(0, fadeOut);
  const k = a + b > length && a + b > 0 ? length / (a + b) : 1;
  return [a * k, b * k];
}

/** The shape a clip's volume follows, without its fades: keyframes times lowering under voice. */
export const envelope = (t: number, c: Pick<Placed, 'length' | 'keys' | 'levels' | 'duck' | 'ducks'>) => keyLevel(t, c) * duckLevel(t, c);

/** True if the volume changes inside the clip (keyframes or lowering under voice), not only at its fades. */
export const hasEnvelope = (c: Pick<Placed, 'keys' | 'duck' | 'ducks'>) => !!c.keys?.length || (c.duck != null && !!c.ducks?.length);

/** Volume at `t` seconds into a clip: gain, keyframes and lowering under voice, times an equal-power fade in and out. */
export function fadeGain(t: number, c: Pick<Placed, 'length' | 'gain' | 'fadeIn' | 'fadeOut' | 'keys' | 'levels' | 'duck' | 'ducks'>): number {
  const [fi, fo] = clampFades(c.length, c.fadeIn, c.fadeOut);
  let g = c.gain * envelope(t, c);
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

/** Shortest piece a cut may leave, seconds. */
export const MIN_CLIP = 0.1;

/**
 * Where a cut at clip time `t` really goes: on a voice clip, never inside a word but in the middle
 * of the nearest gap between two kept words. `after` is the last few words before the cut (for the popup).
 */
export function cutPoint(c: Pick<MainClip, 'kind' | 'segments' | 'words'>, t: number): { t: number; after: string | null } {
  if (!isSpeech(c.kind)) return { t, after: null };
  const kept = displayWords(c.words, c.segments)
    .filter((d) => !d.deleted)
    .map((d) => {
      const m = sourceToOutput(c.segments, mid(d.word)) ?? 0;
      return { text: d.word.text, start: m - (mid(d.word) - d.word.start), end: m + (d.word.end - mid(d.word)) };
    });
  const length = outputDuration(c.segments);
  // every gap between words (and before the first, after the last) as a candidate cut
  const gaps: { t: number; after: string | null }[] = [];
  for (let i = 0; i <= kept.length; i++) {
    const a = i === 0 ? 0 : kept[i - 1].end;
    const b = i === kept.length ? length : kept[i].start;
    gaps.push({ t: i === 0 ? b : i === kept.length ? a : (a + Math.max(a, b)) / 2, after: i === 0 ? null : kept.slice(Math.max(0, i - 3), i).map((k) => k.text).join(' ') });
  }
  const inGap = gaps.find((_, i) => (i === 0 ? 0 : kept[i - 1].end) <= t && t <= (i === kept.length ? length : kept[i].start));
  if (inGap) return { t, after: inGap.after };
  return gaps.reduce((best, g) => (Math.abs(g.t - t) < Math.abs(best.t - t) ? g : best));
}

/**
 * Split a clip at clip time `t` (seconds from its start) into two clips that play back to back: the
 * first keeps the id, the fade in and the place; the second gets the fade out. Null if either piece
 * would be shorter than MIN_CLIP.
 */
export function splitClip(main: MainTimeline, id: string, t: number): { main: MainTimeline; second: string } | null {
  const c = main.clips.find((x) => x.id === id);
  if (!c) return null;
  const length = clipLength(c);
  if (t < MIN_CLIP || t > length - MIN_CLIP) return null;
  const seg = (a: number, b: number) => sourceSlices(c.segments, a, b).map(([s, e]) => ({ id: newId(), start: s, end: e }));
  const first = seg(0, t);
  const rest = seg(t, length);
  // a word belongs to the piece that plays it; a word cut inside the clip stays with the piece before it in the source
  const at = outputToSourceAt(c.segments, t);
  const inFirst = (w: (typeof c.words)[number]) => {
    const m = sourceToOutput(c.segments, mid(w));
    return m == null ? mid(w) < at : m < t;
  };
  const base = c.name.replace(/ \d+$/, '');
  const n = Number(/ (\d+)$/.exec(c.name)?.[1] ?? 1);
  // keyframes go with their piece; both pieces keep the level that was playing at the cut
  const keys = c.keys ?? [];
  const levels = c.levels?.length === keys.length + 1 ? c.levels : keys.map(() => 1).concat(1);
  const nLeft = keys.filter((k) => k < t).length;
  const envA = keys.length ? { keys: keys.slice(0, nLeft), levels: levels.slice(0, nLeft + 1) } : {};
  const right = keys.filter((k) => k > t);
  const envB = keys.length ? { keys: right.map((k) => k - t), levels: levels.slice(keys.length - right.length) } : {};
  const a: MainClip = { ...c, ...envA, name: `${base} ${n}`, segments: first, words: c.words.filter(inFirst), fadeOut: 0 };
  const b: MainClip = {
    ...c,
    id: newId('c'),
    name: `${base} ${n + 1}`,
    segments: rest,
    words: c.words.filter((w) => !inFirst(w)),
    fadeIn: 0,
    gap: 0,
    at: c.at + t,
    ...envB,
  };
  const clips = main.clips.flatMap((x) => (x.id === id ? [a, b] : [x]));
  return { main: { clips }, second: b.id };
}

/** A moment a dragged clip edge can snap to, with what it is (shown on the guide line). */
export type SnapTarget = { t: number; label: string };

/** Every clip edge except the dragged clip's own, plus the start and the playhead. */
export function snapTargets(placed: Placed[], except: string, playhead: number | null): SnapTarget[] {
  const out: SnapTarget[] = [{ t: 0, label: 'the start' }];
  if (playhead != null && playhead > 0) out.push({ t: playhead, label: 'the playhead' });
  for (const c of placed) {
    if (c.id === except) continue;
    out.push({ t: c.start, label: `start of ${c.name}` }, { t: c.start + c.length, label: `end of ${c.name}` });
  }
  return out;
}

/**
 * Premiere-style snapping: if the clip's start or end (at `start`, `length` long) is within `tolerance`
 * of a target, the shift that lines it up exactly, and the target. Nearest wins.
 */
export function snapMove(start: number, length: number, targets: SnapTarget[], tolerance: number): { shift: number; target: SnapTarget } | null {
  let best: { shift: number; target: SnapTarget } | null = null;
  for (const target of targets)
    for (const edge of [start, start + length]) {
      const shift = target.t - edge;
      if (Math.abs(shift) <= tolerance && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, target };
    }
  return best;
}

/** Add a keyframe at clip time `t`; the stretch it splits keeps its level on both sides. Unchanged if too close to another or an end. */
export function addKey(main: MainTimeline, id: string, t: number): MainTimeline {
  const c = main.clips.find((x) => x.id === id);
  if (!c) return main;
  const keys = c.keys ?? [];
  const levels = c.levels?.length === keys.length + 1 ? c.levels : keys.map(() => 1).concat(1);
  if (t < MIN_KEY_GAP || t > clipLength(c) - MIN_KEY_GAP || keys.some((k) => Math.abs(k - t) < MIN_KEY_GAP)) return main;
  const i = keys.filter((k) => k < t).length;
  return updateClip(main, id, { keys: [...keys.slice(0, i), t, ...keys.slice(i)], levels: [...levels.slice(0, i + 1), levels[i], ...levels.slice(i + 1)] });
}

/** Remove keyframe `j`: the stretches either side join, at the level of the one before it. */
export function removeKey(main: MainTimeline, id: string, j: number): MainTimeline {
  const c = main.clips.find((x) => x.id === id);
  const keys = c?.keys ?? [];
  if (!c || j < 0 || j >= keys.length) return main;
  const levels = c.levels ?? [];
  const next = keys.filter((_, i) => i !== j);
  return updateClip(main, id, next.length ? { keys: next, levels: levels.filter((_, i) => i !== j + 1) } : { keys: undefined, levels: undefined });
}

/** Move keyframe `j` to clip time `t`, kept between its neighbours. */
export function moveKey(main: MainTimeline, id: string, j: number, t: number): MainTimeline {
  const c = main.clips.find((x) => x.id === id);
  const keys = c?.keys ?? [];
  if (!c || j < 0 || j >= keys.length) return main;
  const lo = (keys[j - 1] ?? 0) + MIN_KEY_GAP;
  const hi = (keys[j + 1] ?? clipLength(c)) - MIN_KEY_GAP;
  return updateClip(main, id, { keys: keys.map((k, i) => (i === j ? Math.max(lo, Math.min(hi, t)) : k)) });
}

/** Set the volume of stretch `i` (0 to MAX_GAIN, relative to the clip's volume). */
export function setLevel(main: MainTimeline, id: string, i: number, level: number): MainTimeline {
  const c = main.clips.find((x) => x.id === id);
  if (!c?.levels || i < 0 || i >= c.levels.length) return main;
  return updateClip(main, id, { levels: c.levels.map((l, k) => (k === i ? Math.max(0, Math.min(MAX_GAIN, level)) : l)) });
}

/**
 * Drop a voice clip so it starts at main time `start`: it goes into the running order before the
 * first other voice clip whose middle is later (so dragging it left past a clip moves it ahead of
 * that clip), and the space left before it becomes its pause. Dropped into a pause, it fills it;
 * otherwise the clips after it move along.
 */
export function placeSpeech(main: MainTimeline, id: string, start: number): MainTimeline {
  const c = main.clips.find((x) => x.id === id);
  if (!c || !isSpeech(c.kind)) return main;
  const rest = main.clips.filter((x) => x.id !== id);
  const others = layout({ clips: rest }).filter((x) => isSpeech(x.kind));
  const i = others.filter((x) => x.start + x.length / 2 < start).length;
  const prevEnd = i > 0 ? others[i - 1].start + others[i - 1].length : 0;
  const moved = { ...c, gap: Math.max(0, start - prevEnd) };
  // put it back in the array just before the speech clip it now precedes (music keeps its place);
  // dropped into that clip's pause, it uses up the pause, so the clip stays where it was if it can
  const next = others[i];
  const nextGap = next ? Math.max(0, next.start - (start + clipLength(c))) : 0;
  const clips = next ? rest.flatMap((x) => (x.id === next.id ? [moved, { ...x, gap: Math.min(x.gap, nextGap) }] : [x])) : [...rest, moved];
  return { clips };
}
