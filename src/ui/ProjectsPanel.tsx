// Projects drawer (mockups/save-b-drawer.html, picked 5 Oct 2026): every autosaved project,
// newest first. Click one to switch to it; the current one is marked.
import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../engine/save';
import { useStore } from '../state/store';
import { ago } from './time';
import { fmt } from './util';

export function ProjectsPanel() {
  const library = useStore((s) => s.library);
  const currentId = useStore((s) => s.project?.id);
  const { setPanel, refreshLibrary, loadFile } = useStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [now] = useState(() => Date.now());

  // the list also changes while a project is open (its own summary), so reload it whenever the drawer opens
  useEffect(() => void refreshLibrary(), [refreshLibrary]);

  return (
    <aside className="help projects-panel" aria-label="Projects">
      <div className="help-head">
        <h2>Projects</h2>
        <button className="ghost" onClick={() => setPanel(null)} title="Close" aria-label="Close projects">
          ✕
        </button>
      </div>
      <button className="primary new" onClick={() => input.current?.click()}>
        New project from audio file
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void loadFile(f);
        }}
      />
      {library.length ? (
        library.map((p) => <Item key={p.id} p={p} current={p.id === currentId} now={now} />)
      ) : (
        <p className="muted">No saved projects yet.</p>
      )}
      <p className="note">
        Saved automatically after every change, in this browser only. Clearing your browser data removes them. Undo
        history is not kept when you switch or close.
      </p>
    </aside>
  );
}

function Item({ p, current, now }: { p: ProjectSummary; current: boolean; now: number }) {
  const { openSaved, deleteSaved } = useStore.getState();
  const detail = [
    p.edited < p.duration - 0.05 ? `${fmt(p.edited)} of ${fmt(p.duration)}` : fmt(p.duration),
    p.transcribed ? `${p.words.toLocaleString()} words` : 'transcript not finished',
    p.highlights ? `${p.highlights} highlight${p.highlights === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return (
    <div className={`project${current ? ' on' : ''}`}>
      <button
        className="project-main"
        onClick={() => !current && void openSaved(p.id)}
        aria-current={current || undefined}
        title={current ? 'Open now' : `Open ${p.name}`}
      >
        <b>{p.name}</b>
        <span>{detail.join(' · ')}</span>
        <span>{current ? 'Open now' : `Saved ${ago(p.savedAt, now)}`}</span>
      </button>
      <button
        className="ghost project-x"
        title="Delete project"
        aria-label={`Delete ${p.name}`}
        onClick={() => confirm(`Delete ${p.name}? Its transcript and edits are removed from this browser. Your original audio file is not touched.`) && void deleteSaved(p)}
      >
        ✕
      </button>
    </div>
  );
}
