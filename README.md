# Yarnit

Edit audio by editing its transcript, entirely in your browser. Nothing is uploaded: transcription (Whisper), editing, playback and export all run locally.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5174 in Chrome, drop in an audio file (MP3, WAV, M4A), and wait for the transcript. The first run downloads the speech model (about 80 MB), which the browser then caches.

- Click a word to jump there; shift-click to select a range
- Delete / Backspace cuts the selection; Cmd+Z undoes, Shift+Cmd+Z redoes
- Move text: select it, Cmd+X, click the word to paste before, Cmd+V
- Remove fillers, then export WAV or MP3

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run check` | Typecheck, lint, unit tests |
| `npm test` | Unit tests only |
| `npm run sample` | Regenerate `test-audio/sample.wav` with macOS text-to-speech |
| `npm run build` | Production build into `dist/` |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and [TODO.md](TODO.md) for what's next.
