# Yarnit: Architecture

**Yarnit** is a local, in-browser audio editor where you edit the transcript and the audio follows (a Descript-style workflow). Audio never leaves the machine: transcription, editing, playback and export all run in the browser.

**Status (5 Oct 2026):** milestone 1 done and verified in Chrome: layout C UI (timeline lanes + transcript), local transcription, delete, cut/paste move (keys or the floating bar), search with delete-all, remove fillers, shorten pauses, speaker rename/reassign, colour highlights with a Highlights panel, Light/Dark/Auto theme, undo/redo, live playback, WAV/MP3 export, help drawer, autosave with a Projects drawer. Not yet tested on real (non-synthetic) recordings.
**Plan doc:** [Local Descript: Proof of Concept Plan](https://claude.ai/code/artifact/81f62755-9098-4bfc-b892-1dcd8edeebde) (research, scope, milestones)
**Run:** `npm run dev` (port 5174 via the parent `ai_projects/.claude/launch.json` entry "yarnit"). End users: `start.bat` (Windows) / `start.command` (Mac) or `npm start`, which builds and serves on port 4173 (see README).

## Where we left off (5 Oct 2026)

- **Git:** 4 Oct work in `d7ae30e`, all 5 Oct work in the second commit on [github.com/wakkum/yarnit](https://github.com/wakkum/yarnit) (private, `main`). Nothing uncommitted at that point. Never commit or push without the user's yes for that change.
- **Built on 5 Oct, all browser-verified:** see the decisions table (5 Oct rows) and "UI (layout C)". Mockups picked: help B (drawer), features A + pause chips from C, highlights B panel + A marker look, autosave B (drawer), paragraph moves C (outline; fall back to B if it doesn't look right), waveform B (edited, original on demand), zoom B + A's buttons. Reset timeline was built without mockups (one button + confirm).
- **Open questions for the user:**
  1. **Second file:** what should adding one do? (a) **Synced mics** (recommended, = M3): one file per speaker recorded together, merged transcript, cuts apply to all tracks; (b) **append** after the first; (c) **music/SFX bed**. Today a second drop starts a new project (the current one stays saved). See "Adding files" below.
  2. **Send highlights to a main timeline:** replace the current edit (undoable) or create a separate main timeline to switch to? And can passages be reordered there? (TODO.md "Highlights".)
- **Suggested next:** M3 once question 1 is answered; the Outline view and edited timeline are the base for the main timeline (question 2). Autosave not yet tried on a long real recording or after a browser storage clear.
- **User feedback so far:** basic features work. A real 3 min recording "seemed stuck" on transcribing: it was only slow (fixed by speech-only pieces). Cut quality on their own recordings not reported yet (POC verdict).
- **Not verified:** a real Windows machine (labels simulated, Ctrl paths tested on Mac). The top bar wraps to 2 or 3 rows on narrow windows; a tidy-up may be wanted.
- **Housekeeping:** an old dev server from the deleted `descryptor/` folder may still run on port 5173 in the user's own Terminal (serves 404s); only "yarnit" on 5174 is current. `mockups/` (layouts, help-*, feat-*, hl-*, save-*, para-*, wave-*, zoom-*) is throwaway once the UI settles.

---

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 4 Oct 2026 | Build new instead of forking [Rescript](https://github.com/wassgha/rescript) | Rescript is PolyForm Noncommercial, one file per project, and video-first (ffmpeg.wasm). We need multitrack and unrestricted use. Rescript stays a reference only: do not copy its code. |
| 4 Oct 2026 | Audio only, multitrack in the data model from day one | Retrofitting multitrack later means rewriting the core. |
| 4 Oct 2026 | Edits change only an ordered list of kept segments | One structure covers delete, move, undo and multitrack sync. See "Data model". |
| 4 Oct 2026 | Seams use a short fade-out/fade-in (8 ms, equal-power), not an overlapping crossfade | Output length = sum of segments exactly, so time mapping stays trivial. Cuts are snapped to quiet points, so the dip is inaudible. Revisit if a cut sounds bumpy. |
| 4 Oct 2026 | Mediabunny for export, not ffmpeg.wasm | ~30 kB vs ~30 MB, uses WebCodecs, no cross-origin isolation headers needed. |
| 4 Oct 2026 | Transcription defaults to WASM, not WebGPU | Transformers.js word timestamps on WebGPU have open issues. WASM measured ~3 to 9 s for a 15 s clip on whisper-base.en. WebGPU is selectable for testing. |
| 4 Oct 2026 | UI layout C chosen: timeline lanes on top, transcript below (`mockups/c-timeline.html`) | User picked it over A (document) and B (sidebar). Scales to multitrack and future music lanes. |
| 5 Oct 2026 | Renamed Descryptor to **Yarnit** (app title, package, docs, launch entry "yarnit") | User's choice: a yarn is a told story. Folder moved to `ai_projects/yarnit/` the same day. |
| 5 Oct 2026 | Theme switch, selection bar, pause chips, speaker menu built from `mockups/feat-a-popovers.html` plus the pause chips of `feat-c-inline.html` | User's pick. Popovers keep the transcript uncluttered; chips show where the dead air is and let one pause be shortened at a time. |
| 5 Oct 2026 | Speaker changes relabel `word.speakerId` and are undoable; the undo history stores `{segments, words, speakers}` snapshots | Labels are not audio edits, so segments stay the only audio edit, but users expect Undo to cover renames. Snapshots share unchanged arrays by reference, so they stay cheap. |
| 5 Oct 2026 | Pauses are shortened by removing their middle (`shortenPauses`), keeping `pauseKeep` seconds | The words either side keep their natural lead-in and tail; it reuses `removeSpan`, so seams get the usual fades. A pause is the silence actually heard between two kept words, so it can run across a seam (`Pause.pieces`, one source span per side); shortening keeps `pauseKeep / 2` next to each word. (Until 5 Oct a gap across a seam was ignored, which hid the dead air a move leaves behind.) |
| 5 Oct 2026 | A move carries at most `MOVE_PAD` (0.25 s) of silence on each side of the passage, and pastes at most 0.25 s from the target word | User report: cutting words that followed a long pause pasted them with dead air in front (a move took half of each surrounding gap, like a delete). Now the rest of the pause stays at the old place, where it shows as a pause chip. |
| 5 Oct 2026 | Transcribe only stretches with sound, in pieces of at most 28 s cut in pauses (`speechPieces`), instead of fixed 120 s pieces | 120 s pieces left the progress bar empty for minutes (user thought it was stuck). Plain 30 s pieces made Whisper invent words in a silent intro and drop a word at a piece start. Speech-only pieces fixed both and were 3x faster on a 2:17 test file (19 s vs ~60 s). Risk: speech quieter than the noise-floor estimate is skipped; the 0.3 s pad covers soft onsets. |
| 5 Oct 2026 | Distribute as source plus double-click launchers (`start.bat`, `start.command`) that check Node, run `npm ci` once, then `npm start` (`vite build && vite preview --open`) | Works from a GitHub ZIP on Windows and Mac with one prerequisite (Node 22+). The app cannot run from `file://` (module workers and wasm need http), so a local server is required. Hosting the built `dist/` (e.g. GitHub Pages) would remove the install step entirely; not done yet because the repo is private and publishing needs the user's go-ahead. |
| 5 Oct 2026 | Autosave to IndexedDB, not OPFS: project JSON, a summary per project, and the original audio file as a Blob keyed by track id (`src/state/library.ts`). Every project change is written 0.8 s later, and at once on `pagehide` / tab hidden. On load the last saved project reopens (`resumeLast`); the **Projects** drawer (mockup B) switches, starts or deletes projects. | IndexedDB stores Blobs on disk in every browser, with one API for both parts; OPFS writes need extra care in Safari. Keeping the original file (not decoded audio) is small and decodes in a second. Undo history is not saved (snapshots would duplicate the words per step). A project closed mid-transcription saves `transcribed: false` and transcribes again on reopen. `navigator.storage.persist()` is requested but Chrome may refuse; saving works either way. |
| 5 Oct 2026 | Paragraph moves: ↑ ↓ under each speaker label, Alt+Shift+↑/↓, and an **Outline** view (one row per paragraph, drag to reorder) from `mockups/para-c-outline.html`. If it doesn't look right the user wants B (`para-b-blocks.html`, Gutenberg-style block toolbar). | User asked for Gutenberg-style moves, with the main timeline in mind: the Outline rows are meant to become the main timeline's passage list. A paragraph move is `paragraphMove` (view.ts) then `moveWords` with `PARAGRAPH_PAD` (0.75 s, so the pause between paragraphs travels with it, capped so long dead air doesn't). `paragraphs()` now breaks wherever the next kept word is not the next one in the source, so a moved paragraph never merges with its new neighbours. |
| 5 Oct 2026 | `moveWords` keeps every edge inside the segment that holds its word, and inserts next to the target word's own segment | Found while testing paragraph moves: after a few moves the edit is fragmented, and the old "insert after the segment that ends at insertAt" matched a leftover scrap elsewhere, so the move did nothing. The same could hit a word paste after nearby cuts. |
| 5 Oct 2026 | The timeline shows the edited result (B of `mockups/wave-*.html`), with the original as an optional thin strip | User noticed cuts and moves were not reflected in the waveform. The main view now matches what plays and exports, which is also the shape the main timeline needs (lanes in playback order). |
| 5 Oct 2026 | Timeline zoom: overview window (`mockups/zoom-b-overview.html`) plus the − / + / Fit buttons of `zoom-a-buttons.html` | User's pick (B with A's buttons). Fit is button-only because the 0 key clears highlights. |
| 5 Oct 2026 | Shortcut labels come from `src/ui/keys.ts` (`combo('mod', 'X')` -> ⌘X or Ctrl+X); Ctrl+Y also redoes | The handlers always accepted Cmd or Ctrl, but the UI printed Mac symbols on Windows. Never hard-code ⌘ / ⇧ / ⌫ in UI copy. |
| 5 Oct 2026 | Colour highlights are source-time spans (`project.highlights`), not a word property; six colours, optional meaning per colour | Source time is the unit segments use, so "send red to the main timeline" can turn spans straight into segments, and with multitrack a span covers every track at that moment. Words stay immutable. UI: marker look of `mockups/hl-a-marker.html` (lower-half stroke, never confused with the solid selection) with the clip-bin panel of `hl-b-bin.html`. No yellow: search hits use it. |
| 5 Oct 2026 | Help is a right-hand drawer (`mockups/help-b-drawer.html`): getting started, shortcuts, FAQ | User picked it over a modal (A) and inline start-screen help (C). Stays open while editing, so shortcuts can be read alongside the transcript. |
| 4 Oct 2026 | Word ends are trimmed against the audio when words arrive (`speechEnd`) | Whisper stretches a word's end over the following pause (seen: 1.7 s "coast."), which hid paragraph breaks and skewed the playhead highlight. |

## Tech stack

- **App:** Vite 8 + React 19 + TypeScript 6, static files only, no backend
- **State:** Zustand 5 (`src/state/store.ts`)
- **Transcription:** `@huggingface/transformers` 4.3, Whisper (`Xenova/whisper-base.en` default), `return_timestamps: 'word'`, in a Web Worker
- **Decode:** Web Audio `decodeAudioData` (MP3, WAV, M4A, Ogg)
- **Playback:** Web Audio `AudioBufferSourceNode` scheduling on the original buffers
- **Export:** `mediabunny` 1.61 (WAV `pcm-s16`) + `@mediabunny/mp3-encoder` (LAME WASM, 192 kbps CBR default), in a Web Worker
- **Tests:** Vitest 4 (`npm test`), lint with oxlint, all three via `npm run check`

## Data flow

```
audio file(s) ──decodeAudioData──▶ AudioBuffer per track ──────────────┐
      │                                                                │
      └─OfflineAudioContext──▶ 16 kHz mono copy ──▶ transcribe.worker  │
                                   │                (Whisper, speech- │
                                   │                 only pieces ≤28 s,│
                                   ▼                 words back)       │
                       cut snapping (render.ts)          │             │
                                   │                     ▼             ▼
            transcript UI ◀── Project { words, segments } ──▶ Player (live, no re-render)
                 │ edits                       │
                 └──────▶ edl.ts ──────────────┘──▶ renderEdit ──▶ export.worker ──▶ WAV / MP3
```

## Data model (`src/engine/types.ts`)

- `Track`: one source file. `offset` aligns synced multitrack recordings on the shared timeline.
- `Word`: text + `start`/`end` in **source** seconds, `trackId`, `speakerId`, `isFiller`. Text and timing are written once by transcription and never change. Only `speakerId` can change (speaker menu, `assignSpeaker`).
- `Highlight`: `{ id, color, start, end }` in **source** seconds; spans never overlap (`applyHighlight` replaces what a new colour covers). A word's colour is the span containing its midpoint (`wordColors`). `passages()` (highlights.ts) groups kept words in playback order into same-colour runs for the panel. `highlightNames` holds the optional meaning per colour. Highlights are part of the undo snapshot; names are not.
- `Speaker`: `{ id, name }`. Each track gets a "Speaker 1" style speaker on load, and its words inherit it; the speaker menu renames them or moves a paragraph to another (or a new) speaker.
- `Segment`: `{ start, end }` span of the source timeline. **The ordered `segments` array is the edit.**
  - Delete = remove a span (splits segments). Move = split at the span edges and reorder. Undo = restore a previous array.
  - Every segment plays **all** tracks for its span, so multitrack edits can never drift out of sync.
  - Invariant: segments never overlap in source time (move is cut-and-paste, never copy).
- The transcript shown to the user is derived: `displayWords(words, segments)` = kept words in playback order, with deleted words kept visible (struck through) after the segment that precedes them in the source.

## Key modules

| File | Role | Tested |
| --- | --- | --- |
| `src/engine/edl.ts` | Pure edit-list logic: `deleteWords`, `moveWords`, `removeSpan`, `displayWords`, time mapping, filler detection | `edl.test.ts` |
| `src/engine/render.ts` | `renderEdit` (segments + tracks → mixed Float32Array with seam fades), `snapToQuiet` | `render.test.ts` |
| `src/audio/decode.ts` | Decode file, make 16 kHz mono copy | browser only |
| `src/audio/player.ts` | Live playback by scheduling segments 1 s ahead; fades match `render.ts` | browser only |
| `src/workers/transcribe.worker.ts` | Whisper pipeline over `speechPieces` (render.ts), drops punctuation-only words, streams `words` messages with progress | browser only |
| `src/workers/export.worker.ts` | Encodes rendered channels to WAV/MP3 | browser only |
| `src/engine/view.ts` | Derived UI views: `paragraphs` (speaker change, pause > 1.5 s, next kept word not the next in the source, long runs at sentence ends), `paragraphMove` (move paragraph i to position j as a `moveWords` call), `searchHits` (phrase, last token as prefix, kept words only), `computePeaks` | `view.test.ts` |
| `src/engine/save.ts` | Autosave format: `toSaved`, `fromSaved` (validates, fills fields older saves lack, refuses newer versions), `summarize` | `save.test.ts` |
| `src/state/library.ts` | IndexedDB `yarnit` (stores `projects`, `summaries`, `audio`): save/load/list/delete | browser |
| `src/state/store.ts` | Zustand store: load, edit actions, undo/redo, search, export, autosave (`useStore.subscribe` + `flushSave` at the bottom), `openSaved` / `resumeLast` / `closeProject`. Heavy audio lives in the non-reactive `media` object, never in React state. | browser |
| `src/ui/*` | `TopBar` (search, undo, fillers, export menu), `Timeline` (ruler, canvas waveform per track, cut regions, playhead), `Transcript` (paragraphs, word spans), `EmptyState` (drop zone, model picker) | browser |

## UI (layout C)

- Top bar: file name, search (`Cmd+F`, Enter / Shift+Enter to step, Delete all), Undo/Redo, Remove fillers (count), Export menu (MP3 192 kbps / WAV 16-bit).
- Timeline (`mockups/wave-b-edited.html`): transport + status ("2.8 s removed, 1 passage moved."), ruler, one lane per track showing the **edited** timeline: `editedPieces(segments)` (view.ts) lays segments out in playback order, the canvas looks each x up in the source peaks through the piece that plays there. Moved pieces (not in the duration-weighted longest run of pieces still in source order) draw in `--sp2` with a "moved from M:SS" tag; `.join` marks every seam; highlights are mapped with `toOutputSpans`. Clicking seeks in edited time (`seekOutput`). **Reset timeline** (play row, only when something is cut or moved): `confirm()` warning, then `resetTimeline` sets `fullSegments(duration)` through `commit`, so it is undoable; transcript, highlights and speakers are untouched. Zoom: `store.zoom` (`{start, span}` in output seconds, null = fit; `clampView` / `zoomAround` / `tickStep` in view.ts). − / N× / + / Fit in the play row, keys `+` `=` `-` (App.tsx), ⌘/Ctrl + wheel or trackpad pinch zooms around the pointer, sideways wheel or Shift + wheel pans (non-passive `wheel` listener so the page does not zoom). `Overview` strip under the lanes: whole edit with a window (drag = pan, edges = zoom, click outside = centre there, double-click = fit). While playing, the view pages along with the playhead. Zoomed past the 3000-peak resolution, track 1 is drawn straight from the 16 kHz copy (other tracks stay coarse until multitrack gives each a copy). Max zoom: `MIN_SPAN` 1 s. **Show original** (`settings.showOriginal`) opens a 20 px strip of the untouched first track: cuts red, moved source spans orange, its own playhead, click = `seekSource`.
- Transcript: paragraphs with speaker label + **edited** timestamp; click = select + seek, Shift+click or drag = range, Delete cuts, `Cmd+X` then click target + `Cmd+V` moves before it, Esc clears selection.
- Per-frame updates (clock, playhead line, current word) avoid React re-renders: the clock and playhead are written to the DOM directly via `usePlayhead`; the current word uses `usePlayheadValue`, which only re-renders on change. **Never give React children to an element that `usePlayhead` writes** (caused a `removeChild` crash).
- Clicking anywhere that is not a word, the selection bar, a popover, the help or the cut banner clears the selection (window `mousedown` in Transcript.tsx).
- Selecting: click (select + seek), Shift+click (range from the anchor), or mouse drag across words (`onMouseDown` / `onMouseMove` on `.doc-inner`, delegated via `data-wid`; auto-scrolls near the edges; mouse only, so touch still scrolls). A drag ends with a click on its start word, which `skipClick` swallows. Native text selection stays off (`user-select: none`). A selection is drawn as one block: the spaces between selected words are highlighted too (`.gap.sel`), with rounded ends (`sel-first` / `sel-last`).
- Selection bar (`SelectionBar` in Transcript.tsx): floats above the first selected word (below the selection when there is no room above) with Cut / Delete. After Cut the clipboard (`store.clipboard`) words get a dashed outline, a banner explains the next step, and clicking a target word turns the bar into **Paste before** / **Paste after** (`moveWords(..., side)`; after exists so a passage can go at the end of a sentence or the transcript). Cmd+X / Cmd+V (before) / Shift+Cmd+V (after) go through the same `cut` / `paste` actions. Esc cancels.
- Pauses: `findPauses` (edl.ts) on the display order; chips (`.pause`) after the word a pause follows. Clicking a chip shortens that one; **Shorten pauses (N)** in the top bar opens a popover to set `pauseMin` / `pauseKeep` and shorten all. Chips update live as the numbers change.
- Speakers: clicking a paragraph's speaker label opens `SpeakerMenu`: rename (all paragraphs by that speaker), or assign the paragraph's words to another or a new speaker. Colours follow the speaker's position in `project.speakers` (`speakerColor`).
- Highlights: select words, then a colour dot in the selection bar or keys `1` to `6` (`0` clears); the selection is cleared so the marker shows. Marker = `linear-gradient` on the lower half of `.w.hl` (and of the space between same-colour words, `.gap.hl`), strength `--hl-mix`. Colours `--hl-<id>` in index.css, names in `src/ui/colors.ts`. The **Highlights (N)** top-bar button (N = passages) opens `HighlightsPanel`: passages grouped by colour with edited time and length (click = select + seek + scroll; ✕ = remove), a meaning field per colour, and a disabled "Build main timeline" preview. The timeline draws each span as a strip at the top of every lane (`.hl-strip`).
- Paragraph moves: ↑ ↓ (`MoveButtons` in Outline.tsx) under the speaker label, shown on hover or when the paragraph holds the selection; Alt+Shift+↑/↓ moves the paragraph holding the selection (App.tsx). The moved paragraph glows (`store.moved`, `.flash`) and scrolls into view. Paragraphs come from `currentParagraphs(project)` (store.ts, cached per words/segments) so the transcript, outline and keys agree on keys.
- Outline view: `store.view` (`transcript` / `outline`) switched in the `.viewbar` above the transcript. `Outline.tsx` rows: drag handle (HTML5 drag and drop, `.drop-line` shows the slot), speaker, edited start, kept text with highlight dots, length (to the next paragraph's start), ↑ ↓. Click selects the paragraph's words and seeks; plain ↑/↓ pick the previous/next row.
- Side panels: `store.panel` (`'help' | 'highlights' | 'projects' | null`), one at a time, in the `.app.with-help` grid column.
- Autosave UI: next to the file name, `SaveState` shows Saved HH:MM (green), Saving (amber) or Not saved (red, tooltip says why). **Projects** (top bar, also on the start screen) opens `ProjectsPanel`: New project from audio file, every saved project (edited length, words, highlights, saved ago; click to switch, ✕ deletes after a confirm). After a reopen a `Notice` toast says which project and when it was saved. Dropping a file onto an open project starts a new project without asking (the old one is saved), and asks only when saving is off.
- Theme: `settings.theme` (`auto` / `light` / `dark`) sets `data-theme` on `<html>`; `index.css` applies the dark tokens under `prefers-color-scheme: dark` unless `data-theme="light"`, and always under `data-theme="dark"`. Settings persist in `localStorage` (`yarnit.settings`, wrapped in try/catch).
- Under 700px, top-bar popovers span the bar width (`.top .menu` is `position: static`) so they never hang off the screen.
- Help: `src/ui/Help.tsx`, toggled by the top-bar **Help** button (always shown, also on the start screen) or the `?` key; Esc closes it once nothing is selected. Open state is `helpOpen` in the store; `.app.with-help` adds a 380px grid column (full screen under 700px). Its shortcut table and FAQ are hand-written: **when a shortcut in `App.tsx` or a behaviour named in the FAQ changes, update `Help.tsx` too.** The ⌘ / Ctrl labels follow the platform.

### Adding files: what currently assumes one file

Touch these when implementing multitrack or append (the data model already supports several `tracks`):

- `store.loadFile` creates a **new** project with one track and resets everything; needs an `addFile` path that keeps `words`/`segments`/history.
- `media.mono16k` and `media.silence` are single values used by `snap` and `speechEnd`; make them per track (`Map<trackId, ...>`). For synced mics, snap on a mix of all tracks (a cut must be quiet on every mic).
- `transcribe(trackId, ...)` reads `media.mono16k`; pass the track's own copy. Words already carry `trackId`.
- `Project.duration` = longest track including `offset`; `segments` must be extended when a longer track arrives (append: add a segment for the new span).
- Player (`setTracks`) and `renderEdit` already mix multiple tracks with offsets and are tested for it.
- Speaker per word for synced mics: pick the track that is loudest during the word (bleed between mics means every track hears everyone), then dedupe words transcribed on more than one track.
- `App.tsx` drop handler starts a new project (the current one is autosaved); route it to "add" once that exists.
- Autosave: `openSaved` decodes only `tracks[0]`'s audio and `attachAudio` takes one buffer; loop over tracks. `library.saveAudio` is already keyed by track id.
- `paragraphs` already breaks on `speakerId ?? trackId` change, and `trackLabel` names lanes "Speaker N".

### Cut placement rules (edl.ts)

- A deleted run of words is cut from **halfway into the gap before it** to **halfway into the gap after it**, so one natural pause remains.
- **Moves differ:** the passage reaches at most `MOVE_PAD` (0.25 s) past its first and last word, and the insertion point is at most 0.25 s from the target word, so long pauses stay where they were instead of travelling with the words.
- First word: boundary is 0 (leading silence goes with it). Last word: boundary reaches past the end (trailing silence goes with it).
- With audio available, each boundary is snapped (`snapToQuiet`) to the quietest 5 ms window in the gap, allowed to reach 40 ms past Whisper's word edges (`SNAP_SLACK`) because Whisper timestamps are approximate.

## Known limits

- If a worker script fails to load (for example a dev server left running from a moved folder serves 404s), `worker.onerror` now puts an error in the status line instead of hanging on "Loading speech model". Only one dev server should run: the "yarnit" preview on port 5174.
- **Whisper often drops fillers.** On the test clip it kept "um" and "uh", but on real speech it frequently omits them, so Remove fillers finds nothing. Fixes for later: prompt with fillers, or detect short voiced gaps with a VAD.
- **Memory:** a 60 min stereo 44.1 kHz file is ~1.27 GB as Float32, and export renders a second copy. Fine for M1 testing; chunked render/encode needed before long multitrack sessions.
- **Time-to-first-transcript:** the model (~80 MB for base.en q8) downloads once, then is cached by the browser.
- **Chrome is the target.** Safari/Firefox may work but are untested.
- **Speakers:** every paragraph is "Speaker 1" until multitrack (M3) or speaker detection (M4).
- **Autosave:** saved projects live in this browser profile only; clearing site data removes them. No export/import of a project file yet. The undo history is lost on reopen.
- **Testing gotcha:** the browser pane pauses `requestAnimationFrame` while hidden, so the clock/playhead don't update in scripted tests then; check state, not the clock.

## Testing

- `npm run check`: typecheck + lint + unit tests. Run before asking to commit.
- `npm run sample`: regenerates `test-audio/sample.wav` (15 s, macOS `say`, includes "um"/"uh"). `test-audio/interview.wav` (50 s, two macOS voices, 1.8 s pauses) was generated ad hoc the same way for paragraph/search testing.
- Browser check: start the "yarnit" preview, drop `test-audio/interview.wav` on the `.drop` element (in scripts: fetch it, build a `DataTransfer`, dispatch a synthetic `drop` event), and wait until the transport text reads "Click the waveform to jump." (transcription done). `test-audio/` is gitignored; regenerate with `npm run sample`.
- Downloads in scripted tests: patch `HTMLAnchorElement.prototype.click` to capture the blob size instead of saving a file.
- Long-file check: `test-audio/long.wav` (2:17, 30 s of faint noise first, long gaps) was built with ffmpeg + `say`; it catches Whisper inventing words in silence and words lost at piece boundaries.
- Screenshots in the preview pane are scaled (for example 1024 px wide page -> 800 px image): convert element rects with `800 / innerWidth` before clicking by coordinate, or click by `ref`.
- After changing a keyboard handler in `App.tsx`, do a full reload: hot reload can keep the old `keydown` listener (its effect has `[]` deps).
- Windows labels can be checked without Windows: override `Navigator.prototype.platform` / `userAgentData`, then `import('/src/ui/keys.ts?x=' + Date.now())` for a fresh copy.
- Production check: `npm start` (or `start.command` in a clean copy with `BROWSER=none`) serves `dist/` on 4173; transcribe + MP3 export there before release-type changes.
- Autosave check: drop a file, edit, reload: the project should reopen with a "Reopened" notice. Reload mid-transcription: it should transcribe again. Inspect storage with `indexedDB.open('yarnit')` and count the `projects` / `summaries` / `audio` stores.
- Gotcha: `await import('/src/state/store.ts')` from the console can load a **second copy** of the store after HMR (Vite adds `?t=` versions), so the page won't reflect it. Drive the UI instead.

## Roadmap

1. **M1 Core loop** (done 4 Oct 2026): transcribe, delete, playback, WAV/MP3 export. Search with delete-all and keyboard cut/paste moves landed early.
2. **M2 Reorder** (mostly done 5 Oct 2026): drag-select, Cut/Paste bar with visible clipboard, silence shortening, colour highlights. Autosave done (IndexedDB). Left: drag-to-move, SRT/VTT export, timeline zoom.
3. **M3 Multitrack:** several synced files, one merged transcript, speaker = loudest track, per-track or mixed export.
4. **M4 Speakers:** rename and reassign done (5 Oct 2026). Left: pyannote segmentation 3.0 (ONNX) for single-file recordings, reassign part of a paragraph.
5. **Main timeline:** send chosen highlight colours to a main timeline (design in TODO.md, needs the user's two decisions).
6. **Later:** music/effects layers, noise reduction (RNNoise/DeepFilterNet), manual word-boundary nudge, typed transcript corrections.
