# TODO

## Now
- [x] Pick an editor layout (C, timeline, 4 Oct 2026) and build it
- [x] Help drawer: getting started, shortcuts, FAQ (B, 5 Oct 2026)
- [ ] Test cut quality on real recordings (clean 5 min, full 60 min, noisy/crosstalk). This is the POC verdict.
- [ ] Delete `mockups/` once the UI has settled (throwaway)
- [ ] User to choose what "add a second file" means: synced mics (recommended), append, or music bed. Then build "Add file" (ARCHITECTURE.md "Adding files")
- [x] First commit, pushed to github.com/wakkum/yarnit (5 Oct 2026)
- [ ] Decide English-only vs multilingual default model

## Milestone 2: Reorder and search
- [x] Keyboard cut/paste move (Cmd+X, click target, Cmd+V)
- [ ] Drag-to-move, and show what is on the clipboard
- [x] Word/phrase search: next/previous, highlight all, delete all matches
- [ ] Drag-select words with the mouse (currently shift-click only)
- [ ] Timeline zoom, and show moved passages on the timeline
- [ ] Silence shortening (gaps longer than X become Y)
- [x] Waveform with cut regions
- [ ] Autosave project (OPFS for audio, IndexedDB for project JSON)
- [ ] SRT/VTT export with edited timestamps

## Milestone 3: Multitrack
- [ ] Import several files as tracks, align by offset
- [ ] Transcribe each track, merge into one transcript, speaker = loudest track
- [ ] Per-track and mixed export

## Milestone 4: Speakers
- [ ] pyannote segmentation 3.0 (ONNX) for single-file recordings
- [ ] Rename speakers, reassign labels on selected words

## Known issues
- [ ] Whisper often omits fillers on real speech (see ARCHITECTURE.md "Known limits")
- [ ] Long files: render/encode in chunks to cap memory
