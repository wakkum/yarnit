// Non-reactive media: decoded audio, the Whisper copy, the players. Never in Zustand state.
import type { MixPlayer } from '../audio/mix';
import type { Player } from '../audio/player';

export const media = {
  buffers: new Map<string, AudioBuffer>(),
  mono16k: null as Float32Array | null,
  /** Level below which the 16 kHz copy counts as silence (estimated per file). */
  silence: 0.002,
  player: null as Player | null,
  /** The main timeline: every clip's audio by track id, and its player (sharing the player's AudioContext). */
  mainBuffers: new Map<string, AudioBuffer>(),
  mainPeaks: new Map<string, Float32Array>(),
  mix: null as MixPlayer | null,
};
