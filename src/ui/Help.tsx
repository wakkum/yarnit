// Help drawer (mockups/help-b-drawer.html, picked 5 Oct 2026). Keep the shortcut list in sync with App.tsx.
import type { ReactNode } from 'react';
import { useStore } from '../state/store';

import { combo, isMac } from './keys';

const STEPS: [string, ReactNode][] = [
  ['Open a file', <>Drop an MP3, WAV or M4A onto the page, or click <b>Choose audio file</b>.</>],
  ['Wait for the transcript', 'It is made on this computer. The first time, the speech model downloads once.'],
  ['Edit the text', <>Select words and press <kbd>Delete</kbd>. They are cut from the audio too.</>],
  ['Export', <>Play it back to check, then <b>Export</b> as MP3 or WAV.</>],
];

const KEYS: [string, ReactNode][] = [
  ['Play / pause', <><kbd>Space</kbd></>],
  ['Jump to a word', 'Click the word'],
  ['Jump to a moment', 'Click the waveform. It shows the edit as it plays: moved passages in orange, a red mark at each join. Show original opens the untouched recording underneath'],
  ['Zoom the waveform', <><kbd>+</kbd> / <kbd>−</kbd>, the buttons by the play button, or <kbd>{combo('mod')}</kbd> + scroll (trackpad: pinch). Scroll sideways to move along. The strip under the waveform shows the whole edit: drag its blue window, or its edges, and double-click it to fit</>],
  ['Select a range', <>Drag across the words, or <kbd>Shift</kbd> + click</>],
  ['Cut the selection', <><kbd>Delete</kbd> or <kbd>Backspace</kbd></>],
  ['Undo / redo', <><kbd>{combo('mod', 'Z')}</kbd> / <kbd>{combo('shift', 'mod', 'Z')}</kbd>{!isMac && <> or <kbd>{combo('mod', 'Y')}</kbd></>}</>],
  ['Move a passage', <>Select it, <b>Cut</b> (<kbd>{combo('mod', 'X')}</kbd>), click a word next to where it goes, then <b>Paste before</b> (<kbd>{combo('mod', 'V')}</kbd>) or <b>Paste after</b> (<kbd>{combo('shift', 'mod', 'V')}</kbd>)</>],
  ['Move a whole paragraph', <>Click ↑ or ↓ under its speaker name, or click a word in it and press <kbd>{combo('alt', 'shift', '↑')}</kbd> / <kbd>{combo('alt', 'shift', '↓')}</kbd>. <b>Outline</b> (above the transcript) shows one line per paragraph: drag ⋮⋮ to reorder, <kbd>↑</kbd> <kbd>↓</kbd> to pick a row</>],
  ['Search', <><kbd>{combo('mod', 'F')}</kbd>, then <kbd>Enter</kbd> / <kbd>{combo('shift', 'Enter')}</kbd> for next / previous</>],
  ['Highlight in a colour', <>Select words, then click a colour in the bar, or press <kbd>1</kbd> to <kbd>6</kbd>. <kbd>0</kbd> removes it</>],
  ['Rename a speaker', 'Click the speaker name next to a paragraph'],
  ['Shorten one pause', 'Click its chip (for example 2.4 s) in the transcript'],
  ['Clear selection, cut or search', <><kbd>Esc</kbd></>],
  ['Open or close this help', <><kbd>?</kbd></>],
];

const FAQ: [string, string][] = [
  ['Is my audio uploaded anywhere?', 'No. Transcription, editing and export all run in your browser. The only download is the speech model, once.'],
  ['Does editing change my original file?', 'No. The original is never touched. Cuts are applied when you export, and you can undo at any time.'],
  ['Why is the first transcript slow?', 'The speech model (40 to 250 MB) downloads the first time. After that your browser keeps it. For more speed, pick the Fastest model or try the GPU engine before opening a file.'],
  ['What are highlights for?', 'Mark important passages in up to six colours. Highlights opens a list of every highlighted passage by colour; click one to jump to it, and give a colour a meaning such as "Must keep". Next, you will be able to send chosen colours to a main timeline. Highlights do not change the audio, and Undo covers them.'],
  ['How do I name the speakers?', 'Click the name next to any paragraph. Rename it there, or say the paragraph is by someone else (or a new speaker). Undo works for this too.'],
  ['How do I cut out dead air?', 'Long pauses show as small chips such as "2.4 s" in the transcript. Click one to shorten just that pause, or use Shorten pauses in the top bar to shorten all of them. You choose how long a pause must be and what it becomes.'],
  ['Remove fillers missed some "um"s. Why?', 'The speech model often leaves fillers out of the transcript, so there is no word to remove. Listen, then select the words around it and cut by hand.'],
  ['A cut sounds abrupt. What can I do?', 'Cuts snap to the nearest quiet moment and fade over 8 ms. If two words run together, undo and cut one word more or less.'],
  ['Which speech model should I pick?', 'Balanced suits most English recordings. Most accurate is slower but better with accents and noise. Use Multilingual for other languages.'],
  ['MP3 or WAV?', 'MP3 (192 kbps) is small and good for sharing. WAV is full quality, best if you will edit it further elsewhere.'],
  ['How do I start over on a file?', 'Reset timeline (next to the play button, shown once you have edited) brings back every cut and undoes every move, after asking first. The transcript, highlights and speaker names stay, and Undo can take the reset back.'],
  ['Is my work saved?', 'Yes, automatically after every change, in this browser on this computer. Next time, Yarnit reopens the project you last worked on. Projects in the top bar lists the others. Undo history starts fresh when you reopen. Clearing your browser data removes saved projects, so export anything you want to keep.'],
  ['Can I add a second file or track?', 'Not yet. Dropping a new file starts a new project; the current one stays saved under Projects. Multitrack is planned.'],
  ['Can I switch between light and dark?', 'Yes, with Auto / Light / Dark at the top right. Auto follows your computer. Your choice is remembered in this browser.'],
  ['Which browser should I use?', 'Chrome or Edge. Other browsers may work but are untested.'],
];

export function Help() {
  const setPanel = useStore((s) => s.setPanel);
  return (
    <aside className="help" aria-label="Help">
      <div className="help-head">
        <h2>Help</h2>
        <button className="ghost" onClick={() => setPanel(null)} title="Close (?)" aria-label="Close help">
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
