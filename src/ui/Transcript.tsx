import { memo, useMemo, useRef } from 'react';
import { displayWords, sourceToOutput, type DisplayWord } from '../engine/edl';
import type { Project } from '../engine/types';
import { paragraphs, searchHits } from '../engine/view';
import { useStore } from '../state/store';
import { fmt, trackColor, trackLabel, usePlayheadValue } from './util';

type Marks = { selected: Set<string>; hits: Set<string>; activeHit: Set<string>; current: string | null };

const Word = memo(function Word({
  d,
  index,
  sel,
  hit,
  active,
  cur,
  onPick,
}: {
  d: DisplayWord;
  index: number;
  sel: boolean;
  hit: boolean;
  active: boolean;
  cur: boolean;
  onPick: (i: number, shift: boolean) => void;
}) {
  const cls = ['w'];
  if (d.word.isFiller) cls.push('fill');
  if (d.deleted) cls.push('del');
  else {
    if (hit) cls.push(active ? 'hit-active' : 'hit');
    if (sel) cls.push('sel');
    if (cur) cls.push('cur');
  }
  return (
    <>
      <span className={cls.join(' ')} onClick={(e) => onPick(index, e.shiftKey)}>
        {d.word.text}
      </span>{' '}
    </>
  );
});

export function Transcript() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const query = useStore((s) => s.query);
  const hitIndex = useStore((s) => s.hitIndex);
  const phase = useStore((s) => s.phase);
  const anchor = useRef<number | null>(null);

  const display = useMemo(() => displayWords(project.words, project.segments), [project.words, project.segments]);
  const paras = useMemo(() => paragraphs(display), [display]);
  const indexOf = useMemo(() => new Map(display.map((d, i) => [d.word.id, i])), [display]);
  const hits = useMemo(() => searchHits(display, query), [display, query]);

  const current = usePlayheadValue<string | null>(
    project,
    (_, source) => {
      if (source == null) return null;
      return project.words.find((w) => source >= w.start && source < w.end)?.id ?? null;
    },
    null,
  );

  const marks: Marks = {
    selected: new Set(selection),
    hits: new Set(hits.flat()),
    activeHit: new Set(hits[hitIndex] ?? []),
    current,
  };

  const onPick = useMemo(
    () => (i: number, shift: boolean) => {
      const st = useStore.getState();
      const d = display[i];
      if (d.deleted) return;
      if (shift && anchor.current != null) {
        const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
        st.select(display.slice(a, b + 1).filter((x) => !x.deleted).map((x) => x.word.id));
      } else {
        anchor.current = i;
        st.select([d.word.id]);
        st.seekToWord(d.word);
      }
    },
    [display],
  );

  if (!project.words.length) {
    return (
      <main className="doc">
        <div className="doc-inner muted">
          {phase === 'error' ? 'No transcript.' : 'The transcript appears here as it is made, a couple of minutes of audio at a time.'}
        </div>
      </main>
    );
  }

  return (
    <main className="doc">
      <div className="doc-inner">
        {paras.map((p) => (
          <Para key={p.key} project={project} para={p} marks={marks} indexOf={indexOf} onPick={onPick} />
        ))}
        <p className="hint">
          Click a word to jump there, <kbd>Shift</kbd>+click to select a range. <kbd>Delete</kbd> cuts the selection,{' '}
          <kbd>⌘Z</kbd> undoes. To move a passage: select it, <kbd>⌘X</kbd>, click the word it should go before,{' '}
          <kbd>⌘V</kbd>. <kbd>Space</kbd> plays and pauses, <kbd>⌘F</kbd> searches. Press <kbd>?</kbd> for help.
        </p>
      </div>
    </main>
  );
}

function Para({
  project,
  para,
  marks,
  indexOf,
  onPick,
}: {
  project: Project;
  para: ReturnType<typeof paragraphs>[number];
  marks: Marks;
  indexOf: Map<string, number>;
  onPick: (i: number, shift: boolean) => void;
}) {
  const ti = project.tracks.findIndex((t) => t.id === para.trackId);
  const out = sourceToOutput(project.segments, para.start + 0.001);
  return (
    <div className="para">
      <div className="para-label">
        <span style={{ color: trackColor(ti) }}>{trackLabel(project, para.trackId, para.speakerId)}</span>
        <span className="ts mono">{out == null ? 'cut' : fmt(out)}</span>
      </div>
      <p>
        {para.words.map((d) => (
          <Word
            key={d.word.id}
            d={d}
            index={indexOf.get(d.word.id)!}
            sel={marks.selected.has(d.word.id)}
            hit={marks.hits.has(d.word.id)}
            active={marks.activeHit.has(d.word.id)}
            cur={marks.current === d.word.id}
            onPick={onPick}
          />
        ))}
      </p>
    </div>
  );
}
