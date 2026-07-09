import { ipcMain, dialog, BrowserWindow } from 'electron'
import { diffWords } from 'diff'
import { store } from './lib/store'
import { snapshotAll, readSnapshotChapter, restoreChapterFromSnapshot } from './lib/snapshot'
import {
  ensureSession,
  recordSelfWrite,
  upsertPendingReview,
  getPendingReview,
  clearReviewEntry
} from './lib/session'
import { detectClaude, testConnection, runClaudeTurn } from './lib/claudeCli'
import { detectCodex, runCodexTurn } from './lib/codexCli'
import { importDocx } from './lib/docxImport'
import type { AgentEvent, DiffResult, ReviewEntry } from '../shared/types'

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(\s*)([-+*]|\d+\.)\s+/gm, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
}

function countDiffWords(before: string, after: string): { added: number; removed: number } {
  const parts = diffWords(before, after)
  let added = 0
  let removed = 0
  for (const p of parts) {
    const n = wordCount(p.value)
    if (p.added) added += n
    else if (p.removed) removed += n
  }
  return { added, removed }
}

let activeBookId: string | null = null
export function getActiveBookId(): string | null {
  return activeBookId
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // ---- Books ----
  ipcMain.handle('books:list', () => store.listBooks())
  ipcMain.handle('books:create', (_e, title: string) => store.createBook(title))
  ipcMain.handle('books:open', (event, bookId: string) => {
    activeBookId = bookId
    ensureSession(bookId, (chapterId, content) => {
      event.sender.send('chapter:external-change', { bookId, chapterId, content })
    })
    return store.readBook(bookId)
  })
  ipcMain.handle('books:setActive', (_e, bookId: string | null) => {
    activeBookId = bookId
  })

  // ---- Chapters ----
  ipcMain.handle('chapters:add', (_e, bookId: string, title: string) =>
    store.addChapter(bookId, title)
  )
  ipcMain.handle('chapters:rename', (_e, bookId: string, chapterId: string, title: string) =>
    store.renameChapter(bookId, chapterId, title)
  )
  ipcMain.handle('chapters:delete', (_e, bookId: string, chapterId: string) =>
    store.deleteChapter(bookId, chapterId)
  )
  ipcMain.handle('chapters:reorder', (_e, bookId: string, orderedIds: string[]) =>
    store.reorderChapters(bookId, orderedIds)
  )
  ipcMain.handle('chapters:read', (_e, bookId: string, chapterId: string) =>
    store.readChapter(bookId, chapterId)
  )
  ipcMain.handle(
    'chapters:write',
    async (_e, bookId: string, chapterId: string, markdown: string) => {
      recordSelfWrite(bookId, chapterId, markdown)
      await store.writeChapter(bookId, chapterId, markdown)
    }
  )

  // ---- Writing Rules (book's CLAUDE.md) ----
  ipcMain.handle('writingRules:read', (_e, bookId: string) => store.readWritingRules(bookId))
  ipcMain.handle('writingRules:write', (_e, bookId: string, text: string) =>
    store.writeWritingRules(bookId, text)
  )

  // ---- Settings ----
  ipcMain.handle('settings:setModel', (_e, bookId: string, model: string) =>
    store.setModel(bookId, model)
  )

  // ---- Detection ----
  ipcMain.handle('detect:claude', () => detectClaude())
  ipcMain.handle('detect:codex', () => detectCodex())
  ipcMain.handle('detect:testClaude', () => testConnection())

  // ---- Claude turn ----
  ipcMain.handle('claude:send', async (event, bookId: string, prompt: string) => {
    const book = await store.readBook(bookId)
    const session = ensureSession(bookId, (chapterId, content) => {
      event.sender.send('chapter:external-change', { bookId, chapterId, content })
    })
    if (session.turnRunning) return { started: false }
    session.turnRunning = true
    session.changedDuringTurn.clear()
    const ts = await snapshotAll(bookId)
    session.pendingSnapshotTs = ts

    const chapterListing = book.chapters
      .map((c, i) => `${i + 1}. chapters/${c.id}.md — "${c.title}"`)
      .join('\n')
    const fullPrompt = `[Book: "${book.title}". Chapters in order:\n${chapterListing}]\n\n${prompt}`

    const onEvent = (agentEvent: AgentEvent): void => {
      event.sender.send('claude:event', { bookId, event: agentEvent })
    }

    void (async () => {
      const result = await runClaudeTurn({
        cwd: store.bookDir(bookId),
        prompt: fullPrompt,
        model: book.model,
        resumeSessionId: book.claudeSessionId,
        onEvent
      })
      try {
        if (result.sessionId) await store.setSessionId(bookId, result.sessionId)

        // Diff every chapter against the pre-turn snapshot; build/merge review entries.
        // ponytail: doesn't detect chapters Claude created but never registered in book.json — out of scope for now.
        const freshBook = await store.readBook(bookId)
        const entries: ReviewEntry[] = []
        for (const chapter of freshBook.chapters) {
          const before = await readSnapshotChapter(bookId, ts, chapter.id)
          const after = await store.readChapter(bookId, chapter.id)
          if (before === after) continue
          const { added, removed } = countDiffWords(before, after)
          entries.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            addedWords: added,
            removedWords: removed,
            snapshotTs: ts
          })
          event.sender.send('chapter:external-change', {
            bookId,
            chapterId: chapter.id,
            content: after
          })
        }
        upsertPendingReview(bookId, entries)
        event.sender.send('claude:review', { bookId, entries: getPendingReview(bookId) })
      } catch (error) {
        onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not review Claude changes.'
        })
      } finally {
        session.turnRunning = false
      }
    })()

    return { started: true }
  })

  // ---- Codex (second opinion, read-only, never edits files) ----
  ipcMain.handle('codex:send', async (event, bookId: string, prompt: string) => {
    const onEvent = (agentEvent: AgentEvent): void => {
      event.sender.send('codex:event', { bookId, event: agentEvent })
    }
    runCodexTurn({ cwd: store.bookDir(bookId), prompt, onEvent })
    return { started: true }
  })

  // ---- Review strip ----
  ipcMain.handle('review:list', (_e, bookId: string) => getPendingReview(bookId))
  ipcMain.handle(
    'review:diff',
    async (_e, bookId: string, chapterId: string): Promise<DiffResult | null> => {
      const entry = getPendingReview(bookId).find((e) => e.chapterId === chapterId)
      if (!entry) return null
      const before = await readSnapshotChapter(bookId, entry.snapshotTs, chapterId)
      const after = await store.readChapter(bookId, chapterId)
      return {
        chapterTitle: entry.chapterTitle,
        parts: diffWords(plainText(before), plainText(after))
      }
    }
  )
  ipcMain.handle('review:undo', async (_e, bookId: string, chapterId: string) => {
    const entry = getPendingReview(bookId).find((e) => e.chapterId === chapterId)
    if (!entry) return
    await restoreChapterFromSnapshot(bookId, entry.snapshotTs, chapterId)
    const restored = await store.readChapter(bookId, chapterId)
    recordSelfWrite(bookId, chapterId, restored)
    clearReviewEntry(bookId, chapterId)
  })
  ipcMain.handle('review:dismiss', (_e, bookId: string, chapterId: string) => {
    clearReviewEntry(bookId, chapterId)
  })

  // ---- Import from Word ----
  ipcMain.handle('import:docx', (_e, bookId: string) => runDocxImportFlow(getWindow(), bookId))
}

/** Shared by the ipc handler (renderer-triggered) and the app menu item. */
export async function runDocxImportFlow(
  win: BrowserWindow | null,
  bookId: string | null
): Promise<{ chaptersCreated: number } | null> {
  if (!bookId) {
    if (win)
      dialog.showMessageBox(win, {
        message: 'Open a book first, then use Import from Word.',
        type: 'info'
      })
    return null
  }
  const note = {
    type: 'info' as const,
    message: 'Import from Word (.docx)',
    detail:
      'Pick a .docx file. It will be split into chapters at each top-level heading.\n\n' +
      'From Google Docs: use File → Download → Microsoft Word (.docx) first, then import that file.',
    buttons: ['Choose File…', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  }
  const choice = win ? await dialog.showMessageBox(win, note) : await dialog.showMessageBox(note)
  if (choice.response !== 0) return null

  const options = {
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
    properties: ['openFile' as const]
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return importDocx(bookId, result.filePaths[0])
}
