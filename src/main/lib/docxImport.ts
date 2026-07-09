import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { store } from './store'

const turndown = new TurndownService({ headingStyle: 'atx' })

interface ParsedChapter {
  title: string
  content: string
}

function splitOnH1(markdown: string): ParsedChapter[] {
  const lines = markdown.split('\n')
  const chapters: ParsedChapter[] = []
  let current: ParsedChapter | null = null
  for (const line of lines) {
    const h1 = /^#\s+(.+)/.exec(line)
    if (h1) {
      if (current) chapters.push(current)
      current = { title: h1[1].trim(), content: '' }
    } else if (current) {
      current.content += line + '\n'
    } else if (line.trim()) {
      // content before any H1 — collect into an untitled leading chapter
      current = { title: 'Chapter 1', content: line + '\n' }
    }
  }
  if (current) chapters.push(current)
  return chapters.map((c) => ({ title: c.title, content: c.content.trim() }))
}

/** Imports a .docx file into the book, splitting on H1 headings (fallback: single chapter). */
export async function importDocx(
  bookId: string,
  filePath: string
): Promise<{ chaptersCreated: number }> {
  const { value: html } = await mammoth.convertToHtml({ path: filePath })
  const markdown = turndown.turndown(html)
  let chapters = splitOnH1(markdown)
  if (chapters.length === 0) {
    chapters = [{ title: 'Chapter 1', content: markdown.trim() }]
  }

  // Replace a lone untouched default chapter rather than leaving a stray empty one.
  let book = await store.readBook(bookId)
  if (book.chapters.length === 1 && book.chapters[0].title === 'Chapter 1') {
    const existing = await store.readChapter(bookId, book.chapters[0].id)
    if (existing.trim() === '') {
      book = await store.deleteChapter(bookId, book.chapters[0].id)
    }
  }

  for (const chapter of chapters) {
    book = await store.addChapter(bookId, chapter.title)
    const added = book.chapters[book.chapters.length - 1]
    await store.writeChapter(bookId, added.id, chapter.content)
  }

  return { chaptersCreated: chapters.length }
}
