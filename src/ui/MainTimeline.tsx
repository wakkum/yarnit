// The main timeline's lanes (mockups/main-a-lanes.html, picked 7 Oct 2026, with one lane per kind):
// Interview and Voice-over clips play one after another; Music and Sound-effect clips start wherever
// they are dragged and play under the voice. Every clip has a volume and a fade in and out; the
// selected clip's settings show under the lanes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { labelRows } from '../engine/parts';
import {
  addKey,
  clampFades,
  cutPoint,
  EMPTY_MAIN,
  envelope,
  fadeGain,
  hasEnvelope,
  layout,
  mainDuration,
  MAX_FADE,
  MAX_GAIN,
  moveKey,
  removeKey,
  setLevel,
  snapMove,
  snapTargets,
  updateClip,
  type Placed,
  type SnapTarget,
  wordTimes,
} from '../engine/main';
import { isSpeech, RECORDING_KINDS, type MainTimeline as Main, type RecordingKind } from '../engine/types';
import { editedPieces, tickStep, type ZoomView } from '../engine/view';
import { mainOf } from '../state/mainSlice';
import { media } from '../state/media';
import { useStore } from '../state/store';
import { KIND_LABEL } from './kinds';
import { KindIcon } from './Sidebar';
import { fmt, scrub, seconds, useMixPlayhead } from './util';
import { Waveform } from './Waveform';

const LANE_COLOR: Record<RecordingKind, string> = { interview: 'var(--sp1)', voiceover: 'var(--sp3)', music: 'var(--sp4)', sfx: 'var(--sp2)' };
/** Lane order, top to bottom (user's choice, 7 Oct 2026). */
const LANES: RecordingKind[] = ['voiceover', 'interview', 'music', 'sfx'];
const DRAG_PX = 4;
/** Height of one row of clips in a lane, px: normal, the focused clip's lane, the other lanes while focused. */
const ROW = 44;
const BIG_ROW = 190;
const SLIM_ROW = 16;
const WHEEL_ZOOM = 0.006;
/** How close, in px, a dragged edge must come to snap. */
const SNAP_PX = 8;

/** A click (not a drag) on a clip: the menu at the pointer, for main-timeline time `t`. */
type ClipMenu = { id: string; t: number; x: number; y: number; span: number; width: number };
const tenths = (t: number) => `${fmt(t)}.${Math.floor((t % 1) * 10 + 1e-6)}`;


export function MainTimeline() {
  const main = useStore((s) => s.project?.main ?? EMPTY_MAIN);
  const playing = useStore((s) => s.playing);
  const zoom = useStore((s) => s.zoom);
  const phase = useStore((s) => s.phase);
  const message = useStore((s) => s.message);
  const progress = useStore((s) => s.progress);
  const selected = useStore((s) => s.mainClip);
  const peaks = useStore((s) => s.peaks);
  const snap = useStore((s) => s.settings.snap);
  const focus = useStore((s) => s.mainFocus);
  const { togglePlay, seekMain, setZoom, zoomBy, selectClip, setSettings } = useStore.getState();
  const [guide, setGuide] = useState<SnapTarget | null>(null);
  const [menu, setMenu] = useState<ClipMenu | null>(null);
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
  const grip = useRef<HTMLElement>(null);
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
    if (grip.current) grip.current.style.left = left;
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
  const focused = focus ? placed.find((c) => c.id === focus.id) : undefined;
  const rowH = (kind: RecordingKind) => (!focused ? ROW : kind === focused.kind ? BIG_ROW : SLIM_ROW);
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
    <section className={`timeline main-timeline${focused ? ' focused' : ''}`}>
      {focused && (
        <div className="focus-bar">
          <button onClick={() => useStore.getState().focusClip(null)}>← Back to all</button>
          <b>{focused.name}</b>
          <span className="muted">
            {fmt(focused.start)} to {fmt(focused.start + focused.length)} · double-click it or press Esc to go back
          </span>
        </div>
      )}
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
                ? 'Voice clips play one after another. Drag clips to move them; click one to cut it there or set its volume and fades.'
                : 'Empty so far. Open a recording and use Send to main in the top bar.'}
          </span>
        )}
        <button
          className={`snap-toggle${snap ? ' on' : ''}`}
          aria-pressed={snap}
          onClick={() => setSettings({ snap: !snap })}
          title="Dragged clips snap to the edges of other clips and to the playhead (S). Hold Alt while dragging to skip it once."
        >
          Snap
        </button>
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
        <div className="ruler mruler" onPointerDown={(e) => scrub(e, e.currentTarget, view, total, seekMain)} title="Click or drag to move the playhead">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {fmt(t)}
            </span>
          ))}
          {guide && (
            <b className="snap-label" style={{ left: pct(guide.t) }}>
              Snaps to {guide.label}
            </b>
          )}
          <i className="scrub-grip" ref={grip} aria-hidden />
        </div>
        {LANES.map((kind, i) => (
          <div className={`lane mlane${focused ? (kind === focused.kind ? ' big' : ' slim') : ''}`} key={kind}>
            <div className="lane-head" style={{ borderLeftColor: LANE_COLOR[kind] }}>
              <b>
                <KindIcon kind={kind} /> {KIND_LABEL[kind]}
              </b>
              <span className="muted">{counts[kind] ? `${counts[kind]} clip${counts[kind] === 1 ? '' : 's'}` : isSpeech(kind) ? 'plays in turn' : 'plays under voice'}</span>
            </div>
            <div
              className="lane-body mlane-body"
              style={{ height: rowH(kind) * Math.max(1, rows[kind].count) + 6 }}
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
                    top={3 + rowH(kind) * (rows[kind].row.get(c.id) ?? 0)}
                    height={rowH(kind) - 4}
                    words={c.id === focused?.id && isSpeech(c.kind)}
                    view={view}
                    on={c.id === selected}
                    peaks={peaks[c.trackId]}
                    color={LANE_COLOR[kind]}
                    cutAt={menu?.id === c.id ? cutPoint(c, menu.t - c.start).t : null}
                    onGuide={setGuide}
                    onMenu={setMenu}
                  />
                ))}
              {guide && <div className="snap-guide" style={{ left: pct(guide.t) }} />}
              {!counts[kind] && <span className="lane-empty">{isSpeech(kind) ? `${KIND_LABEL[kind]} clips you send play here, one after another` : `${KIND_LABEL[kind]} you send lands here`}</span>}
              <div className="playhead" ref={(el) => void (heads.current[i] = el)} />
            </div>
          </div>
        ))}
      </div>
      {menu && placed.some((c) => c.id === menu.id) && <ClipMenuPop menu={menu} c={placed.find((c) => c.id === menu.id)!} close={() => setMenu(null)} />}
      {selected && placed.some((c) => c.id === selected) && <Inspector key={`${selected}:${placed.find((c) => c.id === selected)!.name}`} c={placed.find((c) => c.id === selected)!} />}
    </section>
  );
}

function seekAt(e: React.PointerEvent, view: ZoomView, seek: (t: number) => void) {
  const r = e.currentTarget.getBoundingClientRect();
  seek(Math.max(0, view.start + ((e.clientX - r.left) / r.width) * view.span));
}

/** One clip on a lane: drag it to move (music: its start; speech: the pause before it), click to select. */
function Clip({
  c,
  left,
  width,
  top,
  view,
  on,
  peaks,
  color,
  cutAt,
  onGuide,
  onMenu,
  height,
  words,
}: {
  c: Placed;
  left: string;
  width: string;
  top: number;
  view: ZoomView;
  on: boolean;
  peaks?: Float32Array;
  color: string;
  /** Clip time where the open menu would cut, drawn as a line. */
  cutAt: number | null;
  onGuide: (g: SnapTarget | null) => void;
  onMenu: (m: ClipMenu | null) => void;
  height: number;
  /** Write the clip's words under its waveform (the focused voice clip). */
  words: boolean;
}) {
  const pieces = useMemo(() => editedPieces(c.segments).map((p) => ({ ...p, moved: false })), [c.segments]);
  const source = media.mainBuffers.get(c.trackId)?.duration ?? Math.max(...c.segments.map((s) => s.end));
  const [fi, fo] = clampFades(c.length, c.fadeIn, c.fadeOut);
  const level = useCallback((t: number) => fadeGain(t, c), [c]);
  const st = useStore.getState();
  const env = hasEnvelope(c);
  const keys = c.keys ?? [];
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const envLine = useMemo(() => {
    if (!env) return '';
    const n = 160;
    return Array.from({ length: n + 1 }, (_, i) => `${(i / n) * 100},${(1 - envelope((i / n) * c.length, c)) * 100}`).join(' ');
  }, [env, c]);

  /** Drag a stretch's volume bar up or down, or a keyframe sideways; one undo step when let go. */
  const dragEnv = (e: React.PointerEvent, what: { level: number } | { key: number }) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onMenu(null);
    st.selectClip(c.id);
    const box = (e.currentTarget as Element).closest('.mclip')!.getBoundingClientRect();
    const before: Main = mainOf(useStore.getState());
    let latest = before;
    const onMove = (ev: PointerEvent) => {
      if ('level' in what) {
        const v = Math.round(Math.max(0, Math.min(1, 1 - (ev.clientY - box.top) / box.height)) * 100) / 100;
        latest = setLevel(before, c.id, what.level, v);
        setReadout({ x: ev.clientX - box.left, y: ev.clientY - box.top, text: `${Math.round(v * 100)}%` });
      } else {
        const t = ((ev.clientX - box.left) / box.width) * c.length;
        latest = moveKey(before, c.id, what.key, t);
        setReadout({ x: ev.clientX - box.left, y: 14, text: tenths(c.start + (latest.clips.find((x) => x.id === c.id)?.keys?.[what.key] ?? t)) });
      }
      st.previewMain(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setReadout(null);
      if (latest !== before) st.commitMain(latest, before);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Drag the clip (mode 'move') or one of its fade handles. */
  const drag = (e: React.PointerEvent, mode: 'move' | 'in' | 'out') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    st.selectClip(c.id);
    onMenu(null);
    const body = (e.currentTarget as Element).closest('.mlane-body')!;
    const box = body.getBoundingClientRect();
    const perPx = view.span / box.width;
    const x0 = e.clientX;
    const before: Main = mainOf(useStore.getState());
    // everything this clip can line up with, fixed for the drag (the other clips don't move meanwhile)
    const targets = snapTargets(layout(before), c.id, st.mainTime());
    let latest = before;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < DRAG_PX) return;
      moved = true;
      const dt = dx * perPx;
      let patch: Partial<Placed>;
      if (mode === 'move') {
        // a voice clip can't start before the clip ahead of it ends (its pause can't go below 0)
        const lowest = isSpeech(c.kind) ? c.start - c.gap : 0;
        let start = Math.max(lowest, c.start + dt);
        const hit = useStore.getState().settings.snap && !ev.altKey ? snapMove(start, c.length, targets, SNAP_PX * perPx) : null;
        if (hit) start = Math.max(lowest, start + hit.shift);
        const lined = hit && [start, start + c.length].some((edge) => Math.abs(edge - hit.target.t) < 1e-6);
        onGuide(lined ? hit.target : null);
        patch = isSpeech(c.kind) ? { gap: start - lowest } : { at: start };
      } else
        patch =
          mode === 'in'
            ? { fadeIn: Math.min(MAX_FADE, Math.max(0, c.fadeIn + dt), c.length) }
            : { fadeOut: Math.min(MAX_FADE, Math.max(0, c.fadeOut - dt), c.length) };
      latest = updateClip(before, c.id, patch);
      st.previewMain(latest);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onGuide(null);
      if (moved && latest !== before) st.commitMain(latest, before);
      // a click without a drag: offer to cut there
      else if (!moved && mode === 'move')
        onMenu({ id: c.id, t: view.start + ((ev.clientX - box.left) / box.width) * view.span, x: ev.clientX, y: ev.clientY, span: view.span, width: box.width });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`mclip${on ? ' on' : ''}${isSpeech(c.kind) ? ' speech' : ''}`}
      style={{ left, width, top, height, ['--c' as string]: color }}
      onPointerDown={(e) => drag(e, 'move')}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onMenu(null);
        const st = useStore.getState();
        st.focusClip(st.mainFocus?.id === c.id ? null : c.id);
      }}
      title={`${c.name}: ${fmt(c.start)} to ${fmt(c.start + c.length)}, volume ${Math.round(c.gain * 100)}%. Drag to move, click to cut.`}
    >
      <Waveform peaks={peaks} color={color} source={source} length={c.length} pieces={pieces} level={level} />
      {c.ducks?.map(([a, b]) => (
        <span key={a} className="duck-band" style={{ left: `${(Math.max(0, a) / c.length) * 100}%`, width: `${((Math.min(c.length, b) - Math.max(0, a)) / c.length) * 100}%` }} />
      ))}
      {env && (
        <svg className="env-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline points={envLine} />
        </svg>
      )}
      {keys.length > 0 &&
        (c.levels ?? []).map((l, i) => {
          const a = keys[i - 1] ?? 0;
          const b = keys[i] ?? c.length;
          return (
            <span
              key={`bar${i}`}
              className="level-bar"
              style={{ left: `${(a / c.length) * 100}%`, width: `${((b - a) / c.length) * 100}%`, top: `${(1 - l) * 100}%` }}
              onPointerDown={(e) => dragEnv(e, { level: i })}
              title={`${Math.round(l * 100)}%. Drag up or down to change the volume here.`}
            />
          );
        })}
      {keys.map((k, j) => (
        <span
          key={`key${j}`}
          className="keyframe"
          style={{ left: `${(k / c.length) * 100}%`, top: `${(1 - envelope(k, c)) * 100}%` }}
          onPointerDown={(e) => dragEnv(e, { key: j })}
          onDoubleClick={(e) => {
            e.stopPropagation();
            st.commitMain(removeKey(mainOf(useStore.getState()), c.id, j));
          }}
          title="Keyframe: drag sideways to move it, double-click to remove it"
        />
      ))}
      {readout && (
        <span className="env-readout" style={{ left: readout.x, top: readout.y }}>
          {readout.text}
        </span>
      )}
      {on && !env && (
        <svg className="fades" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline points={`0,100 ${(fi / c.length) * 100},${100 - (c.gain / MAX_GAIN) * 100} ${100 - (fo / c.length) * 100},${100 - (c.gain / MAX_GAIN) * 100} 100,100`} />
        </svg>
      )}
      <b>{c.name}</b>
      {words && <ClipWords c={c} />}
      {cutAt != null && <span className="cut-mark" style={{ left: `${(cutAt / c.length) * 100}%` }} />}
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
      {!speech && (
        <label className="insp-duck" title="Turn this clip down while a voice clip plays, and back up in between, with a short ease each way">
          <input type="checkbox" checked={c.duck != null} onChange={(e) => st.updateClip(c.id, { duck: e.target.checked ? 0.35 : undefined })} />
          Lower under voice
          {c.duck != null && (
            <>
              {' to '}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(c.duck * 100)}
                onChange={(e) => live({ duck: Number(e.target.value) / 100 })}
                onPointerUp={settle}
                onKeyUp={settle}
                onBlur={settle}
              />
              <span className="mono">{Math.round(c.duck * 100)}%</span>
            </>
          )}
        </label>
      )}
      {!!c.keys?.length && (
        <button onClick={() => st.updateClip(c.id, { keys: undefined, levels: undefined })} title="Remove every keyframe of this clip">
          Clear keyframes ({c.keys.length})
        </button>
      )}
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

/** The menu a click on a clip opens (mockups/cut-a-click.html): cut there, play from there, or its settings. */
function ClipMenuPop({ menu, c, close }: { menu: ClipMenu; c: Placed; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x + 8, top: menu.y + 8 });
  const cut = cutPoint(c, menu.t - c.start);
  const at = c.start + cut.t;
  // a click on (or right next to) a keyframe offers to remove it instead of adding one
  const perPx = menu.span / menu.width;
  const nearKey = (c.keys ?? []).findIndex((k) => Math.abs(c.start + k - menu.t) < 6 * perPx);
  const st = useStore.getState();

  // keep it on screen, and close it on a click elsewhere, Esc, or scrolling
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.min(menu.x + 8, innerWidth - r.width - 16), top: menu.y + 8 + r.height > innerHeight - 16 ? menu.y - r.height - 8 : menu.y + 8 });
  }, [menu.x, menu.y]);
  useEffect(() => {
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        st.cutClip(c.id, at);
        close();
      }
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', close, true);
    };
  }, [close, st, c.id, at]);

  const item = (label: React.ReactNode, run: () => void, hint?: string) => (
    <button
      role="menuitem"
      onClick={() => {
        close();
        run();
      }}
    >
      {label}
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
  return (
    <div ref={ref} className="clip-menu" role="menu" style={pos}>
      <div className="clip-menu-head">
        {c.name} at {tenths(at)}
        {cut.after && <span className="muted">, in the pause after “{cut.after}”</span>}
      </div>
      {item('✂ Cut here', () => st.cutClip(c.id, at), 'C')}
      {nearKey >= 0
        ? item('Remove keyframe', () => st.commitMain(removeKey(mainOf(useStore.getState()), c.id, nearKey)))
        : item('◆ Add keyframe', () => {
            const before = mainOf(useStore.getState());
            const next = addKey(before, c.id, menu.t - c.start);
            if (next === before) st.setNotice('Too close to another keyframe or the edge of the clip.');
            else {
              st.commitMain(next);
              st.selectClip(c.id);
            }
          })}
      {useStore.getState().mainFocus?.id === c.id
        ? item('Back to all', () => st.focusClip(null), 'Z')
        : item('Zoom to clip', () => st.focusClip(c.id), 'Z')}
      {item('▶ Play from here', () => {
        st.seekMain(at);
        if (!useStore.getState().playing) st.togglePlay();
      })}
      {item('Clip settings', () => {
        st.selectClip(c.id);
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.inspector .insp-vol input')?.focus());
      })}
    </div>
  );
}

/** The focused voice clip's words, each written at the moment it is spoken, under the waveform. */
function ClipWords({ c }: { c: Placed }) {
  const words = useMemo(() => wordTimes([{ ...c, start: 0 }]), [c]);
  const text = useMemo(() => new Map(c.words.map((w) => [w.id, w.text])), [c.words]);
  return (
    <div className="clip-words" aria-hidden>
      {words.map((w, i) => (
        <span
          key={w.id}
          // two staggered rows: each word has room up to the one after next
          style={{ left: `${(w.at / c.length) * 100}%`, bottom: i % 2 ? 18 : 0, maxWidth: `${(((words[i + 2]?.at ?? c.length) - w.at) / c.length) * 100}%` }}
        >
          {text.get(w.id)}
        </span>
      ))}
    </div>
  );
}
