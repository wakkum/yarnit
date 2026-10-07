// A file's own sample rate, read from its header. Decoding at that rate is several times faster than
// letting the browser convert it to its own rate (usually 48 kHz) along the way, and uses less memory.

const MP3_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

/** The sample rate in a WAV, MP3 or MP4/M4A header, or null if it can't be told from `bytes` (the start of the file; all of it for M4A). */
export function sniffSampleRate(bytes: Uint8Array): number | null {
  const ascii = (at: number, s: string) => [...s].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ok = (r: number) => (r >= 3000 && r <= 384000 ? r : null);

  // WAV: RIFF....WAVE, then chunks; "fmt " holds the rate at offset 4 of its data
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) {
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = view.getUint32(at + 4, true);
      if (ascii(at, 'fmt ') && at + 16 <= bytes.length) return ok(view.getUint32(at + 12, true));
      at += 8 + size + (size % 2);
    }
    return null;
  }

  // MP4 / M4A: the "mp4a" sample entry has the rate (16.16 fixed point) 24 bytes after its type
  if (ascii(4, 'ftyp')) {
    // the movie box is often at the end of the file: jump between "m" bytes with the native search
    for (let at = bytes.indexOf(0x6d, 8); at >= 0 && at + 32 <= bytes.length; at = bytes.indexOf(0x6d, at + 1))
      if (ascii(at, 'mp4a')) return ok(view.getUint16(at + 28));
    return null;
  }

  // MP3: skip an ID3v2 tag (its size is "syncsafe", 7 bits per byte), then find the first frame header
  let at = 0;
  if (ascii(0, 'ID3') && bytes.length >= 10) at = 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f);
  for (; at + 4 <= bytes.length && at < 1 << 20; at++) {
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[at + 1] >> 3) & 3;
    const layer = (bytes[at + 1] >> 1) & 3;
    const rateIndex = (bytes[at + 2] >> 2) & 3;
    if (version === 1 || layer === 0 || rateIndex === 3) continue; // reserved values: not a real header
    return MP3_RATES[version][rateIndex];
  }
  return null;
}
