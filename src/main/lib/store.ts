import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import {
  booksRoot,
  bookDir,
  chaptersDir,
  snapshotsDir,
  bookJsonPath,
  chapterPath,
  writingRulesPath
} from './paths'
import type { BookMeta, BookSummary } from '../../shared/types'

const WRITING_RULES_TEMPLATE = `Tell Claude how you want the book written — style, tone, things to always/never do.

- Keep my sentences short.
- Never use the word "suddenly".
- Don't change dialogue unless I ask.
`

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'book') + '-' + randomBytes(3).toString('hex')
}

function newChapterId(): string {
  return 'c' + randomBytes(4).toString('hex')
}

async function readBook(bookId: string): Promise<BookMeta> {
  const raw = await fs.readFile(bookJsonPath(bookId), 'utf8')
  return JSON.parse(raw)
}

async function writeBook(book: BookMeta): Promise<void> {
  await fs.writeFile(bookJsonPath(book.id), JSON.stringify(book, null, 2), 'utf8')
}

async function listBooks(): Promise<BookSummary[]> {
  const root = booksRoot()
  if (!existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const summaries: BookSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const jsonPath = bookJsonPath(entry.name)
    if (!existsSync(jsonPath)) continue
    try {
      const book = await readBook(entry.name)
      const stat = await fs.stat(jsonPath)
      summaries.push({ id: book.id, title: book.title, updatedAt: stat.mtimeMs })
    } catch {
      // skip unreadable book folders
    }
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  return summaries
}

async function createBook(title: string): Promise<BookMeta> {
  const id = slugify(title)
  mkdirSync(chaptersDir(id), { recursive: true })
  mkdirSync(snapshotsDir(id), { recursive: true })
  const firstChapter = { id: newChapterId(), title: 'Chapter 1' }
  await fs.writeFile(chapterPath(id, firstChapter.id), '', 'utf8')
  await fs.writeFile(writingRulesPath(id), `<!--\n${WRITING_RULES_TEMPLATE}\n-->`, 'utf8')
  const book: BookMeta = {
    id,
    title,
    chapters: [firstChapter],
    claudeSessionId: null,
    model: 'sonnet[1m]'
  }
  await writeBook(book)
  return book
}

async function addChapter(bookId: string, title: string): Promise<BookMeta> {
  const book = await readBook(bookId)
  const chapter = { id: newChapterId(), title }
  await fs.writeFile(chapterPath(bookId, chapter.id), '', 'utf8')
  book.chapters.push(chapter)
  await writeBook(book)
  return book
}

async function renameChapter(bookId: string, chapterId: string, title: string): Promise<BookMeta> {
  const book = await readBook(bookId)
  const chapter = book.chapters.find((c) => c.id === chapterId)
  if (chapter) chapter.title = title
  await writeBook(book)
  return book
}

async function deleteChapter(bookId: string, chapterId: string): Promise<BookMeta> {
  const book = await readBook(bookId)
  book.chapters = book.chapters.filter((c) => c.id !== chapterId)
  await writeBook(book)
  await fs.rm(chapterPath(bookId, chapterId), { force: true })
  return book
}

async function reorderChapters(bookId: string, orderedIds: string[]): Promise<BookMeta> {
  const book = await readBook(bookId)
  const byId = new Map(book.chapters.map((c) => [c.id, c]))
  book.chapters = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is BookMeta['chapters'][number] => !!c)
  await writeBook(book)
  return book
}

async function readChapter(bookId: string, chapterId: string): Promise<string> {
  try {
    return await fs.readFile(chapterPath(bookId, chapterId), 'utf8')
  } catch {
    return ''
  }
}

async function writeChapter(bookId: string, chapterId: string, markdown: string): Promise<void> {
  await fs.writeFile(chapterPath(bookId, chapterId), markdown, 'utf8')
}

async function readWritingRules(bookId: string): Promise<string> {
  try {
    return await fs.readFile(writingRulesPath(bookId), 'utf8')
  } catch {
    return WRITING_RULES_TEMPLATE
  }
}

async function writeWritingRules(bookId: string, text: string): Promise<void> {
  await fs.writeFile(writingRulesPath(bookId), text, 'utf8')
}

async function setSessionId(bookId: string, sessionId: string): Promise<void> {
  const book = await readBook(bookId)
  book.claudeSessionId = sessionId
  await writeBook(book)
}

async function setModel(bookId: string, model: string): Promise<void> {
  const book = await readBook(bookId)
  book.model = model
  await writeBook(book)
}

export const store = {
  bookDir,
  chaptersDir,
  listBooks,
  createBook,
  readBook,
  writeBook,
  addChapter,
  renameChapter,
  deleteChapter,
  reorderChapters,
  readChapter,
  writeChapter,
  readWritingRules,
  writeWritingRules,
  setSessionId,
  setModel
}
