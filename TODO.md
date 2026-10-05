# TODO

## Now
- [x] Pick an editor layout (C, timeline, 4 Oct 2026) and build it
- [x] Help drawer: getting started, shortcuts, FAQ (B, 5 Oct 2026)
- [x] Light/Dark/Auto theme, clearer highlights, floating Cut/Paste bar (5 Oct 2026)
- [ ] Test cut quality on real recordings (clean 5 min, full 60 min, noisy/crosstalk). This is the POC verdict.
- [ ] Delete `mockups/` once the UI has settled (throwaway)
- [ ] User to choose what "add a second file" means: synced mics (recommended), append, or music bed. Then build "Add file" (ARCHITECTURE.md "Adding files")
- [x] First commit, pushed to github.com/wakkum/yarnit (5 Oct 2026)
- [ ] Decide English-only vs multilingual default model
- [ ] Test on a real Windows machine (start.bat, shortcuts, export). Only verified on Mac with Windows labels simulated (5 Oct 2026)
- [ ] Optional: host the built app (GitHub Pages or similar) so others need no install. Needs a public repo or paid plan, and the user's go-ahead

## Milestone 2: Reorder and search
- [x] Keyboard cut/paste move (Cmd+X, click target, Cmd+V)
- [x] Move whole paragraphs: ↑ ↓, Alt+Shift+↑/↓, Outline view with drag (5 Oct 2026). If the user doesn't like C, switch to B (`mockups/para-b-blocks.html`)
- [ ] Drag-to-move words in the transcript view
- [x] Word/phrase search: next/previous, highlight all, delete all matches
- [x] Drag-select words with the mouse (5 Oct 2026)
- [x] Timeline shows the edited result, moved passages and joins; Show original strip (5 Oct 2026)
- [x] Reset timeline for a file, with a warning, undoable (5 Oct 2026)
- [x] Timeline zoom: overview window, − / + / Fit, ⌘ + scroll / pinch, follows playback (5 Oct 2026)
- [ ] Original strip for every track in multitrack (today: first track only)
- [x] Silence shortening: pause chips + Shorten pauses popover (5 Oct 2026)
- [x] Waveform with cut regions
- [x] Autosave project + Projects drawer (IndexedDB for project JSON and audio, 5 Oct 2026)
- [ ] Save/open a project file (export a project to move it to another browser or computer)
- [ ] Keep undo history across reopen (maybe the last N steps)
- [ ] SRT/VTT export with edited timestamps

## Highlights
- [x] Six-colour highlights, marker look, Highlights panel with passages and colour meanings, timeline strips (5 Oct 2026)
- [ ] **Send chosen colours to a main timeline.** Design: highlight spans become the segments of a new edit (in transcript order), so the project needs more than one edit ("timelines": source edit + main). Decide with the user: replace the edit (undoable) vs a separate main timeline you can switch to, and whether a passage can be reordered there. With multitrack, each span takes every track.
- [ ] Filter the transcript to one colour, and step through passages from the keyboard

## Milestone 3: Multitrack
- [ ] Import several files as tracks, align by offset
- [ ] Transcribe each track, merge into one transcript, speaker = loudest track
- [ ] Per-track and mixed export

## Milestone 4: Speakers
- [ ] pyannote segmentation 3.0 (ONNX) for single-file recordings
- [x] Rename speakers, reassign a paragraph to another or a new speaker (5 Oct 2026)
- [ ] Reassign the speaker of a selection inside a paragraph (today it is whole paragraphs only)

## Known issues
- [ ] Whisper often omits fillers on real speech (see ARCHITECTURE.md "Known limits")
- [ ] Long files: render/encode in chunks to cap memory
