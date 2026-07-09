import chokidar, { FSWatcher } from 'chokidar'
import { basename } from 'path'
import { chaptersDir } from './paths'
import type { ReviewEntry } from '../../shared/types'

/** Per-book in-memory runtime state: file watcher + active-turn bookkeeping. */
interface BookSession {
  watcher: FSWatcher
  lastKnownContent: Map<string, string> // chapterId -> content we last wrote/saw ourselves
  turnRunning: boolean
  pendingSnapshotTs: string | null
  changedDuringTurn: Set<string>
  pendingReview: ReviewEntry[]
}

const sessions = new Map<string, BookSession>()

/** Ensures a chokidar watcher is running for the book's chapters/ dir. Idempotent. */
export function ensureSession(
  bookId: string,
  onExternalChange: (chapterId: string, content: string) => void
): BookSession {
  let session = sessions.get(bookId)
  if (session) return session

  const watcher = chokidar.watch(chaptersDir(bookId), {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })

  session = {
    watcher,
    lastKnownContent: new Map(),
    turnRunning: false,
    pendingSnapshotTs: null,
    changedDuringTurn: new Set(),
    pendingReview: []
  }
  sessions.set(bookId, session)

  const handle = async (path: string): Promise<void> => {
    if (!path.endsWith('.md')) return
    const chapterId = basename(path, '.md')
    const fs = await import('fs/promises')
    let content: string
    try {
      content = await fs.readFile(path, 'utf8')
    } catch {
      return // file was deleted mid-event
    }
    const known = session!.lastKnownContent.get(chapterId)
    if (known === content) return // echo of our own write
    session!.lastKnownContent.set(chapterId, content)
    if (session!.turnRunning) session!.changedDuringTurn.add(chapterId)
    onExternalChange(chapterId, content)
  }

  watcher.on('change', handle)
  watcher.on('add', handle)

  return session
}

/** Call whenever we (the app) write a chapter file ourselves, so the watcher ignores the echo. */
export function recordSelfWrite(bookId: string, chapterId: string, content: string): void {
  sessions.get(bookId)?.lastKnownContent.set(chapterId, content)
}

export function getSession(bookId: string): BookSession | undefined {
  return sessions.get(bookId)
}

/** Upserts this turn's changed-chapter entries into the book's pending review strip
 *  (chapters untouched this turn keep whatever entry they already had). */
export function upsertPendingReview(bookId: string, entries: ReviewEntry[]): void {
  const session = sessions.get(bookId)
  if (!session) return
  for (const entry of entries) {
    session.pendingReview = session.pendingReview.filter((e) => e.chapterId !== entry.chapterId)
    session.pendingReview.push(entry)
  }
}

export function getPendingReview(bookId: string): ReviewEntry[] {
  return sessions.get(bookId)?.pendingReview ?? []
}

export function clearReviewEntry(bookId: string, chapterId: string): void {
  const session = sessions.get(bookId)
  if (session)
    session.pendingReview = session.pendingReview.filter((e) => e.chapterId !== chapterId)
}

export function closeSession(bookId: string): void {
  const session = sessions.get(bookId)
  if (session) {
    session.watcher.close()
    sessions.delete(bookId)
  }
}
