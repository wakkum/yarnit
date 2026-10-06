// Outline view (mockups/para-c-outline.html, picked 5 Oct 2026): one row per paragraph, to reorder
// a long recording at a glance. Meant to grow into the main timeline (same rows, built from highlights).
import { useMemo, useRef, useState } from 'react';
import { outputDuration, sourceToOutput } from '../engine/edl';
import { wordColors } from '../engine/highlights';
import type { HighlightColor, Recording } from '../engine/types';
import type { Paragraph } from '../engine/view';
import { currentParagraphs, useStore } from '../state/store';
import { HIGHLIGHT_NAMES } from './colors';
import { combo } from './keys';
import { fmt, speakerColor, trackLabel } from './util';

type Row = { p: Paragraph; text: string; at: number; length: number; colors: HighlightColor[] };

export function Outline({ recording }: { recording: Recording }) {
  const selection = useStore((s) => s.selection);
  const moved = useStore((s) => s.moved);
  const paras = currentParagraphs(recording);
  /** Insertion index (0 to rows.length) while a row is dragged over the list. */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragKey = useRef<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const byWord = wordColors(recording.words, recording.highlights);
    const total = outputDuration(recording.segments);
    const starts = paras.map((p) => sourceToOutput(recording.segments, p.start + 0.001) ?? 0);
    return paras.map((p, i) => {
      const kept = p.words.filter((d) => !d.deleted).map((d) => d.word);
      const colors = [...new Set(kept.map((w) => byWord.get(w.id)).filter((c): c is HighlightColor => !!c))];
      return { p, text: kept.map((w) => w.text).join(' '), at: starts[i], length: (starts[i + 1] ?? total) - starts[i], colors };
    });
  }, [paras, recording]);

  const current = paras.find((p) => p.words.some((d) => d.word.id === selection[0]))?.key;
  const st = useStore.getState();

  const indexAt = (e: React.DragEvent, i: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? i : i + 1;
  };

  return (
    <div className="outline" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropAt(null)}>
      {rows.map(({ p, text, at, length, colors }, i) => (
        <div key={p.key} style={{ display: 'contents' }}>
          {dropAt === i && <div className="drop-line" />}
          <div
            className={`orow${p.key === current ? ' on' : ''}${p.key === moved ? ' flash' : ''}`}
            style={{ '--c': speakerColor(recording, p.trackId, p.speakerId) } as React.CSSProperties}
            data-key={p.key}
            onClick={() => st.selectParagraph(p.key)}
            onDragOver={(e) => {
              if (!dragKey.current) return;
              e.preventDefault();
              setDropAt(indexAt(e, i));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const key = dragKey.current;
              const to = indexAt(e, i);
              setDropAt(null);
              if (key) st.moveParagraph(key, to);
            }}
          >
            <span
              className="grip"
              draggable
              title="Drag to move"
              onDragStart={(e) => {
                dragKey.current = p.key;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', text);
                const row = (e.currentTarget as HTMLElement).parentElement!;
                e.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2);
              }}
              onDragEnd={() => {
                dragKey.current = null;
                setDropAt(null);
              }}
            >
              ⋮⋮
            </span>
            <div className="who">
              <b>{trackLabel(recording, p.trackId, p.speakerId)}</b>
              <span className="mono muted">{fmt(at)}</span>
            </div>
            <span className="txt">
              {colors.map((c) => (
                <i key={c} className={`dot hl-${c}`} title={recording.highlightNames[c] || HIGHLIGHT_NAMES[c]} />
              ))}
              {text}
            </span>
            <span className="len mono muted">{fmt(length)}</span>
            <span className="arr">
              <MoveButtons k={p.key} first={i === 0} last={i === rows.length - 1} />
            </span>
          </div>
        </div>
      ))}
      {dropAt === rows.length && <div className="drop-line" />}
    </div>
  );
}

/** ↑ ↓ for one paragraph, shared by the outline rows and the transcript's paragraph labels. */
export function MoveButtons({ k, first, last }: { k: string; first: boolean; last: boolean }) {
  const st = useStore.getState();
  return (
    <>
      <button
        className="ghost"
        disabled={first}
        onClick={(e) => {
          e.stopPropagation();
          st.moveParagraph(k, 'up');
        }}
        title={`Move paragraph up (${combo('alt', 'shift', '↑')})`}
        aria-label="Move paragraph up"
      >
        ↑
      </button>
      <button
        className="ghost"
        disabled={last}
        onClick={(e) => {
          e.stopPropagation();
          st.moveParagraph(k, 'down');
        }}
        title={`Move paragraph down (${combo('alt', 'shift', '↓')})`}
        aria-label="Move paragraph down"
      >
        ↓
      </button>
    </>
  );
}
