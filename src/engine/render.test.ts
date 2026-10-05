import { describe, expect, it } from 'vitest';
import { renderEdit, silenceThreshold, snapToQuiet, speechEnd, speechPieces } from './render';

const SR = 1000; // 1 kHz keeps sample math readable
const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i);
const seg = (start: number, end: number) => ({ id: `${start}`, start, end });

describe('renderEdit', () => {
  it('concatenates kept segments in list order', () => {
    const out = renderEdit([{ channels: [ramp(10_000)], offset: 0 }], [seg(5, 6), seg(1, 2)], SR, 0);
    expect(out[0]).toHaveLength(2000);
    expect(out[0][0]).toBe(5000);
    expect(out[0][1000]).toBe(1000);
  });

  it('fades only at seams, never at the start or end', () => {
    const ones = new Float32Array(5000).fill(1);
    const out = renderEdit([{ channels: [ones], offset: 0 }], [seg(0, 1), seg(2, 3)], SR, 0.01)[0];
    expect(out[0]).toBe(1); // no fade-in at output start
    expect(out[999]).toBeCloseTo(0, 5); // fade-out into the seam
    expect(out[1000]).toBeCloseTo(0, 5); // fade-in after the seam
    expect(out[1999]).toBe(1); // no fade-out at output end
  });

  it('mixes tracks and respects track offsets', () => {
    const a = new Float32Array(3000).fill(1);
    const b = new Float32Array(3000).fill(2);
    // b starts 1s later on the source timeline
    const out = renderEdit(
      [
        { channels: [a], offset: 0 },
        { channels: [b], offset: 1 },
      ],
      [seg(0, 3)],
      SR,
      0,
    )[0];
    expect(out[500]).toBe(1); // only a
    expect(out[1500]).toBe(3); // a + b
  });

  it('feeds mono tracks to every channel of a stereo mix', () => {
    const mono = new Float32Array(1000).fill(1);
    const stereo = [new Float32Array(1000).fill(0.5), new Float32Array(1000).fill(0.25)];
    const out = renderEdit(
      [
        { channels: [mono], offset: 0 },
        { channels: stereo, offset: 0 },
      ],
      [seg(0, 1)],
      SR,
      0,
    );
    expect(out).toHaveLength(2);
    expect(out[0][10]).toBe(1.5);
    expect(out[1][10]).toBe(1.25);
  });
});

describe('speechEnd', () => {
  // 0.0 to 0.5 s loud "word", then silence; Whisper claimed the word ran to 1.5 s
  const s = new Float32Array(2000);
  s.fill(0.5, 0, 500);
  it('trims a stretched word end back to where the sound stops', () => {
    const end = speechEnd(s, SR, 0, 1.5, silenceThreshold(s, SR));
    expect(end).toBeGreaterThan(0.5);
    expect(end).toBeLessThan(0.6);
  });
  it('leaves a word that is sounding at its end untouched', () => {
    expect(speechEnd(s, SR, 0, 0.4, 0.01)).toBe(0.4);
  });
});

describe('snapToQuiet', () => {
  it('moves a cut into the nearby silent gap', () => {
    const s = new Float32Array(1000).fill(0.8);
    s.fill(0, 600, 640); // silence at 0.60 to 0.64 s
    const t = snapToQuiet(s, SR, 0.55, 0.5, 0.7);
    expect(t).toBeGreaterThanOrEqual(0.6);
    expect(t).toBeLessThanOrEqual(0.64);
  });
  it('keeps the original point over flat silence', () => {
    const s = new Float32Array(1000);
    expect(snapToQuiet(s, SR, 0.5, 0.4, 0.6)).toBeCloseTo(0.5, 2);
  });
});

describe('speechPieces', () => {
  // seconds of sound/silence -> 1 kHz signal
  const signal = (parts: [number, boolean][]) => {
    const out: number[] = [];
    for (const [sec, loud] of parts) for (let i = 0; i < sec * SR; i++) out.push(loud ? 0.5 : 0);
    return Float32Array.from(out);
  };
  const round = (p: [number, number][]) => p.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]);

  it('skips long silences and keeps a pad around speech', () => {
    const s = signal([[30, false], [5, true], [10, false], [4, true], [3, false]]);
    expect(round(speechPieces(s, SR, 0.01))).toEqual([[29.7, 35.3], [44.7, 49.3]]);
  });

  it('joins sound across short gaps and splits long runs at a pause, padding both sides', () => {
    const s = signal([[10, true], [0.2, false], [10, true], [1, false], [10, true]]);
    const p = speechPieces(s, SR, 0.01, { maxLen: 25 });
    expect(round(p)).toEqual([[0, 20.5], [20.9, 31.2]]);
  });

  it('splits continuous speech longer than a piece at the quietest point', () => {
    const s = signal([[40, true]]);
    s.fill(0.1, 26_000, 26_050);
    const p = speechPieces(s, SR, 0.01, { maxLen: 28 });
    expect(p).toHaveLength(2);
    expect(p[0][1]).toBeGreaterThan(26);
    expect(p[0][1]).toBeLessThan(26.05);
    expect(p[1][0]).toBe(p[0][1]);
  });
});
