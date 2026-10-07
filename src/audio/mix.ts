// Plays the main timeline live: every stretch of every clip is scheduled a second ahead on the
// original AudioBuffers, through a gain node per clip that carries its volume and fades. The seam
// fade and the envelope come from engine/main.ts, the same as the export render.
import { clampFades, clipEntries, fadeGain, mainDuration, type Entry, type Placed } from '../engine/main';
import { FADE_SECONDS } from '../engine/render';

const LOOKAHEAD = 1.0;
const TICK_MS = 200;
/** Envelope curve points per second (Web Audio interpolates linearly between them). */
const CURVE_RATE = 100;

const seamIn = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * (Math.PI / 2)));
const seamOut = seamIn.slice().reverse();

export class MixPlayer {
  readonly ctx: AudioContext;
  private placed: Placed[] = [];
  private entries: Entry[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private nodes: AudioScheduledSourceNode[] = [];
  private gains = new Map<string, GainNode>();
  private timer: number | undefined;
  private startCtx = 0;
  private startOut = 0;
  private pausedAt = 0;
  private next = 0;
  private until = Infinity;
  playing = false;
  onEnded?: () => void;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get duration() {
    return mainDuration(this.placed);
  }

  get currentTime() {
    return this.playing ? this.startOut + (this.ctx.currentTime - this.startCtx) : this.pausedAt;
  }

  /** New layout or audio: keep the position; carry on playing unless only a range was playing. */
  set(placed: Placed[], buffers: Map<string, AudioBuffer>) {
    const t = this.currentTime;
    const wasPlaying = this.playing;
    const ranged = Number.isFinite(this.until);
    this.stopNodes();
    this.placed = placed;
    this.entries = clipEntries(placed);
    this.buffers = buffers;
    this.pausedAt = Math.min(t, this.duration);
    if (wasPlaying && !ranged) void this.play(this.pausedAt);
    else if (wasPlaying) this.onEnded?.();
  }

  async play(from = this.pausedAt, until = Infinity) {
    await this.ctx.resume();
    this.stopNodes();
    if (from >= this.duration) from = 0;
    this.playing = true;
    this.until = Math.min(until, this.duration);
    this.startCtx = this.ctx.currentTime + 0.05;
    this.startOut = from;
    this.next = 0;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  pause() {
    this.pausedAt = this.currentTime;
    this.stopNodes();
  }

  seek(t: number) {
    const to = Math.max(0, Math.min(t, this.duration));
    if (this.playing) void this.play(to);
    else this.pausedAt = to;
  }

  private schedule() {
    const now = this.currentTime;
    const horizon = Math.min(now + LOOKAHEAD, this.until);
    while (this.next < this.entries.length && this.entries[this.next].at < horizon) {
      const e = this.entries[this.next++];
      if (e.at + e.dur > this.startOut) this.scheduleEntry(e);
    }
    if (now >= this.until) {
      this.pausedAt = this.until < this.duration ? this.until : 0;
      this.stopNodes();
      this.onEnded?.();
    }
  }

  /** The gain node of a clip, with its envelope from the playhead on. */
  private clipGain(c: Placed) {
    let g = this.gains.get(c.id);
    if (g) return g;
    g = this.ctx.createGain();
    g.connect(this.ctx.destination);
    this.gains.set(c.id, g);
    const toCtx = (t: number) => this.startCtx + (t - this.startOut);
    const from = Math.max(c.start, this.startOut);
    const end = Math.min(c.start + c.length, this.until);
    g.gain.setValueAtTime(fadeGain(from - c.start, c), toCtx(from));
    // sample the envelope only where it changes: the fade in and the fade out
    const [fi, fo] = clampFades(c.length, c.fadeIn, c.fadeOut);
    const fadeInEnd = c.start + fi;
    const fadeOutStart = c.start + c.length - fo;
    const curve = (a: number, b: number) => {
      if (b - a < 0.01) return;
      const n = Math.max(2, Math.ceil((b - a) * CURVE_RATE));
      const values = Float32Array.from({ length: n }, (_, i) => fadeGain(a + ((b - a) * i) / (n - 1) - c.start, c));
      g.gain.setValueCurveAtTime(values, toCtx(a), b - a);
    };
    if (fi > 0 && fadeInEnd > from) curve(from, Math.min(fadeInEnd, end));
    if (fo > 0) curve(Math.max(fadeOutStart, from, fadeInEnd), end);
    return g;
  }

  private scheduleEntry(e: Entry) {
    const c = this.placed.find((p) => p.id === e.clipId);
    const buffer = this.buffers.get(e.trackId);
    if (!c || !buffer) return;
    const skip = Math.max(0, this.startOut - e.at);
    const dur = Math.min(e.dur, this.until - e.at) - skip;
    if (dur <= 0 || e.from + skip >= buffer.duration) return;
    const when = this.startCtx + (e.at + skip - this.startOut);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const seam = this.ctx.createGain();
    const fade = Math.min(FADE_SECONDS, e.dur / 2);
    const startAt = this.startCtx + (e.at - this.startOut);
    if (skip < fade) seam.gain.setValueCurveAtTime(seamIn, startAt, fade);
    if (e.at + e.dur <= this.until) seam.gain.setValueCurveAtTime(seamOut, startAt + e.dur - fade, fade);
    src.connect(seam).connect(this.clipGain(c));
    src.start(Math.max(when, this.ctx.currentTime), e.from + skip, dur);
    this.nodes.push(src);
  }

  private stopNodes() {
    window.clearInterval(this.timer);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
    for (const g of this.gains.values()) g.disconnect();
    this.nodes = [];
    this.gains.clear();
    this.playing = false;
  }
}
