// Parts of a music or sound-effects recording: named source spans, kept sorted by start.
import { newId, type DisplayWord } from './edl';
import { HIGHLIGHT_COLORS, type Part } from './types';

/** Shortest part, so an accidental click can't make an empty one. */
export const MIN_PART = 0.1;

const byStart = (parts: Part[]) => [...parts].sort((a, b) => a.start - b.start || a.end - b.end);

/** The next "Part N" name: one past the highest number in use. */
export function nextPartName(parts: Part[]) {
  const n = parts.reduce((m, p) => Math.max(m, Number(/^Part (\d+)$/.exec(p.name)?.[1] ?? 0)), 0);
  return `Part ${Math.max(n, parts.length) + 1}`;
}

/** A colour not used yet, else round the palette. */
function nextColor(parts: Part[]) {
  return HIGHLIGHT_COLORS.find((c) => !parts.some((p) => p.color === c)) ?? HIGHLIGHT_COLORS[parts.length % HIGHLIGHT_COLORS.length];
}

/** Add the span a..b (either order) clamped to the recording; null if it is too short to be a part. */
export function addPart(parts: Part[], a: number, b: number, duration: number, id = newId('pt')): { parts: Part[]; part: Part } | null {
  const start = Math.max(0, Math.min(a, b));
  const end = Math.min(duration, Math.max(a, b));
  if (end - start < MIN_PART) return null;
  const part: Part = { id, name: nextPartName(parts), color: nextColor(parts), start, end };
  return { parts: byStart([...parts, part]), part };
}

/** Move one edge to `t`, keeping the part inside the recording and at least MIN_PART long. */
export function setPartEdge(parts: Part[], id: string, edge: 'start' | 'end', t: number, duration: number): Part[] {
  return byStart(
    parts.map((p) => {
      if (p.id !== id) return p;
      return edge === 'start'
        ? { ...p, start: Math.max(0, Math.min(t, p.end - MIN_PART)) }
        : { ...p, end: Math.min(duration, Math.max(t, p.start + MIN_PART)) };
    }),
  );
}

/** Rename; a blank or unchanged name returns `parts` itself, so no undo step is made. */
export function renamePart(parts: Part[], id: string, name: string): Part[] {
  const clean = name.trim();
  if (!clean || parts.find((p) => p.id === id)?.name === clean) return parts;
  return parts.map((p) => (p.id === id ? { ...p, name: clean } : p));
}

export const removePart = (parts: Part[], id: string) => parts.filter((p) => p.id !== id);

/**
 * Row for each label so overlapping or close parts don't cover each other's names: a label takes
 * `width` seconds from its span's start. Spans must be sorted by start.
 */
export function labelRows(spans: { start: number; width: number }[]): number[] {
  const rowEnds: number[] = [];
  return spans.map((s) => {
    let row = rowEnds.findIndex((end) => end <= s.start);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = s.start + s.width;
    return row;
  });
}

/** Kept words that play inside output seconds a..b (by their midpoint; times from `wordOutputTimes`). */
export function wordsInOutput(times: Map<string, number>, a: number, b: number): string[] {
  const out: string[] = [];
  for (const [id, t] of times) if (t >= a && t <= b) out.push(id);
  return out;
}

/**
 * One source span for a part from the source slices a selection covers (`sourceSlices`). Slices in
 * source order (only cuts between them) become one span from the first to the last; a selection
 * that crosses a moved passage can't be one span, so the longest slice is used (`whole` false).
 */
export function spanFromSlices(slices: [number, number][]): { start: number; end: number; whole: boolean } | null {
  if (!slices.length) return null;
  const ordered = slices.every((x, i) => i === 0 || x[0] >= slices[i - 1][1] - 1e-6);
  if (ordered) return { start: slices[0][0], end: slices.at(-1)![1], whole: true };
  const [start, end] = slices.reduce((m, x) => (x[1] - x[0] > m[1] - m[0] ? x : m));
  return { start, end, whole: false };
}

/**
 * Which part each kept word belongs to (by midpoint; with overlapping parts, the earlier one), and
 * the part(s) that start at a word: the first word of a part in playback order.
 */
export function wordParts(display: DisplayWord[], parts: Part[]) {
  const byWord = new Map<string, Part>();
  const startsAt = new Map<string, Part[]>();
  const seen = new Set<string>();
  for (const d of display) {
    if (d.deleted) continue;
    const m = (d.word.start + d.word.end) / 2;
    for (const p of parts) {
      if (m < p.start || m > p.end) continue;
      if (!byWord.has(d.word.id)) byWord.set(d.word.id, p);
      if (!seen.has(p.id)) {
        seen.add(p.id);
        startsAt.set(d.word.id, [...(startsAt.get(d.word.id) ?? []), p]);
      }
    }
  }
  return { byWord, startsAt };
}
