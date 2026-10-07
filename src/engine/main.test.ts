import { describe, expect, it } from 'vitest';
import { displayWords } from './edl';
import {
  addClips,
  addKey,
  duckLevel,
  keyLevel,
  moveKey,
  removeKey,
  renameClipSpeaker,
  fromStretches,
  keysAround,
  shiftLevels,
  clampFades,
  clipEntries,
  cutPoint,
  deleteClipWords,
  fadeGain,
  layout,
  mainDuration,
  makeClip,
  moveSpeechClip,
  partSegments,
  placeSpeech,
  removeClips,
  snapMove,
  snapTargets,
  splitClip,
  renderMix,
  updateClip,
  wordsToSegments,
  wordTimes,
} from './main';
import type { MainClip, Recording, RecordingKind, Word } from './types';

const word = (id: string, start: number, end: number): Word => ({ id, text: id, start, end, trackId: 't1', speakerId: 'sp1' });
const recording = (kind: RecordingKind = 'interview'): Recording => ({
  id: 'r1',
  name: 'Talk',
  kind,
  sampleRate: 10,
  duration: 10,
  tracks: [{ id: 't1', fileName: 'talk.wav', offset: 0 }],
  speakers: [{ id: 'sp1', name: 'Ann' }],
  words: [word('a', 0.5, 1), word('b', 2, 2.5), word('c', 4, 4.5), word('d', 6, 6.5)],
  // b was cut: plays 0..1.5, then 3..10
  segments: [
    { id: 's1', start: 0, end: 1.5 },
    { id: 's2', start: 3, end: 10 },
  ],
  highlights: [],
  highlightNames: {},
  parts: [],
});
const clip = (id: string, kind: RecordingKind, len: number, extra: Partial<MainClip> = {}): MainClip => ({
  id,
  name: id,
  kind,
  recordingId: 'r1',
  trackId: 't1',
  segments: [{ id: 's', start: 0, end: len }],
  words: [],
  speakers: [],
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
  gap: 0,
  at: 0,
  ...extra,
});

describe('main timeline layout', () => {
  it('runs speech one after another across both speech lanes, music at its own time', () => {
    const main = { clips: [clip('vo', 'voiceover', 3), clip('bed', 'music', 20, { at: 1 }), clip('int', 'interview', 4, { gap: 2 })] };
    const placed = layout(main);
    expect(placed.map((c) => [c.id, c.start, c.length])).toEqual([
      ['vo', 0, 3],
      ['bed', 1, 20],
      ['int', 5, 4],
    ]);
    expect(mainDuration(placed)).toBe(21);
  });

  it('reorders speech only among speech clips', () => {
    const main = { clips: [clip('a', 'interview', 1), clip('m', 'music', 1), clip('b', 'voiceover', 1)] };
    expect(moveSpeechClip(main, 'b', -1).clips.map((c) => c.id)).toEqual(['b', 'm', 'a']);
    expect(moveSpeechClip(main, 'a', -1)).toBe(main);
  });

  it('updates and removes clips', () => {
    const main = addClips({ clips: [] }, [clip('a', 'music', 2)]);
    expect(updateClip(main, 'a', { gain: 0.3 }).clips[0].gain).toBe(0.3);
    expect(removeClips(main, ['a']).clips).toEqual([]);
  });
});

describe('fades and volume', () => {
  it('never lets fades overlap', () => {
    expect(clampFades(10, 2, 3)).toEqual([2, 3]);
    expect(clampFades(4, 4, 4)).toEqual([2, 2]);
  });

  it('shape the volume with an equal-power fade in and out', () => {
    const c = { length: 10, gain: 0.5, fadeIn: 2, fadeOut: 4 };
    expect(fadeGain(0, c)).toBe(0);
    expect(fadeGain(1, c)).toBeCloseTo(0.5 * Math.sin(Math.PI / 4));
    expect(fadeGain(5, c)).toBe(0.5);
    expect(fadeGain(8, c)).toBeCloseTo(0.5 * Math.sin(Math.PI / 4));
    expect(fadeGain(10, c)).toBe(0);
  });
});

describe('mixing', () => {
  it('lists stretches by start time', () => {
    const main = { clips: [clip('v', 'interview', 2, { segments: [{ id: 'x', start: 5, end: 6 }, { id: 'y', start: 1, end: 2 }] }), clip('m', 'music', 1, { at: 0.5 })] };
    expect(clipEntries(layout(main)).map((e) => [e.clipId, e.at, e.from])).toEqual([
      ['v', 0, 5],
      ['m', 0.5, 0],
      ['v', 1, 1],
    ]);
  });

  it('plays voice and music at the same time, each at its own volume', () => {
    const sr = 10;
    const voice = [new Float32Array(100).fill(1)];
    const music = [new Float32Array(100).fill(1), new Float32Array(100).fill(-1)];
    const main = {
      clips: [clip('v', 'interview', 3, { trackId: 'tv' }), clip('m', 'music', 2, { trackId: 'tm', at: 1, gain: 0.25 })],
    };
    const out = renderMix(main, new Map([['tv', voice], ['tm', music]]), sr, 0);
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(30);
    expect(out[0][5]).toBeCloseTo(1); // voice only
    expect(out[0][15]).toBeCloseTo(1.25); // voice + music
    expect(out[1][15]).toBeCloseTo(1 - 0.25); // mono voice feeds both channels; music's right channel is -1
  });

  it('applies the fade envelope in the render', () => {
    const out = renderMix({ clips: [clip('m', 'music', 4, { fadeIn: 2 })] }, new Map([['t1', [new Float32Array(100).fill(1)]]]), 10, 0);
    expect(out[0][0]).toBe(0);
    expect(out[0][10]).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(out[0][30]).toBeCloseTo(1);
  });
});

describe('sending to the main timeline', () => {
  it('copies kept words with new ids, and keeps the recording untouched', () => {
    const r = recording();
    const c = makeClip(r, r.segments, 'Whole edit');
    expect(c.words.map((w) => w.text)).toEqual(['a', 'c', 'd']);
    expect(c.words.every((w) => !['a', 'c', 'd'].includes(w.id))).toBe(true);
    expect(c.segments).not.toBe(r.segments);
    expect(c.kind).toBe('interview');
    expect(makeClip(recording('music'), [{ id: 'x', start: 0, end: 4 }], 'Bed', 7)).toMatchObject({ words: [], at: 7 });
  });

  it('turns selected words into padded spans that stop short of their neighbours', () => {
    const r = recording();
    const display = displayWords(r.words, r.segments);
    // c alone: 4..4.5, neighbours a (ends 1) and d (starts 6): pad SEND_PAD each side
    expect(wordsToSegments(display, r.segments, ['c']).map((s) => [s.start, s.end])).toEqual([[3.75, 4.75]]);
    // a and c are neighbours in playback (b is cut): one run across the cut, two source slices
    expect(wordsToSegments(display, r.segments, ['a', 'c']).map((s) => [s.start, s.end])).toEqual([
      [0.25, 1.5],
      [3, 4.75],
    ]);
  });

  it('takes the kept pieces of a part', () => {
    expect(partSegments(recording(), { start: 1, end: 5 }).map((s) => [s.start, s.end])).toEqual([
      [1, 1.5],
      [3, 5],
    ]);
  });

  it('cuts words inside clips and drops a clip with nothing left', () => {
    const r = recording();
    const c = makeClip(r, r.segments, 'All');
    const [a, , d] = c.words;
    const main = { clips: [c, clip('m', 'music', 3)] };
    const cut = deleteClipWords(main, [d.id]);
    expect(cut.clips[0].segments.at(-1)!.end).toBeLessThan(10);
    const alone = makeClip(r, [{ id: 'x', start: 0.4, end: 1.1 }], 'Just a');
    expect(deleteClipWords({ clips: [alone] }, [alone.words[0].id]).clips).toEqual([]);
    expect(wordTimes(layout(main))[0]).toMatchObject({ id: a.id, at: 0.5 });
  });
});

describe('cutting a clip', () => {
  it('splits music into two back-to-back clips, fades kept on the outer ends', () => {
    const main = { clips: [clip('m', 'music', 10, { at: 2, fadeIn: 1, fadeOut: 2, gain: 0.3, name: 'Bed' })] };
    const r = splitClip(main, 'm', 4)!;
    const [a, b] = r.main.clips;
    expect([a.id, b.id]).toEqual(['m', r.second]);
    expect([a.name, b.name]).toEqual(['Bed 1', 'Bed 2']);
    expect([a.at, b.at]).toEqual([2, 6]);
    expect([a.fadeIn, a.fadeOut, b.fadeIn, b.fadeOut]).toEqual([1, 0, 0, 2]);
    expect(b.gain).toBe(0.3);
    const placed = layout(r.main);
    expect(placed.map((c) => [c.start, c.length])).toEqual([[2, 4], [6, 6]]);
  });

  it('keeps speech in running order with no pause between the halves, and splits the words', () => {
    const c = makeClip(recording(), recording().segments, 'Talk');
    const main = { clips: [clip('v', 'voiceover', 2, { gap: 1 }), c, clip('w', 'interview', 3)] };
    const before = layout(main);
    const r = splitClip(main, c.id, 2)!;
    const after = layout(r.main);
    expect(after.map((x) => x.id)).toEqual(['v', c.id, r.second, 'w']);
    expect(after[2].start).toBeCloseTo(after[1].start + after[1].length);
    expect(after[3].start).toBeCloseTo(before[2].start); // the clip after does not move
    expect(r.main.clips[1].words.map((w) => w.text)).toEqual(['a']);
    expect(r.main.clips[2].words.map((w) => w.text)).toEqual(['c', 'd']);
    expect(r.main.clips[2].gap).toBe(0);
  });

  it('refuses a cut too close to an edge', () => {
    expect(splitClip({ clips: [clip('m', 'music', 10)] }, 'm', 0.05)).toBeNull();
    expect(splitClip({ clips: [clip('m', 'music', 10)] }, 'm', 9.95)).toBeNull();
  });

  it('moves a voice cut out of a word into the gap', () => {
    const c = makeClip(recording(), recording().segments, 'Talk');
    // output: a 0.5..1, c 2.5..3, d 4.5..5
    expect(cutPoint(c, 2.6)).toEqual({ t: 1.75, after: 'a' });
    expect(cutPoint(c, 2.9)).toEqual({ t: 3.75, after: 'a c' });
    expect(cutPoint(c, 2)).toEqual({ t: 2, after: 'a' }); // already in a gap
    expect(cutPoint(clip('m', 'music', 10), 2.6)).toEqual({ t: 2.6, after: null });
  });
});

describe('snapping', () => {
  const placed = layout({ clips: [clip('a', 'interview', 5, { name: 'A' }), clip('m', 'music', 4, { at: 7, name: 'M' })] });
  const targets = snapTargets(placed, 'm', 3);

  it('lists edges of the other clips, the start and the playhead', () => {
    expect(targets.map((t) => t.t)).toEqual([0, 3, 0, 5]);
    expect(targets[3].label).toBe('end of A');
  });

  it('lines up the nearer edge within the tolerance', () => {
    // a 4 s clip dragged to 5.3: its start is 0.3 from the end of A
    const s = snapMove(5.3, 4, targets, 0.5)!;
    expect(s.shift).toBeCloseTo(-0.3);
    expect(s.target).toBe(targets[3]);
    // its end (at 3.2) is 0.2 from the playhead: nearer wins
    expect(snapMove(-0.8, 4, targets, 0.5)?.target.label).toBe('the playhead');
    expect(snapMove(6, 4, targets, 0.5)).toBeNull();
  });
});

describe('renameClipSpeaker', () => {
  it('renames the speaker in every clip from the same recording, not in others', () => {
    const sp = [{ id: 'sp1', name: 'Speaker 1' }];
    const main = {
      clips: [
        clip('a', 'interview', 5, { speakers: sp }),
        clip('b', 'interview', 5, { speakers: sp }),
        clip('c', 'interview', 5, { speakers: sp, recordingId: 'r2' }),
      ],
    };
    const next = renameClipSpeaker(main, 'a', 'sp1', '  Omar ');
    expect(next.clips.map((c) => c.speakers[0].name)).toEqual(['Omar', 'Omar', 'Speaker 1']);
    expect(sp[0].name).toBe('Speaker 1');
    expect(renameClipSpeaker(next, 'a', 'sp1', 'Omar')).toBe(next);
    expect(renameClipSpeaker(next, 'a', 'sp1', '  ')).toBe(next);
  });
});

describe('volume keyframes', () => {
  const bed = () => ({ clips: [clip('m', 'music', 20, { at: 0 })] });
  // a dip: four keyframes, the middle two turned down to 40%
  const dip = () => shiftLevels([5, 6, 14, 15].reduce((m, t) => addKey(m, 'm', t), bed()), 'm', keysAround({ keys: [5, 6, 14, 15] }, 10), -0.6);

  it('adds a keyframe at the volume playing there, so nothing changes yet', () => {
    const main = addKey(addKey(bed(), 'm', 5), 'm', 10);
    expect(main.clips[0].keys).toEqual([5, 10]);
    expect(main.clips[0].levels).toEqual([1, 1]);
    const c = dip().clips[0];
    expect(c.levels).toEqual([1, 0.4, 0.4, 1]);
    // added on the slope of the dip, it takes the level there
    expect(addKey(dip(), 'm', 5.5).clips[0].levels![1]).toBeCloseTo(0.7);
  });

  it('eases from keyframe to keyframe and holds the ends', () => {
    const c = layout(dip())[0];
    expect(keyLevel(2, c)).toBe(1);
    expect(keyLevel(5.5, c)).toBeCloseTo(0.7);
    expect(keyLevel(10, c)).toBeCloseTo(0.4);
    expect(keyLevel(18, c)).toBe(1);
    // an S-curve: a tenth of the way it has moved far less than a tenth
    expect(1 - keyLevel(5.1, c)).toBeLessThan(0.6 * 0.05);
  });

  it('moves the keyframes either side of a stretch, or the end one outside them', () => {
    const c = { keys: [5, 6, 14, 15] };
    expect(keysAround(c, 2)).toEqual([0]);
    expect(keysAround(c, 10)).toEqual([1, 2]);
    expect(keysAround(c, 18)).toEqual([3]);
    expect(keysAround({}, 3)).toEqual([]);
    // one keyframe on its own, kept within 0 and MAX_GAIN
    expect(shiftLevels(dip(), 'm', [0], 5).clips[0].levels).toEqual([2, 0.4, 0.4, 1]);
    expect(shiftLevels(dip(), 'm', [1, 2], -1).clips[0].levels).toEqual([1, 0, 0, 1]);
  });

  it('refuses keyframes too close together, removes and moves them', () => {
    let main = addKey(bed(), 'm', 5);
    expect(addKey(main, 'm', 5.1)).toBe(main);
    expect(addKey(main, 'm', 0.05)).toBe(main);
    main = shiftLevels(addKey(main, 'm', 10), 'm', [1], -0.7);
    expect(moveKey(main, 'm', 0, 12).clips[0].keys).toEqual([9.8, 10]);
    expect(moveKey(main, 'm', 1, 30).clips[0].keys).toEqual([5, 20]);
    const gone = removeKey(main, 'm', 0);
    expect(gone.clips[0].keys).toEqual([10]);
    expect(gone.clips[0].levels![0]).toBeCloseTo(0.3);
    expect(removeKey(gone, 'm', 0).clips[0].keys).toBeUndefined();
  });

  it('keeps keyframes with their piece when the clip is cut, with one at the cut', () => {
    const r = splitClip(dip(), 'm', 10)!;
    const [a, b] = r.main.clips;
    expect(a.keys).toEqual([5, 6, 10]);
    expect(a.levels!.map((l) => +l.toFixed(3))).toEqual([1, 0.4, 0.4]);
    expect(b.keys).toEqual([0, 4, 5]);
    expect(b.levels!.map((l) => +l.toFixed(3))).toEqual([0.4, 0.4, 1]);
  });

  it('converts the first model (a level per stretch) so it sounds the same', () => {
    // keys at 5 and 10, the stretch between at 40%: each change eased over 1 s across its key
    const old = fromStretches([5, 10, 15], [1, 0.4, 1, 1], 20);
    expect(old.keys).toEqual([4.5, 5.5, 9.5, 10.5, 15]);
    expect(old.levels).toEqual([1, 0.4, 0.4, 1, 1]);
    const c = { ...old };
    expect(keyLevel(5, c)).toBeCloseTo(0.7);
    expect(keyLevel(7, c)).toBeCloseTo(0.4);
  });
});

describe('lowering music under voice', () => {
  it('ducks while voice plays, easing down before and up after', () => {
    const main = { clips: [clip('v', 'voiceover', 4, { gap: 3 }), clip('m', 'music', 12, { at: 0, duck: 0.3 })] };
    const m = layout(main)[1];
    expect(m.ducks).toEqual([[3, 7]]);
    expect(duckLevel(1, m)).toBe(1);
    expect(duckLevel(5, m)).toBeCloseTo(0.3);
    expect(duckLevel(2.75, m)).toBeCloseTo(0.65); // halfway down the ramp
    expect(duckLevel(8, m)).toBe(1);
  });

  it('stays down through a short pause between voice clips', () => {
    const main = { clips: [clip('v', 'voiceover', 4), clip('w', 'interview', 4, { gap: 0.6 }), clip('m', 'music', 12, { at: 0, duck: 0.3 })] };
    expect(layout(main)[2].ducks).toEqual([[0, 8.6]]);
  });

  it('is off unless set', () => {
    const main = { clips: [clip('v', 'voiceover', 4), clip('m', 'music', 12, { at: 0 })] };
    expect(layout(main)[1].ducks).toBeUndefined();
    expect(duckLevel(2, layout(main)[1])).toBe(1);
  });
});

describe('dragging a voice clip', () => {
  const main = { clips: [clip('a', 'interview', 4), clip('b', 'voiceover', 2), clip('m', 'music', 10, { at: 1 })] };

  it('moves ahead of a clip when dropped before its middle, with no pause when flush', () => {
    const next = placeSpeech(main, 'b', 0);
    expect(layout(next).filter((c) => c.kind !== 'music').map((c) => [c.id, c.start])).toEqual([['b', 0], ['a', 2]]);
    expect(next.clips.find((c) => c.id === 'b')!.gap).toBe(0);
  });

  it('stays after it when dropped past its middle, the space becoming its pause', () => {
    const next = placeSpeech(main, 'b', 6);
    const placed = layout(next);
    expect(placed.find((c) => c.id === 'b')!.start).toBe(6);
    expect(next.clips.find((c) => c.id === 'b')!.gap).toBe(2);
  });

  it('fills a pause without pushing the clip after it', () => {
    const next = placeSpeech({ clips: [clip('a', 'interview', 4, { gap: 5 }), clip('b', 'voiceover', 2)] }, 'b', 1);
    expect(layout(next).map((c) => [c.id, c.start])).toEqual([['b', 1], ['a', 5]]);
  });

  it('pushes the clip after it along when there is no room', () => {
    const next = placeSpeech({ clips: [clip('a', 'interview', 4, { gap: 1 }), clip('b', 'voiceover', 2)] }, 'b', 0);
    expect(layout(next).map((c) => [c.id, c.start])).toEqual([['b', 0], ['a', 2]]);
  });

  it('leaves music where it is', () => {
    expect(placeSpeech(main, 'b', 0).clips.find((c) => c.id === 'm')!.at).toBe(1);
  });
});
