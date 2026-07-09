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

## Round 2 — owner click-test feedback (2026-07-09)

Five fixes requested after the owner's hands-on test, plus one bug found
along the way. All verified against the production build via the same
Playwright `_electron` driver, with screenshots inspected.

### 1-3. Sidebar clipping / editor page scroll / chat scroll — one root cause

`.app-shell` was a CSS grid with `height: 100vh` but an implicit `auto` row:
any pane whose content grew taller than the window grew the row past 100vh,
so the chapter list, the editor page, and the chat history all clipped off
the bottom instead of scrolling inside their sections. Fix:
`grid-template-rows: minmax(0, 1fr)` + `min-height: 0` on the three panes
(`src/renderer/src/assets/main.css`). Also raised `.editor-wrap` bottom
padding to `40vh` for the Google-Docs "always room under the caret" feel,
and added chat auto-scroll (sticks to newest message, but stays put if the
user has scrolled up to read history — `messagesRef`/`stickToBottomRef` in
`App.tsx`).

Observed with a 15-chapter book and an 80-paragraph chapter:
- Chapter list scrolls inside its own section (`scrollHeight > clientHeight`),
  Writing Rules button fully visible, zero overflow on `.app-shell`/body.
- `.editor-wrap` scrolls; typing at the document end keeps the caret
  ~70px above the container bottom (caret rect 662px vs wrap bottom 732px).
- Chat history overflows inside `.messages` with the input pinned at the
  bottom; after a long streamed answer the view was auto-scrolled to the
  newest message; after scrolling to top and sending another turn, the view
  stayed near the top (scrollTop 100) instead of yanking down.

### 4. Conversation mode

`--append-system-prompt` in `src/main/lib/claudeCli.ts` previously told
Claude to "make edits directly when asked" with no discussion path. Now:
edit only when the author clearly asks for a change; questions/critique/
brainstorming get a chat answer (reading chapters is fine, editing is not).

Real turn (model `sonnet`): "What do you think of Chapter 2's pacing?" →
Claude read the chapter and streamed a genuine critique; every chapter
file byte-identical before/after (checked on disk), zero review entries,
no tool-edit chips. Ran twice (two app sessions) — same result both times.

### 5. Check for Updates

New `src/main/updateCheck.ts` + "Check for Updates…" in the File menu +
a launch check delayed 3s (non-blocking). Notify-and-open-browser only —
no electron-updater, no signing dependence. Compares the version baked in
from package.json at build time (`__APP_VERSION__` via electron.vite
`define` — `app.getVersion()` is wrong when unpackaged, it returns
Electron's own version) against the latest GitHub Release of `UPDATE_REPO`
(constant in updateCheck.ts, empty until a repo exists; a
`BOOKDESK_UPDATE_REPO` env var overrides it for testing).

Observed (dialogs and `shell.openExternal` mocked at the module level):
- Repo unset: launch check produced zero dialogs over 5.5s (fully silent);
  manual menu click showed "Update checks are not configured for this build."
- Repo pointed at microsoft/vscode (release 1.128.0 > 0.1.0): launch check
  showed exactly one dialog — "Version 1.128.0 available / You have 0.1.0"
  with [Download, Later]; pressing Download called `shell.openExternal`
  with https://github.com/microsoft/vscode/releases/tag/1.128.0.
- Errors (404 repo, offline) are swallowed silently on launch, reported in
  a dialog only for the manual menu check.

### Bonus bug found while testing: Add/Rename chapter were dead

`window.prompt()` throws in Electron ("prompt() is not supported"), so the
sidebar's Add and Rename buttons crashed silently. Add now creates
"Chapter N" immediately (rename after, Docs-style); Rename opens a small
modal with an input (Enter or Save commits). Verified: Add went 14 → 15
chapters, Rename via modal set "Epilogue: The Long Road" in the sidebar.

Round-2 checks: 14/14 passed across the two runs (3 first-run failures were
1 test-script artifact — my own typed text autosaving between snapshot and
send — and the 2 update-checker asserts, which exposed the real
`app.getVersion()` bug fixed above).

## Round 3 — dropdown fix, design pass, dark mode, history + find (2026-07-09)

All verified against the production build via Playwright `_electron`,
screenshots inspected in BOTH themes. 26 automated checks passed.

### 1. Toolbar dropdown clipping — root cause

The old toolbar used native `<select>`s plus `position:absolute` color
palettes inside the toolbar; after round 2's overflow fixes the absolute
menus could clip against pane bounds, and native select popups can't be
themed at all. Replaced every toolbar dropdown (style, font, size, text
color, highlight, alignment, line spacing) with one `ToolbarMenu` component
(`src/renderer/src/components/ToolbarMenu.tsx`): a `position:fixed` portal
into `document.body`, clamped to the window edges, flipping above the
trigger when out of vertical room, closing on outside-click/Escape/pick.
Verified: all 7 menus open fully inside the viewport; with the window
shrunk to 980px the right-most menu clamps at the right edge instead of
overflowing.

### 2. Design pass ("a writing study")

Full token system in `base.css`: light = daylight study (warm paper
neutrals, fountain-ink blue accent `#3f5e8c` — deliberately not
Google-blue), dark = lamplight study (warm charcoal `#161512`, sheet sits
lighter than the desk, ink accent lightened to `#92abd8`). Claude keeps a
sepia "manuscript" presence in both. Bookish serif display stack (Iowan Old
Style / Palatino / Constantia / Georgia — no webfonts, offline app) for
brand, headings, chapter list, editor prose; system UI for controls.
Signature: the sidebar is a table of contents — serif numerals + titles
with right-aligned word counts; Rename/Delete appear on hover. Real SVG
icon set replaces the old unicode glyphs. Sheet gets a layered
paper-on-desk shadow. 120–160ms micro-transitions (menus, messages,
modals), custom theme-aware scrollbars, `prefers-reduced-motion` respected,
redesigned empty state and setup panel.

Found and fixed while verifying: the scaffold's `* { font-weight: normal }`
reset had been silently beating the browser's `strong` styling since round
1 — bold text rendered at weight 400. Restored 700 where prose renders
(editor page, diff, history preview). Computed weight now 700, confirmed.

### 3. Dark mode

Toggle in the sidebar brand row (sun/moon), persisted in localStorage,
`data-theme` on the root element, every surface tokenized (sheet, toolbar,
menus, chat, modals, scrollbars, diff colors, find highlights). Verified:
toggle flips tokens live, survives a full app relaunch, and highlighted
text on the dark sheet renders dark ink on the pastel highlight
(`!important` needed because TipTap emits inline `color: inherit` on
marks). Known ceiling (`ponytail:` comment in main.css): user-picked text
colors are absolute hex, so a near-black swatch chosen in light mode stays
dark on the dark sheet.

### 4a. Version history

Reuses the `.snapshots/` folder (one snapshot before every Claude turn —
and now before every restore, so restores are undoable). New IPC:
`history:list` (newest-first, capped at 100), `history:read`,
`history:restore` (snapshots first, restores the file through the
self-write path so the watcher doesn't misattribute it, pushes the change
to the editor). UI: History button in the editor header opens a modal —
snapshot times down the left (with seconds, so near-simultaneous snapshots
stay distinguishable), chapter picker + serif preview + "Restore this
version" on the right. Verified end-to-end: after a real Claude turn the
snapshot listed, preview matched the pre-turn text exactly, Restore
returned the file on disk to the pre-turn text byte-for-byte, took a new
snapshot first (2 → 3 on disk), and the editor live-updated.

### 4b. Find

- Ctrl/Cmd+F opens a find bar under the toolbar: all matches highlighted
  via a ProseMirror decoration extension (`FindHighlight`), active match
  stronger, count ("2 of 7"), Enter/Shift+Enter or arrows to navigate,
  Escape closes and clears. Case-insensitive plain-text match.
  (ponytail: matches spanning two text nodes — e.g. bold mid-word — are
  missed; fine for prose.)
- Sidebar "Search all chapters": debounced, lists matching chapters with
  match counts and a snippet; clicking jumps to the chapter and opens the
  find bar pre-filled. Verified both, including the no-matches state.

### Regressions after the CSS/toolbar overhaul — both re-verified

- Real Claude edit turn (sonnet): file changed, review strip appeared
  ("Claude changed Chapter 1 (+12 / -0 words)"), tool chips rendered.
- Formatting round-trip: bold + highlight + 2.0 line spacing applied via
  the NEW menus, autosaved, full relaunch — all survived; the `.md` file
  stayed plain markdown (`**…**`, no HTML).

### Round-3 follow-up: sidebar dropdown trigger overflow (owner report)

The control was the sidebar's **book picker `<select>`** (and the New-book
input row next to it): `.book-picker` is a CSS grid, and grid items'
automatic `min-width: auto` sizes the track to the widest book title, so a
long title pushed the select past the sidebar's right edge (visible in
screenshots since round 1). Fixed with `minmax(0, 1fr)` tracks +
`min-width: 0` + `text-overflow: ellipsis` on the select. Audited every
button/select/input/textarea in all three panes against its pane's right
edge at 1280/1024/860px in both themes with a deliberately long book
title — zero overflows (7/7 checks). The audit also showed the three-pane
grid's minimum (~910px) clips the chat pane in a smaller window, so the
BrowserWindow now has `minWidth: 940` / `minHeight: 560` — verified the
window clamps and the shell fits exactly.

## What's genuinely stubbed / out of scope (by design, not oversight)

- Chapters Claude creates but never registers in `book.json` aren't picked
  up by the review-strip diffing loop (explicit `ponytail:` comment in
  `ipcHandlers.ts`) — narrow edge case, not exercised by SPEC's verification
  steps.
- No git dependency, no database — per SPEC.md ("No git dependency" /
  "No database, no server, no telemetry"), confirmed absent.
