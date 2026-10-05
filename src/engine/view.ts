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
 * a long pause, a jump in the source (a moved or cut-joined passage), or a long run
 * that has reached the end of a sentence. Deleted words never cause a break.
 */
export function paragraphs(display: DisplayWord[], { pause = 1.5, softMax = 60 } = {}): Paragraph[] {
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
        gap < -0.05 || // jumped backwards in the source: a moved passage starts
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
