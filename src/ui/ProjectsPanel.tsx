// Projects drawer (mockups/save-b-drawer.html, picked 5 Oct 2026; projects hold several recordings
// since 6 Oct): every saved project, newest first. Click one to switch to it.
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../engine/save';
import { useStore } from '../state/store';
import { ago } from './time';
import { fmt } from './util';

export function ProjectsPanel() {
  const library = useStore((s) => s.library);
  const currentId = useStore((s) => s.project?.id);
  const { setPanel, refreshLibrary, newProject } = useStore.getState();
  const [now] = useState(() => Date.now());

  // names and lengths change while a project is open, so reload the list whenever the drawer opens
  useEffect(() => void refreshLibrary(), [refreshLibrary]);

  return (
    <aside className="help projects-panel" aria-label="Projects">
      <div className="help-head">
        <h2>Projects</h2>
        <button className="ghost" onClick={() => setPanel(null)} title="Close" aria-label="Close projects">
          ✕
        </button>
      </div>
      <button className="primary new" onClick={() => void newProject().then(() => setPanel(null))}>
        New project
      </button>
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
  const { openProject, deleteProject } = useStore.getState();
  const detail = [`${p.recordings} recording${p.recordings === 1 ? '' : 's'}`, p.recordings ? fmt(p.duration) : ''].filter(Boolean);
  return (
    <div className={`project${current ? ' on' : ''}`}>
      <button
        className="project-main"
        onClick={() => !current && void openProject(p.id)}
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
        onClick={() =>
          confirm(
            `Delete the project ${p.name} and its ${p.recordings} recording${p.recordings === 1 ? '' : 's'}? Transcripts and edits are removed from this browser. Your original audio files are not touched.`,
          ) && void deleteProject(p.id)
        }
      >
        ✕
      </button>
    </div>
  );
}
