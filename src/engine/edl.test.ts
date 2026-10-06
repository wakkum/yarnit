import { describe, expect, it } from 'vitest';
import {
  deleteWords,
  displayWords,
  findPauses,
  fullSegments,
  isFillerText,
  MOVE_PAD,
  moveWords,
  outputDuration,
  outputToSource,
  removeOutputRange,
  removeSpan,
  shortenPauses,
  sourceToOutput,
} from './edl';
import type { Word } from './types';

// "a b c d e": each word 1s long with a 0.2s gap. a=[0,1] b=[1.2,2.2] c=[2.4,3.4] d=[3.6,4.6] e=[4.8,5.8]
const words: Word[] = ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({
  id: text,
  text,
  start: i * 1.2,
  end: i * 1.2 + 1,
  trackId: 't1',
}));
const base = () => fullSegments(6);
const order = (segs = base()) =>
  displayWords(words, segs)
    .map((d) => (d.deleted ? `-${d.word.text}` : d.word.text))
    .join(' ');
const order2 = (ws: Word[], segs: { id: string; start: number; end: number }[]) =>
  displayWords(ws, segs)
    .map((d) => (d.deleted ? `-${d.word.text}` : d.word.text))
    .join(' ');
const close = (segs: { start: number; end: number }[]) =>
  segs.map((s) => [+s.start.toFixed(3), +s.end.toFixed(3)]);

describe('removeSpan', () => {
  it('splits a segment around the removed span', () => {
    expect(close(removeSpan(base(), 2, 3))).toEqual([
      [0, 2],
      [3, 6],
    ]);
  });
  it('ignores spans outside the segments', () => {
    expect(close(removeSpan(base(), 7, 8))).toEqual([[0, 6]]);
  });
});

describe('deleteWords', () => {
  it('cuts a word plus half of each neighbouring gap', () => {
    const segs = deleteWords(base(), words, ['c']);
    expect(close(segs)).toEqual([
      [0, 2.3],
      [3.5, 6],
    ]);
    expect(order(segs)).toBe('a b -c d e');
  });
  it('merges a contiguous selection into one cut', () => {
    const segs = deleteWords(base(), words, ['b', 'c']);
    expect(segs).toHaveLength(2);
    expect(order(segs)).toBe('a -b -c d e');
  });
  it('handles two separate runs', () => {
    const segs = deleteWords(base(), words, ['a', 'd']);
    expect(order(segs)).toBe('-a b c -d e');
    expect(outputDuration(segs)).toBeCloseTo(6 - 1.1 - 1.2, 3);
  });
  it('re-joins segments when a cut is undone by deleting nothing', () => {
    expect(deleteWords(base(), words, [])).toHaveLength(1);
  });
});

describe('moveWords', () => {
  it('moves a word before an earlier word', () => {
    const segs = moveWords(base(), words, ['d'], 'b', 'before');
    expect(order(segs)).toBe('a d b c e');
  });
  it('moves a run after a later word', () => {
    const segs = moveWords(base(), words, ['a', 'b'], 'd', 'after');
    expect(order(segs)).toBe('c d a b e');
  });
  it('keeps total duration when moving', () => {
    const segs = moveWords(base(), words, ['b'], 'e', 'after');
    expect(outputDuration(segs)).toBeCloseTo(6, 6);
  });
  it('does nothing when the target is in the selection', () => {
    const segs = base();
    expect(moveWords(segs, words, ['b', 'c'], 'c', 'before')).toBe(segs);
  });
  it('moving before the first word leaves no scrap of leading audio in front', () => {
    const segs = moveWords(base(), words, ['c'], 'a', 'before');
    expect(order(segs)).toBe('c a b d e');
    expect(segs[0].start).toBeCloseTo(2.3, 3); // starts with the moved piece, not [0, x]
  });
  it('moves a word after the last word', () => {
    expect(order(moveWords(base(), words, ['a'], 'e', 'after'))).toBe('b c d e a');
  });
  it('deleting the last word also removes trailing audio', () => {
    expect(outputDuration(deleteWords(base(), words, ['e']))).toBeCloseTo(4.7, 3);
  });
  it('leaves most of a long pause behind instead of carrying it along', () => {
    // a=[0,1], 4 s pause, b=[5,6], c=[6.2,7.2]
    const ws: Word[] = [
      { id: 'a', text: 'a', start: 0, end: 1, trackId: 't1' },
      { id: 'b', text: 'b', start: 5, end: 6, trackId: 't1' },
      { id: 'c', text: 'c', start: 6.2, end: 7.2, trackId: 't1' },
    ];
    const segs = moveWords(fullSegments(7.2), ws, ['b'], 'a', 'before');
    const moved = segs.find((s) => s.start <= 5 && s.end >= 6)!;
    expect(moved.start).toBeCloseTo(5 - MOVE_PAD, 6); // not 3 (half of the 4 s pause)
    expect(outputDuration(segs)).toBeCloseTo(7.2, 6); // nothing lost: the pause stays at the old place
  });
  it('pastes right next to a target word that follows a long pause', () => {
    // a=[0,1], b=[1.2,2.2], 4 s pause, c=[6.2,7.2]: paste a before c
    const ws: Word[] = [
      { id: 'a', text: 'a', start: 0, end: 1, trackId: 't1' },
      { id: 'b', text: 'b', start: 1.2, end: 2.2, trackId: 't1' },
      { id: 'c', text: 'c', start: 6.2, end: 7.2, trackId: 't1' },
    ];
    const segs = moveWords(fullSegments(7.2), ws, ['a'], 'c', 'before');
    expect(order2(ws, segs)).toBe('b a c');
    // the segment after the moved piece starts just before c, so the pause comes before "a", not after it
    const after = segs[segs.findIndex((s) => s.start === 0) + 1];
    expect(after.start).toBeCloseTo(6.2 - MOVE_PAD, 6);
  });
  it('still moves when the gap before the target was cut away', () => {
    // remove the whole b to c gap, so the usual insertion point (halfway into it) no longer plays
    const cut = removeSpan(base(), 2.2, 2.4);
    expect(order(moveWords(cut, words, ['e'], 'c', 'before'))).toBe('a b e c d');
  });
  it('does not drag along audio that plays elsewhere', () => {
    // move c to the front, then move d before b: d's span must not swallow the piece c left behind
    const once = moveWords(base(), words, ['c'], 'a', 'before');
    const twice = moveWords(once, words, ['d'], 'b', 'before');
    expect(order(twice)).toBe('c a d b e');
    expect(outputDuration(twice)).toBeCloseTo(6, 6);
  });
  it('inserts by the target even when a leftover piece elsewhere ends at the same time', () => {
    // a scrap of silence [2.0, 2.3] plays after c's segment and ends where c's segment starts
    const frag = [
      { id: 's1', start: 0, end: 2.0 },
      { id: 's2', start: 2.3, end: 3.5 },
      { id: 's3', start: 2.0, end: 2.3 },
      { id: 's4', start: 3.5, end: 6 },
    ];
    expect(order(moveWords(frag, words, ['e'], 'c', 'before'))).toBe('a b e c d');
  });
  it('works after a delete', () => {
    const cut = deleteWords(base(), words, ['c']);
    expect(order(moveWords(cut, words, ['e'], 'a', 'before'))).toBe('e a b -c d');
  });
});

describe('time mapping', () => {
  it('maps source to output across a cut', () => {
    const segs = deleteWords(base(), words, ['c']); // [0,2.3] [3.5,6]
    expect(sourceToOutput(segs, 1)).toBeCloseTo(1);
    expect(sourceToOutput(segs, 3)).toBeNull();
    expect(sourceToOutput(segs, 4)).toBeCloseTo(2.8);
  });
  it('maps output back to source', () => {
    const segs = deleteWords(base(), words, ['c']);
    expect(outputToSource(segs, 2.8)).toEqual({ index: 1, source: expect.closeTo(4, 6) });
    expect(outputToSource(segs, 100)).toBeNull();
  });
});

describe('isFillerText', () => {
  it('matches fillers regardless of case and punctuation', () => {
    expect(isFillerText(' Um,')).toBe(true);
    expect(isFillerText('umbrella')).toBe(false);
  });
});

describe('pauses', () => {
  // x=[0.5,1] y=[3,4] z=[4.1,5], recording 0 to 8: 0.5 s lead-in, 2 s gap, 3 s tail
  const pw: Word[] = [
    { id: 'x', text: 'x', start: 0.5, end: 1, trackId: 't1' },
    { id: 'y', text: 'y', start: 3, end: 4, trackId: 't1' },
    { id: 'z', text: 'z', start: 4.1, end: 5, trackId: 't1' },
  ];
  const segs = fullSegments(8);
  const found = (s = segs, min = 1) => findPauses(displayWords(pw, s), s, min);

  it('finds gaps, lead-in and tail longer than the minimum', () => {
    expect(found()).toEqual([
      { pieces: [[1, 3]], length: 2, afterId: 'x', beforeId: 'y' },
      { pieces: [[5, 8]], length: 3, afterId: 'z' },
    ]);
    expect(found(segs, 0.4)[0]).toEqual({ pieces: [[0, 0.5]], length: 0.5, beforeId: 'x' });
  });

  it('measures a gap across a cut by what is still heard', () => {
    // 2 s gap minus a 0.5 s cut: 1.5 s still plays, in two pieces either side of the seam
    const p = found(removeSpan(segs, 1.5, 2))[0];
    expect(p.pieces).toEqual([[1, 1.5], [2, 3]]);
    expect(p.length).toBeCloseTo(1.5);
    // cut most of it: 0.9 s left is under the minimum
    expect(found(removeSpan(segs, 1.5, 2.6)).map((q) => q.afterId)).toEqual(['z']);
  });

  it('shortens a pause across a seam, keeping half on each side', () => {
    const cut = removeSpan(segs, 1.5, 2);
    const out = shortenPauses(cut, found(cut).slice(0, 1), 0.4);
    expect(close(out)).toEqual([[0, 1.2], [2.8, 8]]);
  });

  it('shortens each pause to the kept length, keeping half on each side of a gap', () => {
    const out = shortenPauses(segs, found(), 0.4);
    expect(close(out)).toEqual([[0, 1.2], [2.8, 5.2]]);
    expect(outputDuration(out)).toBeCloseTo(8 - 1.6 - 2.8);
    expect(found(out)).toEqual([]);
  });
});

describe('removeOutputRange', () => {
  const seg = (id: string, start: number, end: number) => ({ id, start, end });
  it('cuts inside one segment', () => {
    expect(removeOutputRange([seg('a', 0, 10)], 2, 3).map((s) => [s.start, s.end])).toEqual([[0, 2], [3, 10]]);
  });
  it('cuts across a seam of reordered segments', () => {
    // plays 20..25 then 0..5; output 3..7 is source 23..25 and 0..2
    const out = removeOutputRange([seg('a', 20, 25), seg('b', 0, 5)], 3, 7);
    expect(out.map((s) => [s.start, s.end])).toEqual([[20, 23], [2, 5]]);
  });
  it('leaves the edit alone outside it', () => {
    const segs = [seg('a', 0, 5)];
    expect(removeOutputRange(segs, 6, 8)).toEqual(segs);
  });
});
