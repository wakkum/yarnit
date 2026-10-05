// Local Whisper transcription with word timestamps (Transformers.js), off the main thread.
// Only the stretches with sound are sent, in pieces of up to ~28 s (one Whisper window) cut in
// pauses (render.ts speechPieces), so words and progress stream back every few seconds, long
// silences are skipped (Whisper invents words on silence), and no piece starts on a word.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { silenceThreshold, speechPieces } from '../engine/render';

export type TranscribeRequest = {
  /** 16 kHz mono samples. */
  audio: Float32Array;
  model: string;
  /** e.g. 'english'. Omit for English-only (.en) models. */
  language?: string;
  device: 'webgpu' | 'wasm';
};

type Chunk = { text: string; timestamp: [number, number | null] };

export type RawWord = { text: string; start: number; end: number };

export type TranscribeMessage =
  | { type: 'download'; progress: number; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'words'; words: RawWord[]; progress: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

const SR = 16_000;

const post = (m: TranscribeMessage) => self.postMessage(m);

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedKey = '';

function load(model: string, device: 'webgpu' | 'wasm') {
  const key = `${model}|${device}`;
  if (asr && key === loadedKey) return asr;
  loadedKey = key;
  asr = pipeline('automatic-speech-recognition', model, {
    device,
    // WebGPU: full-precision encoder keeps timestamps stable; WASM: 8-bit for speed.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: { status: string; progress?: number; loaded?: number; total?: number }) => {
      if (p.status === 'progress_total') {
        post({ type: 'download', progress: (p.progress ?? 0) / 100, loaded: p.loaded ?? 0, total: p.total ?? 0 });
      }
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  return asr;
}

self.onmessage = async (e: MessageEvent<TranscribeRequest>) => {
  const { audio, model, language, device } = e.data;
  try {
    const transcriber = await load(model, device);
    post({ type: 'ready', device });
    const duration = audio.length / SR;
    for (const [from, to] of speechPieces(audio, SR, silenceThreshold(audio, SR))) {
      const [a, b] = [Math.round(from * SR), Math.round(to * SR)];
      const offset = from;
      const out = await transcriber(audio.subarray(a, b), {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(language ? { language, task: 'transcribe' } : {}),
      });
      const chunks: Chunk[] = (Array.isArray(out) ? out[0] : out).chunks ?? [];
      const words: RawWord[] = chunks
        // Whisper emits stray punctuation-only "words" on silence (seen: a lone "." in 30 s of room noise)
        .filter((c) => /[\p{L}\p{N}]/u.test(c.text))
        .map((c) => {
          const start = offset + c.timestamp[0];
          // the last word of a piece can come back without an end time
          const end = c.timestamp[1] == null ? Math.min(start + 0.4, to) : offset + c.timestamp[1];
          return { text: c.text.trim(), start, end: Math.max(end, start + 0.02) };
        });
      post({ type: 'words', words, progress: to / duration });
    }
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
