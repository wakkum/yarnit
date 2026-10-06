// Plays the edit live: schedules each kept segment of every track on the ORIGINAL
// AudioBuffers with Web Audio, a second ahead at a time. No re-render on edit.
// Fades match render.ts (same length, same equal-power curve) so playback == export.
import { outputDuration, outputToSource } from '../engine/edl';
import { FADE_SECONDS } from '../engine/render';
import type { Segment } from '../engine/types';

export type PlayerTrack = { buffer: AudioBuffer; offset: number; gain?: number };

const LOOKAHEAD = 1.0; // seconds scheduled ahead of the playhead
const TICK_MS = 200;

const fadeIn = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * (Math.PI / 2)));
const fadeOut = fadeIn.slice().reverse();

export class Player {
  readonly ctx: AudioContext;
  private tracks: PlayerTrack[] = [];
  private segments: Segment[] = [];
  private nodes: AudioScheduledSourceNode[] = [];
  private timer: number | undefined;
  private startCtx = 0; // ctx time at which output time `startOut` plays
  private startOut = 0;
  private pausedAt = 0;
  private nextIndex = 0; // next segment to schedule
  private nextOut = 0; // output time where that segment starts
  private until = Infinity; // output time to stop at (playing one part), else the end
  playing = false;
  onEnded?: () => void;

  constructor(ctx = new AudioContext()) {
    this.ctx = ctx;
  }

  setTracks(tracks: PlayerTrack[]) {
    this.tracks = tracks;
  }

  /** Swap the edit list. Keeps playing from the same output time if playing. */
  setSegments(segments: Segment[]) {
    const t = this.currentTime;
    const wasPlaying = this.playing;
    this.stopNodes();
    this.segments = segments;
    this.pausedAt = Math.min(t, outputDuration(segments));
    if (wasPlaying) this.play(this.pausedAt);
  }

  get duration() {
    return outputDuration(this.segments);
  }

  get currentTime() {
    return this.playing ? this.startOut + (this.ctx.currentTime - this.startCtx) : this.pausedAt;
  }

  /** Play from `from`; with `until`, stop there (fading out, as at a cut) instead of at the end. */
  async play(from = this.pausedAt, until = Infinity) {
    await this.ctx.resume();
    this.stopNodes();
    const pos = outputToSource(this.segments, from);
    if (!pos) return;
    this.playing = true;
    this.until = until;
    this.startCtx = this.ctx.currentTime + 0.05;
    this.startOut = from;
    this.nextIndex = pos.index;
    // output time at which segment pos.index starts
    this.nextOut = from - (pos.source - this.segments[pos.index].start);
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  pause() {
    this.pausedAt = this.currentTime;
    this.stopNodes();
  }

  seek(outputTime: number) {
    if (this.playing) this.play(outputTime);
    else this.pausedAt = outputTime;
  }

  private schedule() {
    const horizon = this.currentTime + LOOKAHEAD;
    while (this.nextIndex < this.segments.length && this.nextOut < horizon && this.nextOut < this.until) {
      const seg = this.segments[this.nextIndex];
      this.scheduleSegment(seg, this.nextOut, this.nextIndex);
      this.nextOut += seg.end - seg.start;
      this.nextIndex++;
    }
    const end = Math.min(this.duration, this.until);
    if ((this.nextIndex >= this.segments.length || this.nextOut >= this.until) && this.currentTime >= end) {
      this.pausedAt = end < this.duration ? end : 0;
      this.stopNodes();
      this.onEnded?.();
    }
  }

  private scheduleSegment(seg: Segment, segOut: number, index: number) {
    const full = seg.end - seg.start;
    // a range that ends inside this segment stops (and fades) there
    const len = Math.min(full, this.until - segOut);
    const clipped = len < full;
    // skip the part of the first segment before the playhead
    const skip = Math.max(0, this.startOut - segOut);
    const when = this.startCtx + (segOut + skip - this.startOut);
    const isFirst = index === 0;
    const isLast = index === this.segments.length - 1;
    const fade = Math.min(FADE_SECONDS, len / 2);

    for (const track of this.tracks) {
      let bufOffset = seg.start + skip - track.offset;
      let at = when;
      let dur = len - skip;
      if (bufOffset < 0) {
        at -= bufOffset;
        dur += bufOffset;
        bufOffset = 0;
      }
      if (dur <= 0 || bufOffset >= track.buffer.duration) continue;

      const src = this.ctx.createBufferSource();
      src.buffer = track.buffer;
      const gain = this.ctx.createGain();
      const level = track.gain ?? 1;
      gain.gain.value = level;
      const segStartAt = this.startCtx + (segOut - this.startOut);
      if (!isFirst && skip < fade) gain.gain.setValueCurveAtTime(fadeIn.map((v) => v * level), segStartAt, fade);
      if (!isLast || clipped) gain.gain.setValueCurveAtTime(fadeOut.map((v) => v * level), segStartAt + len - fade, fade);
      src.connect(gain).connect(this.ctx.destination);
      src.start(Math.max(at, this.ctx.currentTime), bufOffset, dur);
      this.nodes.push(src);
    }
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
    this.nodes = [];
    this.playing = false;
  }
}
