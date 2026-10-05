// Timeline (mockups/wave-b-edited.html, picked 5 Oct 2026): the waveform in playback order, so it shows
// what plays and exports. Moved passages are orange, joins get a red mark, and "Show original" opens a
// thin strip of the untouched recording. Zoom (mockups/zoom-b-overview.html with the buttons of
// zoom-a-buttons.html): an overview of the whole edit with a window you drag and stretch, plus − / + / Fit.
import { useEffect, useMemo, useRef } from 'react';
import { WHISPER_SAMPLE_RATE } from '../audio/decode';
import { outputDuration } from '../engine/edl';
import { editedPieces, movedPassages, tickStep, toOutputSpans, type Piece, type ZoomView } from '../engine/view';
import { media, useStore } from '../state/store';
import { combo } from './keys';
import { cutRegions, fmt, trackColor, trackLabel, usePlayhead } from './util';

const MOVED_COLOR = 'var(--sp2)';
/** How much one wheel notch (deltaY 100) zooms. */
const WHEEL_ZOOM = 0.006;

/** Ruler label; below 1 s spacing the tenths matter. */
const tickLabel = (t: number, step: number) => (step < 1 && t % 1 ? `${fmt(t)}.${Math.round((t % 1) * 10)}` : fmt(t));

/** Resolve a `var(--x)` colour for canvas, which can't read CSS variables itself. */
const resolve = (el: Element, color: string) => getComputedStyle(el).getPropertyValue(color.slice(4, -1)) || '#888';

/**
 * Canvas waveform over an axis of `length` seconds. With `pieces`, the axis is the edited timeline and
 * each x is looked up in the source through the piece that plays there; without, it is the source itself.
 */
function Waveform({
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

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const peaks = useStore((s) => s.peaks);
  const playing = useStore((s) => s.playing);
  const phase = useStore((s) => s.phase);
  const progress = useStore((s) => s.progress);
  const message = useStore((s) => s.message);
  const showOriginal = useStore((s) => s.settings.showOriginal);
  const zoom = useStore((s) => s.zoom);
  const { togglePlay, seekSource, seekOutput, setSettings, setZoom, zoomBy, resetTimeline } = useStore.getState();
  const lanes = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const heads = useRef<(HTMLDivElement | null)[]>([]);
  const origHead = useRef<HTMLDivElement>(null);

  const duration = project.duration;
  const edited = outputDuration(project.segments);
  const pieces = useMemo(() => editedPieces(project.segments), [project.segments]);
  const moves = useMemo(() => movedPassages(pieces), [pieces]);
  const highlights = useMemo(() => toOutputSpans(pieces, project.highlights), [pieces, project.highlights]);
  const cuts = useMemo(() => cutRegions(project.segments, duration), [project.segments, duration]);
  const view: ZoomView = zoom ?? { start: 0, span: Math.max(edited, 0.001) };
  const step = tickStep(view.span);
  const ticks = useMemo(() => {
    const first = Math.ceil(view.start / step) * step;
    return Array.from({ length: Math.floor((view.start + view.span - first) / step) + 1 }, (_, i) => first + i * step);
  }, [view.start, view.span, step]);

  // a cut can shrink the edit under the current view
  useEffect(() => setZoom(useStore.getState().zoom), [edited, setZoom]);

  // ⌘/Ctrl + wheel (and trackpad pinch, which arrives as ctrl + wheel) zooms around the pointer;
  // a sideways scroll, or Shift + wheel, pans. Needs a non-passive listener to stop page zoom.
  useEffect(() => {
    const el = lanes.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      const total = outputDuration(st.project!.segments);
      const v = st.zoom ?? { start: 0, span: total };
      const r = el.querySelector('.lane-body')!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = v.start + ((e.clientX - r.left) / r.width) * v.span;
        st.zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM), anchor);
      } else if (st.zoom && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) {
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        st.setZoom({ start: v.start + (d / r.width) * v.span, span: v.span });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // move the playheads and clock without re-rendering React every frame
  usePlayhead(project, (out, source) => {
    if (clock.current) clock.current.textContent = `${fmt(out)} / ${fmt(edited)}`;
    const st = useStore.getState();
    const v = st.zoom;
    // while playing, page the view along so the playhead never runs off
    if (v && st.playing && (out < v.start || out > v.start + v.span)) st.setZoom({ start: out - v.span * 0.05, span: v.span });
    const w = v ?? { start: 0, span: Math.max(edited, 0.001) };
    const left = `${((Math.min(out, edited) - w.start) / w.span) * 100}%`;
    for (const h of heads.current) if (h) h.style.left = left;
    if (origHead.current) origHead.current.style.left = source == null ? '-10px' : `${(source / duration) * 100}%`;
  });

  const working = phase === 'decoding' || phase === 'downloading' || phase === 'transcribing' || phase === 'exporting';
  const pct = (t: number) => `${((t - view.start) / view.span) * 100}%`;
  const len = (d: number) => `${(d / view.span) * 100}%`;
  const visible = (a: number, b: number) => b > view.start && a < view.start + view.span;
  const srcPct = (t: number) => `${(t / duration) * 100}%`;
  const removed = duration - edited;
  const summary = [
    removed > 0.05 ? `${removed < 60 ? `${removed.toFixed(1)} s` : fmt(removed)} removed` : '',
    moves.length ? `${moves.length} passage${moves.length === 1 ? '' : 's'} moved` : '',
  ].filter(Boolean);

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
            {phase === 'error' ? message : summary.length ? `${summary.join(', ')}.` : 'Click the waveform to jump.'}
          </span>
        )}
        {!working && summary.length > 0 && (
          <button
            className="ghost danger reset"
            title="Bring back every cut and undo every move"
            onClick={() =>
              confirm(
                `Reset the whole timeline of ${project.name}?\n\nEvery cut comes back and every move is undone, so it plays exactly as recorded. The transcript, highlights and speaker names stay.\n\nYou can still undo this with ${combo('mod', 'Z')}.`,
              ) && resetTimeline()
            }
          >
            Reset timeline
          </button>
        )}
        <div className="zoombox" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy(0.5)} disabled={!zoom} title="Zoom out (−)" aria-label="Zoom out">
            −
          </button>
          <span className="mono" title="How far you are zoomed in">
            {zoom ? `${edited / zoom.span < 10 ? (edited / zoom.span).toFixed(1) : Math.round(edited / zoom.span)}×` : '1×'}
          </span>
          <button onClick={() => zoomBy(2)} disabled={!!zoom && zoom.span <= 1.01} title="Zoom in (+)" aria-label="Zoom in">
            +
          </button>
          <button onClick={() => setZoom(null)} disabled={!zoom} title="Show the whole edit">
            Fit
          </button>
        </div>
      </div>
      <div ref={lanes}>
      <div className="ruler">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {tickLabel(t, step)}
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
              seekOutput(view.start + ((e.clientX - r.left) / r.width) * view.span);
            }}
          >
            <Waveform
              peaks={peaks[track.id]}
              color={trackColor(i)}
              source={duration}
              length={view.span}
              from={view.start}
              pieces={pieces}
              samples={i === 0 ? media.mono16k : null}
            />
            {moves.filter((m) => visible(m.at, m.at + m.length)).map((m) => (
              <div key={m.at} className="moved-box" style={{ left: pct(m.at), width: len(m.length) }} title={`Moved here from ${fmt(m.from)} in the original`}>
                <span className="tag">moved from {fmt(m.from)}</span>
              </div>
            ))}
            {highlights.filter((h) => visible(h.outStart, h.outEnd)).map((h) => (
              <div key={`${h.id}-${h.outStart}`} className={`hl-strip hl-${h.color}`} style={{ left: pct(h.outStart), width: len(h.outEnd - h.outStart) }} />
            ))}
            {pieces
              .filter((p) => p.join && visible(p.at, p.at))
              .map((p) => (
                <div key={p.at} className="join" style={{ left: pct(p.at) }} />
              ))}
            <div className="playhead" ref={(el) => void (heads.current[i] = el)} />
          </div>
        </div>
      ))}
      </div>
      <Overview pieces={pieces} edited={edited} duration={duration} peaks={peaks[project.tracks[0].id]} view={zoom} />
      <div className="orig">
        <button className="ghost orig-toggle" onClick={() => setSettings({ showOriginal: !showOriginal })} aria-expanded={showOriginal}>
          {showOriginal ? 'Hide original ▾' : 'Show original ▸'}
        </button>
        {showOriginal && (
          <div
            className="orig-strip"
            title="The original recording. Click to jump to that moment."
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seekSource(((e.clientX - r.left) / r.width) * duration);
            }}
          >
            <Waveform peaks={peaks[project.tracks[0].id]} color="var(--muted)" source={duration} length={duration} />
            {cuts.map(([a, b]) => (
              <div key={a} className="cut-region" style={{ left: srcPct(a), width: srcPct(b - a) }} />
            ))}
            {pieces
              .filter((p) => p.moved)
              .map((p) => (
                <div key={p.start} className="moved-src" style={{ left: srcPct(p.start), width: srcPct(p.end - p.start) }} />
              ))}
            <div className="playhead" ref={origHead} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The whole edit as a thin strip, with a window showing what the lanes show. Drag the window to pan,
 * drag its edges to zoom, click elsewhere to centre it there, double-click to fit.
 */
function Overview({ pieces, edited, duration, peaks, view }: { pieces: Piece[]; edited: number; duration: number; peaks: Float32Array | undefined; view: ZoomView | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = view ?? { start: 0, span: edited };
  const pct = (t: number) => `${(t / Math.max(edited, 0.001)) * 100}%`;

  /** Pointer drag: 'move' pans the window, 'left' / 'right' move one edge. */
  const startDrag = (e: React.PointerEvent, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const toT = (x: number) => ((x - r.left) / r.width) * edited;
    const grab = toT(e.clientX);
    const start0 = v.start;
    const end0 = v.start + v.span;
    const { setZoom } = useStore.getState();
    const onMove = (ev: PointerEvent) => {
      const t = toT(ev.clientX);
      if (mode === 'move') setZoom({ start: start0 + t - grab, span: end0 - start0 });
      else if (mode === 'left') setZoom({ start: Math.min(t, end0 - 1), span: end0 - Math.min(t, end0 - 1) });
      else setZoom({ start: start0, span: Math.max(1, t - start0) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="overview"
      ref={ref}
      title="The whole edit. Drag the window to move, its edges to zoom; double-click to fit."
      onPointerDown={(e) => {
        // click outside the window: centre the window there, then keep dragging it
        const r = e.currentTarget.getBoundingClientRect();
        const t = ((e.clientX - r.left) / r.width) * edited;
        if (view) useStore.getState().setZoom({ start: t - v.span / 2, span: v.span });
      }}
      onDoubleClick={() => useStore.getState().setZoom(null)}
    >
      <Waveform peaks={peaks} color="var(--muted)" source={duration} length={edited} pieces={pieces} />
      <div className="dim" style={{ left: 0, width: pct(v.start) }} />
      <div className="dim" style={{ left: pct(v.start + v.span), right: 0 }} />
      <div className="win" style={{ left: pct(v.start), width: pct(v.span) }} onPointerDown={(e) => startDrag(e, 'move')}>
        <span className="edge l" onPointerDown={(e) => startDrag(e, 'left')} />
        <span className="edge r" onPointerDown={(e) => startDrag(e, 'right')} />
      </div>
    </div>
  );
}
