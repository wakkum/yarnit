// Colour highlights: pure functions over source-time spans. Tested in highlights.test.ts.
import { newId, sourceOrder, sourceToOutput, type DisplayWord } from './edl';
import type { Highlight, HighlightColor, Segment, Word } from './types';

const mid = (w: Word) => (w.start + w.end) / 2;

/** Colour the span [start, end] (or clear it with null). Whatever was there is replaced. */
export function applyHighlight(
  highlights: Highlight[],
  start: number,
  end: number,
  color: HighlightColor | null,
): Highlight[] {
  const out: Highlight[] = [];
  for (const h of highlights) {
    if (h.end <= start || h.start >= end) {
      out.push(h);
      continue;
    }
    if (h.start < start) out.push({ ...h, end: start });
    if (h.end > end) out.push({ ...h, id: newId('h'), start: end });
  }
  if (color) out.push({ id: newId('h'), color, start, end });
  return out.sort((a, b) => a.start - b.start);
}

/** Source spans covering the given words: one per run of words that are consecutive in the source. */
export function wordRuns(words: Word[], ids: Iterable<string>): [number, number][] {
  const set = new Set(ids);
  const runs: [number, number][] = [];
  let open = false;
  for (const w of sourceOrder(words)) {
    if (!set.has(w.id)) {
      open = false;
      continue;
    }
    if (open) runs[runs.length - 1][1] = w.end;
    else runs.push([w.start, w.end]);
    open = true;
  }
  return runs;
}

/** Highlight (or clear) a set of words. */
export function highlightWords(
  highlights: Highlight[],
  words: Word[],
  ids: Iterable<string>,
  color: HighlightColor | null,
): Highlight[] {
  return wordRuns(words, ids).reduce((hs, [a, b]) => applyHighlight(hs, a, b, color), highlights);
}

/** Colour of each highlighted word (by its midpoint). */
export function wordColors(words: Word[], highlights: Highlight[]): Map<string, HighlightColor> {
  const out = new Map<string, HighlightColor>();
  if (!highlights.length) return out;
  for (const w of words) {
    const t = mid(w);
    const h = highlights.find((x) => t >= x.start && t < x.end);
    if (h) out.set(w.id, h.color);
  }
  return out;
}

export type Passage = {
  color: HighlightColor;
  wordIds: string[];
  text: string;
  /** Edited-timeline start and length (seconds). */
  start: number;
  duration: number;
};

/**
 * Highlighted passages as the listener hears them: runs of kept words in playback order that share
 * a colour. Cut words are skipped (they are not in the edit), so a passage that was cut entirely
 * disappears; a cut inside a passage does not split it.
 */
export function passages(display: DisplayWord[], segments: Segment[], colors: Map<string, HighlightColor>): Passage[] {
  const out: Passage[] = [];
  let cur: { color: HighlightColor; words: Word[] } | null = null;
  const close = () => {
    if (!cur) return;
    const first = cur.words[0];
    const last = cur.words.at(-1)!;
    const a = sourceToOutput(segments, mid(first)) ?? 0;
    const b = sourceToOutput(segments, mid(last)) ?? a;
    // edges: from the first word's start to the last word's end, measured on the edited timeline
    const start = Math.max(0, a - (mid(first) - first.start));
    const end = b + (last.end - mid(last));
    out.push({
      color: cur.color,
      wordIds: cur.words.map((w) => w.id),
      text: cur.words.map((w) => w.text).join(' '),
      start,
      duration: Math.max(0, end - start),
    });
    cur = null;
  };
  for (const d of display) {
    if (d.deleted) continue;
    const c = colors.get(d.word.id);
    if (cur && c === cur.color) {
      cur.words.push(d.word);
      continue;
    }
    close();
    if (c) cur = { color: c, words: [d.word] };
  }
  close();
  return out;
}
