// Derived views for the UI: paragraphs, search hits, waveform peaks. Pure, tested in view.test.ts.
import type { DisplayWord } from './edl';

export type Paragraph = {
  key: string;
  words: DisplayWord[];
  /** Source time of the first kept word (for the timestamp label). */
  start: number;
  speakerId?: string;
  trackId: string;
};

const endsSentence = (t: string) => /[.?!]["')\]]?$/.test(t);

/**
 * Group the playback-order transcript into paragraphs. Breaks on a speaker change,
 * a long pause, a moved passage (the next kept word is not the next one in the source,
 * so a moved paragraph always stays a paragraph of its own), or a long run that has
 * reached the end of a sentence. Deleted words never cause a break.
 */
export function paragraphs(display: DisplayWord[], { pause = 1.5, softMax = 60 } = {}): Paragraph[] {
  const kept = display.filter((d) => !d.deleted).map((d) => d.word);
  const rank = new Map([...kept].sort((a, b) => a.start - b.start).map((w, i) => [w.id, i]));
  const out: Paragraph[] = [];
  let cur: Paragraph | null = null;
  let lastKept: DisplayWord | null = null;
  for (const d of display) {
    const w = d.word;
    let breakHere = !cur;
    if (cur && !d.deleted && lastKept) {
      const p = lastKept.word;
      const gap = w.start - p.end;
      breakHere =
        (w.speakerId ?? w.trackId) !== (p.speakerId ?? p.trackId) ||
        gap > pause ||
        rank.get(w.id) !== rank.get(p.id)! + 1 || // a moved passage starts or ends here
        (cur.words.length >= softMax && endsSentence(p.text));
    }
    if (breakHere) {
      cur = { key: w.id, words: [], start: w.start, speakerId: w.speakerId, trackId: w.trackId };
      out.push(cur);
    }
    cur!.words.push(d);
    if (!d.deleted) {
      if (!lastKept || breakHere) cur!.start = w.start;
      lastKept = d;
    }
  }
  return out;
}

export const normalizeToken = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Every run of kept words matching the query phrase, as lists of word ids, in playback order. */
export function searchHits(display: DisplayWord[], query: string): string[][] {
  const q = query.split(/\s+/).map(normalizeToken).filter(Boolean);
  if (!q.length) return [];
  const kept = display.filter((d) => !d.deleted).map((d) => d.word);
  const hits: string[][] = [];
  for (let i = 0; i + q.length <= kept.length; i++) {
    let ok = true;
    for (let j = 0; j < q.length && ok; j++) {
      const t = normalizeToken(kept[i + j].text);
      // last query token may be a prefix, so results appear while typing
      ok = j === q.length - 1 ? t.startsWith(q[j]) : t === q[j];
    }
    if (ok) hits.push(kept.slice(i, i + q.length).map((w) => w.id));
  }
  return hits;
}

/** Peak absolute amplitude per bucket, for drawing a waveform overview. */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const size = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const end = Math.min(samples.length, Math.floor((b + 1) * size));
    for (let i = Math.floor(b * size); i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out[b] = max;
  }
  return out;
}

/** What to move so paragraph `from` ends up at position `to` (0 to paras.length), or null if nothing moves. */
export function paragraphMove(
  paras: Paragraph[],
  from: number,
  to: number,
): { ids: string[]; targetId: string; side: 'before' | 'after' } | null {
  const keptIds = (p?: Paragraph) => p?.words.filter((d) => !d.deleted).map((d) => d.word.id) ?? [];
  const ids = keptIds(paras[from]);
  if (!ids.length || to < 0 || to > paras.length || to === from || to === from + 1) return null;
  if (to < from) {
    const target = keptIds(paras[to])[0];
    return target ? { ids, targetId: target, side: 'before' } : null;
  }
  const target = keptIds(paras[to - 1]).at(-1);
  return target ? { ids, targetId: target, side: 'after' } : null;
}

/** One segment as laid out on the edited (playback) timeline. */
export type Piece = {
  start: number;
  end: number;
  /** Where it starts in the edited result (output seconds). */
  at: number;
  /** Plays out of source order: it was moved here. */
  moved: boolean;
  /** A join (cut or move seam) sits at this piece's start. */
  join: boolean;
};

/**
 * Lay the segments out in playback order. Which pieces count as "moved" is decided by keeping the
 * longest (by duration) run of pieces that are still in source order; everything else was moved.
 */
export function editedPieces(segments: { start: number; end: number }[]): Piece[] {
  const n = segments.length;
  // weighted longest increasing subsequence on start time, O(n^2): segment lists stay small
  const best = segments.map((s) => s.end - s.start);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      if (segments[j].start < segments[i].start && best[j] + segments[i].end - segments[i].start > best[i]) {
        best[i] = best[j] + segments[i].end - segments[i].start;
        prev[i] = j;
      }
  const inOrder = new Set<number>();
  for (let i = best.indexOf(Math.max(...best)); i >= 0 && n; i = prev[i]) inOrder.add(i);
  let at = 0;
  return segments.map((s, i) => {
    const join = i > 0 && Math.abs(segments[i - 1].end - s.start) > 1e-6;
    const piece = { start: s.start, end: s.end, at, moved: !inOrder.has(i), join };
    at += s.end - s.start;
    return piece;
  });
}

/** Map source-time spans (e.g. highlights) onto the edited timeline, split wherever the edit splits them. */
export function toOutputSpans<T extends { start: number; end: number }>(pieces: Piece[], spans: T[]): (T & { outStart: number; outEnd: number })[] {
  const out: (T & { outStart: number; outEnd: number })[] = [];
  for (const p of pieces)
    for (const s of spans) {
      const lo = Math.max(p.start, s.start);
      const hi = Math.min(p.end, s.end);
      if (hi > lo) out.push({ ...s, outStart: p.at + lo - p.start, outEnd: p.at + hi - p.start });
    }
  return out;
}

/** Runs of adjacent moved pieces, i.e. moved passages as the user sees them. */
export function movedPassages(pieces: Piece[]): { at: number; length: number; from: number }[] {
  const out: { at: number; length: number; from: number }[] = [];
  pieces.forEach((p, i) => {
    const len = p.end - p.start;
    if (p.moved && pieces[i - 1]?.moved) out[out.length - 1].length += len;
    else if (p.moved) out.push({ at: p.at, length: len, from: p.start });
  });
  return out;
}

/** The visible part of the edited timeline when zoomed in (output seconds). */
export type ZoomView = { start: number; span: number };
/** Closest zoom: a second or so of audio across the lane. */
export const MIN_SPAN = 1;

/** Keep a view inside the edit; a span covering everything means "fit" (null). */
export function clampView(view: ZoomView | null, total: number): ZoomView | null {
  if (!view || total <= MIN_SPAN) return null;
  const span = Math.max(MIN_SPAN, Math.min(view.span, total));
  if (span >= total - 1e-6) return null;
  return { start: Math.max(0, Math.min(view.start, total - span)), span };
}

/** Zoom by `factor` (> 1 = in) keeping `anchor` (output seconds) at the same place on screen. */
export function zoomAround(view: ZoomView | null, total: number, factor: number, anchor: number): ZoomView | null {
  const v = view ?? { start: 0, span: total };
  const span = v.span / factor;
  const at = (anchor - v.start) / v.span; // where the anchor sits, 0 to 1
  return clampView({ start: anchor - at * span, span }, total);
}

/** Ruler spacing for a visible span: about 8 labels at most. */
export function tickStep(span: number): number {
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => span / s <= 8) ?? 3600;
}
