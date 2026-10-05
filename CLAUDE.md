# Yarnit: working notes for Claude

Local, in-browser, Descript-style audio editor. **Read ARCHITECTURE.md first**: it holds the decisions, data model, cut rules and known limits. Grep it before writing code in an area you haven't touched this session.

## Workflow rules

- **Never commit or push without an explicit go-ahead for that specific change.** Earlier approvals don't carry over.
- **UI and visual changes:** build 2 to 4 rendered mockups (HTML in `mockups/`) and let the user pick before writing production UI. Mockups must be **fully self-contained**: static pre-rendered HTML with all CSS inlined (no `<link>` to `src/index.css`, no JS needed), because the user opens them from the file pane, which loads neither.
- Before asking to commit: `npm run check` (typecheck + oxlint + Vitest) must pass, and anything observable is verified in the browser preview ("yarnit" in `ai_projects/.claude/launch.json`, port 5174).
- Git author email: `yarnoritzen@gmail.com` (the global default; check `git config user.email` on a new machine).
- No em-dashes or en-dashes in docs or UI copy. Use commas, colons, or "to" for ranges.
- After a substantive session, update ARCHITECTURE.md (decisions table, status line) and TODO.md.
- Before the user compacts, refresh "Where we left off" at the top of ARCHITECTURE.md: git state, open questions for the user, suggested next step.

## Code conventions

- `src/engine/` is pure TypeScript: no DOM, no Web Audio, no React. Every function there gets a Vitest test. Audio-dependent behaviour is injected (for example the `Snap` callback in `deleteWords`).
- Annotations (highlights, future markers) are **source-time spans**, not word fields, so they map straight onto segments and cover every track.
- Audio edits change **only** `project.segments`. Word text and timing are immutable after transcription; `speakerId` is the one field that may change (speaker labels). Every undoable change goes through `commit()` in the store.
- Heavy audio (`AudioBuffer`s, the 16 kHz copy, the `Player`) lives in `media` in `src/state/store.ts`, never in Zustand state.
- Long-running work goes in a Web Worker (`src/workers/`). Transfer buffers instead of copying where possible.
- Player and export must stay identical: same `FADE_SECONDS`, same equal-power curve (`render.ts` / `player.ts`).
- Match the surrounding style: short comments explaining why, no comment noise.
- Must work on Windows and Mac: shortcut labels only via `combo()` in `src/ui/keys.ts` (never hard-code ⌘ / ⇧ / ⌫), handlers accept `metaKey || ctrlKey`, and any new script needs both a `.bat` and a shell version (see `start.bat` / `start.command`, line endings pinned in `.gitattributes`).

## Licensing

Our code is unrestricted. Do **not** copy code from Rescript (PolyForm Noncommercial). Reading it for ideas is fine. Dependencies so far: Transformers.js (Apache-2.0), Mediabunny + MP3 encoder (MPL-2.0; LAME is LGPL), React, Zustand (MIT).
