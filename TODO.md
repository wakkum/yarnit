# TODO

## Now
- [x] Pick an editor layout (C, timeline, 4 Oct 2026) and build it
- [x] Help drawer: getting started, shortcuts, FAQ (B, 5 Oct 2026)
- [x] First-run tour (A, without a demo project): sections for the start screen, a speech recording, music, the main timeline; skippable, restart from Help (7 Oct 2026)
- [x] "Unable to decode audio data" on a 150 MB MP3: adding decoded it three times at once; now once, with a clear message if decoding still fails (7 Oct 2026)
- [x] Light/Dark/Auto theme, clearer highlights, floating Cut/Paste bar (5 Oct 2026)
- [ ] Test cut quality on real recordings (clean 5 min, full 60 min, noisy/crosstalk). This is the POC verdict.
- [ ] Delete `mockups/` once the UI has settled (throwaway)
- [x] First commit, pushed to github.com/wakkum/yarnit (5 Oct 2026)
- [ ] Decide English-only vs multilingual default model
- [ ] Test on a real Windows machine (start.bat, shortcuts, export). Only verified on Mac with Windows labels simulated (5 Oct 2026)
- [x] Ready for GitHub Pages: relative asset paths, deploy workflow (skipped while private), build tested from a `/yarnit/` subfolder incl. transcription and MP3 export (6 Oct 2026)
- [x] Commit the review fixes, Pages workflow and main timeline (7 Oct 2026)
- [x] `.claude/` preview config kept local, in .gitignore (7 Oct 2026)
- [x] Repo public, GitHub Pages live at https://wakkum.github.io/yarnit/ (7 Oct 2026), checked: load, transcribe, send to main, MP3 export
- [ ] Still open from hosting: decide on a dedicated address (custom domain) so saved recordings are not shared with other `github.io` sites of the account

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

## Projects (6 Oct 2026)
- [x] Projects with several recordings, collapsible sidebar, "What is this recording?" on add, background transcription queue, v1 saves migrated
- [ ] **User testing** of projects and the main timeline on real recordings
- [x] Main timeline: Send to main (copy) from a recording: whole edit, selection, colours, parts; its own transcript, lanes, editing, undo and mixed export (7 Oct 2026)
- [x] Parts for music and sound effects: mark pieces on the waveform, pads to play and rename (6 Oct 2026)
- [x] Waveform selection on speech too: Delete, Add as part, parts strip and marks in the transcript (6 Oct 2026)
- [x] Music and sound effects on the main timeline, each kind its own lane: Send to main per part, drag to place, volume, fade in/out (7 Oct 2026)
- [x] Send all parts of a recording to main at once (7 Oct 2026)
- [ ] Main timeline: anchor a music or effect clip to a speech clip so it moves when speech before it is cut
- [x] Main timeline: cut a clip in two anywhere (click menu or C), Premiere-style snapping across lanes (7 Oct 2026)
- [x] Main timeline: volume keyframes with eased changes, Lower under voice for music and effects; lanes reordered to Voice-over, Interview, Music, Sound effect (7 Oct 2026)
- [x] Main timeline: focus one clip (double-click, Z): zoomed, tall, words under the waveform (7 Oct 2026)
- [x] Scrub grip on the playhead, both timelines (7 Oct 2026)
- [ ] Scrub audio while dragging the playhead (short snippets), if wanted
- [ ] Main timeline: trim a clip by dragging its edges
- [ ] Main timeline: show which clips are out of date after their recording was edited, with a Replace option
- [ ] Reorder recordings in the sidebar (drag)

## Highlights
- [x] Six-colour highlights, marker look, Highlights panel with passages and colour meanings, timeline strips (5 Oct 2026)
- [x] Send chosen colours to the main timeline, one clip per passage (Send to main menu and the Highlights panel, 7 Oct 2026)
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
- [ ] Long files: decode, render and encode in chunks to cap memory (a 2 to 3 hour MP3 does not decode at all today)
