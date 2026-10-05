import { useEffect, useRef, useState } from 'react';
import { outputToSource } from '../engine/edl';
import type { Project, Segment } from '../engine/types';
import { media } from '../state/store';

export const fmt = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export const trackColor = (i: number) => `var(--sp${(i % 4) + 1})`;

/** Display name for a track: speaker name if set, else "Speaker N". */
export function trackLabel(project: Project, trackId: string, speakerId?: string) {
  const sp = speakerId && project.speakers.find((s) => s.id === speakerId);
  if (sp) return sp.name;
  return `Speaker ${project.tracks.findIndex((t) => t.id === trackId) + 1}`;
}

/** Source-time gaps not covered by any segment, i.e. what has been cut. */
export function cutRegions(segments: Segment[], duration: number): [number, number][] {
  const kept = [...segments].sort((a, b) => a.start - b.start);
  const out: [number, number][] = [];
  let at = 0;
  for (const s of kept) {
    if (s.start > at + 0.001) out.push([at, s.start]);
    at = Math.max(at, s.end);
  }
  if (at < duration - 0.001) out.push([at, duration]);
  return out;
}

/** Calls fn every animation frame with the playhead's output and source time. */
export function usePlayhead(project: Project | null, fn: (out: number, source: number | null) => void) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!project) return;
    let raf = 0;
    const tick = () => {
      const out = media.player?.currentTime ?? 0;
      fnRef.current(out, outputToSource(project.segments, out)?.source ?? null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project]);
}

/** Re-renders only when the derived value changes, not every frame. */
export function usePlayheadValue<T>(project: Project | null, derive: (out: number, source: number | null) => T, initial: T) {
  const [value, setValue] = useState<T>(initial);
  usePlayhead(project, (o, s) => setValue(derive(o, s)));
  return value;
}
