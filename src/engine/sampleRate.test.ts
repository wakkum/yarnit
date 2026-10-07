import { describe, expect, it } from 'vitest';
import { sniffSampleRate } from './sampleRate';

const bytes = (...parts: (string | readonly number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];

describe('sniffSampleRate', () => {
  it('reads a WAV fmt chunk, also after another chunk', () => {
    const fmt = ['fmt ', u32le(16), [1, 0, 1, 0], u32le(44100), u32le(88200), [2, 0, 16, 0]] as const;
    expect(sniffSampleRate(bytes('RIFF', u32le(0), 'WAVE', ...fmt))).toBe(44100);
    expect(sniffSampleRate(bytes('RIFF', u32le(0), 'WAVE', 'LIST', u32le(3), [0, 0, 0, 0], ...fmt))).toBe(44100);
  });

  it('reads an MP3 frame header, after an ID3 tag', () => {
    // MPEG 1 layer III, rate index 1 = 48 kHz
    expect(sniffSampleRate(bytes([0xff, 0xfb, 0x94, 0x00]))).toBe(48000);
    // a 5-byte ID3 tag body, then MPEG 2 layer III at 24 kHz
    expect(sniffSampleRate(bytes('ID3', [4, 0, 0, 0, 0, 0, 5], [1, 2, 3, 4, 5], [0xff, 0xf3, 0x84, 0x00]))).toBe(24000);
  });

  it('reads the mp4a sample entry of an M4A', () => {
    const entry = ['mp4a', new Array(24).fill(0)] as const;
    const b = bytes(u32le(0), 'ftyp', 'M4A ', ...entry, [0, 0, 0, 0]);
    // the rate sits 24 bytes after "mp4a", as 16.16 fixed point
    b[12 + 4 + 24] = 0xbb;
    b[12 + 4 + 25] = 0x80;
    expect(sniffSampleRate(b)).toBe(48000);
  });

  it('gives up on anything else', () => {
    expect(sniffSampleRate(bytes('OggS', [0, 0, 0, 0]))).toBeNull();
    expect(sniffSampleRate(new Uint8Array(0))).toBeNull();
  });
});
