// Local Whisper transcription with word timestamps (Transformers.js), off the main thread.
// Audio is split into ~2 minute pieces at quiet points so words stream back with progress
// and editing can start before the whole file is done.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

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
const PIECE = 120; // seconds
const SPLIT_SEARCH = 10; // look this far back from a piece end for a quiet split point

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

/** Quietest 20 ms window between from and to (sample indices). */
function quietestPoint(audio: Float32Array, from: number, to: number) {
  const win = SR / 50;
  let best = to;
  let bestE = Infinity;
  for (let i = Math.max(0, from); i + win < Math.min(to, audio.length); i += win / 2) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += audio[j] * audio[j];
    if (e < bestE) {
      bestE = e;
      best = i + win / 2;
    }
  }
  return best;
}

function pieces(audio: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  while (at < audio.length) {
    let end = Math.min(audio.length, at + PIECE * SR);
    if (end < audio.length) end = quietestPoint(audio, end - SPLIT_SEARCH * SR, end);
    out.push([at, end]);
    at = end;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<TranscribeRequest>) => {
  const { audio, model, language, device } = e.data;
  try {
    const transcriber = await load(model, device);
    post({ type: 'ready', device });
    const list = pieces(audio);
    for (const [a, b] of list) {
      const offset = a / SR;
      const out = await transcriber(audio.subarray(a, b), {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(language ? { language, task: 'transcribe' } : {}),
      });
      const chunks: Chunk[] = (Array.isArray(out) ? out[0] : out).chunks ?? [];
      const words: RawWord[] = chunks
        .filter((c) => c.text.trim())
        .map((c) => {
          const start = offset + c.timestamp[0];
          // the last word of a piece can come back without an end time
          const end = c.timestamp[1] == null ? Math.min(start + 0.4, b / SR) : offset + c.timestamp[1];
          return { text: c.text.trim(), start, end: Math.max(end, start + 0.02) };
        });
      post({ type: 'words', words, progress: b / audio.length });
    }
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
