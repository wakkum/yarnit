// Turns source audio + the edit list into the edited audio. Pure Float32Array math,
// shared by export (renderEdit) and cut placement (snapToQuiet). Tested in render.test.ts.
import type { Segment } from './types';

export type TrackAudio = {
  /** One Float32Array per channel at `sampleRate`. */
  channels: Float32Array[];
  /** Seconds this track is shifted on the source timeline. */
  offset: number;
  gain?: number;
};

/** Fade length at each seam. Player and export must use the same value. */
export const FADE_SECONDS = 0.008;

/**
 * Render the edit: every segment in order, all tracks mixed, with a short
 * fade-out/fade-in at every seam so cuts never click. Output length equals
 * outputDuration(segments) exactly, which keeps time mapping simple.
 */
export function renderEdit(
  tracks: TrackAudio[],
  segments: Segment[],
  sampleRate: number,
  fadeSeconds = FADE_SECONDS,
): Float32Array[] {
  const numChannels = Math.max(1, ...tracks.map((t) => t.channels.length));
  const lengths = segments.map((s) => Math.round(s.end * sampleRate) - Math.round(s.start * sampleRate));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out = Array.from({ length: numChannels }, () => new Float32Array(total));
  const fade = Math.round(fadeSeconds * sampleRate);

  let pos = 0;
  segments.forEach((seg, si) => {
    const len = lengths[si];
    for (const track of tracks) {
      const gain = track.gain ?? 1;
      const srcStart = Math.round((seg.start - track.offset) * sampleRate);
      for (let c = 0; c < numChannels; c++) {
        // mono tracks feed every output channel
        const src = track.channels[Math.min(c, track.channels.length - 1)];
        const dst = out[c];
        const from = Math.max(0, -srcStart);
        const to = Math.min(len, src.length - srcStart);
        for (let i = from; i < to; i++) dst[pos + i] += src[srcStart + i] * gain;
      }
    }
    // Fades only at real seams: not at the very start/end of the output.
    const f = Math.min(fade, Math.floor(len / 2));
    for (let c = 0; c < numChannels; c++) {
      const dst = out[c];
      for (let i = 0; i < f; i++) {
        const g = Math.sin((i / f) * (Math.PI / 2)); // equal-power curve
        if (si > 0) dst[pos + i] *= g;
        if (si < segments.length - 1) dst[pos + len - 1 - i] *= g;
      }
    }
    pos += len;
  });
  return out;
}

/** Average power per window, used to find quiet moments. */
function windowEnergy(samples: Float32Array, from: number, size: number) {
  let sum = 0;
  const end = Math.min(samples.length, from + size);
  for (let i = Math.max(0, from); i < end; i++) sum += samples[i] * samples[i];
  return sum / Math.max(1, end - from);
}

/** RMS of 20 ms windows, for noise-floor and speech-end detection. */
function windowRms(mono: Float32Array, from: number, size: number) {
  return Math.sqrt(windowEnergy(mono, from, size));
}

/**
 * Estimate the recording's noise floor: a quiet-percentile window level, times a margin.
 * Anything below it counts as silence.
 */
export function silenceThreshold(mono: Float32Array, sampleRate: number): number {
  const size = Math.round(0.02 * sampleRate);
  const levels: number[] = [];
  for (let i = 0; i + size <= mono.length; i += size) levels.push(windowRms(mono, i, size));
  if (!levels.length) return 0.002;
  levels.sort((a, b) => a - b);
  return Math.max(0.002, levels[Math.floor(levels.length * 0.1)] * 3);
}

/**
 * Whisper often stretches a word's end over the pause after it. Return the time the
 * sound in [start, end] actually stops (plus a short tail), never earlier than start.
 */
export function speechEnd(mono: Float32Array, sampleRate: number, start: number, end: number, threshold: number): number {
  const size = Math.round(0.02 * sampleRate);
  const a = Math.round(start * sampleRate);
  for (let i = Math.round(end * sampleRate) - size; i >= a; i -= size) {
    if (windowRms(mono, i, size) > threshold) return Math.min(end, (i + size) / sampleRate + 0.06);
  }
  return Math.min(end, start + 0.1);
}

/**
 * Move a cut point to the quietest 5 ms window between lo and hi (seconds),
 * so cuts land in pauses instead of clipping a word's edge.
 */
export function snapToQuiet(mono: Float32Array, sampleRate: number, t: number, lo: number, hi: number): number {
  const size = Math.max(1, Math.round(0.005 * sampleRate));
  const a = Math.max(0, Math.round(lo * sampleRate));
  const b = Math.min(mono.length - size, Math.round(hi * sampleRate));
  if (b <= a) return t;
  let best = Math.round(t * sampleRate) - Math.floor(size / 2);
  let bestE = windowEnergy(mono, best, size);
  for (let i = a; i <= b; i += Math.max(1, Math.floor(size / 2))) {
    const e = windowEnergy(mono, i, size);
    // prefer the original point unless clearly quieter (avoids jitter on flat silence)
    if (e < bestE * 0.7) {
      bestE = e;
      best = i;
    }
  }
  return (best + size / 2) / sampleRate;
}

export type SpeechPieceOptions = {
  /** Longest piece in seconds (Whisper's window is 30 s). */
  maxLen?: number;
  /** Sound separated by a shorter gap counts as one stretch of speech. */
  joinGap?: number;
  /** A gap at least this long always ends a piece, so long silences are never transcribed. */
  breakGap?: number;
  /** Margin kept around speech so soft word onsets and tails are not clipped. */
  pad?: number;
};

/**
 * Split audio into pieces for transcription: only stretches with sound, each at most `maxLen`,
 * cut in the middle of pauses. Sending Whisper pure silence makes it invent words, and a piece
 * that starts right on a word tends to lose that word. Returns [start, end] in seconds.
 */
export function speechPieces(
  mono: Float32Array,
  sampleRate: number,
  threshold: number,
  { maxLen = 28, joinGap = 0.3, breakGap = 2, pad = 0.3 }: SpeechPieceOptions = {},
): [number, number][] {
  const size = Math.round(0.02 * sampleRate);
  const dur = mono.length / sampleRate;
  // stretches of sound, joined across short gaps
  const regions: [number, number][] = [];
  for (let i = 0; i + size <= mono.length; i += size) {
    if (windowRms(mono, i, size) <= threshold) continue;
    const a = i / sampleRate;
    const b = (i + size) / sampleRate;
    const last = regions.at(-1);
    if (last && a - last[1] < joinGap) last[1] = b;
    else regions.push([a, b]);
  }
  const out: [number, number][] = [];
  let start = -1;
  let end = -1;
  const close = (nextStart: number) => {
    // end halfway into the following gap (or at the padded end), never past the next sound
    out.push([start, Math.min(dur, end + pad, end + (nextStart - end) / 2)]);
  };
  for (const [a, b] of regions) {
    if (start < 0) {
      start = Math.max(0, a - pad);
    } else if (a - end >= breakGap || b - start > maxLen) {
      close(a);
      start = Math.max(out.at(-1)![1], a - pad);
    }
    end = b;
    // one stretch of speech longer than a piece: cut it at its quietest point near the limit
    while (end - start > maxLen) {
      const cut = snapToQuiet(mono, sampleRate, start + maxLen, start + maxLen - 8, start + maxLen);
      out.push([start, cut]);
      start = cut;
    }
  }
  if (start >= 0) close(Infinity);
  return out;
}
