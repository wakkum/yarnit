// Layout C: top bar, timeline lanes, transcript. See ARCHITECTURE.md "UI".
import { useEffect, useRef } from 'react';
import { useStore } from './state/store';
import { EmptyState } from './ui/EmptyState';
import { Help } from './ui/Help';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { Transcript } from './ui/Transcript';

export default function App() {
  const hasProject = useStore((s) => s.project != null);
  const helpOpen = useStore((s) => s.helpOpen);
  const clipboard = useRef<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'f' && st.project) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search input')?.focus();
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '?') {
        st.setHelp(!st.helpOpen);
      } else if (e.key === 'Escape' && st.helpOpen && !st.selection.length) {
        st.setHelp(false);
      } else if (e.code === 'Space') {
        e.preventDefault();
        st.togglePlay();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        st.deleteSelection();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key === 'x' && st.selection.length) {
        e.preventDefault();
        clipboard.current = st.selection;
      } else if (mod && e.key === 'v' && st.selection.length === 1 && clipboard.current.length) {
        e.preventDefault();
        st.moveWords(clipboard.current, st.selection[0], 'before');
        clipboard.current = [];
        st.select([]);
      } else if (e.key === 'Escape') {
        st.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={`app${helpOpen ? ' with-help' : ''}`}
      onDragOver={(e) => hasProject && e.preventDefault()}
      onDrop={(e) => {
        if (!hasProject) return;
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f && confirm(`Open ${f.name}? Edits to the current file will be lost.`)) void useStore.getState().loadFile(f);
      }}
    >
      <TopBar />
      {hasProject ? (
        <>
          <Timeline />
          <Transcript />
        </>
      ) : (
        <EmptyState />
      )}
      {helpOpen && <Help />}
    </div>
  );
}
