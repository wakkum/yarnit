// The main timeline's lanes (mockups/main-a-lanes.html, picked 7 Oct 2026, with one lane per kind):
// Interview and Voice-over clips play one after another; Music and Sound-effect clips start wherever
// they are dragged and play under the voice. Every clip has a volume and a fade in and out; the
// selected clip's settings show under the lanes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { labelRows } from '../engine/parts';
import { clampFades, EMPTY_MAIN, fadeGain, layout, mainDuration, MAX_FADE, MAX_GAIN, updateClip, type Placed } from '../engine/main';
import { isSpeech, RECORDING_KINDS, type MainTimeline as Main, type RecordingKind } from '../engine/types';
import { editedPieces, tickStep, type ZoomView } from '../engine/view';
import { mainOf } from '../state/mainSlice';
import { media } from '../state/media';
import { useStore } from '../state/store';
import { KIND_LABEL } from './kinds';
import { KindIcon } from './Sidebar';
import { fmt, seconds, useMixPlayhead } from './util';
import { Waveform } from './Waveform';

const LANE_COLOR: Record<RecordingKind, string> = { interview: 'var(--sp1)', voiceover: 'var(--sp3)', music: 'var(--sp4)', sfx: 'var(--sp2)' };
const DRAG_PX = 4;
/** Height of one row of clips in a lane, px. */
const ROW = 44;
const WHEEL_ZOOM = 0.006;


export function MainTimeline() {
  const main = useStore((s) => s.project?.main ?? EMPTY_MAIN);
  const playing = useStore((s) => s.playing);
  const zoom = useStore((s) => s.zoom);
  const phase = useStore((s) => s.phase);
  const message = useStore((s) => s.message);
  const progress = useStore((s) => s.progress);
  const selected = useStore((s) => s.mainClip);
  const peaks = useStore((s) => s.peaks);
  const { togglePlay, seekMain, setZoom, zoomBy, selectClip } = useStore.getState();
  const placed = useMemo(() => layout(main), [main]);
  const total = mainDuration(placed);
  const view: ZoomView = zoom ?? { start: 0, span: Math.max(total, 1) };
  const step = tickStep(view.span);
  const ticks = useMemo(() => {
    const first = Math.ceil(view.start / step) * step;
    return Array.from({ length: Math.floor((view.start + view.span - first) / step) + 1 }, (_, i) => first + i * step);
  }, [view.start, view.span, step]);
  const lanesRef = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const heads = useRef<(HTMLDivElement | null)[]>([]);
  const pct = (t: number) => `${((t - view.start) / view.span) * 100}%`;
  const len = (d: number) => `${(d / view.span) * 100}%`;

  // a change can shorten the timeline under the current view
  useEffect(() => setZoom(useStore.getState().zoom), [total, setZoom]);

  useMixPlayhead((t) => {
    if (clock.current) clock.current.textContent = `${fmt(t)} / ${fmt(total)}`;
    const st = useStore.getState();
    const v = st.zoom;
    if (v && st.playing && (t < v.start || t > v.start + v.span)) st.setZoom({ start: t - v.span * 0.05, span: v.span });
    const w = v ?? { start: 0, span: Math.max(total, 1) };
    const left = `${((t - w.start) / w.span) * 100}%`;
    for (const h of heads.current) if (h) h.style.left = left;
  });

  // ⌘/Ctrl + wheel or pinch zooms around the pointer; sideways wheel pans (as on a recording)
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      const t = mainDuration(layout(mainOf(st)));
      const v = st.zoom ?? { start: 0, span: Math.max(t, 1) };
      const body = el.querySelector('.mlane-body');
      if (!body) return;
      const r = body.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        st.zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM), v.start + ((e.clientX - r.left) / r.width) * v.span);
      } else if (st.zoom && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) {
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        st.setZoom({ start: v.start + (d / r.width) * v.span, span: v.span });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const working = phase === 'decoding' || phase === 'exporting';
  const counts = Object.fromEntries(RECORDING_KINDS.map((k) => [k, placed.filter((c) => c.kind === k).length])) as Record<RecordingKind, number>;
  // clips that overlap in one lane (music under music) stack in rows, so none hides another
  const rows = useMemo(
    () =>
      Object.fromEntries(
        RECORDING_KINDS.map((k) => {
          const mine = placed.filter((c) => c.kind === k).sort((a, b) => a.start - b.start);
          const r = labelRows(mine.map((c) => ({ start: c.start, width: c.length - 1e-6 })));
          return [k, { row: new Map(mine.map((c, i) => [c.id, r[i]])), count: Math.max(0, ...r) + 1 }];
        }),
      ) as Record<RecordingKind, { row: Map<string, number>; count: number }>,
    [placed],
  );

  return (
    <section className="timeline main-timeline">
      <div className="transport">
        <button className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play/pause (Space)" disabled={!placed.length}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="mono" ref={clock} />
        {working ? (
          <>
            <span className="muted">{message}</span>
            {phase === 'exporting' && (
              <div className="progress" aria-label="progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </>
        ) : (
          <span className={phase === 'error' ? 'status-error' : 'muted'}>
            {phase === 'error'
              ? message
              : placed.length
                ? 'Voice clips play one after another. Drag music and effects to where they start; click a clip for its volume and fades.'
                : 'Empty so far. Open a recording and use Send to main in the top bar.'}
          </span>
        )}
        <div className="zoombox" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy(0.5)} disabled={!zoom} title="Zoom out (−)" aria-label="Zoom out">
            −
          </button>
          <span className="mono">{zoom ? `${total / zoom.span < 10 ? (total / zoom.span).toFixed(1) : Math.round(total / zoom.span)}×` : '1×'}</span>
          <button onClick={() => zoomBy(2)} disabled={!placed.length || (!!zoom && zoom.span <= 1.01)} title="Zoom in (+)" aria-label="Zoom in">
            +
          </button>
          <button onClick={() => setZoom(null)} disabled={!zoom} title="Show everything">
            Fit
          </button>
        </div>
      </div>
      <div ref={lanesRef}>
        <div className="ruler mruler" onPointerDown={(e) => seekAt(e, view, seekMain)}>
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        {RECORDING_KINDS.map((kind, i) => (
          <div className="lane mlane" key={kind}>
            <div className="lane-head" style={{ borderLeftColor: LANE_COLOR[kind] }}>
              <b>
                <KindIcon kind={kind} /> {KIND_LABEL[kind]}
              </b>
              <span className="muted">{counts[kind] ? `${counts[kind]} clip${counts[kind] === 1 ? '' : 's'}` : isSpeech(kind) ? 'plays in turn' : 'plays under voice'}</span>
            </div>
            <div
              className="lane-body mlane-body"
              style={{ height: ROW * Math.max(1, rows[kind].count) + 6 }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                selectClip(null);
                seekAt(e, view, seekMain);
              }}
            >
              {placed
                .filter((c) => c.kind === kind && c.start + c.length > view.start && c.start < view.start + view.span)
                .map((c) => (
                  <Clip
                    key={c.id}
                    c={c}
                    left={pct(c.start)}
                    width={len(c.length)}
                    top={3 + ROW * (rows[kind].row.get(c.id) ?? 0)}
                    view={view}
                    on={c.id === selected}
                    peaks={peaks[c.trackId]}
                    color={LANE_COLOR[kind]}
                  />
                ))}
              {!counts[kind] && <span className="lane-empty">{isSpeech(kind) ? `${KIND_LABEL[kind]} clips you send play here, one after another` : `${KIND_LABEL[kind]} you send lands here`}</span>}
              <div className="playhead" ref={(el) => void (heads.current[i] = el)} />
            </div>
          </div>
        ))}
      </div>
      {selected && placed.some((c) => c.id === selected) && <Inspector key={`${selected}:${placed.find((c) => c.id === selected)!.name}`} c={placed.find((c) => c.id === selected)!} />}
    </section>
  );
}

function seekAt(e: React.PointerEvent, view: ZoomView, seek: (t: number) => void) {
  const r = e.currentTarget.getBoundingClientRect();
  seek(Math.max(0, view.start + ((e.clientX - r.left) / r.width) * view.span));
}

/** One clip on a lane: drag it to move (music: its start; speech: the pause before it), click to select. */
function Clip({ c, left, width, top, view, on, peaks, color }: { c: Placed; left: string; width: string; top: number; view: ZoomView; on: boolean; peaks?: Float32Array; color: string }) {
  const pieces = useMemo(() => editedPieces(c.segments).map((p) => ({ ...p, moved: false })), [c.segments]);
  const source = media.mainBuffers.get(c.trackId)?.duration ?? Math.max(...c.segments.map((s) => s.end));
  const [fi, fo] = clampFades(c.length, c.fadeIn, c.fadeOut);
  const { length, gain, fadeIn, fadeOut } = c;
  const level = useCallback((t: number) => fadeGain(t, { length, gain, fadeIn, fadeOut }), [length, gain, fadeIn, fadeOut]);
  const st = useStore.getState();

  /** Drag the clip (mode 'move') or one of its fade handles. */
  const drag = (e: React.PointerEvent, mode: 'move' | 'in' | 'out') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    st.selectClip(c.id);
    const body = (e.currentTarget as Element).closest('.mlane-body')!;
    const perPx = view.span / body.getBoundingClientRect().width;
    const x0 = e.clientX;
    const before: Main = mainOf(useStore.getState());
    let latest = before;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < DRAG_PX) return;
      moved = true;
      const dt = dx * perPx;
      const patch =
        mode === 'move'
          ? isSpeech(c.kind)
            ? { gap: Math.max(0, c.gap + dt) }
            : { at: Math.max(0, c.at + dt) }
          : mode === 'in'
            ? { fadeIn: Math.min(MAX_FADE, Math.max(0, c.fadeIn + dt), c.length) }
            : { fadeOut: Math.min(MAX_FADE, Math.max(0, c.fadeOut - dt), c.length) };
      latest = updateClip(before, c.id, patch);
      st.previewMain(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved && latest !== before) st.commitMain(latest, before);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`mclip${on ? ' on' : ''}${isSpeech(c.kind) ? ' speech' : ''}`}
      style={{ left, width, top, height: ROW - 4, ['--c' as string]: color }}
      onPointerDown={(e) => drag(e, 'move')}
      title={`${c.name}: ${fmt(c.start)} to ${fmt(c.start + c.length)}, volume ${Math.round(c.gain * 100)}%${isSpeech(c.kind) ? '' : '. Drag to move.'}`}
    >
      <Waveform peaks={peaks} color={color} source={source} length={c.length} pieces={pieces} level={level} />
      {on && (
        <svg className="fades" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline points={`0,100 ${(fi / c.length) * 100},${100 - (c.gain / MAX_GAIN) * 100} ${100 - (fo / c.length) * 100},${100 - (c.gain / MAX_GAIN) * 100} 100,100`} />
        </svg>
      )}
      <b>{c.name}</b>
      {on && (
        <>
          <span className="fade-handle in" style={{ left: `${(fi / c.length) * 100}%` }} onPointerDown={(e) => drag(e, 'in')} title="Drag to set the fade in" />
          <span className="fade-handle out" style={{ right: `${(fo / c.length) * 100}%` }} onPointerDown={(e) => drag(e, 'out')} title="Drag to set the fade out" />
        </>
      )}
    </div>
  );
}

/** Settings of the selected clip: name, volume, fades, and for speech its place in the running order. */
function Inspector({ c }: { c: Placed }) {
  const from = useStore((s) => s.recordings.find((r) => r.id === c.recordingId)?.name);
  const st = useStore.getState();
  // a slider previews while it moves and becomes one undo step when let go
  const before = useRef<Main | null>(null);
  const [name, setName] = useState(c.name);
  const live = (patch: Partial<Placed>) => {
    before.current ??= mainOf(useStore.getState());
    st.previewMain(updateClip(mainOf(useStore.getState()), c.id, patch));
  };
  const settle = () => {
    if (!before.current) return;
    st.commitMain(mainOf(useStore.getState()), before.current);
    before.current = null;
  };
  const speech = isSpeech(c.kind);
  const num = (label: string, value: number, max: number, onChange: (v: number) => void, title: string) => (
    <label className="insp-num" title={title}>
      {label}
      <input type="number" min={0} max={max} step={0.5} value={Math.round(value * 10) / 10} onChange={(e) => onChange(Math.min(max, Math.max(0, Number(e.target.value) || 0)))} />
      <span className="muted">s</span>
    </label>
  );
  return (
    <div className="inspector" key={c.id}>
      <input
        className="insp-name"
        value={name}
        aria-label="Clip name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== c.name && st.updateClip(c.id, { name: name.trim() })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="muted">
        {from ? `from ${from} · ` : ''}
        {fmt(c.start)} to {fmt(c.start + c.length)} ({seconds(c.length)})
      </span>
      <label className="insp-vol" title="Volume of this clip. Turn background music down to 20 to 40%.">
        Volume
        <input
          type="range"
          min={0}
          max={MAX_GAIN * 100}
          step={5}
          value={Math.round(c.gain * 100)}
          onChange={(e) => live({ gain: Number(e.target.value) / 100 })}
          onPointerUp={settle}
          onKeyUp={settle}
          onBlur={settle}
        />
        <span className="mono">{Math.round(c.gain * 100)}%</span>
      </label>
      {num('Fade in', c.fadeIn, Math.min(MAX_FADE, c.length), (v) => st.updateClip(c.id, { fadeIn: v }), 'Seconds to fade in from silence')}
      {num('Fade out', c.fadeOut, Math.min(MAX_FADE, c.length), (v) => st.updateClip(c.id, { fadeOut: v }), 'Seconds to fade out to silence')}
      {speech && num('Pause before', c.gap, 60, (v) => st.updateClip(c.id, { gap: v }), 'Silence before this clip, for example to let music play first')}
      {speech && (
        <>
          <button onClick={() => st.moveClip(c.id, -1)} title="Play this clip earlier in the running order">
            ← Earlier
          </button>
          <button onClick={() => st.moveClip(c.id, 1)} title="Play this clip later in the running order">
            Later →
          </button>
        </>
      )}
      <button onClick={() => st.playClip(c.id)}>▶ Play clip</button>
      <button className="danger" onClick={() => st.removeClip(c.id)}>
        Remove
      </button>
    </div>
  );
}
