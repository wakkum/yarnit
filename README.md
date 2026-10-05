# Yarnit

Edit audio by editing its transcript, entirely in your browser. Nothing is uploaded: transcription (Whisper), editing, playback and export all run on your own computer.

## Run it

You need two things, both free:

- **Node.js 22 or newer**: download the LTS version from [nodejs.org](https://nodejs.org/en/download) and install it with the default options.
- **Chrome or Edge.** Other browsers may work but are untested.

Then:

1. On GitHub, click **Code > Download ZIP**, and unzip it. On Windows, right-click the ZIP and choose **Extract All** first: it will not run from inside the ZIP.
2. Open the unzipped folder and double-click the launcher:
   - **Windows:** `start.bat`
   - **Mac:** `start.command`
3. The first run installs what Yarnit needs, which takes a few minutes. After that it starts in seconds.
4. Yarnit opens in your browser at http://localhost:4173. Keep the launcher window open while you use it; close it to stop Yarnit.

The first time you transcribe, the speech model (about 80 MB) downloads once and is kept by your browser. After that, Yarnit works offline.

**If your computer blocks the launcher:**

- **Mac** ("cannot be opened because it is from an unidentified developer"): right-click `start.command`, choose **Open**, then **Open** again. You only need to do this once.
- **Windows** ("Windows protected your PC"): click **More info**, then **Run anyway**.

Prefer a terminal? In the folder, run `npm install` once, then `npm start`.

## Using it

Drop in an audio file (MP3, WAV, M4A) and wait for the transcript. Press **?** in the app for the full guide and FAQ.

| Action | Windows | Mac |
| --- | --- | --- |
| Play / pause | Space | Space |
| Select words | Drag across them, or Shift+click | Drag across them, or Shift+click |
| Cut the selection from the audio | Delete | Delete |
| Move a passage | Ctrl+X, click a word, Ctrl+V (before) or Shift+Ctrl+V (after) | ⌘X, click a word, ⌘V or ⇧⌘V |
| Undo / redo | Ctrl+Z / Ctrl+Y | ⌘Z / ⇧⌘Z |
| Search | Ctrl+F | ⌘F |

Your work is saved automatically in the browser, and Yarnit reopens your last project next time (**Projects** lists the rest). Also: shorten long pauses, remove "um"s, highlight in colours, rename speakers, light or dark theme, and export to MP3 or WAV.

## For developers

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm start` | Production build, served and opened in the browser |
| `npm run check` | Typecheck, lint, unit tests |
| `npm test` | Unit tests only |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run sample` | Regenerate `test-audio/sample.wav` (macOS only: uses the `say` voice) |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and [TODO.md](TODO.md) for what's next.
