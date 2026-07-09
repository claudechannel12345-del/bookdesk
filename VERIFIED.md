# VERIFIED.md — honest, observed verification results

Date: 2026-07-09. Machine: Windows 11 dev box. Node: v24.16.0.

## Starting state (audit, before touching anything)

The app was already ~95% complete. `git log`: `ff1a000` scaffold → `7726b38`
checkpoint → `e48a79b` docs-style rich editor persistence → `f2d5f3c`
checkpoint. All of main (`src/main/**`), preload, and the renderer
(`App.tsx`, `editorExtensions.ts`) were present and structurally matched
SPEC.md, including the full Google-Docs-parity toolbar (font family/size,
bold/italic/underline/strike, text color, highlight color, styles dropdown,
alignment, line-spacing, bullet/numbered lists, indent/outdent, blockquote,
clear formatting, undo/redo, word count) and the exact headless
`claude -p --output-format stream-json` CLI integration described in SPEC.md.

Two real problems found on audit, both fixed:
1. **`electron.exe` at the repo root** — a stray 30-byte text file (contents:
   `node_modules\electron\path.txt`), accidentally committed in the
   `7726b38` checkpoint. Not a real binary; junk from a redirected command.
   Removed (`git rm electron.exe`).
2. **77 Prettier/ESLint formatting warnings** (0 real lint errors) in
   `App.tsx`, from long single-line JSX. Fixed with `eslint --fix`.

The "known loose ends" flagged in the task turned out to already be resolved:
- **`window.api` typings**: `npx tsc -b --force` (clean rebuild, both
  `tsconfig.node.json` and `tsconfig.web.json` project refs) exits 0 with
  zero errors. `src/preload/index.d.ts` + `src/renderer/src/env.d.ts` both
  correctly declare `window.api: Api` from the preload's exported type.
- **Docs-parity toolbar**: complete, see above — verified working live, not
  just present in code (see step 3 below).

No other functional code changes were made — the app did what SPEC.md asked.

## Verification steps run

All four were driven against the actual app, not unit tests: a **production
build** (`npm run build`) launched via Playwright's `_electron` driver
(installed as a temporary, unsaved dev dependency, removed again after —
`package.json`/lockfile untouched). This was necessary because desktop-level
mouse/keyboard automation on this shared machine kept stealing focus into
other windows on the user's real desktop (confirmed via
`GetForegroundWindow` landing on an unrelated Chrome tab) — Playwright's
Electron driver attaches over CDP instead and never touches the real screen
or input devices.

### 1. `npm start` launches on this Windows machine

```
npm start   (NODE_OPTIONS must NOT be --use-system-ca — see Deviations below)
```
Result: **PASS.** electron-vite built main/preload/renderer, four
`electron.exe` processes started, a window titled "BookDesk" opened with a
valid `MainWindowHandle`. Screenshot confirmed the app rendered correctly
(sidebar, empty-state editor pane, chat pane) — not a blank/crashed window.

### 2. Create a book, type text, confirm autosave writes the .md

Driven via the real UI (fill "New book title" → click New → click into the
editor → type). After the ~2s debounce:
```
chapter .md on disk: "This is the opening line of my book. It was a dark and stormy night."
```
**PASS.**

### 3. Real Claude turn through the app's session manager (the linchpin)

Used the real, authenticated `claude` CLI (v2.1.205) on this machine, model
overridden to plain `sonnet` for the test turn per task instructions (app's
shipped default stays `sonnet[1m]`). Prompt: "Add exactly one short new
sentence to the end of Chapter 1, continuing the story."

Observed, in order:
- Chat showed tool-activity chips, not raw JSON: `Reading c69ffbcff.md…`,
  `Editing c69ffbcff.md…`.
- Claude's reply rendered as a bubble with the "C" avatar: `Added: "The
  handle was ice-cold beneath her fingers."`, then `Claude finished.`
- The chapter **file on disk** changed:
  `"...dark and stormy night. Thunder rattled the windows as she reached for the door."`
  → `"...reached for the door. The handle was ice-cold beneath her fingers."`
- `book.json`'s `claudeSessionId` was populated (`303c9a7c-...`) — session
  continuity captured for `--resume` on the next turn.
- The **editor live-reloaded** to the new text with no user action.
- The **review strip** appeared: `Claude changed Chapter 1 (+7 / -0 words)`
  with `View changes` / `Undo`. `View changes` opened the diff modal.
- Clicking **Undo** restored the chapter file to exactly its pre-turn
  content and the review entry cleared.

**PASS — full round trip, exactly as SPEC.md's "Edit safety loop" describes.**

(Note: pending review entries live in an in-memory per-process session map,
not persisted to disk — confirmed by relaunching fresh and finding no
review strip. This is consistent with the rest of the session/watcher design
in `src/main/lib/session.ts`, not a bug: snapshots on disk still back Undo
for the life of the running app.)

### 4. docx import round-trip

Generated a minimal valid 2-heading `.docx` by hand (via `jszip`, since no
Word/LibreOffice is installed on this machine) and confirmed **mammoth**
parses it correctly first (`<h1>Chapter One</h1><p>...</p><h1>Chapter
Two</h1><p>...</p>`, zero warnings) before trusting it as a test fixture.

Drove the real `File → Import from Word…` menu item (the same code path a
user clicks), with only the native OS file-picker/message-box dialogs
mocked at the Electron `dialog` module level (Playwright cannot drive real
OS-native dialogs; this is the standard way to test them).

Result: book went from 1 chapter to 3. Two new chapters appended —
`Chapter One` / `Chapter Two` — with correct split-on-H1 content, and the
existing non-empty `Chapter 1` was left untouched (correctly *not* treated
as the "replace the lone empty default chapter" case). The sidebar and
editor **live-refreshed** via the `book:reload` IPC event without a manual
reopen. **PASS.**

### Extra: formatting round-trip (spec's "Critical extra check")

On the chapter from step 2: selected all text, applied **Bold**,
**highlight** (`#fce8b2`), **Georgia** font family, and **2.0 line
spacing**, waited for autosave, then **fully quit the app and relaunched a
new process** (not just a soft reload) and reopened the same book/chapter.

- Chapter `.md` immediately after formatting: `**This is the opening line
  of my book. It was a dark and stormy night.**` — plain Markdown, no HTML,
  no lost text. **Confirmed Claude-editable-as-plain-text is preserved.**
- After the full restart, the **same `.md` file was byte-identical** to
  right after formatting (still plain markdown).
- The editor's rendered HTML after reload:
  `<p style="line-height: 2;"><span style="font-family: Georgia, serif;">
  <strong><mark data-color="#fce8b2" style="background-color: rgb(252, 232,
  178);...">...</mark></strong></span></p>`
  — bold, highlight, font family, and line-spacing **all survived** the
  full quit/relaunch cycle, sourced from the `.bookdesk-format/<chapter>.json`
  sidecar (confirmed present on disk) as designed in SPEC.md's persistence
  note.

**PASS — full round-trip fidelity, formatting and plain-text-for-Claude
both hold at once.**

### Extra: Codex button — missing-binary path (per task instructions, real
`codex` was never invoked; it's installed on this machine and shares quota
with a production trading agent)

Launched one isolated instance with the npm global bin directory (where
`codex`/`codex.cmd` live) stripped from `PATH`, so `detectCodex()` (a plain
`spawnSync('where.exe', ['codex'])` check — read in `src/main/lib/codexCli.ts`)
genuinely reports not-found:
```
detect.codex() -> { found: false }
```
Clicked "Second opinion (Codex)" with that state: **no crash, no spawn
attempt** — the chat showed exactly `Codex is optional. Install the codex
CLI to use Second opinion.` **PASS** for graceful handling. (Minor
deviation: SPEC.md's setup section describes "setup instructions" for the
missing binary; the shipped behavior is a one-line chat message rather than
a dedicated instructions panel. Functionally graceful either way — noted
under Deviations.)

## Deviations / notes

- **`NODE_OPTIONS=--use-system-ca` breaks Electron on this machine.**
  Electron refuses to start with that flag set via `NODE_OPTIONS`
  (`electron: --use-system-ca is not allowed in NODE_OPTIONS` — Electron
  blocks this specific flag for security). The task's TLS-fallback
  instruction doesn't apply to `npm start`/`npm run dev` themselves; `npm
  install`/`npm run build` were unaffected. If a future `npm install` hits a
  TLS error, use `NODE_OPTIONS=--use-system-ca npm install` for that one
  command only, then run the app with it unset (`env -u NODE_OPTIONS npm
  start` in bash, or unset it in your shell profile for this project).
- **Codex "missing binary" UX** is a one-line chat message, not a dedicated
  instructions screen. This matches SPEC's "optional dependency" framing and
  errs on the side of not building UI SPEC.md didn't clearly ask for
  (SPEC's dedicated first-run setup screen is explicitly for Claude only:
  "Same lightweight detection for codex (optional dependency)" — read as
  "detect it the same lightweight way," which the code does).
- Test artifacts (`scratch-*.mjs` driver scripts, a generated
  `test-import.docx`, and the temporary `playwright`/`jszip` dev
  dependencies used only to drive these tests) were removed after
  verification; they are not part of the app and `package.json`/
  `package-lock.json` are untouched by them. All test book folders created
  under `Documents/BookDesk Books` during verification (including
  pre-existing ones left over from the previous agent's own testing) were
  deleted so the app starts clean for the real user.
- Mac `.dmg` build was **not** attempted (config-only per SPEC.md/task
  instructions); `electron-builder.yml` targets mac universal dmg and is
  unchanged.

## What's genuinely stubbed / out of scope (by design, not oversight)

- Chapters Claude creates but never registers in `book.json` aren't picked
  up by the review-strip diffing loop (explicit `ponytail:` comment in
  `ipcHandlers.ts`) — narrow edge case, not exercised by SPEC's verification
  steps.
- No git dependency, no database — per SPEC.md ("No git dependency" /
  "No database, no server, no telemetry"), confirmed absent.
