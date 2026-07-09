# BookDesk — a word processor with Claude as co-author

Mac-first Electron app (must also run in dev on Windows via `npm start`). User is a non-technical author writing a book. He must never see markdown, a terminal, or a diff in raw form.

## Core model
- A **book** is a folder: `<book>/book.json` (title, ordered chapter list, claude session id) + `<book>/chapters/*.md` + `<book>/.snapshots/` (timestamped copies for undo/history).
- No git dependency. Version history = snapshots + `diff` (jsdiff) for change review.

## UI (three panes, clean and Word-like)
1. **Left sidebar**: chapter list — add, rename, delete (confirm), drag to reorder (order persisted in book.json). Word-count per chapter and book total.
2. **Center**: TipTap WYSIWYG editor bound to the selected chapter's markdown (user sees formatted text only). Autosave with ~2s debounce.
   **Google Docs parity is the explicit UI goal — the user is migrating FROM Google Docs and the transition must feel seamless.** Concretely:
   - Page look: white "sheet" centered on a neutral gray canvas, subtle shadow, Docs-like margins; document title editable at top.
   - Full Docs-style toolbar (icon buttons with tooltips, grouped like Docs): undo/redo, font family dropdown (a few good bundled choices incl. an Arial-alike and serif), font size dropdown, bold, italic, underline, strikethrough, **text highlight color** (palette swatch like Docs), text color, headings/styles dropdown ("Normal text", Heading 1-3, Title), alignment (left/center/right/justify), **line spacing dropdown (1.0/1.15/1.5/2.0)**, bullet + numbered lists, indent/outdent, blockquote, clear formatting.
   - Keyboard shortcuts matching Docs where TipTap allows: Cmd/Ctrl+B/I/U, Cmd+Z/Y, etc.
   - Persistence note: markdown alone can't hold highlight/font/spacing — store chapters as markdown-first with an HTML fallback layer or extended attrs so no formatting is silently lost on reload. Whatever the mechanism, round-trip fidelity is required: format → autosave → reload → formatting intact. Claude still reads/edits the files as text.
   - Word count in the bottom-left like Docs.
3. **Right**: chat panel.
   - Claude messages stream in. Tool activity renders as small status chips ("Editing Chapter 3…"), not raw JSON.
   - A **"Second opinion (Codex)"** button sends the current draft question to Codex; its replies are visually distinct (different accent/avatar) and it NEVER edits files.

## Claude integration (the linchpin — do it exactly this way)
- Shell out to the Claude Code CLI headless; do NOT use @anthropic-ai/claude-agent-sdk (it can't use subscription auth).
- Spawn per user message:
  `claude -p <prompt> --output-format stream-json --verbose --model sonnet[1m] --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep" ` with `cwd` = the book folder.
- Continuity: capture `session_id` from the stream, store in book.json, pass `--resume <id>` on subsequent messages. One long-lived conversation per book.
- Parse the stream-json events: assistant text deltas → chat stream; tool_use events → status chips; result event → turn done.
- System-prompt via `--append-system-prompt`: "You are a co-author/editor inside a book-writing app. The book is the markdown files in chapters/. Make edits directly to those files when asked. Keep the author's voice. Never touch book.json or .snapshots."
- Model configurable in Settings (default `sonnet[1m]`, option `opus[1m]`).

## Edit safety loop
- Before dispatching a Claude turn: autosave the open editor, snapshot all chapters to `.snapshots/<ts>/`.
- File watcher (chokidar) on chapters/. When Claude's turn ends, diff current vs snapshot:
  - Changed open chapter → live-reload editor (if user typed meanwhile, banner: "Claude edited this chapter — Reload / Keep mine").
  - Show a review strip: "Claude changed Chapter 3 (+120 / −40 words) — View changes | Undo". View = side-by-side or inline word-diff rendered readably. Undo restores from the snapshot (per file).
- While a Claude turn is running, disable the send button; typing stays allowed (banner flow resolves conflicts).

## Writing Rules
- A "Writing Rules" button (sidebar or toolbar) opens a simple always-editable plain-text panel: "Tell Claude how you want the book written — style, tone, things to always/never do."
- It saves to `<book>/CLAUDE.md`. The claude CLI auto-loads CLAUDE.md from its cwd on every turn, so the rules apply to every change with no extra wiring. Seed new books with a commented template (e.g. "- Keep my sentences short." / "- Never use the word 'suddenly'." / "- Don't change dialogue unless I ask.").
- Never show the filename/markdown mechanics to the user — it's just "Writing Rules". Claude must not edit this file itself (add to the append-system-prompt exclusions alongside book.json and .snapshots).

## Codex integration
- Spawn: `codex exec --sandbox read-only -C <bookfolder> "<prompt>"`, stream stdout to the chat panel as the Codex speaker. Read-only always. If binary missing, the button shows setup instructions instead of erroring.

## Import
- Menu: "Import from Word (.docx)…" → mammoth → markdown → split on H1 headings into chapter files (fallback: single chapter). Mention in the import dialog: from Google Docs use File → Download → Microsoft Word first.

## First-run / setup screen
- Detect `claude` binary (PATH + common install locations on mac/win). If missing or unauthenticated (spawn fails / auth error in stream), show a friendly setup page: install command, "log in by running `claude` once in Terminal", and a "Test connection" button that runs a 1-token ping.
- Same lightweight detection for `codex` (optional dependency).

## Stack & constraints
- Electron + Vite + React + TipTap. Keep deps minimal beyond that (chokidar, mammoth, diff/jsdiff, tiptap markdown extension). No database, no server, no telemetry.
- electron-builder config targeting mac dmg (universal) — config only; actual dmg build happens on the Mac later. `npm start` must work on Windows for dev.
- Plain JS or TS, whichever is leaner to keep correct — TS preferred for the main-process services.
- Code style: boring, minimal, no speculative abstraction.

## Required verification before you finish (do not skip)
1. `npm start` launches on this Windows machine.
2. Create a book, type text, confirm autosave writes the .md.
3. Send a real Claude message (claude CLI is installed and authenticated on this machine) asking it to edit a chapter; confirm the file changes, the editor reloads, and the review strip + Undo work.
4. docx import round-trip with a small generated .docx.
Write a short `VERIFIED.md` with what you actually observed (commands, outcomes). Honest failures > claimed success.
