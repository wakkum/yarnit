// Help drawer (mockups/help-b-drawer.html, picked 5 Oct 2026). Keep the shortcut list in sync with App.tsx.
import type { ReactNode } from 'react';
import { FRESH_TOUR } from '../engine/tour';
import { useStore } from '../state/store';

import { combo, isMac } from './keys';

const STEPS: [string, ReactNode][] = [
  ['Add recordings', <>Drop MP3, WAV or M4A files onto the page or the sidebar, or click <b>+ Add recordings</b>. Say what each one is: interviews and voice-overs get a transcript, music and sound effects don't.</>],
  ['Wait for the transcript', 'It is made on this computer. The first time, the speech model downloads once.'],
  ['Edit the text', <>Select words and press <kbd>Delete</kbd>. They are cut from the audio too.</>],
  ['Build the final version', <>Use <b>Send to main</b> on each recording (the whole edit, the selected words, a highlight colour or a part), then open <b>Main timeline</b> in the sidebar to arrange them.</>],
  ['Export', <>Play it back to check, then <b>Export</b> as MP3 or WAV. On the main timeline, Export mixes every lane into one file.</>],
];

const KEYS: [string, ReactNode][] = [
  ['Play / pause', <><kbd>Space</kbd></>],
  ['Jump to a word', 'Click the word'],
  ['Scrub', 'Drag the blue grip at the top of the playhead, or drag anywhere along the time ruler. Playback pauses while you drag and carries on from where you let go'],
  ['Jump to a moment', 'Click the waveform. It shows the edit as it plays: moved passages in orange, a red mark at each join. Show original opens the untouched recording underneath'],
  ['Zoom the waveform', <><kbd>+</kbd> / <kbd>−</kbd>, the buttons by the play button, or <kbd>{combo('mod')}</kbd> + scroll (trackpad: pinch). Scroll sideways to move along. The strip under the waveform shows the whole edit: drag its blue window, or its edges, and double-click it to fit</>],
  ['Select a range', <>Drag across the words, or <kbd>Shift</kbd> + click</>],
  ['Cut the selection', <><kbd>Delete</kbd> or <kbd>Backspace</kbd></>],
  ['Select audio on the waveform', <>Drag across it. The words under it light up; <kbd>Delete</kbd> cuts it (interviews and voice-overs), <kbd>Enter</kbd> makes it a part</>],
  ['Undo / redo', <><kbd>{combo('mod', 'Z')}</kbd> / <kbd>{combo('shift', 'mod', 'Z')}</kbd>{!isMac && <> or <kbd>{combo('mod', 'Y')}</kbd></>}</>],
  ['Move a passage', <>Select it, <b>Cut</b> (<kbd>{combo('mod', 'X')}</kbd>), click a word next to where it goes, then <b>Paste before</b> (<kbd>{combo('mod', 'V')}</kbd>) or <b>Paste after</b> (<kbd>{combo('shift', 'mod', 'V')}</kbd>)</>],
  ['Move a whole paragraph', <>Click ↑ or ↓ under its speaker name, or click a word in it and press <kbd>{combo('alt', 'shift', '↑')}</kbd> / <kbd>{combo('alt', 'shift', '↓')}</kbd>. <b>Outline</b> (above the transcript) shows one line per paragraph: drag ⋮⋮ to reorder, <kbd>↑</kbd> <kbd>↓</kbd> to pick a row</>],
  ['Search', <><kbd>{combo('mod', 'F')}</kbd>, then <kbd>Enter</kbd> / <kbd>{combo('shift', 'Enter')}</kbd> for next / previous</>],
  ['Send words to the main timeline', <>Select them, then <b>Send to main</b> in the bar that appears</>],
  ['Highlight in a colour', <>Select words, then click a colour in the bar, or press <kbd>1</kbd> to <kbd>6</kbd>. <kbd>0</kbd> removes it</>],
  ['Rename a speaker', 'Click the speaker name next to a paragraph'],
  ['Correct a misheard word', <>Double-click it, type the right word (or several, such as a full name) and press <kbd>Enter</kbd>. <kbd>Esc</kbd> cancels. The audio does not change. On the main timeline this corrects that clip only</>],
  ['Shorten one pause', 'Click its chip (for example 2.4 s) in the transcript'],
  ['Main timeline: select a clip', <>Click it to set its volume, fades and the pause before it. Drag a music or effect clip to move it, drag the small squares to set its fades. <kbd>Esc</kbd> deselects</>],
  ['Main timeline: cut a clip in two', <>Click the spot on the clip, then <b>Cut here</b>, or select the clip and press <kbd>C</kbd> to cut at the playhead. A voice clip is cut in the nearest pause between words</>],
  ['Main timeline: speaker names', <>Click a speaker's name in the transcript under the lanes to rename them. It changes every clip from that recording on the main timeline; the recording keeps its own names</>],
  ['Main timeline: snapping', <>Dragged clips snap to the edges of every other clip and to the playhead, with a yellow line. <kbd>S</kbd> or the Snap button turns it off; hold <kbd>Alt</kbd> while dragging to skip it once</>],
  ['Main timeline: zoom into one clip', <>Double-click a clip (or <b>Zoom to clip</b> in its menu, or <kbd>Z</kbd>). It fills the view; <kbd>Esc</kbd>, <kbd>Z</kbd> or <b>Back to all</b> returns. To make lanes bigger, use <b>S</b>, <b>M</b> and <b>L</b> in each lane header: any number of lanes can be large. The strip under the lanes shows the whole timeline: drag its window to move, its edges to zoom</>],
  ['Main timeline: volume inside a clip', <>Click a clip, then <b>Add keyframe</b>. The dashed line on a clip is its volume (100% in the middle): drag it up or down. Each keyframe has its own volume: drag it up or down, or sideways to move it (hold <kbd>Shift</kbd> to change only its volume). The volume eases from one keyframe to the next. Dragging the line between two keyframes moves both. To dip the music for a moment, add four keyframes and drag the stretch between the middle two down. Double-click a keyframe to remove it. On music, <b>Lower under voice</b> in the clip settings does this for you wherever someone speaks</>],
  ['Main timeline: cut words', <>Select words in a clip's transcript and press <kbd>Delete</kbd>. Only that clip changes, not the recording</>],
  ['Clear selection, cut or search', <><kbd>Esc</kbd></>],
  ['Open or close this help', <><kbd>?</kbd></>],
];

const FAQ: [string, string][] = [
  ['Is my audio uploaded anywhere?', 'No. Transcription, editing and export all run in your browser. The only download is the speech model, once.'],
  ['Does editing change my original file?', 'No. The original is never touched. Cuts are applied when you export, and you can undo at any time.'],
  ['Why is the first transcript slow?', 'The speech model (40 to 250 MB) downloads the first time. After that your browser keeps it. For more speed, pick the Fastest model or try the GPU engine before opening a file.'],
  ['What are highlights for?', 'Mark important passages in up to six colours. Highlights opens a list of every highlighted passage by colour; click one to jump to it, and give a colour a meaning such as "Must keep". Send to main can send every passage in one colour to the main timeline, one clip per passage. Highlights do not change the audio, and Undo covers them.'],
  ['How do I name the speakers?', 'Click the name next to any paragraph. Rename it there, or say the paragraph is by someone else (or a new speaker). Undo works for this too.'],
  ['How do I cut out dead air?', 'Long pauses show as small chips such as "2.4 s" in the transcript. Click one to shorten just that pause, or use Shorten pauses in the top bar to shorten all of them. You choose how long a pause must be and what it becomes.'],
  ['Remove fillers missed some "um"s. Why?', 'The speech model often leaves fillers out of the transcript, so there is no word to remove. Listen, then select the words around it and cut by hand.'],
  ['A cut sounds abrupt. What can I do?', 'Cuts snap to the nearest quiet moment and fade over 8 ms. If two words run together, undo and cut one word more or less.'],
  ['Which speech model should I pick?', 'Balanced suits most English recordings. Most accurate is slower but better with accents and noise. Use Multilingual for other languages.'],
  ['MP3 or WAV?', 'MP3 (192 kbps) is small and good for sharing. WAV is full quality, best if you will edit it further elsewhere.'],
  ['How do I start over on a file?', 'Reset timeline (next to the play button, shown once you have edited) brings back every cut and undoes every move, after asking first. The transcript, highlights and speaker names stay, and Undo can take the reset back.'],
  ['Is my work saved?', 'Yes, automatically after every change, in this browser on this computer. Next time, Yarnit reopens the project and recording you last worked on. Projects (top bar, or ▾ next to the project name) lists the others. Undo history starts fresh when you switch or reopen. Clearing your browser data removes saved projects, so export anything you want to keep.'],
  ['How do projects and recordings work?', 'A project holds several recordings: interviews, voice-overs, music, sound effects. Each recording has its own transcript and edit; click one in the sidebar to work on it. Transcription runs in the background, one recording at a time, so you can edit one while the next is transcribed. Use ⋯ on a recording to rename it, change what it is, or delete it, and ☰ to fold the sidebar. Combine them into the final version on the main timeline.'],
  ['What are parts?', 'Pieces of a recording you want to use, each with a name and colour, for example Intro, Bed or Sting from a music file, or the best quote from an interview. Drag across the waveform, then click Add as part (or press Enter). Drag a part\'s edges on the waveform to adjust it, and click its name to rename it. Music and sound effects show their parts as pads instead of a transcript and are never cut; in an interview, parts sit in a strip under the waveform and are marked in the transcript with a coloured bar and a name tag. Parts may overlap, and each one can go to the main timeline on its own (Send to main on the pad or in its ⋯ menu), as often as you like. With two or more parts, Send all to main sends every part at once; music and effects then line up one after another.'],
  ['How does the main timeline work?', 'It is where you combine recordings into the final version. Send to main copies a piece of a recording into it as a clip, so later edits to the recording do not change the clip (send it again if you want the new version). Every kind has its own lane. Interview and voice-over clips play one after another in running order: drag one past another (or use the arrows) to change the order, and drop it with space before it, or use Pause before, to add a gap. Music and sound effects start where you drag them and play under the voice, so they do not move when you cut speech before them. Click a clip to cut it in two at that spot, or to set its volume (for example 30% for a music bed) and a fade in and fade out. Dragged clips snap to the edges of the other clips, so a voice-over can follow an interview part with no gap. The main timeline has its own Undo.'],
  ['Can I switch between light and dark?', 'Yes, with Auto / Light / Dark at the top right. Auto follows your computer. Your choice is remembered in this browser.'],
  ['Can I see the tour again?', 'Yes: Take the tour again, under Getting started in this help. It shows each part of the app the next time it is on screen: the start screen, a transcribed recording, a music file and the main timeline.'],
  ['Can I use audio from YouTube?', 'Yarnit cannot download from YouTube itself: browsers do not allow it. On your own computer, the free tool yt-dlp can save just the audio of a video you have the right to use: run  yt-dlp -x --audio-format mp3 "the video link"  in a terminal, then drop the MP3 onto Yarnit. YouTube\'s terms only allow downloading where YouTube offers it, so use your own videos or ones you have permission for.'],
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
        <button
          className="help-tour"
          onClick={() => {
            useStore.getState().setSettings({ tour: FRESH_TOUR });
            setPanel(null);
          }}
        >
          Take the tour again
        </button>
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
