// "Send to main" in a recording's top bar (mockups/main-a-lanes.html): copies the whole edit, the
// selected words, one highlight colour (a clip per passage) or a part onto the main timeline.
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayWords, outputDuration } from '../engine/edl';
import { passages, wordColors } from '../engine/highlights';
import { partSegments, wordsToSegments } from '../engine/main';
import { HIGHLIGHT_COLORS, isSpeech, type Recording } from '../engine/types';
import { useStore } from '../state/store';
import { HIGHLIGHT_NAMES } from './colors';
import { seconds } from './util';

export function SendMenu({ recording }: { recording: Recording }) {
  const selection = useStore((s) => s.selection);
  const transcribed = useStore((s) => s.transcribed);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const send = useStore.getState().sendToMain;
  const speech = isSpeech(recording.kind);
  // a clip copies the words it is sent with, so speech waits for its transcript
  const waiting = speech && !transcribed;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // only worked out while the menu is open: lengths of everything on offer
  const offer = useMemo(() => {
    if (!open) return null;
    const display = displayWords(recording.words, recording.segments);
    const list = passages(display, recording.segments, wordColors(recording.words, recording.highlights));
    const colors = HIGHLIGHT_COLORS.map((color) => {
      const mine = list.filter((p) => p.color === color);
      return { color, count: mine.length, length: mine.reduce((t, p) => t + p.duration, 0) };
    }).filter((c) => c.count);
    return {
      all: outputDuration(recording.segments),
      selection: selection.length ? outputDuration(wordsToSegments(display, recording.segments, selection)) : 0,
      colors,
      parts: recording.parts.map((p) => ({ part: p, length: outputDuration(partSegments(recording, p)) })),
    };
  }, [open, recording, selection]);

  const item = (label: React.ReactNode, length: number, onClick: () => void, cls = '') => (
    <button
      role="menuitem"
      className={cls}
      disabled={length <= 0 || waiting}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {label}
      <small className="mono">{seconds(length)}</small>
    </button>
  );

  return (
    <div className="menu send-menu" ref={ref}>
      <button className="send-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="Copy this recording, or a piece of it, to the main timeline">
        Send to main ▾
      </button>
      {open && offer && (
        <div className="menu-list" role="menu">
          {item(speech ? 'Whole edit' : 'Whole file', offer.all, () => send({ type: 'all' }))}
          {speech && item(selection.length ? 'Selected words' : 'Selected words (select some first)', offer.selection, () => send({ type: 'selection' }))}
          {offer.colors.length > 0 && <div className="sec">Highlight colours, a clip per passage</div>}
          {offer.colors.map((c) =>
            item(
              <>
                <span className={`dot hl-${c.color}`} style={{ background: 'var(--c)' }} />
                {recording.highlightNames[c.color] || HIGHLIGHT_NAMES[c.color]}
                <span className="muted"> ({c.count})</span>
              </>,
              c.length,
              () => send({ type: 'colors', colors: [c.color] }),
              'with-dot',
            ),
          )}
          {offer.parts.length > 0 && <div className="sec">Parts</div>}
          {offer.parts.length > 1 &&
            item(
              <>
                All parts <span className="muted">({offer.parts.length})</span>
              </>,
              offer.parts.reduce((t, p) => t + p.length, 0),
              () => send({ type: 'parts' }),
            )}
          {offer.parts.map(({ part, length }) =>
            item(
              <>
                <span className={`dot hl-${part.color}`} style={{ background: 'var(--c)' }} />
                {part.name}
              </>,
              length,
              () => send({ type: 'part', id: part.id }),
              'with-dot',
            ),
          )}
          <p className="send-note">
            {speech
              ? 'Speech goes to the end of the voice lanes.'
              : 'Music and effects land at the main timeline’s playhead; drag them into place there.'}{' '}
            {waiting ? 'Wait for the transcript to finish: a clip takes its words along, so they can be edited on the main timeline.' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
