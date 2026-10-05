import { describe, expect, it } from 'vitest';
import type { DisplayWord } from './edl';
import { computePeaks, paragraphs, searchHits } from './view';

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
