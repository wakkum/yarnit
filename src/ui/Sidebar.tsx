// Project sidebar (mockups/files-c-collapsible.html, picked 6 Oct 2026): the project's recordings,
// folding to a rail of icons. The main timeline entry is a placeholder until that step is built.
import { useEffect, useRef, useState } from 'react';
import type { RecordingSummary } from '../engine/save';
import { isSpeech, RECORDING_KINDS, type RecordingKind } from '../engine/types';
import { useStore } from '../state/store';
import { KIND_ICON, KIND_LABEL } from './kinds';
import { fmt } from './util';


export function KindIcon({ kind }: { kind: RecordingKind }) {
  return (
    <span className={`ico k-${kind}`} aria-hidden>
      {KIND_ICON[kind]}
    </span>
  );
}

export function Sidebar() {
  const project = useStore((s) => s.project);
  const recordings = useStore((s) => s.recordings);
  const openId = useStore((s) => s.recording?.id);
  const mode = useStore((s) => s.settings.sidebar);
  const { setSettings, addFiles } = useStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (!project) return null;
  const rail = mode === 'rail';

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="audio/*"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        void addFiles(files);
      }}
    />
  );
  const toggle = (
    <button
      className="ghost side-toggle"
      onClick={() => setSettings({ sidebar: rail ? 'open' : 'rail' })}
      title={rail ? 'Show the recordings list' : 'Fold the sidebar'}
      aria-label={rail ? 'Show the recordings list' : 'Fold the sidebar'}
    >
      ☰
    </button>
  );

  if (rail)
    return (
      <aside className="side rail" aria-label="Recordings">
        {toggle}
        <span className="ico k-main off" title="Main timeline (next step)">
          ▤
        </span>
        {recordings.map((r) => (
          <button
            key={r.id}
            className={`rail-item${r.id === openId ? ' on' : ''}`}
            title={`${r.name} (${KIND_LABEL[r.kind]})`}
            onClick={() => r.id !== openId && void useStore.getState().openRecording(r.id)}
          >
            <KindIcon kind={r.kind} />
          </button>
        ))}
        <button className="ghost rail-add" title="Add recordings" aria-label="Add recordings" onClick={() => input.current?.click()}>
          +
        </button>
        {fileInput}
      </aside>
    );

  return (
    <aside
      className={`side${over ? ' over' : ''}`}
      aria-label="Recordings"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="side-head">
        {toggle}
        <ProjectName key={project.name} name={project.name} />
      </div>
      <div className="item off" title="Coming next: send passages from your recordings here to build the final version">
        <span className="ico k-main">▤</span>
        <span className="nm">Main timeline</span>
        <small>next step</small>
      </div>
      <h4>Recordings</h4>
      {recordings.map((r) => (
        <Item key={r.id} r={r} open={r.id === openId} />
      ))}
      <button className="addf" onClick={() => input.current?.click()}>
        <b>+ Add recordings</b>
        or drop audio files here
      </button>
      {fileInput}
    </aside>
  );
}

/** Click the project name to rename it; ▾ opens the Projects drawer. */
function ProjectName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const { renameProject, setPanel } = useStore.getState();
  const save = () => {
    setEditing(false);
    renameProject(text);
  };
  return (
    <div className="proj">
      {editing ? (
        <input
          autoFocus
          value={text}
          aria-label="Project name"
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setText(name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button className="proj-name" onClick={() => setEditing(true)} title="Rename the project">
          {name}
        </button>
      )}
      <button
        className="ghost proj-switch"
        onClick={() => setPanel(useStore.getState().panel === 'projects' ? null : 'projects')}
        title="Switch project, or start a new one"
        aria-label="Switch project"
      >
        ▾
      </button>
    </div>
  );
}

function Item({ r, open }: { r: RecordingSummary; open: boolean }) {
  const transcribing = useStore((s) => (s.transcribing?.id === r.id ? s.transcribing : null));
  const queued = useStore((s) => s.queued.includes(r.id));
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = useStore.getState();

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const right = transcribing ? (
    <span className="bar" title={transcribing.stage === 'download' ? 'Loading the speech model' : 'Transcribing'}>
      <i style={{ width: `${Math.round(transcribing.progress * 100)}%` }} />
    </span>
  ) : queued ? (
    <small title="Waiting to be transcribed">waiting</small>
  ) : (
    <small className="mono">{!isSpeech(r.kind) && r.parts ? `${r.parts} part${r.parts === 1 ? '' : 's'}` : fmt(r.edited)}</small>
  );

  return (
    <div className={`item${open ? ' on' : ''}`} ref={ref} onClick={() => !open && !renaming && void st.openRecording(r.id)} title={`${r.name} (${KIND_LABEL[r.kind]})`}>
      <KindIcon kind={r.kind} />
      {renaming ? (
        <RenameInput
          name={r.name}
          done={(name) => {
            setRenaming(false);
            if (name) void st.renameRecording(r.id, name);
          }}
        />
      ) : (
        <span className="nm">{r.name}</span>
      )}
      {right}
      <button
        className="ghost more"
        aria-label={`Options for ${r.name}`}
        aria-expanded={menu}
        onClick={(e) => {
          e.stopPropagation();
          setMenu(!menu);
        }}
      >
        ⋯
      </button>
      {menu && (
        <div className="pop item-menu" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setMenu(false);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <div className="sec">What is it?</div>
          {RECORDING_KINDS.map((k) => (
            <button
              key={k}
              className={k === r.kind ? 'on' : ''}
              onClick={() => {
                setMenu(false);
                if (k !== r.kind) void st.setKind(r.id, k);
              }}
            >
              <KindIcon kind={k} /> {KIND_LABEL[k]}
              {k === r.kind && ' ✓'}
            </button>
          ))}
          <hr />
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              if (confirm(`Delete ${r.name} from this project? Its transcript and edits are removed from this browser. Your original audio file is not touched.`))
                void st.deleteRecording(r.id);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function RenameInput({ name, done }: { name: string; done: (name: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <input
      className="nm"
      autoFocus
      value={text}
      aria-label="Recording name"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(text.trim() !== name ? text : '')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') done('');
      }}
    />
  );
}
