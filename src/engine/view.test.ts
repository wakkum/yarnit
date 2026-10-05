import { describe, expect, it } from 'vitest';
import type { DisplayWord } from './edl';
import { displayWords, fullSegments, moveWords } from './edl';
import type { Word } from './types';
import { clampView, computePeaks, editedPieces, tickStep, zoomAround, movedPassages, paragraphMove, paragraphs, searchHits, toOutputSpans } from './view';

const dw = (text: string, start: number, opts: Partial<DisplayWord['word']> & { deleted?: boolean } = {}): DisplayWord => {
  const { deleted = false, ...rest } = opts;
  return { word: { id: `${text}@${start}`, text, start, end: start + 0.4, trackId: 't1', ...rest }, deleted };
};
const texts = (ps: ReturnType<typeof paragraphs>) => ps.map((p) => p.words.map((d) => d.word.text).join(' '));

describe('paragraphs', () => {
  it('breaks on a long pause', () => {
    const ps = paragraphs([dw('Hello', 0), dw('there.', 0.5), dw('Next', 3), dw('one.', 3.5)]);
    expect(texts(ps)).toEqual(['Hello there.', 'Next one.']);
    expect(ps[1].start).toBe(3);
  });
  it('breaks on a speaker change', () => {
    const ps = paragraphs([dw('Hi.', 0, { speakerId: 'a' }), dw('Hey.', 0.5, { speakerId: 'b' })]);
    expect(ps).toHaveLength(2);
  });
  it('breaks where a moved passage jumps back in the source', () => {
    expect(texts(paragraphs([dw('later', 10), dw('bit.', 10.5), dw('early', 1), dw('bit.', 1.5)]))).toEqual([
      'later bit.',
      'early bit.',
    ]);
  });
  it('breaks where a passage was moved out, even after a short gap', () => {
    // "c" was moved away from between b and d: b and d play back to back but are not neighbours
    expect(texts(paragraphs([dw('a', 0), dw('b', 0.5), dw('d', 1.5), dw('c', 1)]))).toEqual(['a b', 'd', 'c']);
  });
  it('ignores deleted words when measuring pauses', () => {
    const ps = paragraphs([dw('a', 0), dw('cut', 5, { deleted: true }), dw('b', 0.5)]);
    expect(ps).toHaveLength(1);
  });
  it('splits long runs only at sentence ends', () => {
    const run = Array.from({ length: 6 }, (_, i) => dw(i === 3 ? 'end.' : `w${i}`, i * 0.5));
    expect(texts(paragraphs(run, { softMax: 2 }))).toEqual(['w0 w1 w2 end.', 'w4 w5']);
  });
});

describe('searchHits', () => {
  const doc = [dw('The', 0), dw('quick,', 0.5), dw('brown', 1), dw('fox.', 1.5), dw('The', 2, { deleted: true }), dw('Quick', 2.5)];
  it('finds a phrase ignoring case and punctuation', () => {
    expect(searchHits(doc, 'the quick')).toEqual([['The@0', 'quick,@0.5']]);
  });
  it('matches the last token as a prefix while typing', () => {
    expect(searchHits(doc, 'qu')).toHaveLength(2);
  });
  it('skips deleted words', () => {
    expect(searchHits(doc, 'fox quick')).toEqual([['fox.@1.5', 'Quick@2.5']]);
  });
  it('returns nothing for an empty query', () => {
    expect(searchHits(doc, '  ')).toEqual([]);
  });
});

describe('computePeaks', () => {
  it('takes the max absolute value per bucket', () => {
    const p = computePeaks(Float32Array.from([0.1, -0.9, 0.2, 0.3]), 2);
    expect(Array.from(p).map((v) => +v.toFixed(2))).toEqual([0.9, 0.3]);
  });
});

describe('paragraphMove', () => {
  // three paragraphs split by 2 s pauses: "a b" [0,1.4], "c d" [3.4,4.8], "e f" [6.8,8.2]
  const words: Word[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, i) => {
    const start = Math.floor(i / 2) * 3.4 + (i % 2) * 0.5;
    return { id: text, text, start, end: start + 0.4, trackId: 't1' };
  });
  const paras = (segs = fullSegments(9)) => paragraphs(displayWords(words, segs));
  const apply = (segs: ReturnType<typeof fullSegments>, from: number, to: number) => {
    const m = paragraphMove(paras(segs), from, to)!;
    return moveWords(segs, words, m.ids, m.targetId, m.side);
  };
  const order = (segs: ReturnType<typeof fullSegments>) => paras(segs).map((p) => p.words.map((d) => d.word.text).join(''));

  it('moves a paragraph up and down by one', () => {
    expect(order(apply(fullSegments(9), 1, 0))).toEqual(['cd', 'ab', 'ef']);
    expect(order(apply(fullSegments(9), 1, 3))).toEqual(['ab', 'ef', 'cd']);
  });
  it('moves the last paragraph to the top and keeps every paragraph whole', () => {
    expect(order(apply(fullSegments(9), 2, 0))).toEqual(['ef', 'ab', 'cd']);
  });
  it('does nothing for a move onto itself or past the ends', () => {
    expect(paragraphMove(paras(), 1, 1)).toBeNull();
    expect(paragraphMove(paras(), 1, 2)).toBeNull();
    expect(paragraphMove(paras(), 0, -1)).toBeNull();
    expect(paragraphMove(paras(), 2, 4)).toBeNull();
  });
});

describe('edited timeline', () => {
  // 0 to 50 s recording: P1 [0,9], P3 [17.5,23.3] moved up, P2 [9,12] + [14.5,17.5] (2.5 s cut), rest
  const segs = [
    { start: 0, end: 9 },
    { start: 17.5, end: 23.3 },
    { start: 9, end: 12 },
    { start: 14.5, end: 17.5 },
    { start: 23.3, end: 50 },
  ];
  const pieces = editedPieces(segs);

  it('lays pieces out in playback order and marks the moved one', () => {
    expect(pieces.map((p) => p.at)).toEqual([0, 9, expect.closeTo(14.8), expect.closeTo(17.8), expect.closeTo(20.8)]);
    expect(pieces.map((p) => p.moved)).toEqual([false, true, false, false, false]);
    expect(pieces.map((p) => p.join)).toEqual([false, true, true, true, true]);
  });
  it('an untouched recording has no joins and nothing moved', () => {
    expect(editedPieces([{ start: 0, end: 10 }])).toEqual([{ start: 0, end: 10, at: 0, moved: false, join: false }]);
    expect(editedPieces([])).toEqual([]);
  });
  it('maps highlights onto the edit, splitting at a cut', () => {
    const out = toOutputSpans(pieces, [{ start: 11, end: 15 }]);
    expect(out.map((s) => [+s.outStart.toFixed(2), +s.outEnd.toFixed(2)])).toEqual([[16.8, 17.8], [17.8, 18.3]]);
  });
  it('groups moved pieces into passages', () => {
    expect(movedPassages(pieces)).toEqual([{ at: 9, length: expect.closeTo(5.8), from: 17.5 }]);
  });
});

describe('zoom', () => {
  it('zooms in around an anchor that stays put on screen', () => {
    const v = zoomAround(null, 100, 4, 50)!;
    expect(v).toEqual({ start: 37.5, span: 25 });
    const w = zoomAround(v, 100, 2, 40)!; // 40 s sat 10% in; it still does
    expect((40 - w.start) / w.span).toBeCloseTo((40 - v.start) / v.span);
  });
  it('clamps to the edit, and zooming all the way out means fit', () => {
    expect(zoomAround({ start: 90, span: 10 }, 100, 1, 95)).toEqual({ start: 90, span: 10 });
    expect(clampView({ start: 95, span: 10 }, 100)).toEqual({ start: 90, span: 10 });
    expect(zoomAround({ start: 0, span: 50 }, 100, 0.5, 0)).toBeNull();
    expect(clampView({ start: 0, span: 0.1 }, 100)!.span).toBe(1);
  });
  it('picks a ruler step for the visible span', () => {
    expect(tickStep(47)).toBe(10);
    expect(tickStep(12)).toBe(2);
    expect(tickStep(3)).toBe(0.5);
  });
});
