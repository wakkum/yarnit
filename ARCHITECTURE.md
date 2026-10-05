# Yarnit: Architecture

**Yarnit** is a local, in-browser audio editor where you edit the transcript and the audio follows (a Descript-style workflow). Audio never leaves the machine: transcription, editing, playback and export all run in the browser.

**Status (4 Oct 2026):** milestone 1 done and verified in Chrome: layout C UI (timeline lanes + transcript), local transcription, delete, cut/paste move, search with delete-all, remove fillers, undo/redo, live playback, WAV/MP3 export, help drawer (5 Oct). Not yet tested on real (non-synthetic) recordings.
**Plan doc:** [Local Descript: Proof of Concept Plan](https://claude.ai/code/artifact/81f62755-9098-4bfc-b892-1dcd8edeebde) (research, scope, milestones)
**Run:** `npm run dev` (port 5174 via the parent `ai_projects/.claude/launch.json` entry "yarnit")

## Where we left off (4 Oct 2026)

- **Git:** first commit pushed to [github.com/wakkum/yarnit](https://github.com/wakkum/yarnit) (`main`) on 5 Oct 2026. Every later commit or push still needs its own go-ahead.
- **Open question for the user:** what should "add a second file" do? The user asked how to add one; today a second drop **replaces** the project (after a confirm). Three options were offered, with option 1 recommended:
  1. **Synced mics** (one file per speaker, recorded at the same time): play together as tracks, one merged transcript labelled by speaker, every cut applies to all tracks. This is M3.
  2. **Append** (part 2, a separately recorded intro): new file continues after the first on the timeline; transcript continues below.
  3. **Music/SFX bed:** untranscribed track under the speech (planned "Later").
  Wait for the answer before building; then add an "Add file" button (see "Adding files" below).
- **POC verdict pending:** not yet tested on the user's own (non-synthetic) recordings.
- **Throwaway:** `mockups/` (static HTML: layouts A/B/C, help A/B/C) can be deleted once the UI has settled.

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
                                   │                (Whisper, ~2 min   │
                                   │                 pieces, streams   │
                                   ▼                 words back)       │
                       cut snapping (render.ts)          │             │
                                   │                     ▼             ▼
            transcript UI ◀── Project { words, segments } ──▶ Player (live, no re-render)
                 │ edits                       │
                 └──────▶ edl.ts ──────────────┘──▶ renderEdit ──▶ export.worker ──▶ WAV / MP3
```

## Data model (`src/engine/types.ts`)

- `Track`: one source file. `offset` aligns synced multitrack recordings on the shared timeline.
- `Word`: text + `start`/`end` in **source** seconds, `trackId`, optional `speakerId`, `isFiller`. Written once by transcription, never changed by edits.
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
| `src/workers/transcribe.worker.ts` | Whisper pipeline, splits audio into ~120 s pieces at quiet points, streams `words` messages with progress | browser only |
| `src/workers/export.worker.ts` | Encodes rendered channels to WAV/MP3 | browser only |
| `src/engine/view.ts` | Derived UI views: `paragraphs` (speaker change, pause > 1.5 s, source jump, long runs at sentence ends), `searchHits` (phrase, last token as prefix, kept words only), `computePeaks` | `view.test.ts` |
| `src/state/store.ts` | Zustand store: load, edit actions, undo/redo, search, export. Heavy audio lives in the non-reactive `media` object, never in React state. | browser |
| `src/ui/*` | `TopBar` (search, undo, fillers, export menu), `Timeline` (ruler, canvas waveform per track, cut regions, playhead), `Transcript` (paragraphs, word spans), `EmptyState` (drop zone, model picker) | browser |

## UI (layout C)

- Top bar: file name, search (`Cmd+F`, Enter / Shift+Enter to step, Delete all), Undo/Redo, Remove fillers (count), Export menu (MP3 192 kbps / WAV 16-bit).
- Timeline: transport + status/progress, ruler, one lane per track (canvas waveform from 3000 peaks of the 16 kHz copy), red overlays for cut source regions, click to seek (a cut moment jumps to the next kept audio). The timeline shows the **source** timeline, so moved passages are not visible there yet.
- Transcript: paragraphs with speaker label + **edited** timestamp; click = select + seek, Shift+click = range, Delete cuts, `Cmd+X` then click target + `Cmd+V` moves before it, Esc clears selection.
- Per-frame updates (clock, playhead line, current word) avoid React re-renders: the clock and playhead are written to the DOM directly via `usePlayhead`; the current word uses `usePlayheadValue`, which only re-renders on change. **Never give React children to an element that `usePlayhead` writes** (caused a `removeChild` crash).
- Words are not drag-selectable yet (`user-select: none`), shift-click only.
- Help: `src/ui/Help.tsx`, toggled by the top-bar **Help** button (always shown, also on the start screen) or the `?` key; Esc closes it once nothing is selected. Open state is `helpOpen` in the store; `.app.with-help` adds a 380px grid column (full screen under 700px). Its shortcut table and FAQ are hand-written: **when a shortcut in `App.tsx` or a behaviour named in the FAQ changes, update `Help.tsx` too.** The ⌘ / Ctrl labels follow the platform.

### Adding files: what currently assumes one file

Touch these when implementing multitrack or append (the data model already supports several `tracks`):

- `store.loadFile` creates a **new** project with one track and resets everything; needs an `addFile` path that keeps `words`/`segments`/history.
- `media.mono16k` and `media.silence` are single values used by `snap` and `speechEnd`; make them per track (`Map<trackId, ...>`). For synced mics, snap on a mix of all tracks (a cut must be quiet on every mic).
- `transcribe(trackId, ...)` reads `media.mono16k`; pass the track's own copy. Words already carry `trackId`.
- `Project.duration` = longest track including `offset`; `segments` must be extended when a longer track arrives (append: add a segment for the new span).
- Player (`setTracks`) and `renderEdit` already mix multiple tracks with offsets and are tested for it.
- Speaker per word for synced mics: pick the track that is loudest during the word (bleed between mics means every track hears everyone), then dedupe words transcribed on more than one track.
- `App.tsx` drop handler replaces the project after `confirm()`; route it to "add" once that exists.
- `paragraphs` already breaks on `speakerId ?? trackId` change, and `trackLabel` names lanes "Speaker N".

### Cut placement rules (edl.ts)

- A deleted run of words is cut from **halfway into the gap before it** to **halfway into the gap after it**, so one natural pause remains.
- First word: boundary is 0 (leading silence goes with it). Last word: boundary reaches past the end (trailing silence goes with it).
- With audio available, each boundary is snapped (`snapToQuiet`) to the quietest 5 ms window in the gap, allowed to reach 40 ms past Whisper's word edges (`SNAP_SLACK`) because Whisper timestamps are approximate.

## Known limits

- **Whisper often drops fillers.** On the test clip it kept "um" and "uh", but on real speech it frequently omits them, so Remove fillers finds nothing. Fixes for later: prompt with fillers, or detect short voiced gaps with a VAD.
- **Memory:** a 60 min stereo 44.1 kHz file is ~1.27 GB as Float32, and export renders a second copy. Fine for M1 testing; chunked render/encode needed before long multitrack sessions.
- **Time-to-first-transcript:** the model (~80 MB for base.en q8) downloads once, then is cached by the browser.
- **Chrome is the target.** Safari/Firefox may work but are untested.
- **Speakers:** every paragraph is "Speaker 1" until multitrack (M3) or speaker detection (M4).
- **Testing gotcha:** the browser pane pauses `requestAnimationFrame` while hidden, so the clock/playhead don't update in scripted tests then; check state, not the clock.

## Testing

- `npm run check`: typecheck + lint + unit tests. Run before asking to commit.
- `npm run sample`: regenerates `test-audio/sample.wav` (15 s, macOS `say`, includes "um"/"uh"). `test-audio/interview.wav` (50 s, two macOS voices, 1.8 s pauses) was generated ad hoc the same way for paragraph/search testing.
- Browser check: start the "yarnit" preview, drop `test-audio/interview.wav` on the `.drop` element (in scripts: fetch it, build a `DataTransfer`, dispatch a synthetic `drop` event), and wait until the transport text reads "Click the waveform to jump." (transcription done). `test-audio/` is gitignored; regenerate with `npm run sample`.
- Downloads in scripted tests: patch `HTMLAnchorElement.prototype.click` to capture the blob size instead of saving a file.
- Gotcha: `await import('/src/state/store.ts')` from the console can load a **second copy** of the store after HMR (Vite adds `?t=` versions), so the page won't reflect it. Drive the UI instead.

## Roadmap

1. **M1 Core loop** (done 4 Oct 2026): transcribe, delete, playback, WAV/MP3 export. Search with delete-all and keyboard cut/paste moves landed early.
2. **M2 Reorder:** drag-to-move and visible clipboard, silence shortening, autosave (OPFS + IndexedDB), SRT/VTT export, timeline zoom.
3. **M3 Multitrack:** several synced files, one merged transcript, speaker = loudest track, per-track or mixed export.
4. **M4 Speakers:** pyannote segmentation 3.0 (ONNX) for single-file recordings, rename, reassign.
5. **Later:** music/effects layers, noise reduction (RNNoise/DeepFilterNet), manual word-boundary nudge, typed transcript corrections.
