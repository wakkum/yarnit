// Decoding and resampling with the browser's built-in Web Audio decoders.
import { sniffSampleRate } from '../engine/sampleRate';

export const WHISPER_SAMPLE_RATE = 16_000;

/**
 * Decode a whole file. At the file's own sample rate when its header says (several times faster than
 * converting to the playback context's rate, and smaller); the player and export handle any rate.
 */
export async function decodeFile(ctx: BaseAudioContext, file: Blob): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  const rate = sniffSampleRate(new Uint8Array(data));
  const decoder = rate && rate !== ctx.sampleRate ? new OfflineAudioContext(1, 1, rate) : ctx;
  return decoder.decodeAudioData(data);
}

/** Mono 16 kHz copy for Whisper, also used for cut snapping (small: ~230 MB per hour). */
export async function toWhisperMono(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * WHISPER_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination); // the 1-channel destination downmixes
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** A buffer's channels at another sample rate (for mixing files recorded at different rates). */
export async function resampled(buffer: AudioBuffer, rate: number): Promise<Float32Array[]> {
  if (buffer.sampleRate === rate) return channelsOf(buffer);
  const offline = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return channelsOf(await offline.startRendering());
}

export const channelsOf = (buffer: AudioBuffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));

/** A file's length in seconds from its metadata, without decoding it (0 if the browser can't tell). */
export function probeDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}
