import { useEffect, useMemo, useRef, useState } from 'react';
import { displayWords } from '../engine/edl';
import { searchHits } from '../engine/view';
import { useStore } from '../state/store';

export function TopBar() {
  const project = useStore((s) => s.project);
  const query = useStore((s) => s.query);
  const hitIndex = useStore((s) => s.hitIndex);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const phase = useStore((s) => s.phase);
  const helpOpen = useStore((s) => s.helpOpen);
  const { setQuery, stepHit, deleteHits, undo, redo, removeFillers, exportAudio, setHelp } = useStore.getState();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const display = useMemo(() => (project ? displayWords(project.words, project.segments) : []), [project]);
  const hits = useMemo(() => searchHits(display, query), [display, query]);
  const fillers = useMemo(() => display.filter((d) => !d.deleted && d.word.isFiller).length, [display]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const busy = phase === 'decoding' || phase === 'exporting';

  return (
    <header className="top">
      <span className="name">{project ? project.name : 'Yarnit'}</span>
      {project && (
        <>
          <div className="search">
            <input
              type="search"
              placeholder="Search transcript"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') stepHit(e.shiftKey ? -1 : 1);
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                }
              }}
            />
            {query && (
              <>
                <span className="muted mono">
                  {hits.length ? `${hitIndex >= 0 ? hitIndex + 1 + ' of ' : ''}${hits.length}` : 'No matches'}
                </span>
                <button className="ghost" onClick={() => stepHit(-1)} disabled={!hits.length} title="Previous (Shift+Enter)">
                  ↑
                </button>
                <button className="ghost" onClick={() => stepHit(1)} disabled={!hits.length} title="Next (Enter)">
                  ↓
                </button>
                <button className="ghost danger" onClick={deleteHits} disabled={!hits.length}>
                  Delete all
                </button>
              </>
            )}
          </div>
          <button className="ghost" onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">
            Undo
          </button>
          <button className="ghost" onClick={redo} disabled={!canRedo} title="Redo (Shift+Cmd+Z)">
            Redo
          </button>
          <button onClick={removeFillers} disabled={!fillers}>
            Remove fillers{fillers ? ` (${fillers})` : ''}
          </button>
          <div className="menu" ref={menuRef}>
            <button className="primary" onClick={() => setMenu(!menu)} disabled={busy}>
              Export
            </button>
            {menu && (
              <div className="menu-list" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    void exportAudio('mp3');
                  }}
                >
                  MP3 <small>192 kbps, small file</small>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    void exportAudio('wav');
                  }}
                >
                  WAV <small>16-bit, full quality</small>
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <button
        className={`ghost help-toggle${helpOpen ? ' on' : ''}`}
        onClick={() => setHelp(!helpOpen)}
        aria-expanded={helpOpen}
        title="Help and shortcuts (?)"
      >
        Help
      </button>
    </header>
  );
}
