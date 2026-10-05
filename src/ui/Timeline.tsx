import { useEffect, useMemo, useRef } from 'react';
import { outputDuration } from '../engine/edl';
import { useStore } from '../state/store';
import { cutRegions, fmt, trackColor, trackLabel, usePlayhead } from './util';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

function Waveform({ peaks, color }: { peaks: Float32Array | undefined; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = (canvas.width = canvas.clientWidth * dpr);
      const h = (canvas.height = canvas.clientHeight * dpr);
      const g = canvas.getContext('2d')!;
      // canvas can't read CSS variables directly, so resolve the token first
      g.fillStyle = getComputedStyle(canvas).getPropertyValue(color.slice(4, -1)) || '#888';
      const max = Math.max(0.01, ...peaks);
      const bar = Math.max(1, Math.floor(2 * dpr));
      for (let x = 0; x < w; x += bar + 1) {
        const v = peaks[Math.floor((x / w) * peaks.length)] / max;
        const amp = Math.max(1, v * (h / 2 - 2));
        g.fillRect(x, h / 2 - amp, bar, amp * 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, color]);
  return <canvas ref={ref} />;
}

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const peaks = useStore((s) => s.peaks);
  const playing = useStore((s) => s.playing);
  const phase = useStore((s) => s.phase);
  const progress = useStore((s) => s.progress);
  const message = useStore((s) => s.message);
  const { togglePlay, seekSource } = useStore.getState();
  const clock = useRef<HTMLSpanElement>(null);
  const heads = useRef<(HTMLDivElement | null)[]>([]);

  const duration = project.duration;
  const edited = outputDuration(project.segments);
  const cuts = useMemo(() => cutRegions(project.segments, duration), [project.segments, duration]);
  const ticks = useMemo(() => {
    const step = STEPS.find((s) => duration / s <= 8) ?? 3600;
    return Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  }, [duration]);

  // move the playhead and clock without re-rendering React every frame
  usePlayhead(project, (out, source) => {
    if (clock.current) clock.current.textContent = `${fmt(out)} / ${fmt(edited)}`;
    const left = source == null ? '-10px' : `${(source / duration) * 100}%`;
    for (const h of heads.current) if (h) h.style.left = left;
  });

  const working = phase === 'decoding' || phase === 'downloading' || phase === 'transcribing' || phase === 'exporting';
  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <section className="timeline">
      <div className="transport">
        <button className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play/pause (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        {/* written every frame by usePlayhead, so React must not own its text */}
        <span className="mono" ref={clock} />
        {working ? (
          <>
            <span className="muted">{message}</span>
            {phase !== 'decoding' && (
              <div className="progress" aria-label="progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </>
        ) : (
          <span className={phase === 'error' ? 'status-error' : 'muted'}>
            {phase === 'error' ? message : edited < duration - 0.05 ? `Red areas are cut. ${fmt(duration - edited)} removed.` : 'Click the waveform to jump.'}
          </span>
        )}
      </div>
      <div className="ruler">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {fmt(t)}
          </span>
        ))}
      </div>
      {project.tracks.map((track, i) => (
        <div className="lane" key={track.id}>
          <div className="lane-head" style={{ borderLeftColor: trackColor(i) }}>
            <b>{trackLabel(project, track.id, track.speakerId)}</b>
            <span className="muted" title={track.fileName}>
              {track.fileName}
            </span>
          </div>
          <div
            className="lane-body"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seekSource(((e.clientX - r.left) / r.width) * duration);
            }}
          >
            <Waveform peaks={peaks[track.id]} color={trackColor(i)} />
            {cuts.map(([a, b]) => (
              <div key={a} className="cut-region" style={{ left: pct(a), width: pct(b - a) }} />
            ))}
            <div className="playhead" ref={(el) => void (heads.current[i] = el)} />
          </div>
        </div>
      ))}
    </section>
  );
}
