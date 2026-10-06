// "What is this recording?" (mockups/files-*.html): asked for every file added, with a guess picked.
// Speech kinds get a transcript; music and sound effects don't.
import { useState } from 'react';
import { RECORDING_KINDS, isSpeech, type RecordingKind } from '../engine/types';
import { useStore, type PendingFile } from '../state/store';
import { KIND_LABEL } from './kinds';
import { KindIcon } from './Sidebar';
import { fmt } from './util';

export function AddDialog() {
  const pending = useStore((s) => s.pendingFiles);
  // keyed by the file list in App, so a new batch starts from its own guesses
  const [items, setItems] = useState<PendingFile[]>(pending ?? []);
  if (!pending) return null;
  const { confirmAdd, cancelAdd } = useStore.getState();
  const setKind = (i: number, kind: RecordingKind) => setItems(items.map((it, j) => (j === i ? { ...it, kind } : it)));
  const one = items.length === 1;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && cancelAdd()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add recordings">
        <h3>{one ? 'What is this recording?' : `What are these ${items.length} recordings?`}</h3>
        <p className="muted">Interviews and voice-overs get a transcript. Music and sound effects don't: they are added as a waveform.</p>
        <div className="add-list">
          {items.map((it, i) => (
            <div className="add-row" key={i}>
              <div className="add-file">
                <b>{it.file.name}</b>
                <span className="muted mono">{it.duration ? fmt(it.duration) : ''}</span>
              </div>
              <div className="kinds" role="radiogroup" aria-label={`What ${it.file.name} is`}>
                {RECORDING_KINDS.map((k) => (
                  <button key={k} role="radio" aria-checked={it.kind === k} className={`kind${it.kind === k ? ' on' : ''}`} onClick={() => setKind(i, k)}>
                    <KindIcon kind={k} />
                    <span>
                      <b>{KIND_LABEL[k]}</b>
                      <small>{isSpeech(k) ? 'Transcribed' : 'No transcript'}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-row">
          <button onClick={cancelAdd}>Cancel</button>
          <button className="primary" autoFocus onClick={() => void confirmAdd(items)}>
            {one ? 'Add' : `Add ${items.length} recordings`}
          </button>
        </div>
      </div>
    </div>
  );
}
