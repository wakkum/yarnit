import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { displayWords, findPauses, outputDuration, sourceToOutput, wordOutputTimes, type DisplayWord, type Pause } from '../engine/edl';
import { wordColors } from '../engine/highlights';
import { wordParts, wordsInOutput } from '../engine/parts';
import { HIGHLIGHT_COLORS, isSpeech, type HighlightColor, type Part, type Recording } from '../engine/types';
import { searchHits, type Paragraph } from '../engine/view';
import { currentParagraphs, useStore } from '../state/store';
import { HIGHLIGHT_NAMES } from './colors';
import { combo } from './keys';
import { MoveButtons, Outline } from './Outline';
import { Parts } from './Parts';
import { fmt, speakerColor, trackLabel, usePlayheadValue } from './util';

type Marks = {
  /** Selected word id -> whether it starts / ends a selected run (for the joined highlight). */
  selected: Map<string, { first: boolean; last: boolean }>;
  hits: Set<string>;
  activeHit: Set<string>;
  clip: Set<string>;
  current: string | null;
  /** Highlight colour per word, and whether the marker continues into the next word. */
  color: Map<string, { color: HighlightColor; joinNext: boolean }>;
  /** Pause chips keyed by the word they follow; a leading pause is keyed by the word it precedes. */
  pauseAfter: Map<string, Pause>;
  pauseBefore: Map<string, Pause>;
  /** Kept words under the waveform selection. */
  waveSel: Set<string>;
  /** Part per word, and the parts that start at a word (their name tag goes there). */
  part: Map<string, Part>;
  partStart: Map<string, Part[]>;
};

const Word = memo(function Word({
  d,
  index,
  sel,
  hit,
  active,
  cur,
  clip,
  color,
  wave,
  onPick,
}: {
  d: DisplayWord;
  index: number;
  sel?: { first: boolean; last: boolean };
  hit: boolean;
  active: boolean;
  cur: boolean;
  clip: boolean;
  color?: { color: HighlightColor; joinNext: boolean };
  wave: boolean;
  onPick: (i: number, shift: boolean) => void;
}) {
  const cls = ['w'];
  if (color && !d.deleted) cls.push('hl', `hl-${color.color}`);
  if (d.word.isFiller) cls.push('fill');
  if (d.deleted) cls.push('del');
  else {
    if (hit) cls.push(active ? 'hit-active' : 'hit');
    if (sel) cls.push('sel', ...(sel.first ? ['sel-first'] : []), ...(sel.last ? ['sel-last'] : []));
    if (cur) cls.push('cur');
    if (clip) cls.push('clip');
    if (wave) cls.push('wsel');
  }
  return (
    <>
      <span className={cls.join(' ')} data-wid={d.word.id} onClick={(e) => onPick(index, e.shiftKey)}>
        {d.word.text}
      </span>
      {/* the space inside a selection is highlighted too, so a selection reads as one block */}
      {sel && !sel.last ? (
        <span className="gap sel"> </span>
      ) : color?.joinNext && !d.deleted ? (
        <span className={`gap hl hl-${color.color}`}> </span>
      ) : (
        ' '
      )}
    </>
  );
});

function PauseChip({ p }: { p: Pause }) {
  const keep = useStore((s) => s.settings.pauseKeep);
  return (
    <>
      <button
        className="pause"
        title={`Pause of ${p.length.toFixed(1)} s. Click to shorten it to ${keep} s.`}
        onClick={() => useStore.getState().shortenPauses([p])}
      >
        {p.length.toFixed(1)} s
      </button>{' '}
    </>
  );
}

export function Transcript() {
  const recording = useStore((s) => s.recording)!;
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const query = useStore((s) => s.query);
  const hitIndex = useStore((s) => s.hitIndex);
  const phase = useStore((s) => s.phase);
  const pauseMin = useStore((s) => s.settings.pauseMin);
  const waiting = useStore((s) => s.queued.includes(s.recording?.id ?? ''));
  const anchor = useRef<number | null>(null);
  /** Mouse drag in progress: the word index it started on, and whether it has left that word. */
  const drag = useRef<{ start: number; moved: boolean } | null>(null);
  /** A drag ends with a click on the word it started on; that click must not reselect it. */
  const skipClick = useRef(false);
  const inner = useRef<HTMLDivElement>(null);
  const [openSpeaker, setOpenSpeaker] = useState<string | null>(null);

  const display = useMemo(() => displayWords(recording.words, recording.segments), [recording.words, recording.segments]);
  const paras = currentParagraphs(recording);
  const view = useStore((s) => s.view);
  const moved = useStore((s) => s.moved);
  const total = useMemo(() => outputDuration(recording.segments), [recording.segments]);

  // let the moved paragraph glow, bring it into view, then forget it
  useEffect(() => {
    if (!moved) return;
    document.querySelector(`[data-key="${moved}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = setTimeout(() => useStore.setState({ moved: null }), 1400);
    return () => clearTimeout(t);
  }, [moved, recording.segments]);
  const indexOf = useMemo(() => new Map(display.map((d, i) => [d.word.id, i])), [display]);
  const hits = useMemo(() => searchHits(display, query), [display, query]);
  const pauses = useMemo(
    () => (phase === 'ready' ? findPauses(display, recording.segments, pauseMin) : []),
    [display, recording.segments, pauseMin, phase],
  );

  const current = usePlayheadValue<string | null>(
    recording,
    (_, source) => {
      if (source == null) return null;
      return recording.words.find((w) => source >= w.start && source < w.end)?.id ?? null;
    },
    null,
  );

  const selected = useMemo(() => {
    const ids = new Set(selection);
    const kept = display.filter((d) => !d.deleted).map((d) => d.word.id);
    const out = new Map<string, { first: boolean; last: boolean }>();
    kept.forEach((id, i) => {
      if (ids.has(id)) out.set(id, { first: !ids.has(kept[i - 1]), last: !ids.has(kept[i + 1]) });
    });
    return out;
  }, [selection, display]);

  const colors = useMemo(() => {
    const byWord = wordColors(recording.words, recording.highlights);
    const kept = display.filter((d) => !d.deleted).map((d) => d.word.id);
    const out = new Map<string, { color: HighlightColor; joinNext: boolean }>();
    kept.forEach((id, i) => {
      const c = byWord.get(id);
      if (c) out.set(id, { color: c, joinNext: byWord.get(kept[i + 1]) === c });
    });
    return out;
  }, [recording.words, recording.highlights, display]);

  const waveSel = useStore((s) => s.waveSel);
  // word times are worked out once per edit, so a drag on the waveform only filters them
  const wordTimes = useMemo(() => wordOutputTimes(display, recording.segments), [display, recording.segments]);
  const waveWords = useMemo(() => new Set(waveSel ? wordsInOutput(wordTimes, waveSel.start, waveSel.end) : []), [wordTimes, waveSel]);
  const inParts = useMemo(() => wordParts(display, recording.parts), [display, recording.parts]);

  const marks: Marks = {
    selected,
    color: colors,
    hits: new Set(hits.flat()),
    activeHit: new Set(hits[hitIndex] ?? []),
    clip: new Set(clipboard),
    current,
    pauseAfter: new Map(pauses.filter((p) => p.afterId).map((p) => [p.afterId!, p])),
    pauseBefore: new Map(pauses.filter((p) => !p.afterId).map((p) => [p.beforeId!, p])),
    waveSel: waveWords,
    part: inParts.byWord,
    partStart: inParts.startsAt,
  };

  const selectRange = useMemo(
    () => (from: number, to: number) => {
      const [a, b] = [Math.min(from, to), Math.max(from, to)];
      useStore.getState().select(display.slice(a, b + 1).filter((x) => !x.deleted).map((x) => x.word.id));
    },
    [display],
  );

  const onPick = useMemo(
    () => (i: number, shift: boolean) => {
      if (skipClick.current) {
        skipClick.current = false;
        return;
      }
      const st = useStore.getState();
      const d = display[i];
      if (d.deleted) return;
      if (shift && anchor.current != null) {
        selectRange(anchor.current, i);
      } else {
        anchor.current = i;
        st.select([d.word.id]);
        st.seekToWord(d.word);
      }
    },
    [display, selectRange],
  );

  const wordIndexAt = (target: EventTarget) => {
    const id = (target as HTMLElement).closest?.<HTMLElement>('[data-wid]')?.dataset.wid;
    return id == null ? null : (indexOf.get(id) ?? null);
  };

  // Clicking anywhere that is not a word (or the selection's own bar / menus / help) deselects
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('.w, .gap, .selbar, .pop, .help, .clip-banner')) return;
      if (useStore.getState().selection.length) useStore.getState().select([]);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const end = () => {
      if (drag.current?.moved) skipClick.current = true;
      drag.current = null;
      // a drag that ended off its start word gets no click at all, so don't swallow the next one
      setTimeout(() => (skipClick.current = false), 0);
    };
    window.addEventListener('mouseup', end);
    return () => window.removeEventListener('mouseup', end);
  }, []);

  // Drag across words to select them (mouse only: on touch, dragging scrolls).
  const onMouseDown = (e: React.MouseEvent) => {
    const i = wordIndexAt(e.target);
    if (e.button !== 0 || e.shiftKey || i == null || display[i].deleted) return;
    drag.current = { start: i, moved: false };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return;
    const i = wordIndexAt(e.target);
    if (i != null && (i !== d.start || d.moved)) {
      d.moved = true;
      anchor.current = d.start;
      selectRange(d.start, i);
    }
    // nudge the transcript when dragging near its top or bottom edge
    const doc = (e.currentTarget as HTMLElement).closest('.doc');
    if (doc) {
      const r = doc.getBoundingClientRect();
      if (e.clientY < r.top + 40) doc.scrollTop -= 14;
      else if (e.clientY > r.bottom - 40) doc.scrollTop += 14;
    }
  };

  if (!isSpeech(recording.kind)) return <Parts recording={recording} />;

  if (!recording.words.length) {
    return (
      <main className="doc">
        <div className="doc-inner muted">
          {phase === 'error'
            ? 'No transcript.'
            : waiting
              ? 'Waiting to be transcribed: other recordings in this project are first in line. You can play it meanwhile.'
              : 'The transcript appears here as it is made, about 30 seconds of audio at a time. The first part can take a little while.'}
        </div>
      </main>
    );
  }

  return (
    <main className="doc">
      <div className="doc-inner" ref={inner} onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
        {clipboard.length > 0 && (
          <div className="clip-banner" role="status">
            <span>
              <b>
                {clipboard.length} word{clipboard.length === 1 ? '' : 's'} cut.
              </b>{' '}
              Click a word next to where they should go, then <b>Paste before</b> or <b>Paste after</b> it.
            </span>
            <button className="ghost" onClick={() => useStore.getState().clearClipboard()}>
              Cancel
            </button>
          </div>
        )}
        <div className="viewbar">
          <div className="seg" role="group" aria-label="View">
            {(['transcript', 'outline'] as const).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => useStore.getState().setView(v)}>
                {v === 'transcript' ? 'Transcript' : 'Outline'}
              </button>
            ))}
          </div>
          <span className="muted">
            {paras.length} paragraph{paras.length === 1 ? '' : 's'} · {fmt(total)}
          </span>
          {view === 'outline' && (
            <span className="muted viewbar-hint">
              Drag ⋮⋮ or use ↑ ↓ to reorder. <kbd>{combo('alt', 'shift', '↑')}</kbd> / <kbd>{combo('alt', 'shift', '↓')}</kbd> move the selected one.
            </span>
          )}
        </div>
        {view === 'outline' && <Outline recording={recording} />}
        {view === 'transcript' && paras.map((p, i) => (
          <Para
            key={p.key}
            first={i === 0}
            last={i === paras.length - 1}
            flash={p.key === moved}
            recording={recording}
            para={p}
            marks={marks}
            indexOf={indexOf}
            onPick={onPick}
            open={openSpeaker === p.key}
            setOpen={(o) => setOpenSpeaker(o ? p.key : null)}
          />
        ))}
        {view === 'transcript' && <SelectionBar inner={inner} />}
        {view === 'transcript' && <p className="hint">
          Click a word to jump there. Drag across words, or <kbd>Shift</kbd>+click, to select a range. <kbd>Delete</kbd> cuts the selection,{' '}
          <kbd>{combo('mod', 'Z')}</kbd> undoes. Click a speaker name to rename it, and a pause chip to shorten that pause. Press{' '}
          <kbd>?</kbd> for help and all shortcuts.
        </p>}
      </div>
    </main>
  );
}

/** Floating Cut / Delete (or Paste before / after) bar above the start of the selection, so it never covers it. */
function SelectionBar({ inner }: { inner: React.RefObject<HTMLDivElement | null> }) {
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const recording = useStore((s) => s.recording);
  const transcribed = useStore((s) => s.transcribed);
  const [pos, setPos] = useState<{ left: number; top: number; transform?: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const pasting = clipboard.length > 0;
  const canPaste = pasting && selection.length === 1 && !clipboard.includes(selection[0]);
  const show = pasting ? canPaste : selection.length > 0;

  useLayoutEffect(() => {
    const place = () => {
      const root = inner.current;
      const start = root?.querySelector<HTMLElement>('.w.sel-first');
      if (!root || !start || !show) return setPos(null);
      const r = start.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      const width = bar.current?.offsetWidth ?? 160;
      const height = bar.current?.offsetHeight ?? 30;
      const left = Math.max(0, Math.min(r.left - box.left, box.width - width));
      // no room above (first line of the transcript): sit under the end of the selection instead
      if (r.top - box.top < height + 8) {
        const ends = root.querySelectorAll<HTMLElement>('.w.sel-last');
        const e = ends[ends.length - 1].getBoundingClientRect();
        return setPos({ left: Math.max(0, Math.min(e.left - box.left, box.width - width)), top: e.bottom - box.top + 6, transform: 'none' });
      }
      setPos({ left, top: r.top - box.top - 6 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [inner, selection, clipboard, recording, show]);

  if (!show) return null;
  const st = useStore.getState();
  return (
    <div className="selbar" ref={bar} style={pos ?? { visibility: 'hidden' }} role="toolbar" aria-label="Selection">
      {pasting ? (
        <>
          <button onClick={() => st.paste('before')} title="Move the cut words before this word">
            Paste before <kbd>{combo('mod', 'V')}</kbd>
          </button>
          <button onClick={() => st.paste('after')} title="Move the cut words after this word">
            Paste after <kbd>{combo('shift', 'mod', 'V')}</kbd>
          </button>
          <button onClick={st.clearClipboard}>Cancel</button>
        </>
      ) : (
        <>
          <button onClick={st.cut} title="Cut, then click where it should go and paste">
            Cut <kbd>{combo('mod', 'X')}</kbd>
          </button>
          <button className="danger" onClick={st.deleteSelection}>
            Delete <kbd>{combo('del')}</kbd>
          </button>
          <span className="sep" />
          {HIGHLIGHT_COLORS.map((c, i) => (
            <button
              key={c}
              className={`swatch hl-${c}`}
              onClick={() => st.highlightSelection(c)}
              title={`Highlight ${HIGHLIGHT_NAMES[c]} (${i + 1})`}
              aria-label={`Highlight ${HIGHLIGHT_NAMES[c]}`}
            />
          ))}
          <button className="unmark" onClick={() => st.highlightSelection(null)} title="Remove highlight (0)" aria-label="Remove highlight">
            ⌀
          </button>
          <span className="sep" />
          <button
            onClick={() => st.sendToMain({ type: 'selection' })}
            disabled={!transcribed}
            title={transcribed ? 'Copy the selected words to the main timeline as a clip' : 'Wait for the transcript to finish'}
          >
            Send to main
          </button>
        </>
      )}
    </div>
  );
}

function Para({
  first,
  last,
  flash,
  recording,
  para,
  marks,
  indexOf,
  onPick,
  open,
  setOpen,
}: {
  first: boolean;
  last: boolean;
  flash: boolean;
  recording: Recording;
  para: Paragraph;
  marks: Marks;
  indexOf: Map<string, number>;
  onPick: (i: number, shift: boolean) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const out = sourceToOutput(recording.segments, para.start + 0.001);
  // a bar in the margin per part this paragraph holds words of (mockups/speech-parts-c-margin.html)
  const bars = [...new Map(para.words.flatMap((d) => (marks.part.has(d.word.id) ? [marks.part.get(d.word.id)!] : [])).map((p) => [p.id, p])).values()];
  return (
    <div className={`para${flash ? ' flash' : ''}${para.words.some((d) => marks.selected.has(d.word.id)) ? ' has-sel' : ''}`} data-key={para.key}>
      <div className="para-label" style={{ position: 'relative' }}>
        <button
          className={`who${open ? ' open' : ''}`}
          style={{ color: speakerColor(recording, para.trackId, para.speakerId) }}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title="Rename speaker or change who said this"
        >
          {trackLabel(recording, para.trackId, para.speakerId)}
        </button>
        <span className="ts mono">{out == null ? 'cut' : fmt(out)}</span>
        {!(first && last) && (
          <span className="mv">
            <MoveButtons k={para.key} first={first} last={last} />
          </span>
        )}
        {open && <SpeakerMenu recording={recording} para={para} close={() => setOpen(false)} />}
      </div>
      <p>
        {bars.map((b, k) => (
          <span key={b.id} className={`part-bar hl-${b.color}`} style={{ left: -10 - k * 6 }} title={b.name} />
        ))}
        {para.words.map((d) => {
          const id = d.word.id;
          const before = marks.pauseBefore.get(id);
          const after = marks.pauseAfter.get(id);
          return (
            <span key={id} style={{ display: 'contents' }}>
              {marks.partStart.get(id)?.map((pt) => (
                <button key={pt.id} className={`part-tag hl-${pt.color}`} onClick={() => useStore.getState().playPart(pt.id)} title={`Play ${pt.name}`}>
                  {pt.name}
                </button>
              ))}
              {before && <PauseChip p={before} />}
              <Word
                d={d}
                index={indexOf.get(id)!}
                sel={marks.selected.get(id)}
                hit={marks.hits.has(id)}
                active={marks.activeHit.has(id)}
                cur={marks.current === id}
                clip={marks.clip.has(id)}
                color={marks.color.get(id)}
                wave={marks.waveSel.has(id)}
                onPick={onPick}
              />
              {after && <PauseChip p={after} />}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function SpeakerMenu({
  recording,
  para,
  close,
}: {
  recording: Recording;
  para: Paragraph;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const currentId = para.speakerId;
  const current = recording.speakers.find((s) => s.id === currentId);
  const { assignSpeaker } = useStore.getState();
  const wordIds = para.words.map((d) => d.word.id);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // the label button toggles the menu itself
      if (!ref.current?.contains(t) && !ref.current?.parentElement?.querySelector('.who')?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  return (
    <div className="pop" ref={ref} style={{ left: 0, top: 'calc(100% + 6px)', width: 260 }}>
      {current && <RenameForm key={current.id + current.name} id={current.id} name={current.name} />}
      <h4 style={{ marginTop: 14 }}>This paragraph is by</h4>
      <div className="list">
        {recording.speakers.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              assignSpeaker(wordIds, s.id);
              close();
            }}
            disabled={s.id === currentId}
          >
            <span className="dot" style={{ background: speakerColor(recording, para.trackId, s.id) }} />
            {s.name}
            {s.id === currentId && <span className="muted">(current)</span>}
          </button>
        ))}
        <button className="ghost" onClick={() => assignSpeaker(wordIds, 'new')}>
          + New speaker
        </button>
      </div>
    </div>
  );
}

/** Keyed by speaker id + name, so it resets when the speaker or its name changes. */
function RenameForm({ id, name: saved }: { id: string; name: string }) {
  const [name, setName] = useState(saved);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        useStore.getState().renameSpeaker(id, name);
      }}
    >
      <h4>Speaker name</h4>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Speaker name" style={{ flex: 1 }} autoFocus />
        <button className="primary" type="submit" disabled={!name.trim() || name.trim() === saved}>
          Rename
        </button>
      </div>
      <p className="note">Renames every paragraph by {saved}.</p>
    </form>
  );
}
