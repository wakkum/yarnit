# Yarnit: Architecture

**Yarnit** is a local, in-browser audio editor where you edit the transcript and the audio follows (a Descript-style workflow). Audio never leaves the machine: transcription, editing, playback and export all run in the browser.

**Status (5 Oct 2026):** milestone 1 done and verified in Chrome: layout C UI (timeline lanes + transcript), local transcription, delete, cut/paste move (keys or the floating bar), search with delete-all, remove fillers, shorten pauses, speaker rename/reassign, colour highlights with a Highlights panel, Light/Dark/Auto theme, undo/redo, live playback, WAV/MP3 export, help drawer, autosave with a Projects drawer, projects holding several recordings (6 Oct). Not yet tested on real (non-synthetic) recordings.
**Plan doc:** [Local Descript: Proof of Concept Plan](https://claude.ai/code/artifact/81f62755-9098-4bfc-b892-1dcd8edeebde) (research, scope, milestones)
**Run:** `npm run dev` (port 5174 via the parent `ai_projects/.claude/launch.json` entry "yarnit"). End users: `start.bat` (Windows) / `start.command` (Mac) or `npm start`, which builds and serves on port 4173 (see README).

## Where we left off (6 Oct 2026)

- **Git:** `d7ae30e` (4 Oct), `c433f05` (5 Oct) and the 6 Oct commit (projects with several recordings, parts, waveform selection) on [github.com/wakkum/yarnit](https://github.com/wakkum/yarnit) (private, `main`). `.claude/launch.json` (project dev-server config) is left uncommitted until the user decides. Never commit or push without the user's yes.
- **6 Oct:** projects with several recordings built and browser-verified (migration of old saves, add dialog, background queue, switching mid-transcription, rename / kind / delete, rail, Projects drawer, reload). The user will test this before the main timeline.
- **6 Oct, later:** user: music must be usable in pieces, not as a whole 3 min file, and different pieces of one file go to different places. Built **parts** (mockup A `parts-a-list.html` regions + C `parts-c-pads.html` pads): drag on a music/SFX waveform, Add as part (or Enter), named coloured regions with draggable edges, pads to play / rename / delete, "Send to main" shown disabled. Browser-verified (add, overlap, edge drag, undo/redo, play stops at the part's end, delete, reload). The earlier `music-*.html` cut mockups are superseded. Then, at the user's request, the same waveform selection on **speech** (mockup C `speech-parts-c-margin.html`): its bar adds **Delete** (cuts the selected output range, `removeOutputRange`), the words under it light up, and parts show as a strip under the timeline plus a margin bar and name tag in the transcript. Browser-verified on a `say`-generated clip (lit words = cut words, undo, part added and played, music bar has no Delete).
- **Built on 5 Oct, all browser-verified:** see the decisions table (5 Oct rows) and "UI (layout C)". Mockups picked: help B (drawer), features A + pause chips from C, highlights B panel + A marker look, autosave B (drawer), paragraph moves C (outline; fall back to B if it doesn't look right), waveform B (edited, original on demand), zoom B + A's buttons. Reset timeline was built without mockups (one button + confirm).
- **Decided 6 Oct 2026 (user):** Yarnit is for a workshop, so the basics come first. A **project** holds several separate **recordings** (interview, voice-over, sound effects, music), each edited on its own, plus one **main timeline** where the final version is built. "Send to main" **copies** passages (whole edit or chosen highlight colours); later edits to a recording do not change the main timeline. Synced multi-mic recording (old M3) is low priority: few workshop recordings will have separate mic files.
- **Order agreed:** (1) projects with several recordings (mockups `files-*.html`, waiting for the user's pick), then the user tests; (2) main timeline + send to main; (3) music/SFX on the main timeline; multitrack later.
- **Suggested next:** after the user's test, step (2): main timeline + Send to main (copy). The Outline view and edited timeline are the base for the main timeline. Autosave not yet tried on a long real recording or after a browser storage clear.
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
| 6 Oct 2026 | Waveform selection on every recording; on speech its bar also has **Delete**, and speech gets parts too: a strip of small pads under the timeline, and in the transcript a coloured margin bar per part plus a name tag where it starts (`mockups/speech-parts-c-margin.html`, over A strip and B side panel) | User wanted the waveform way of editing everywhere. Speech is edited in sentences, so showing parts in the text helps most; the strip keeps them one click away. Delete cuts by output time so it works across moves. |
| 6 Oct 2026 | Music and sound effects get **parts** instead of cuts: named, coloured source spans (may overlap) marked by dragging on the waveform, shown as regions on it plus pads below (`mockups/parts-a-list.html` + pads of `parts-c-pads.html`) | User: different pieces of one music file go to different places on the main timeline (intro, bed, sting, outro). Cutting the file would allow only one edit; parts never touch the audio and each will be sent to main on its own. |
| 6 Oct 2026 | Projects hold several recordings (interview, voice-over, music, sound effect), each with its own transcript and edit; collapsible sidebar (mockup C of `files-*.html`); kind asked on add; music and sound effects are not transcribed; transcription runs as a background queue | User's workshop needs separate recordings, not synced mics. The old per-file `Project` type became `Recording`, and `Project` is now the container. Save format v2 stores projects and recordings separately so editing one recording never rewrites the others; v1 saves migrate to one-recording projects. Whisper invents lyrics on music, hence no transcript for non-speech kinds. |
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

- `Project` (6 Oct): `{ id, name, recordingIds, lastRecordingId }`, a container for several recordings; the main timeline will live here. `Recording` (until 6 Oct called `Project` in code) is one audio file's document: everything below, plus `kind` (`interview` / `voiceover` / `music` / `sfx`; `isSpeech` decides whether it is transcribed). Music and sound effects have no words.
- `Track`: one source file. `offset` aligns synced multitrack recordings on the shared timeline.
- `Word`: text + `start`/`end` in **source** seconds, `trackId`, `speakerId`, `isFiller`. Text and timing are written once by transcription and never change. Only `speakerId` can change (speaker menu, `assignSpeaker`).
- `Part` (6 Oct): `{ id, name, color, start, end }` in **source** seconds, on music and sound-effects recordings (`recording.parts`, kept sorted by start). Parts may overlap and never change `segments`; each is meant to be sent to the main timeline on its own. Helpers in `parts.ts`; part of the undo snapshot. Colours reuse the highlight palette.
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
| `src/engine/parts.ts` | `addPart` (clamped, min `MIN_PART` 0.1 s, next "Part N" name and unused colour), `setPartEdge`, `renamePart`, `removePart`, `labelRows` (stack close labels) | `parts.test.ts` |
| `src/engine/save.ts` | Save format v2: `SavedProject` and `SavedRecording` as separate records, `fromSaved*` (validate, fill missing fields, refuse newer versions), `summarizeRecording` / `summarizeProject`, `migrateV1` (old one-file save → project + recording), `guessKind` | `save.test.ts` |
| `src/state/library.ts` | IndexedDB `yarnit` v2 (stores `projects`, `recordings`, `summaries` per recording, `audio` per track). The v1→v2 upgrade runs `migrateV1` inside `onupgradeneeded` | browser |
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
- Waveform selection on every lane (`selectOnWave` in Timeline.tsx). Speech: the bar also has **Delete** (`deleteWaveSel` → `removeOutputRange` in edl.ts, the selected output range across seams; Delete / Backspace keys too); `wordsInOutput` (parts.ts) lights the covered kept words (`.w.wsel`); a word selection and a waveform selection clear each other (`select` / `setWaveSel`). Parts on speech: `PartsStrip` (Parts.tsx) under the timeline (play, name, kept length, ⋯), and in the transcript `wordParts` gives each paragraph a `.part-bar` per part it holds words of and a `.part-tag` (plays the part) before a part's first word. `playPart` plays from the first to the last output fragment of a part (`toOutputSpans`). Renaming is `store.renamingPart` (or `freshPart` right after adding). `Waveform` now lives in `Waveform.tsx` (shared by lanes, overview, pads).
- Music and sound effects (`!isSpeech(kind)`): the lane is taller (`.lane.tall`) and purple. A drag on it sets `store.waveSel` (output seconds; under `DRAG_PX` 4 px it is a click = seek). The `SelectionBar` in Timeline.tsx (range in tenths via `rangeLabel`, Play = `playRange`, **Add as part**, ✕; Enter / Esc in App.tsx) sits over the ruler. Parts are drawn with `toOutputSpans` as `.part-region`s: a label button (plays the part; rows from `labelRows` by name length) and 10 px `.part-edge`s whose drag previews with `previewParts` and commits one undo step with `commitParts(parts, before)`. Below, `Parts.tsx` replaces the transcript with pads (name: click to rename, a new part opens with its name selected via `store.freshPart`; range; mini `Waveform` with the 16 kHz detail; ▶/❚❚; disabled Send to main; ⋯ rename / delete). `playPart` plays a part with `Player.play(from, until)`, which stops (with the seam fade) at `until`; `store.playingPart` marks the pad. The top bar hides search, Highlights, Shorten pauses and Remove fillers, and the sidebar shows "N parts".
- Project sidebar (`Sidebar.tsx`, `mockups/files-c-collapsible.html`): `.shell` grid = sidebar + `.app`. Project name (click to rename, ▾ opens the Projects drawer), a disabled Main timeline entry, recordings (kind icon from `kinds.ts`, edited length / progress bar / "waiting"), ⋯ menu per recording (rename, kind, delete), + Add recordings (also a drop target). ☰ folds it to a 52 px rail (`settings.sidebar`).
- Adding files: `addFiles` probes each length (`probeDuration`, metadata only) and opens `AddDialog` ("What is this recording?", guess from `guessKind`: under 15 s = sound effect). `confirmAdd` decodes, stores audio + recording, appends to the project (creating one named after the first file if none is open), queues speech kinds, and opens the first new recording. Dropping files anywhere on the app adds them.
- Background transcription (bottom of store.ts): a queue (`enqueue` / `dequeue` / `pump` / `runWorker`), one recording at a time. Words stream into the open recording live; for one that is not open they collect in the job and are written into its saved record when done (keeping edits made meanwhile). Opening a recording that is mid-job takes the words so far. Switching project drops the other project's queue. `store.transcribing` / `store.queued` drive the sidebar.
- Autosave UI: next to the recording name, `SaveState` shows Saved HH:MM (green), Saving (amber) or Not saved (red, tooltip says why). Autosave writes the open recording (`saveRecording`) and refreshes its sidebar summary; project changes (name, order, last open) are written at once by `persistProject`. **Projects** opens `ProjectsPanel`: New project, every project (recording count, total edited length, saved ago; click to switch, ✕ deletes it with all its recordings after a confirm). On load `resumeLast` opens the newest project on its last-open recording, with a `Notice` toast.
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
- **Projects:** storage blocked (private window) now means files can't be added at all (before: worked unsaved). Adding decodes every file once to read its format; very long files take a moment each. Empty projects made with New project stay in the list until deleted.
- **Parts:** a part is a source span, so after cuts or moves it plays from its first to its last kept fragment, which can include audio moved in between. The margin bar marks a whole paragraph even when a part covers only some of its words. Labels can still touch at extreme zoom-out; tiny parts are hard to grab (zoom in).
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
