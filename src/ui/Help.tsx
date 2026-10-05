// Help drawer (mockups/help-b-drawer.html, picked 5 Oct 2026). Keep the shortcut list in sync with App.tsx.
import type { ReactNode } from 'react';
import { useStore } from '../state/store';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';

const STEPS: [string, ReactNode][] = [
  ['Open a file', <>Drop an MP3, WAV or M4A onto the page, or click <b>Choose audio file</b>.</>],
  ['Wait for the transcript', 'It is made on this computer. The first time, the speech model downloads once.'],
  ['Edit the text', <>Select words and press <kbd>Delete</kbd>. They are cut from the audio too.</>],
  ['Export', <>Play it back to check, then <b>Export</b> as MP3 or WAV.</>],
];

const KEYS: [string, ReactNode][] = [
  ['Play / pause', <><kbd>Space</kbd></>],
  ['Jump to a word', 'Click the word'],
  ['Jump to a moment', 'Click the waveform'],
  ['Select a range', <><kbd>Shift</kbd> + click</>],
  ['Cut the selection', <><kbd>Delete</kbd> or <kbd>Backspace</kbd></>],
  ['Undo / redo', <><kbd>{MOD}Z</kbd> / <kbd>{SHIFT}{MOD}Z</kbd></>],
  ['Move a passage', <>Select it, <kbd>{MOD}X</kbd>, click the word it should go before, <kbd>{MOD}V</kbd></>],
  ['Search', <><kbd>{MOD}F</kbd>, then <kbd>Enter</kbd> / <kbd>{SHIFT}Enter</kbd> for next / previous</>],
  ['Clear selection or search', <><kbd>Esc</kbd></>],
  ['Open or close this help', <><kbd>?</kbd></>],
];

const FAQ: [string, string][] = [
  ['Is my audio uploaded anywhere?', 'No. Transcription, editing and export all run in your browser. The only download is the speech model, once.'],
  ['Does editing change my original file?', 'No. The original is never touched. Cuts are applied when you export, and you can undo at any time.'],
  ['Why is the first transcript slow?', 'The speech model (40 to 250 MB) downloads the first time. After that your browser keeps it. For more speed, pick the Fastest model or try the GPU engine before opening a file.'],
  ['Remove fillers missed some "um"s. Why?', 'The speech model often leaves fillers out of the transcript, so there is no word to remove. Listen, then select the words around it and cut by hand.'],
  ['A cut sounds abrupt. What can I do?', 'Cuts snap to the nearest quiet moment and fade over 8 ms. If two words run together, undo and cut one word more or less.'],
  ['Which speech model should I pick?', 'Balanced suits most English recordings. Most accurate is slower but better with accents and noise. Use Multilingual for other languages.'],
  ['MP3 or WAV?', 'MP3 (192 kbps) is small and good for sharing. WAV is full quality, best if you will edit it further elsewhere.'],
  ['Is my work saved?', 'Not yet. Closing the tab loses your edits, so export before you leave.'],
  ['Can I add a second file or track?', 'Not yet. Dropping a new file replaces the current one (it asks first). Multitrack is planned.'],
  ['Which browser should I use?', 'Chrome or Edge. Other browsers may work but are untested.'],
];

export function Help() {
  const setHelp = useStore((s) => s.setHelp);
  return (
    <aside className="help" aria-label="Help">
      <div className="help-head">
        <h2>Help</h2>
        <button className="ghost" onClick={() => setHelp(false)} title="Close (?)" aria-label="Close help">
          ✕
        </button>
      </div>
      <section>
        <h3>Getting started</h3>
        <ol className="steps">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <b>{title}</b>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3>Shortcuts</h3>
        <table className="keys">
          <tbody>
            {KEYS.map(([action, keys]) => (
              <tr key={action}>
                <td>{action}</td>
                <td>{keys}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Questions</h3>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </aside>
  );
}
