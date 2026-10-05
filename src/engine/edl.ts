// Edit decision list: pure functions over the ordered list of kept segments.
// No audio, no DOM, so everything here is unit tested (edl.test.ts).
import type { Segment, Word } from './types';

/** Spans shorter than this are dropped as noise from float math. */
const MIN_SPAN = 0.001;

let counter = 0;
export const newId = (prefix = 's') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export const fullSegments = (duration: number): Segment[] => [{ id: newId(), start: 0, end: duration }];

export const outputDuration = (segments: Segment[]) =>
  segments.reduce((sum, s) => sum + (s.end - s.start), 0);

/** Drop empty segments and merge neighbours that are contiguous in the source. */
export function normalize(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.end - s.start < MIN_SPAN) continue;
    const prev = out.at(-1);
    if (prev && Math.abs(prev.end - s.start) < MIN_SPAN) {
      out[out.length - 1] = { ...prev, end: s.end };
    } else {
      out.push(s);
    }
  }
  return out;
}

/** Remove a source-time span from every segment, splitting where needed. */
export function removeSpan(segments: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (end <= s.start || start >= s.end) {
      out.push(s);
      continue;
    }
    if (start > s.start) out.push({ id: s.id, start: s.start, end: start });
    if (end < s.end) out.push({ id: newId(), start: end, end: s.end });
  }
  return normalize(out);
}

/** Words sorted by source start time (source order). */
export const sourceOrder = (words: Word[]) => [...words].sort((a, b) => a.start - b.start);

/**
 * Source boundary before word i: halfway into the gap to the previous word,
 * so a cut takes half of each surrounding gap and leaves one natural pause.
 */
function boundaryBefore(sorted: Word[], i: number, snap?: Snap): number {
  const w = sorted[i];
  const prev = sorted[i - 1];
  if (!prev) return 0; // first word: its boundary is the start of the recording
  const t = Math.max(prev.end, (prev.end + w.start) / 2);
  return snap ? snap(t, prev.end - SNAP_SLACK, w.start + SNAP_SLACK) : t;
}

function boundaryAfter(sorted: Word[], i: number, snap?: Snap): number {
  const w = sorted[i];
  const next = sorted[i + 1];
  if (!next) return w.end + TAIL; // last word: reach past the end so trailing silence goes with it
  const t = Math.min(next.start, (w.end + next.start) / 2);
  return snap ? snap(t, w.end - SNAP_SLACK, next.start + SNAP_SLACK) : t;
}

/**
 * Optional cut refinement: given a boundary t and the window [lo, hi] it may move in,
 * return a better cut point (render.ts snapToQuiet). Pure functions stay testable without audio.
 */
export type Snap = (t: number, lo: number, hi: number) => number;
/** Longer than any trailing silence; removeSpan clamps it to the real end. */
const TAIL = 3600;
/** Whisper word edges are only roughly right, so let a snap reach a little past them. */
const SNAP_SLACK = 0.04;

/** Group selected word ids into runs that are contiguous in source order, as source spans. */
export function wordSpans(words: Word[], ids: Iterable<string>, snap?: Snap): [number, number][] {
  const sorted = sourceOrder(words);
  const selected = new Set(ids);
  const spans: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i <= sorted.length; i++) {
    const on = i < sorted.length && selected.has(sorted[i].id);
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      spans.push([boundaryBefore(sorted, runStart, snap), boundaryAfter(sorted, i - 1, snap)]);
      runStart = -1;
    }
  }
  return spans;
}

export function deleteWords(segments: Segment[], words: Word[], ids: Iterable<string>, snap?: Snap): Segment[] {
  return wordSpans(words, ids, snap).reduce((segs, [a, b]) => removeSpan(segs, a, b), segments);
}

/** Split the segment containing source time t into two at t. */
function splitAt(segments: Segment[], t: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (t > s.start + MIN_SPAN && t < s.end - MIN_SPAN) {
      out.push({ id: s.id, start: s.start, end: t }, { id: newId(), start: t, end: s.end });
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Move the selected words to just before (or after) a target word, cut-and-paste style.
 * Returns segments unchanged if the target is inside the selection.
 */
export function moveWords(
  segments: Segment[],
  words: Word[],
  ids: Iterable<string>,
  targetId: string,
  side: 'before' | 'after',
): Segment[] {
  const sel = new Set(ids);
  if (sel.has(targetId) || sel.size === 0) return segments;
  const sorted = sourceOrder(words);
  const ti = sorted.findIndex((w) => w.id === targetId);
  if (ti < 0) return segments;
  const insertAt = side === 'before' ? boundaryBefore(sorted, ti) : boundaryAfter(sorted, ti);

  // 1. Split at every span edge and at the insertion point, so spans map to whole segments.
  const spans = wordSpans(words, sel);
  let segs = splitAt(segments, insertAt);
  for (const [a, b] of spans) segs = splitAt(splitAt(segs, a), b);

  // 2. Pull out the moved pieces (in their current output order).
  const inSpan = (s: Segment) => spans.some(([a, b]) => s.start >= a - MIN_SPAN && s.end <= b + MIN_SPAN);
  const moved = segs.filter(inSpan);
  const rest = segs.filter((s) => !inSpan(s));

  // 3. Insert where the segment ending at insertAt is (or before the one starting there).
  let idx = rest.findIndex((s) => Math.abs(s.end - insertAt) < MIN_SPAN);
  if (idx >= 0) idx += 1;
  else idx = rest.findIndex((s) => Math.abs(s.start - insertAt) < MIN_SPAN);
  // after the last word the boundary lies past the end: insert after the target's segment
  if (idx < 0) {
    const t = sorted[ti].start;
    const host = rest.findIndex((r) => t >= r.start && t < r.end);
    idx = host < 0 ? -1 : host + 1;
  }
  if (idx < 0) return segments; // insertion point was itself deleted
  return normalize([...rest.slice(0, idx), ...moved, ...rest.slice(idx)]);
}

const mid = (w: Word) => (w.start + w.end) / 2;

/** Index of the segment containing a word's midpoint, or -1 if the word is cut. */
export const segmentOf = (segments: Segment[], w: Word) =>
  segments.findIndex((s) => mid(w) >= s.start && mid(w) < s.end);

export type DisplayWord = { word: Word; deleted: boolean };

/**
 * Transcript in playback order. Deleted words stay visible (struck through) right after
 * the segment that precedes them in the source, so the reader sees what was cut and where.
 */
export function displayWords(words: Word[], segments: Segment[]): DisplayWord[] {
  const sorted = sourceOrder(words);
  const kept: Word[][] = segments.map(() => []);
  const cutAfter: Word[][] = segments.map(() => []);
  const cutAtStart: Word[] = [];
  for (const w of sorted) {
    const si = segmentOf(segments, w);
    if (si >= 0) {
      kept[si].push(w);
      continue;
    }
    // anchor = segment with the latest source end at or before this word
    let anchor = -1;
    segments.forEach((s, i) => {
      if (s.end <= mid(w) && (anchor < 0 || s.end > segments[anchor].end)) anchor = i;
    });
    if (anchor < 0) cutAtStart.push(w);
    else cutAfter[anchor].push(w);
  }
  const out: DisplayWord[] = cutAtStart.map((word) => ({ word, deleted: true }));
  segments.forEach((_, i) => {
    for (const word of kept[i]) out.push({ word, deleted: false });
    for (const word of cutAfter[i]) out.push({ word, deleted: true });
  });
  return out;
}

/** Source time -> output (edited) time, or null if that moment was cut. */
export function sourceToOutput(segments: Segment[], t: number): number | null {
  let acc = 0;
  for (const s of segments) {
    if (t >= s.start && t < s.end) return acc + (t - s.start);
    acc += s.end - s.start;
  }
  return null;
}

/** Output (edited) time -> position in the edit list. */
export function outputToSource(segments: Segment[], ot: number): { index: number; source: number } | null {
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const len = s.end - s.start;
    if (ot < acc + len) return { index: i, source: s.start + (ot - acc) };
    acc += len;
  }
  return null;
}

/** Common English fillers. Whisper often omits these; see ARCHITECTURE.md "Known limits". */
export const FILLERS = ['um', 'uh', 'erm', 'er', 'hmm', 'mm', 'ah', 'uhm', 'umm'];

export const isFillerText = (text: string, fillers = FILLERS) =>
  fillers.includes(text.toLowerCase().replace(/[^a-z']/g, ''));
