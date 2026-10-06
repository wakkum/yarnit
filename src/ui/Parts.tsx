// Parts of a recording. Music and sound effects show them as pads in place of a transcript
// (mockups/parts-c-pads.html, picked 6 Oct 2026 with the regions of parts-a-list.html); speech shows a
// strip of small pads under the timeline and marks parts in the transcript (speech-parts-c-margin.html).
// "Send to main" waits for the main timeline.
import { useEffect, useMemo, useRef, useState } from 'react';
import { editedPieces, toOutputSpans } from '../engine/view';
import type { Part, Recording } from '../engine/types';
import { media, useStore } from '../state/store';
import { combo } from './keys';
import { rangeLabel } from './util';
import { Waveform } from './Waveform';

const seconds = (t: number) => (t < 60 ? `${t.toFixed(1)} s` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

export function Parts({ recording }: { recording: Recording }) {
  const peaks = useStore((s) => s.peaks[recording.tracks[0].id]);
  const what = recording.kind === 'music' ? 'music' : 'sound effects file';
  return (
    <main className="doc">
      <div className="doc-inner parts">
        <h3>
          Parts of {recording.name} <span className="muted">{recording.parts.length ? `(${recording.parts.length})` : ''}</span>
        </h3>
        <p className="muted">
          Drag across the waveform to select a piece of this {what}, then click <b>Add as part</b>. Each part can go to the main timeline on its own,
          as often as you like, and parts may overlap. The file itself is never cut. Drag a part's edges on the waveform to adjust it.
        </p>
        <div className="pads">
          {recording.parts.map((p) => (
            <Pad key={p.id} part={p} peaks={peaks} duration={recording.duration} />
          ))}
          <div className="pad new">
            <span>
              <b>+</b>
              Select on the waveform
              <br />
              to add a part
            </span>
          </div>
        </div>
        <p className="muted small">
          Is it actually speech? Use ⋯ next to it in the sidebar and pick Interview or Voice-over to transcribe it. Undo with {combo('mod', 'Z')}.
        </p>
      </div>
    </main>
  );
}

/** Speech: one row of small pads under the timeline. Lengths are what is kept of each part. */
export function PartsStrip({ parts }: { parts: Part[] }) {
  const segments = useStore((s) => s.recording!.segments);
  const kept = useMemo(() => {
    const pieces = editedPieces(segments);
    return new Map(parts.map((p) => [p.id, toOutputSpans(pieces, [p]).reduce((t, x) => t + x.outEnd - x.outStart, 0)]));
  }, [parts, segments]);
  return (
    <div className="parts-strip" role="list" aria-label="Parts">
      <span className="lbl">Parts</span>
      {parts.map((p) => (
        <div key={p.id} role="listitem" className={`mini-pad hl-${p.color}`} title={rangeLabel(p.start, p.end)}>
          <PlayButton part={p} />
          <PartName part={p} />
          <span className="muted mono">{seconds(kept.get(p.id) ?? 0)}</span>
          <PartMenu part={p} />
        </div>
      ))}
    </div>
  );
}

function Pad({ part, peaks, duration }: { part: Part; peaks: Float32Array | undefined; duration: number }) {
  const playing = useStore((s) => s.playingPart === part.id);
  const fresh = useStore((s) => s.freshPart === part.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [fresh]);
  return (
    <div className={`pad hl-${part.color}${playing ? ' playing' : ''}`} ref={ref}>
      <div className="pad-head">
        <PartName part={part} />
        <PartMenu part={part} />
      </div>
      <span className="muted mono">{rangeLabel(part.start, part.end)}</span>
      <div className="pad-wave" onClick={() => useStore.getState().playPart(part.id)} title="Play">
        <Waveform peaks={peaks} color={`var(--hl-${part.color})`} source={duration} length={part.end - part.start} from={part.start} samples={media.mono16k} />
      </div>
      <div className="pad-row">
        <PlayButton part={part} />
        <span className="muted">{playing ? 'playing' : ''}</span>
        <button className="send" disabled title="Comes with the main timeline, the next step">
          Send to main
        </button>
      </div>
    </div>
  );
}

function PlayButton({ part }: { part: Part }) {
  const playing = useStore((s) => s.playingPart === part.id);
  const st = useStore.getState();
  return (
    <button className="pad-play" onClick={() => (playing ? st.togglePlay() : st.playPart(part.id))} aria-label={playing ? `Pause ${part.name}` : `Play ${part.name}`}>
      {playing ? '❚❚' : '▶'}
    </button>
  );
}

/** The name; click to rename. A part that was just added opens with its name selected. */
function PartName({ part }: { part: Part }) {
  const fresh = useStore((s) => s.freshPart === part.id);
  const renaming = useStore((s) => s.renamingPart === part.id) || fresh;
  const { renamePart, setRenamingPart } = useStore.getState();
  if (!renaming)
    return (
      <button className="pad-name" onClick={() => setRenamingPart(part.id)} title="Rename">
        {part.name}
      </button>
    );
  return (
    <input
      className="pad-input"
      autoFocus
      defaultValue={part.name}
      aria-label="Part name"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => renamePart(part.id, e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = part.name;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function PartMenu({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = useStore.getState();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="pad-menu-wrap" ref={ref}>
      <button className="ghost more" aria-label={`Options for ${part.name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="pop item-menu">
          <button
            onClick={() => {
              setOpen(false);
              st.setRenamingPart(part.id);
            }}
          >
            Rename
          </button>
          <hr />
          <button
            className="danger"
            onClick={() => {
              setOpen(false);
              st.deletePart(part.id);
            }}
          >
            Delete part
          </button>
        </div>
      )}
    </div>
  );
}
