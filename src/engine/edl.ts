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

/**
 * Remove output (edited) seconds a..b, as selected on the edited waveform. The range can cross seams,
 * so each segment loses the slice of it that plays inside the range.
 */
export function removeOutputRange(segments: Segment[], a: number, b: number): Segment[] {
  const out: Segment[] = [];
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    const from = Math.max(0, a - acc);
    const to = Math.min(len, b - acc);
    acc += len;
    if (to <= from) {
      out.push(s);
      continue;
    }
    if (from > 0) out.push({ id: s.id, start: s.start, end: s.start + from });
    if (to < len) out.push({ id: from > 0 ? newId() : s.id, start: s.start + to, end: s.end });
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

/**
 * How much silence a moved passage takes along on each side. A delete takes half of each
 * surrounding gap, but a move would carry half of a long pause to its new place as dead air.
 */
export const MOVE_PAD = 0.25;
/** Paragraph moves keep more: the pause between paragraphs should travel with them. */
export const PARAGRAPH_PAD = 0.75;

/**
 * Group selected word ids into runs that are contiguous in source order, as source spans.
 * `pad` caps how far a span reaches past its first and last word (default: half the gap).
 */
export function wordSpans(words: Word[], ids: Iterable<string>, snap?: Snap, pad = Infinity): [number, number][] {
  const sorted = sourceOrder(words);
  const selected = new Set(ids);
  const spans: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i <= sorted.length; i++) {
    const on = i < sorted.length && selected.has(sorted[i].id);
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      const first = sorted[runStart];
      const last = sorted[i - 1];
      spans.push([
        Math.max(boundaryBefore(sorted, runStart, snap), first.start - pad),
        Math.min(boundaryAfter(sorted, i - 1, snap), last.end + pad),
      ]);
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
  pad = MOVE_PAD,
): Segment[] {
  const sel = new Set(ids);
  if (sel.has(targetId) || sel.size === 0) return segments;
  const sorted = sourceOrder(words);
  const ti = sorted.findIndex((w) => w.id === targetId);
  if (ti < 0) return segments;
  // After earlier cuts and moves, the audio beside a word may be gone or play elsewhere, so every
  // edge is kept inside the segment that holds its word (else a move could do nothing, or drag
  // a stray piece of another passage along).
  const host = (w: Word) => segments[segmentOf(segments, w)];
  const target = sorted[ti];
  const th = host(target);
  if (!th) return segments; // the target word is itself cut
  // land right next to the target word, not halfway into a long pause beside it
  const insertAt =
    side === 'before'
      ? Math.max(boundaryBefore(sorted, ti), target.start - pad, th.start)
      : Math.min(boundaryAfter(sorted, ti), target.end + pad, th.end);

  // 1. Split at every span edge and at the insertion point, so spans map to whole segments.
  // the rest of a long pause stays where it was (and still shows as a pause chip there)
  const spans = wordSpans(words, sel, undefined, pad).map(([a, b]): [number, number] => {
    const first = sorted.find((w) => sel.has(w.id) && w.start >= a);
    const last = [...sorted].reverse().find((w) => sel.has(w.id) && w.end <= b);
    const fh = first && host(first);
    const lh = last && host(last);
    return [fh ? Math.max(a, fh.start) : a, lh ? Math.min(b, lh.end) : b];
  });
  let segs = splitAt(segments, insertAt);
  for (const [a, b] of spans) segs = splitAt(splitAt(segs, a), b);

  // 2. Pull out the moved pieces (in their current output order).
  const inSpan = (s: Segment) => spans.some(([a, b]) => s.start >= a - MIN_SPAN && s.end <= b + MIN_SPAN);
  const moved = segs.filter(inSpan);
  const rest = segs.filter((s) => !inSpan(s));

  // 3. Insert next to the piece that now holds the target word. (Matching "the segment that ends at
  // insertAt" instead picks the wrong one when a leftover piece elsewhere happens to end there too.)
  const tm = (target.start + target.end) / 2;
  let idx = rest.findIndex((r) => tm >= r.start && tm < r.end);
  if (idx < 0) return segments;
  if (side === 'after') idx += 1;
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

/** Output time -> source time, where the very end of the edit maps to the end of the last segment. */
export function outputToSourceAt(segments: Segment[], ot: number): number {
  const at = outputToSource(segments, ot);
  if (at) return at.source;
  return segments.at(-1)?.end ?? ot;
}

/** The source slices that play during output seconds a..b, in playback order. */
export function sourceSlices(segments: Segment[], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    const from = Math.max(0, a - acc);
    const to = Math.min(len, b - acc);
    acc += len;
    if (to > from) out.push([s.start + from, s.start + to]);
  }
  return out;
}

/**
 * Output time of each kept word's midpoint, in one pass: kept words come in playback order, segment
 * by segment (displayWords), so the segment walk only moves forward.
 */
export function wordOutputTimes(display: DisplayWord[], segments: Segment[]): Map<string, number> {
  const out = new Map<string, number>();
  let si = 0;
  let acc = 0;
  for (const d of display) {
    if (d.deleted) continue;
    const m = mid(d.word);
    let i = si;
    let at = acc;
    while (i < segments.length && !(m >= segments[i].start && m < segments[i].end)) {
      at += segments[i].end - segments[i].start;
      i++;
    }
    if (i < segments.length) {
      si = i;
      acc = at;
      out.set(d.word.id, acc + m - segments[i].start);
    } else {
      // not found ahead (should not happen): fall back to a full search
      const t = sourceToOutput(segments, m);
      if (t != null) out.set(d.word.id, t);
    }
  }
  return out;
}

/** Common English fillers. Whisper often omits these; see ARCHITECTURE.md "Known limits". */
export const FILLERS = ['um', 'uh', 'erm', 'er', 'hmm', 'mm', 'ah', 'uhm', 'umm'];

export const isFillerText = (text: string, fillers = FILLERS) =>
  fillers.includes(text.toLowerCase().replace(/[^a-z']/g, ''));

/**
 * Correct a misheard word: only its text changes (timing, speaker and cuts stay), and whether it is a
 * filler follows the new text. Blank or unchanged text returns `words` itself.
 */
export function retypeWord(words: Word[], id: string, text: string): Word[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const w = words.find((x) => x.id === id);
  if (!w || !clean || clean === w.text) return words;
  return words.map((x) => (x.id === id ? { ...x, text: clean, isFiller: isFillerText(clean) } : x));
}

/**
 * A stretch of dead air in the edited audio: between two kept words that play back to back
 * (same segment, so nothing was cut there), or before the first / after the last kept word.
 */
/**
 * Silence that plays between two kept words (or before the first / after the last).
 * `pieces` are its source spans in playback order: one normally, more when the pause runs
 * across a seam (after a cut or move, the end of one segment plus the start of the next).
 */
export type Pause = { pieces: [number, number][]; length: number; afterId?: string; beforeId?: string };

const pause = (pieces: [number, number][], ids: Pick<Pause, 'afterId' | 'beforeId'>): Pause => {
  const kept = pieces.filter(([a, b]) => b - a > MIN_SPAN);
  return { pieces: kept, length: kept.reduce((t, [a, b]) => t + b - a, 0), ...ids };
};

/** Pauses longer than `min` seconds as they are heard, in playback order. */
export function findPauses(display: DisplayWord[], segments: Segment[], min: number): Pause[] {
  const kept = display.filter((d) => !d.deleted).map((d) => d.word);
  const out: Pause[] = [];
  if (!kept.length) return out;
  const first = kept[0];
  const fi = segmentOf(segments, first);
  // lead-in: every segment before the first word's, plus the start of its own
  if (fi >= 0) {
    const pieces: [number, number][] = segments.slice(0, fi).map((s) => [s.start, s.end]);
    pieces.push([segments[fi].start, first.start]);
    out.push(pause(pieces, { beforeId: first.id }));
  }
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1];
    const b = kept[i];
    const ia = segmentOf(segments, a);
    const ib = segmentOf(segments, b);
    if (ia < 0 || ib < ia) continue;
    const pieces: [number, number][] =
      ia === ib
        ? [[a.end, b.start]]
        : [
            [a.end, segments[ia].end],
            ...segments.slice(ia + 1, ib).map((s): [number, number] => [s.start, s.end]),
            [segments[ib].start, b.start],
          ];
    out.push(pause(pieces, { afterId: a.id, beforeId: b.id }));
  }
  const last = kept.at(-1)!;
  const li = segmentOf(segments, last);
  if (li >= 0) {
    const pieces: [number, number][] = [[last.end, segments[li].end], ...segments.slice(li + 1).map((s): [number, number] => [s.start, s.end])];
    out.push(pause(pieces, { afterId: last.id }));
  }
  return out.filter((p) => p.length > min);
}

/**
 * Cut each pause down to `keep` seconds by removing its middle, so the words on either side
 * keep their natural lead-in and tail (`keep / 2` each). Leading/trailing pauses keep `keep / 2`
 * next to the word. Across a seam, each side keeps its half and the rest goes.
 */
export function shortenPauses(segments: Segment[], pauses: Pause[], keep: number): Segment[] {
  let out = segments;
  for (const p of pauses) {
    const n = p.pieces.length;
    p.pieces.forEach(([start, end], i) => {
      const from = i === 0 && p.afterId ? start + keep / 2 : start;
      const to = i === n - 1 && p.beforeId ? end - keep / 2 : end;
      // a one-piece pause shorter on one side than keep / 2 can't happen (length > min > keep)
      if (to - from > MIN_SPAN) out = removeSpan(out, from, to);
    });
  }
  return out;
}
