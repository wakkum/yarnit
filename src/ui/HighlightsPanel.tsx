// Highlights panel (mockups/hl-b-bin.html, with the marker look of hl-a-marker.html, picked 5 Oct 2026):
// every highlighted passage grouped by colour, like a bin of clips, plus the later "main timeline" step.
import { useMemo, useState } from 'react';
import { displayWords } from '../engine/edl';
import { passages, wordColors, type Passage } from '../engine/highlights';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../engine/types';
import { useStore } from '../state/store';
import { HIGHLIGHT_NAMES } from './colors';
import { combo } from './keys';
import { fmt } from './util';

export function HighlightsPanel() {
  const project = useStore((s) => s.project);
  const { setPanel } = useStore.getState();
  const [pick, setPick] = useState<Set<HighlightColor>>(new Set(['red']));

  const list = useMemo(() => {
    if (!project) return [];
    const display = displayWords(project.words, project.segments);
    return passages(display, project.segments, wordColors(project.words, project.highlights));
  }, [project]);

  const byColor = HIGHLIGHT_COLORS.map((c) => [c, list.filter((p) => p.color === c)] as const).filter(([, ps]) => ps.length);

  return (
    <aside className="help hl-panel" aria-label="Highlights">
      <div className="help-head">
        <h2>Highlights</h2>
        <button className="ghost" onClick={() => setPanel(null)} title="Close" aria-label="Close highlights">
          ✕
        </button>
      </div>
      {!project || !byColor.length ? (
        <p className="muted" style={{ lineHeight: 1.55 }}>
          No highlights yet. Select words in the transcript and pick a colour in the bar that appears, or press{' '}
          <kbd>1</kbd> to <kbd>6</kbd>. <kbd>0</kbd> removes a highlight.
        </p>
      ) : (
        byColor.map(([color, ps]) => (
          <section key={color}>
            <div className={`grp hl-${color}`}>
              <span className={`dot swatch hl-${color}`} />
              <b>{HIGHLIGHT_NAMES[color]}</b>
              <NameInput key={project.highlightNames[color] ?? ''} color={color} value={project.highlightNames[color] ?? ''} />
              <span className="muted mono">{ps.length}</span>
            </div>
            {ps.map((p) => (
              <Clip key={p.wordIds[0]} p={p} />
            ))}
          </section>
        ))
      )}
      <div className="build">
        <h3>Build main timeline</h3>
        <div className="checks">
          {HIGHLIGHT_COLORS.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={pick.has(c)}
                onChange={(e) => {
                  const next = new Set(pick);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  setPick(next);
                }}
              />
              <span className={`dot swatch hl-${c}`} />
              {project?.highlightNames[c] || HIGHLIGHT_NAMES[c]}
            </label>
          ))}
        </div>
        <p className="note">
          Puts only the chosen colours, in transcript order, on a new main timeline. With multitrack it will take those
          moments from every track.
        </p>
        <button className="primary" disabled style={{ width: '100%' }}>
          Send to main timeline (coming next)
        </button>
      </div>
    </aside>
  );
}

/** Optional meaning for a colour (red = "Must keep"); saved on blur or Enter. */
function NameInput({ color, value }: { color: HighlightColor; value: string }) {
  const [text, setText] = useState(value);
  const save = () => text !== value && useStore.getState().nameHighlight(color, text);
  return (
    <input
      value={text}
      placeholder="Add a meaning"
      aria-label={`Meaning of ${HIGHLIGHT_NAMES[color]}`}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), save())}
    />
  );
}

function Clip({ p }: { p: Passage }) {
  const st = useStore.getState();
  return (
    <div className={`clip hl-${p.color}`}>
      <button
        className="clip-main"
        title="Jump to this passage and select it"
        onClick={() => {
          const first = st.project?.words.find((w) => w.id === p.wordIds[0]);
          st.select(p.wordIds);
          if (first) st.seekToWord(first);
          document.querySelector(`[data-wid="${p.wordIds[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
      >
        <span className="mono muted">{fmt(p.start)}</span>
        <span className="t">{p.text}</span>
        <span className="mono muted">{p.duration.toFixed(1)} s</span>
      </button>
      <button
        className="ghost clip-x"
        title={`Remove this highlight (select it and press ${combo('0')})`}
        aria-label="Remove this highlight"
        onClick={() => st.highlightWordIds(p.wordIds, null)}
      >
        ✕
      </button>
    </div>
  );
}
