import { describe, expect, it } from 'vitest';
import { addPart, labelRows, wordParts, wordsInOutput, MIN_PART, nextPartName, removePart, renamePart, setPartEdge } from './parts';
import type { DisplayWord } from './edl';
import type { Part, Word } from './types';

const word = (id: string, start: number, end: number): Word => ({ id, text: id, start, end, trackId: 't' });
const dw = (w: Word, deleted = false): DisplayWord => ({ word: w, deleted });

const p = (id: string, start: number, end: number, name = id): Part => ({ id, name, color: 'red', start, end });

describe('parts', () => {
  it('add in either order, clamped, sorted, with the next name and an unused colour', () => {
    const r = addPart([p('a', 50, 60, 'Part 1')], 30, -5, 100, 'b')!;
    expect(r.part).toEqual({ id: 'b', name: 'Part 2', color: 'orange', start: 0, end: 30 });
    expect(r.parts.map((x) => x.id)).toEqual(['b', 'a']);
    expect(addPart([], 98, 140, 100, 'c')!.part.end).toBe(100);
  });

  it('refuse a part shorter than the minimum', () => {
    expect(addPart([], 5, 5 + MIN_PART / 2, 100)).toBeNull();
  });

  it('name past the highest number, even after renames and deletes', () => {
    expect(nextPartName([])).toBe('Part 1');
    expect(nextPartName([p('a', 0, 1, 'Part 4'), p('b', 0, 1, 'Intro')])).toBe('Part 5');
    expect(nextPartName([p('a', 0, 1, 'Intro'), p('b', 0, 1, 'Outro')])).toBe('Part 3');
  });

  it('move edges within the recording without crossing', () => {
    const parts = [p('a', 10, 20), p('b', 30, 40)];
    expect(setPartEdge(parts, 'a', 'start', -3, 100)[0].start).toBe(0);
    expect(setPartEdge(parts, 'a', 'start', 25, 100)[0].start).toBeCloseTo(20 - MIN_PART);
    expect(setPartEdge(parts, 'b', 'end', 500, 100)[1].end).toBe(100);
    expect(setPartEdge(parts, 'b', 'start', 5, 100).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('rename (ignoring blank names) and remove', () => {
    const parts = [p('a', 0, 1)];
    expect(renamePart(parts, 'a', '  Sting ')[0].name).toBe('Sting');
    expect(renamePart(parts, 'a', '  ')).toBe(parts);
    expect(removePart(parts, 'a')).toEqual([]);
  });

  it('stack labels that would collide', () => {
    const w = (start: number, width = 5) => ({ start, width });
    expect(labelRows([w(0), w(3), w(6), w(20)])).toEqual([0, 1, 0, 0]);
    expect(labelRows([w(0, 10), w(6, 1), w(8)])).toEqual([0, 1, 1]);
  });
});

describe('parts in a transcript', () => {
  const words = [word('a', 0, 1), word('b', 2, 3), word('c', 4, 5), word('d', 6, 7)];

  it('find the kept words a waveform selection covers, in output time', () => {
    // b cut: output 0..1.5 is source 0..1.5, then source 3.5..8 follows
    const segments = [{ id: 's1', start: 0, end: 1.5 }, { id: 's2', start: 3.5, end: 8 }];
    const display = [dw(words[0]), dw(words[1], true), dw(words[2]), dw(words[3])];
    expect(wordsInOutput(display, segments, 0, 3)).toEqual(['a', 'c']);
    expect(wordsInOutput(display, segments, 3, 10)).toEqual(['d']);
  });

  it('map words to parts and mark where each part starts', () => {
    const display = words.map((w) => dw(w));
    const parts = [p('x', 1.5, 5.5), p('y', 4, 8)];
    const { byWord, startsAt } = wordParts(display, parts);
    expect([...byWord].map(([w, part]) => `${w}:${part.id}`)).toEqual(['b:x', 'c:x', 'd:y']);
    expect([...startsAt].map(([w, ps]) => `${w}:${ps.map((q) => q.id).join('+')}`)).toEqual(['b:x', 'c:y']);
  });
});
