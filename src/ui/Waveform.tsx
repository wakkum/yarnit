// Canvas waveform shared by the timeline lanes, the overview strip and the part pads.
import { useEffect, useRef } from 'react';
import { WHISPER_SAMPLE_RATE } from '../audio/decode';
import type { Piece } from '../engine/view';

const MOVED_COLOR = 'var(--sp2)';

/** Resolve a `var(--x)` colour for canvas, which can't read CSS variables itself. */
const resolve = (el: Element, color: string) => getComputedStyle(el).getPropertyValue(color.slice(4, -1)) || '#888';

/**
 * Canvas waveform over an axis of `length` seconds. With `pieces`, the axis is the edited timeline and
 * each x is looked up in the source through the piece that plays there; without, it is the source itself.
 */
export function Waveform({
  peaks,
  color,
  source,
  length,
  pieces,
  from = 0,
  samples,
}: {
  peaks: Float32Array | undefined;
  color: string;
  source: number;
  length: number;
  pieces?: Piece[];
  /** Axis start (output or source seconds): the left edge when zoomed in. */
  from?: number;
  /** The 16 kHz copy: zoomed in past the peaks' resolution, bars are read from it directly. */
  samples?: Float32Array | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks || length <= 0) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = (canvas.width = canvas.clientWidth * dpr);
      const h = (canvas.height = canvas.clientHeight * dpr);
      const g = canvas.getContext('2d')!;
      const main = resolve(canvas, color);
      const moved = resolve(canvas, MOVED_COLOR);
      const max = Math.max(0.01, ...peaks);
      const bar = Math.max(1, Math.floor(2 * dpr));
      const bucket = source / peaks.length;
      const perBar = (length / w) * (bar + 1);
      const fine = samples && perBar < bucket;
      let pi = 0;
      for (let x = 0; x < w; x += bar + 1) {
        const t = from + (x / w) * length;
        let src = t;
        let isMoved = false;
        if (pieces) {
          // x only grows, so walk the pieces forward instead of searching each time
          while (pi < pieces.length - 1 && t >= pieces[pi].at + pieces[pi].end - pieces[pi].start) pi++;
          const p = pieces[pi];
          if (!p) break;
          src = p.start + (t - p.at);
          isMoved = p.moved;
        }
        let v: number;
        if (fine) {
          const a = Math.max(0, Math.floor(src * WHISPER_SAMPLE_RATE));
          const b = Math.min(samples.length, Math.ceil((src + perBar) * WHISPER_SAMPLE_RATE));
          let m = 0;
          for (let k = a; k < b; k++) m = Math.max(m, Math.abs(samples[k]));
          v = Math.min(1, m / max);
        } else {
          v = peaks[Math.min(peaks.length - 1, Math.max(0, Math.floor((src / source) * peaks.length)))] / max;
        }
        const amp = Math.max(1, v * (h / 2 - 2));
        g.fillStyle = isMoved ? moved : main;
        g.fillRect(x, h / 2 - amp, bar, amp * 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, color, source, length, pieces, from, samples]);
  return <canvas ref={ref} />;
}
