// Parts of a music or sound-effects recording: named source spans, kept sorted by start.
import { newId, sourceToOutput, type DisplayWord } from './edl';
import { HIGHLIGHT_COLORS, type Part, type Segment } from './types';

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

export function renamePart(parts: Part[], id: string, name: string): Part[] {
  const clean = name.trim();
  return clean ? parts.map((p) => (p.id === id ? { ...p, name: clean } : p)) : parts;
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

/** Kept words that play inside output seconds a..b (by their midpoint): what a waveform selection covers. */
export function wordsInOutput(display: DisplayWord[], segments: Segment[], a: number, b: number): string[] {
  return display
    .filter((d) => {
      if (d.deleted) return false;
      const t = sourceToOutput(segments, (d.word.start + d.word.end) / 2);
      return t != null && t >= a && t <= b;
    })
    .map((d) => d.word.id);
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
