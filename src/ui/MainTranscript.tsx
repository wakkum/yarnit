// The main timeline's transcript (mockups/main-a-lanes.html): every voice clip in running order,
// under a header with ↑ ↓ ✕. Words edit like a recording's: click to jump, drag or Shift+click to
// select, Delete cuts them from that clip (the clip itself is a copy; its recording is untouched).
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayWords, sourceToOutput } from '../engine/edl';
import { EMPTY_MAIN, layout, wordTimes, type Placed } from '../engine/main';
import { isSpeech } from '../engine/types';
import { paragraphs } from '../engine/view';
import { useStore } from '../state/store';
import { combo } from './keys';
import { KIND_LABEL } from './kinds';
import { KindIcon } from './Sidebar';
import { RenameForm, WordInput } from './Transcript';
import { fmt, trackColor, useMixPlayhead } from './util';

export function MainTranscript() {
  const main = useStore((s) => s.project?.main ?? EMPTY_MAIN);
  const selection = useStore((s) => s.selection);
  const recordings = useStore((s) => s.recordings);
  const placed = useMemo(() => layout(main), [main]);
  const speech = placed.filter((c) => isSpeech(c.kind));
  const others = placed.length - speech.length;
  const times = useMemo(() => wordTimes(placed), [placed]);
  const order = useMemo(() => new Map(times.map((w, i) => [w.id, i])), [times]);
  const timeOf = useMemo(() => new Map(times.map((w) => [w.id, w.at])), [times]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const st = useStore.getState();

  // the word under the playhead, re-rendering only when it changes
  const [current, setCurrent] = useState<string | null>(null);
  useMixPlayhead((t) => {
    let lo = 0;
    let hi = times.length - 1;
    let found: string | null = null;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (times[m].at <= t) {
        if (t < times[m].end) found = times[m].id;
        lo = m + 1;
      } else hi = m - 1;
    }
    if (found !== current) setCurrent(found);
  });

  const selectTo = (i: number) => {
    const a = anchor.current ?? i;
    const [x, y] = [Math.min(a, i), Math.max(a, i)];
    st.select(times.slice(x, y + 1).map((w) => w.id));
  };
  const pick = (id: string, shift: boolean) => {
    const i = order.get(id);
    if (i == null) return;
    if (shift && anchor.current != null) return selectTo(i);
    anchor.current = i;
    st.select([id]);
    st.seekMain(timeOf.get(id) ?? 0);
  };

  if (!speech.length)
    return (
      <main className="doc">
        <div className="doc-inner muted main-empty">
          <p>
            <b>No voice clips yet.</b> Open an interview or voice-over in the sidebar and use <b>Send to main</b> in the top bar: send the whole edit, the
            selected words, one highlight colour or a part. Music and sound effects go there too, from their pads.
          </p>
          {others > 0 && <p>{others} music or effects clip{others === 1 ? '' : 's'} on the lanes above.</p>}
        </div>
      </main>
    );

  return (
    <main className="doc" onMouseUp={() => (dragging.current = false)} onMouseLeave={() => (dragging.current = false)}>
      <div className="doc-inner main-doc">
        {selection.length > 0 && (
          <div className="main-selbar">
            <span>
              {selection.length} word{selection.length === 1 ? '' : 's'} selected
            </span>
            <button onClick={st.deleteMainSelection}>
              Delete <kbd>{combo('del')}</kbd>
            </button>
            <button className="ghost" onClick={() => st.select([])}>
              ✕
            </button>
          </div>
        )}
        {speech.map((c, i) => (
          <ClipText
            key={c.id}
            c={c}
            first={i === 0}
            last={i === speech.length - 1}
            from={recordings.find((r) => r.id === c.recordingId)?.name}
            selected={selected}
            current={current}
            onDown={(id, shift) => {
              dragging.current = true;
              pick(id, shift);
            }}
            onEnter={(id) => {
              const i2 = order.get(id);
              if (dragging.current && i2 != null) selectTo(i2);
            }}
          />
        ))}
        <p className="hint">
          Click a word to jump there. Drag across words, or <kbd>Shift</kbd>+click, to select; <kbd>Delete</kbd> cuts them from this clip only; double-click a word to correct it. ↑ ↓ change the
          running order, ✕ removes a clip. {others > 0 && `Music and effects (${others}) are on the lanes above.`}
        </p>
      </div>
    </main>
  );
}

function ClipText({
  c,
  first,
  last,
  from,
  selected,
  current,
  onDown,
  onEnter,
}: {
  c: Placed;
  first: boolean;
  last: boolean;
  from?: string;
  selected: Set<string>;
  current: string | null;
  onDown: (id: string, shift: boolean) => void;
  onEnter: (id: string) => void;
}) {
  const paras = useMemo(() => paragraphs(displayWords(c.words, c.segments)), [c.words, c.segments]);
  const on = useStore((s) => s.mainClip === c.id);
  /** The word being corrected (double-click), if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const st = useStore.getState();
  const speakerName = (id?: string) => c.speakers.find((s) => s.id === id)?.name ?? 'Speaker';
  const speakerIndex = (id?: string) => Math.max(0, c.speakers.findIndex((s) => s.id === id));
  return (
    <section className={`main-clip${on ? ' on' : ''}`}>
      <div className="cliphead">
        <KindIcon kind={c.kind} />
        {/* just the kind, so the transcript reads calmly; the rest is in the tooltip */}
        <button
          className="clip-name"
          onClick={() => st.selectClip(c.id)}
          title={[c.name, from && `from ${from}`, `starts at ${fmt(c.start)}`, Math.round(c.gap * 10) > 0 && `${Math.round(c.gap * 10) / 10} s pause before`, 'Click to select it'].filter(Boolean).join(' · ')}
        >
          {KIND_LABEL[c.kind]}
        </button>
        <span className="clip-arrows">
          <button className="ghost" disabled={first} onClick={() => st.moveClip(c.id, -1)} title="Earlier in the running order" aria-label={`Move ${c.name} earlier`}>
            ↑
          </button>
          <button className="ghost" disabled={last} onClick={() => st.moveClip(c.id, 1)} title="Later in the running order" aria-label={`Move ${c.name} later`}>
            ↓
          </button>
          <button className="ghost danger" onClick={() => st.removeClip(c.id)} title="Remove this clip from the main timeline" aria-label={`Remove ${c.name}`}>
            ✕
          </button>
        </span>
      </div>
      {!paras.length && <p className="muted clip-nowords">No transcript in this clip. It plays as it is; remove it and send it again to edit its words.</p>}
      {paras.map((p) => {
        const out = sourceToOutput(c.segments, p.start + 0.001);
        return (
          <div className="para" key={p.key}>
            <div className="para-label" style={{ position: 'relative' }}>
              {p.speakerId && c.speakers.some((s) => s.id === p.speakerId) ? (
                <SpeakerName c={c} speakerId={p.speakerId} color={trackColor(speakerIndex(p.speakerId))} from={from} />
              ) : (
                <span style={{ color: trackColor(speakerIndex(p.speakerId)), fontWeight: 600 }}>{speakerName(p.speakerId)}</span>
              )}
              <span className="ts mono">{out == null ? 'cut' : fmt(c.start + out)}</span>
            </div>
            <p>
              {p.words.map((d) => {
                const cls = ['w'];
                if (d.deleted) cls.push('del');
                else {
                  if (selected.has(d.word.id)) cls.push('sel', 'sel-first', 'sel-last');
                  if (current === d.word.id) cls.push('cur');
                }
                if (editing === d.word.id)
                  return (
                    <span key={d.word.id}>
                      <WordInput
                        text={d.word.text}
                        done={(text) => {
                          if (text != null) st.retypeMainWord(c.id, d.word.id, text);
                          setEditing(null);
                        }}
                      />{' '}
                    </span>
                  );
                return (
                  <span key={d.word.id}>
                    <span
                      className={cls.join(' ')}
                      onDoubleClick={() => !d.deleted && setEditing(d.word.id)}
                      title={d.deleted ? undefined : 'Double-click to correct this word (in this clip only)'}
                      onMouseDown={(e) => {
                        if (d.deleted || e.button !== 0) return;
                        e.preventDefault();
                        onDown(d.word.id, e.shiftKey);
                      }}
                      onMouseEnter={() => !d.deleted && onEnter(d.word.id)}
                    >
                      {d.word.text}
                    </span>{' '}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** A speaker's name over a paragraph: click it to rename that speaker on the main timeline. */
function SpeakerName({ c, speakerId, color, from }: { c: Placed; speakerId: string; color: string; from?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const name = c.speakers.find((s) => s.id === speakerId)!.name;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span ref={ref}>
      <button className={`who${open ? ' open' : ''}`} style={{ color }} onClick={() => setOpen(!open)} aria-expanded={open} title="Rename this speaker">
        {name}
      </button>
      {open && (
        <div className="pop" style={{ left: 0, top: 'calc(100% + 6px)', width: 260 }}>
          <RenameForm
            key={speakerId + name}
            name={name}
            onRename={(next) => {
              useStore.getState().renameMainSpeaker(c.id, speakerId, next);
              setOpen(false);
            }}
            note={`Renames ${name} in every clip from ${from ?? 'this recording'} here. The recording keeps its own names.`}
          />
        </div>
      )}
    </span>
  );
}
