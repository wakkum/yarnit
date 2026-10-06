// Decoding and resampling with the browser's built-in Web Audio decoders.

export const WHISPER_SAMPLE_RATE = 16_000;

export async function decodeFile(ctx: BaseAudioContext, file: Blob): Promise<AudioBuffer> {
  return ctx.decodeAudioData(await file.arrayBuffer());
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
