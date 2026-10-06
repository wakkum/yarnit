// Layout C: top bar, timeline lanes, transcript. See ARCHITECTURE.md "UI".
import { useEffect } from 'react';
import { currentParagraphs, useStore } from './state/store';
import { AddDialog } from './ui/AddDialog';
import { EmptyState } from './ui/EmptyState';
import { Sidebar } from './ui/Sidebar';
import { HIGHLIGHT_COLORS, isSpeech } from './engine/types';
import { Help } from './ui/Help';
import { HighlightsPanel } from './ui/HighlightsPanel';
import { Notice } from './ui/Notice';
import { ProjectsPanel } from './ui/ProjectsPanel';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { Transcript } from './ui/Transcript';

export default function App() {
  const hasRecording = useStore((s) => s.recording != null);
  const panel = useStore((s) => s.panel);
  // a new batch of files gets a fresh dialog (its own kind guesses)
  const pendingKey = useStore((s) => s.pendingFiles?.map((p) => p.file.name).join('|') ?? '');
  const theme = useStore((s) => s.settings.theme);

  // 'auto' follows the system; index.css keys the dark tokens off data-theme
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  // pick up where the user left off
  useEffect(() => void useStore.getState().resumeLast(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'f' && st.recording) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search input')?.focus();
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '?') {
        st.setPanel(st.panel === 'help' ? null : 'help');
      } else if (e.key === 'Escape' && st.panel && !st.selection.length && !st.clipboard.length && !st.waveSel) {
        st.setPanel(null);
      } else if (!mod && !e.altKey && /^[0-6]$/.test(e.key) && st.selection.length) {
        // 1 to 6 colour the selection, 0 clears its highlight
        e.preventDefault();
        st.highlightSelection(e.key === '0' ? null : HIGHLIGHT_COLORS[+e.key - 1]);
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && st.recording && !mod) {
        // Alt+Shift+arrow moves the paragraph holding the selection; in the outline, a plain arrow picks the next row
        const up = e.key === 'ArrowUp';
        const paras = currentParagraphs(st.recording);
        const i = paras.findIndex((p) => p.words.some((d) => d.word.id === st.selection[0]));
        if (e.altKey && e.shiftKey && i >= 0) {
          e.preventDefault();
          st.moveParagraph(paras[i].key, up ? 'up' : 'down');
        } else if (!e.altKey && !e.shiftKey && st.view === 'outline') {
          e.preventDefault();
          const next = paras[i < 0 ? 0 : Math.max(0, Math.min(paras.length - 1, i + (up ? -1 : 1)))];
          if (next) {
            st.selectParagraph(next.key);
            document.querySelector(`[data-key="${next.key}"]`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (!mod && !e.altKey && (e.key === '+' || e.key === '=' || e.key === '-') && st.recording) {
        // timeline zoom (0 is taken by highlights, so Fit is the button only)
        e.preventDefault();
        st.zoomBy(e.key === '-' ? 0.5 : 2);
      } else if (e.code === 'Space') {
        e.preventDefault();
        st.togglePlay();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        // music and sound effects are never cut, only marked
        if (st.waveSel && st.recording && isSpeech(st.recording.kind)) st.deleteWaveSel();
        else st.deleteSelection();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        // Windows convention for redo
        e.preventDefault();
        st.redo();
      } else if (mod && e.key === 'x' && st.selection.length) {
        e.preventDefault();
        st.cut();
      } else if (mod && e.key.toLowerCase() === 'v' && st.selection.length === 1 && st.clipboard.length) {
        e.preventDefault();
        st.paste(e.shiftKey ? 'after' : 'before');
      } else if (e.key === 'Enter' && st.waveSel) {
        // music and sound effects: the waveform selection becomes a part
        e.preventDefault();
        st.addPartFromSelection();
      } else if (e.key === 'Escape') {
        st.select([]);
        st.clearClipboard();
        st.setWaveSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <Sidebar />
    <div
      className={`app${panel ? ' with-help' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // a file dropped anywhere is added to the project (the start screen's drop zone handles its own)
        e.preventDefault();
        void useStore.getState().addFiles([...e.dataTransfer.files]);
      }}
    >
      <TopBar />
      {hasRecording ? (
        <>
          <Timeline />
          <Transcript />
        </>
      ) : (
        <EmptyState />
      )}
      {panel === 'help' && <Help />}
      {panel === 'highlights' && <HighlightsPanel />}
      {panel === 'projects' && <ProjectsPanel />}
      <Notice />
    </div>
      <AddDialog key={pendingKey} />
    </div>
  );
}
