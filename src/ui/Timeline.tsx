// Timeline (mockups/wave-b-edited.html, picked 5 Oct 2026): the waveform in playback order, so it shows
// what plays and exports. Moved passages are orange, joins get a red mark, and "Show original" opens a
// thin strip of the untouched recording. Zoom (mockups/zoom-b-overview.html with the buttons of
// zoom-a-buttons.html): an overview of the whole edit with a window you drag and stretch, plus − / + / Fit.
// Drag across the waveform to select (mockups/parts-a-list.html for music, speech-parts-c-margin.html for
// speech): play it, cut it (speech only) or make it a part. Parts show as coloured regions whose edges
// can be dragged.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { outputDuration, outputToSourceAt } from '../engine/edl';
import { labelRows, setPartEdge } from '../engine/parts';
import { isSpeech, type Part } from '../engine/types';
import { editedPieces, movedPassages, tickStep, toOutputSpans, type Piece, type ZoomView } from '../engine/view';
import { media, useStore } from '../state/store';
import { combo } from './keys';
import { PartsStrip } from './Parts';
import { Waveform } from './Waveform';
import { cutRegions, fmt, rangeLabel, scrub, trackColor, trackLabel, usePlayhead } from './util';

/** Music and sound effects: the colour of their sidebar icon. */
const MUSIC_COLOR = 'var(--sp4)';
/** How much one wheel notch (deltaY 100) zooms. */
const WHEEL_ZOOM = 0.006;

/** Ruler label; below 1 s spacing the tenths matter. */
const tickLabel = (t: number, step: number) => (step < 1 && t % 1 ? `${fmt(t)}.${Math.round((t % 1) * 10)}` : fmt(t));

/** Below this drag distance (px) a press on the waveform is a click: jump there. */
const DRAG_PX = 4;
/** Room a part label needs as a share of the visible span: a base plus a share per letter (stacks close labels). */
const LABEL_BASE = 0.03;
const LABEL_PER_CHAR = 0.012;

export function Timeline() {
  const recording = useStore((s) => s.recording)!;
  const peaks = useStore((s) => s.peaks);
  const playing = useStore((s) => s.playing);
  const phase = useStore((s) => s.phase);
  const progress = useStore((s) => s.progress);
  const message = useStore((s) => s.message);
  const showOriginal = useStore((s) => s.settings.showOriginal);
  const zoom = useStore((s) => s.zoom);
  const waveSel = useStore((s) => s.waveSel);
  const { togglePlay, seekSource, setSettings, setZoom, zoomBy, resetTimeline } = useStore.getState();
  const lanes = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const heads = useRef<(HTMLDivElement | null)[]>([]);
  const origHead = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLElement>(null);

  const duration = recording.duration;
  const edited = outputDuration(recording.segments);
  const pieces = useMemo(() => editedPieces(recording.segments), [recording.segments]);
  const moves = useMemo(() => movedPassages(pieces), [pieces]);
  const highlights = useMemo(() => toOutputSpans(pieces, recording.highlights), [pieces, recording.highlights]);
  const cuts = useMemo(() => cutRegions(recording.segments, duration), [recording.segments, duration]);
  const music = !isSpeech(recording.kind);
  const parts = useMemo(() => toOutputSpans(pieces, recording.parts), [pieces, recording.parts]);
  const view: ZoomView = zoom ?? { start: 0, span: Math.max(edited, 0.001) };
  const rows = useMemo(
    () => labelRows(parts.map((p) => ({ start: p.outStart, width: view.span * (LABEL_BASE + LABEL_PER_CHAR * p.name.length) }))),
    [parts, view.span],
  );
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
      const total = outputDuration(st.recording!.segments);
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
  usePlayhead(recording, (out, source) => {
    if (clock.current) clock.current.textContent = `${fmt(out)} / ${fmt(edited)}`;
    const st = useStore.getState();
    const v = st.zoom;
    // while playing, page the view along so the playhead never runs off
    if (v && st.playing && (out < v.start || out > v.start + v.span)) st.setZoom({ start: out - v.span * 0.05, span: v.span });
    const w = v ?? { start: 0, span: Math.max(edited, 0.001) };
    const left = `${((Math.min(out, edited) - w.start) / w.span) * 100}%`;
    for (const h of heads.current) if (h) h.style.left = left;
    if (grip.current) grip.current.style.left = left;
    if (origHead.current) origHead.current.style.left = source == null ? '-10px' : `${(source / duration) * 100}%`;
  });

  const working = phase === 'decoding' || phase === 'downloading' || phase === 'transcribing' || phase === 'exporting';
  const pct = (t: number) => `${((t - view.start) / view.span) * 100}%`;
  const len = (d: number) => `${(d / view.span) * 100}%`;
  const visible = (a: number, b: number) => b > view.start && a < view.start + view.span;
  const srcPct = (t: number) => `${(t / duration) * 100}%`;
  const removed = duration - edited;
  const summary = [
    removed > 0.05 && !music ? `${removed < 60 ? `${removed.toFixed(1)} s` : fmt(removed)} removed` : '',
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
            {phase === 'error'
              ? message
              : summary.length
                ? `${summary.join(', ')}.`
                : music
                  ? 'Drag across the waveform to mark a part. Click to jump.'
                  : 'Click the waveform to jump, or drag across it to select audio.'}
          </span>
        )}
        {!working && summary.length > 0 && (
          <button
            className="ghost danger reset"
            title="Bring back every cut and undo every move"
            onClick={() =>
              confirm(
                `Reset the whole timeline of ${recording.name}?\n\nEvery cut comes back and every move is undone, so it plays exactly as recorded. The transcript, highlights and speaker names stay.\n\nYou can still undo this with ${combo('mod', 'Z')}.`,
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
      <div className="ruler scrub-ruler" onPointerDown={(e) => scrub(e, e.currentTarget, view, edited, useStore.getState().seekOutput)} title="Click or drag to move the playhead">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {tickLabel(t, step)}
          </span>
        ))}
        <i className="scrub-grip" ref={grip} aria-hidden />
      </div>
      {recording.tracks.map((track, i) => (
        <div className={`lane${music ? ' tall' : ''}`} key={track.id}>
          <div className="lane-head" style={{ borderLeftColor: trackColor(i) }}>
            <b>{trackLabel(recording, track.id, track.speakerId)}</b>
            <span className="muted" title={track.fileName}>
              {track.fileName}
            </span>
          </div>
          <div className="lane-cell">
          {i === 0 && waveSel && <SelectionBar sel={waveSel} view={view} canDelete={!music} />}
          <div
            className="lane-body"
            onPointerDown={(e) => selectOnWave(e, view, edited)}
          >
            <Waveform
              peaks={peaks[track.id]}
              color={music ? MUSIC_COLOR : trackColor(i)}
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
            {parts.map((p, k) =>
                visible(p.outStart, p.outEnd) ? (
                  <PartRegion key={`${p.id}-${p.outStart}`} part={p} left={pct(p.outStart)} width={len(p.outEnd - p.outStart)} row={rows[k]} view={view} />
                ) : null,
              )}
            {waveSel && <div className="wave-sel" style={{ left: pct(waveSel.start), width: len(waveSel.end - waveSel.start) }} />}
            <div className="playhead" ref={(el) => void (heads.current[i] = el)} />
          </div>
          </div>
        </div>
      ))}
      </div>
      <Overview pieces={pieces} edited={edited} duration={duration} peaks={peaks[recording.tracks[0].id]} view={zoom} />
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
            <Waveform peaks={peaks[recording.tracks[0].id]} color="var(--muted)" source={duration} length={duration} />
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
      {!music && recording.parts.length > 0 && <PartsStrip parts={recording.parts} />}
    </section>
  );
}

/** Output seconds under the pointer, clamped to the edit. */
function timeAt(el: Element, clientX: number, view: ZoomView, total: number) {
  const r = el.getBoundingClientRect();
  return Math.max(0, Math.min(total, view.start + ((clientX - r.left) / r.width) * view.span));
}

/** Drag on a music waveform: select a range; a press without a drag jumps there instead. */
function selectOnWave(e: React.PointerEvent, view: ZoomView, total: number) {
  if (e.button !== 0) return;
  const el = e.currentTarget;
  const x0 = e.clientX;
  const t0 = timeAt(el, x0, view, total);
  const st = useStore.getState();
  let dragging = false;
  const onMove = (ev: PointerEvent) => {
    if (!dragging && Math.abs(ev.clientX - x0) < DRAG_PX) return;
    dragging = true;
    const t = timeAt(el, ev.clientX, view, total);
    st.setWaveSel({ start: Math.min(t0, t), end: Math.max(t0, t) });
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (dragging) return;
    st.setWaveSel(null);
    st.seekOutput(t0);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** The bar over a waveform selection: its range, Play, Delete (speech) and Add as part. */
function SelectionBar({ sel, view, canDelete }: { sel: { start: number; end: number }; view: ZoomView; canDelete: boolean }) {
  const { playRange, addPartFromSelection, deleteWaveSel, setWaveSel } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const share = (sel.start - view.start) / view.span;
  // start over the selection, but never past either end of the lane
  useLayoutEffect(() => {
    const el = ref.current;
    const lane = el?.parentElement;
    if (!el || !lane) return;
    el.style.left = `${Math.max(0, Math.min(share * lane.clientWidth, lane.clientWidth - el.offsetWidth))}px`;
  });
  return (
    <div className="selbar wave-bar" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <span className="mono range">{rangeLabel(sel.start, sel.end)}</span>
      <button onClick={() => playRange(sel.start, sel.end)} title="Play the selection">
        ▶ Play
      </button>
      {canDelete && (
        <button onClick={deleteWaveSel} title="Cut this audio out of the edit">
          Delete <kbd>{combo('del')}</kbd>
        </button>
      )}
      <button className="add" onClick={addPartFromSelection} title="Make this a part (Enter)">
        + Add as part <kbd>Enter</kbd>
      </button>
      <button onClick={() => setWaveSel(null)} title="Clear the selection (Esc)" aria-label="Clear the selection">
        ✕
      </button>
    </div>
  );
}

/** A part on the waveform: coloured span, a name that plays it, and edges to drag. */
function PartRegion({ part, left, width, row, view }: { part: Part & { outStart: number; outEnd: number }; left: string; width: string; row: number; view: ZoomView }) {
  const playing = useStore((s) => s.playingPart === part.id);
  const dragEdge = (e: React.PointerEvent, edge: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    const st = useStore.getState();
    const recording = st.recording!;
    const before = recording.parts;
    const body = (e.currentTarget as Element).closest('.lane-body')!;
    const total = outputDuration(recording.segments);
    let latest = before;
    const onMove = (ev: PointerEvent) => {
      const out = timeAt(body, ev.clientX, view, total);
      const src = outputToSourceAt(recording.segments, out);
      latest = setPartEdge(before, part.id, edge, src, recording.duration);
      st.previewParts(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (latest !== before) st.commitParts(latest, before);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div className={`part-region hl-${part.color}`} style={{ left, width }}>
      <button
        className={`part-label${playing ? ' on' : ''}`}
        style={{ top: 4 + row * 19 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => (playing ? useStore.getState().togglePlay() : useStore.getState().playPart(part.id))}
        title={`${part.name}: ${rangeLabel(part.start, part.end)}. Click to play.`}
      >
        {playing ? '❚❚ ' : ''}
        {part.name}
      </button>
      <span className="part-edge l" onPointerDown={(e) => dragEdge(e, 'start')} title="Drag to move the start" />
      <span className="part-edge r" onPointerDown={(e) => dragEdge(e, 'end')} title="Drag to move the end" />
    </div>
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
