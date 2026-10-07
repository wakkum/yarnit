import { useEffect, useMemo, useRef, useState } from 'react';
import { displayWords, findPauses } from '../engine/edl';
import { passages, wordColors } from '../engine/highlights';
import { isSpeech } from '../engine/types';
import { searchHits } from '../engine/view';
import { useStore, type Settings } from '../state/store';
import { combo, isMac } from './keys';
import { SendMenu } from './SendMenu';
import { clock } from './time';

export function TopBar() {
  const recording = useStore((s) => s.recording);
  const query = useStore((s) => s.query);
  const hitIndex = useStore((s) => s.hitIndex);
  const mainOpen = useStore((s) => s.mainOpen);
  const mainEmpty = useStore((s) => !s.project?.main?.clips.length);
  const canUndo = useStore((s) => (s.mainOpen ? s.mainPast : s.past).length > 0);
  const canRedo = useStore((s) => (s.mainOpen ? s.mainFuture : s.future).length > 0);
  const phase = useStore((s) => s.phase);
  const panel = useStore((s) => s.panel);
  const helpOpen = panel === 'help';
  const settings = useStore((s) => s.settings);
  const { setQuery, stepHit, deleteHits, undo, redo, removeFillers, exportAudio, exportMain, setPanel, setSettings } = useStore.getState();
  const doExport = (format: 'mp3' | 'wav') => void (mainOpen ? exportMain(format) : exportAudio(format));
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const display = useMemo(() => (recording ? displayWords(recording.words, recording.segments) : []), [recording]);
  const hits = useMemo(() => searchHits(display, query), [display, query]);
  const fillers = useMemo(() => display.filter((d) => !d.deleted && d.word.isFiller).length, [display]);
  const highlightCount = useMemo(
    () => (recording ? passages(display, recording.segments, wordColors(recording.words, recording.highlights)).length : 0),
    [display, recording],
  );
  const pauses = useMemo(
    () => (recording && phase === 'ready' ? findPauses(display, recording.segments, settings.pauseMin) : []),
    [display, recording, phase, settings.pauseMin],
  );

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const busy = phase === 'decoding' || phase === 'exporting';
  // music and sound effects (and the main timeline) have no transcript to search, highlight or tidy
  const speech = !!recording && isSpeech(recording.kind);

  return (
    <header className="top">
      <span className="name">
        {mainOpen ? 'Main timeline' : recording ? recording.name : 'Yarnit'}
        {recording && <SaveState />}
      </span>
      {(recording || mainOpen) && (
        <>
          {speech && (
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
          )}
          <button className="ghost" onClick={undo} disabled={!canUndo} title={`Undo (${combo('mod', 'Z')})`}>
            Undo
          </button>
          <button className="ghost" onClick={redo} disabled={!canRedo} title={`Redo (${isMac ? combo('shift', 'mod', 'Z') : combo('mod', 'Y')})`}>
            Redo
          </button>
          {speech && (
          <>
          <button
            className={`highlights-toggle${panel === 'highlights' ? ' on' : ''}`}
            onClick={() => setPanel(panel === 'highlights' ? null : 'highlights')}
            aria-expanded={panel === 'highlights'}
            title="Highlighted passages by colour"
          >
            Highlights{highlightCount ? ` (${highlightCount})` : ''}
          </button>
          <PausesMenu count={pauses.length} saves={pauses.reduce((t, p) => t + Math.max(0, p.length - settings.pauseKeep), 0)} />
          <button onClick={removeFillers} disabled={!fillers}>
            Remove fillers{fillers ? ` (${fillers})` : ''}
          </button>
          </>
          )}
          {recording && <SendMenu recording={recording} />}
          <ProjectsToggle />
          <div className="menu" ref={menuRef}>
            <button
              className="primary"
              onClick={() => setMenu(!menu)}
              disabled={busy || (mainOpen && mainEmpty)}
              title={mainOpen ? 'Mix every lane into one audio file' : undefined}
            >
              Export
            </button>
            {menu && (
              <div className="menu-list" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    doExport('mp3');
                  }}
                >
                  MP3 <small>192 kbps, small file</small>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    doExport('wav');
                  }}
                >
                  WAV <small>16-bit, full quality</small>
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {!recording && !mainOpen && <ProjectsToggle />}
      <div className="theme" role="group" aria-label="Theme">
        {(['auto', 'light', 'dark'] as Settings['theme'][]).map((t) => (
          <button
            key={t}
            className={settings.theme === t ? 'on' : ''}
            aria-pressed={settings.theme === t}
            onClick={() => setSettings({ theme: t })}
            title={t === 'auto' ? 'Follow the system setting' : undefined}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <button
        className={`ghost help-toggle${helpOpen ? ' on' : ''}`}
        onClick={() => setPanel(helpOpen ? null : 'help')}
        aria-expanded={helpOpen}
        title="Help and shortcuts (?)"
      >
        Help
      </button>
    </header>
  );
}

function ProjectsToggle() {
  const on = useStore((s) => s.panel === 'projects');
  return (
    <button
      className={`ghost panel-toggle${on ? ' on' : ''}`}
      onClick={() => useStore.getState().setPanel(on ? null : 'projects')}
      aria-expanded={on}
      title="Switch recording, start a new one, or delete one"
    >
      Projects
    </button>
  );
}

/** Green "Saved 10:42", amber "Saving", or why nothing is being saved. */
function SaveState() {
  const status = useStore((s) => s.saveStatus);
  const savedAt = useStore((s) => s.savedAt);
  const [label, title] =
    status === 'saved'
      ? [`Saved ${clock(savedAt)}`, 'Saved in this browser. It reopens when you come back.']
      : status === 'saving'
        ? ['Saving', 'Saving in this browser']
        : status === 'error'
          ? ['Not saved', 'Saving failed, probably because the disk or browser storage is full. Yarnit tries again after your next change.']
          : ['Not saved', 'This browser is not letting Yarnit save (for example a private window). Edits are lost when you close the tab.'];
  return (
    <span className={`save-state ${status}`} title={title} role="status">
      <i />
      {label}
    </span>
  );
}

/** Seconds field: typed freely, applied on blur or Enter, clamped to a sane range. */
function SecondsInput({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  // parent passes key={value}, so an outside change resets the text
  const [text, setText] = useState(String(value));
  const apply = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v * 10) / 10)));
    else setText(String(value));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text}
      style={{ width: 56 }}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => e.key === 'Enter' && apply()}
    />
  );
}

function PausesMenu({ count, saves }: { count: number; saves: number }) {
  const settings = useStore((s) => s.settings);
  const { setSettings, shortenPauses } = useStore.getState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        Shorten pauses{count ? ` (${count})` : ''}
      </button>
      {open && (
        <div className="pop" style={{ right: 0, top: 'calc(100% + 6px)', width: 290 }}>
          <h4>Shorten pauses</h4>
          <div className="row">
            Pauses longer than
            <SecondsInput key={settings.pauseMin} label="Minimum pause" value={settings.pauseMin} min={0.3} max={10} onChange={(pauseMin) => setSettings({ pauseMin })} />s
          </div>
          <div className="row">
            become
            <SecondsInput
              key={settings.pauseKeep}
              label="Shortened length"
              value={settings.pauseKeep}
              min={0}
              max={Math.max(0, settings.pauseMin - 0.1)}
              onChange={(pauseKeep) => setSettings({ pauseKeep })}
            />s
          </div>
          <p className="note">
            {count
              ? `Found ${count} pause${count === 1 ? '' : 's'}, marked as chips in the transcript. Saves ${saves.toFixed(1)} s. Click a chip to shorten just that one.`
              : 'No pauses that long. Try a lower number.'}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end', margin: 0 }}>
            <button className="ghost" onClick={() => setOpen(false)}>
              Close
            </button>
            <button
              className="primary"
              disabled={!count}
              onClick={() => {
                shortenPauses();
                setOpen(false);
              }}
            >
              Shorten {count || ''} pause{count === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
