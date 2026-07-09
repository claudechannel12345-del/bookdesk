import { app } from 'electron'
import { join } from 'path'

export function booksRoot(): string {
  return join(app.getPath('documents'), 'BookDesk Books')
}

export function bookDir(bookId: string): string {
  return join(booksRoot(), bookId)
}

export function chaptersDir(bookId: string): string {
  return join(bookDir(bookId), 'chapters')
}

export function snapshotsDir(bookId: string): string {
  return join(bookDir(bookId), '.snapshots')
}

export function formattingDir(bookId: string): string {
  return join(bookDir(bookId), '.bookdesk-format')
}

export function bookJsonPath(bookId: string): string {
  return join(bookDir(bookId), 'book.json')
}

export function chapterPath(bookId: string, chapterId: string): string {
  return join(chaptersDir(bookId), `${chapterId}.md`)
}

export function chapterFormatPath(bookId: string, chapterId: string): string {
  return join(formattingDir(bookId), `${chapterId}.json`)
}

export function writingRulesPath(bookId: string): string {
  return join(bookDir(bookId), 'CLAUDE.md')
}
