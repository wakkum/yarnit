// Encodes already-rendered audio (render.ts renderEdit) to WAV or MP3 off the main thread.
// The main thread transfers the rendered channels here, so there is no extra copy.
import { AudioSample, AudioSampleSource, BufferTarget, Mp3OutputFormat, Output, Quality, WavOutputFormat, canEncodeAudio } from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';

export type ExportRequest = {
  channels: Float32Array[];
  sampleRate: number;
  format: 'wav' | 'mp3';
  /** MP3 only, bits per second. */
  bitrate?: number;
};

export type ExportMessage =
  | { type: 'progress'; progress: number }
  | { type: 'done'; data: ArrayBuffer; mimeType: string; extension: string }
  | { type: 'error'; message: string };

const post = (m: ExportMessage, transfer: Transferable[] = []) => self.postMessage(m, { transfer });

let mp3Ready: Promise<void> | null = null;
const ensureMp3 = () =>
  (mp3Ready ??= canEncodeAudio('mp3').then((native) => {
    if (!native) registerMp3Encoder();
  }));

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { channels, sampleRate, format, bitrate = 192_000 } = e.data;
  try {
    if (format === 'mp3') await ensureMp3();
    const output = new Output({
      format: format === 'mp3' ? new Mp3OutputFormat() : new WavOutputFormat(),
      target: new BufferTarget(),
    });
    const source = new AudioSampleSource(
      format === 'mp3' ? { codec: 'mp3', quality: new Quality({ bitrate, bitrateMode: 'constant' }) } : { codec: 'pcm-s16' },
    );
    output.addAudioTrack(source);
    await output.start();

    const total = channels[0]?.length ?? 0;
    const block = sampleRate; // 1 second per sample
    for (let at = 0; at < total; at += block) {
      const n = Math.min(block, total - at);
      // f32-planar = channel 0 block, then channel 1 block, ...
      const planar = new Float32Array(n * channels.length);
      channels.forEach((ch, c) => planar.set(ch.subarray(at, at + n), c * n));
      const sample = new AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: channels.length,
        sampleRate,
        timestamp: at / sampleRate,
      });
      await source.add(sample);
      sample.close();
      if ((at / block) % 30 === 0) post({ type: 'progress', progress: at / total });
    }
    await output.finalize();
    const data = output.target.buffer!;
    post({ type: 'done', data, mimeType: output.format.mimeType, extension: output.format.fileExtension }, [data]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
