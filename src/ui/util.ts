import { useEffect, useRef, useState } from 'react';
import { outputToSource } from '../engine/edl';
import type { Recording, Segment } from '../engine/types';
import { media, useStore } from '../state/store';
import type { ZoomView } from '../engine/view';

export const fmt = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Short lengths in tenths (3.0 s), longer ones as M:SS. */
export const seconds = (t: number) => (t < 60 ? `${t.toFixed(1)} s` : fmt(t));

/** "0:06.4 to 0:41.0 · 34.6 s": parts are often short, so tenths matter. */
export const rangeLabel = (a: number, b: number) => {
  const t = (x: number) => {
    const r = Math.round(x * 10) / 10;
    return `${fmt(r)}.${Math.round((r % 1) * 10)}`;
  };
  const len = b - a;
  return `${t(a)} to ${t(b)} · ${len < 60 ? `${len.toFixed(1)} s` : fmt(len)}`;
};

export const trackColor = (i: number) => `var(--sp${(i % 4) + 1})`;

/** Colour for a speaker: by position in the speaker list, else by track. */
export function speakerColor(recording: Recording, trackId: string, speakerId?: string) {
  const i = recording.speakers.findIndex((s) => s.id === speakerId);
  return trackColor(i >= 0 ? i : recording.tracks.findIndex((t) => t.id === trackId));
}

/** Display name for a track: speaker name if set, else "Speaker N". */
export function trackLabel(recording: Recording, trackId: string, speakerId?: string) {
  const sp = speakerId && recording.speakers.find((s) => s.id === speakerId);
  if (sp) return sp.name;
  return `Speaker ${recording.tracks.findIndex((t) => t.id === trackId) + 1}`;
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
export function usePlayhead(recording: Recording | null, fn: (out: number, source: number | null) => void) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    const tick = () => {
      const out = media.player?.currentTime ?? 0;
      fnRef.current(out, outputToSource(recording.segments, out)?.source ?? null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording]);
}

/** Re-renders only when the derived value changes, not every frame. */
export function usePlayheadValue<T>(recording: Recording | null, derive: (out: number, source: number | null) => T, initial: T) {
  const [value, setValue] = useState<T>(initial);
  usePlayhead(recording, (o, s) => setValue(derive(o, s)));
  return value;
}

/** Calls fn every animation frame with the main playhead (seconds). */
export function useMixPlayhead(fn: (t: number) => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      ref.current(media.mix?.currentTime ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/**
 * Drag the playhead along a ruler (pointer down on the ruler or its grip): seeks as the pointer moves.
 * Playback pauses while dragging and carries on from where the grip is let go.
 */
export function scrub(e: React.PointerEvent, ruler: Element, view: ZoomView, total: number, seek: (t: number) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const st = useStore.getState();
  const wasPlaying = st.playing;
  if (wasPlaying) st.togglePlay();
  // a ruler with no width (a hidden window) has no position to give; never seek to NaN
  const at = (x: number) => {
    const r = ruler.getBoundingClientRect();
    return r.width > 0 ? Math.max(0, Math.min(total, view.start + ((x - r.left) / r.width) * view.span)) : null;
  };
  const go = (t: number | null) => t != null && seek(t);
  go(at(e.clientX));
  let frame = 0;
  let x = e.clientX;
  const onMove = (ev: PointerEvent) => {
    x = ev.clientX;
    // one seek per frame, however fast the pointer moves
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      go(at(x));
    });
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    cancelAnimationFrame(frame);
    go(at(x));
    if (wasPlaying) useStore.getState().togglePlay();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
