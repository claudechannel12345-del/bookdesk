import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { DocumentLayout, FontSize, FindHighlight, type FindRange } from './editorExtensions'
import { ToolbarMenu } from './components/ToolbarMenu'
import { HistoryModal } from './components/HistoryModal'
import {
  IcUndo,
  IcRedo,
  IcAlignLeft,
  IcAlignCenter,
  IcAlignRight,
  IcAlignJustify,
  IcBullets,
  IcNumbers,
  IcOutdent,
  IcIndent,
  IcQuote,
  IcClearFormat,
  IcSun,
  IcMoon,
  IcSearch,
  IcHistory,
  IcClose,
  IcChevronDown,
  IcArrowUp,
  IcArrowDown,
  IcBook
} from './components/icons'
import type {
  AgentEvent,
  BookMeta,
  BookSummary,
  ChatMessage,
  DetectResult,
  DiffResult,
  ReviewEntry
} from '../../shared/types'
import { CLAUDE_MODELS } from '../../shared/types'

const emptyDetect: DetectResult = { found: false }

const FONT_FAMILIES = [
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Courier New', '"Courier New", monospace']
] as const

const TEXT_COLORS = ['#202124', '#5f6368', '#c5221f', '#ea8600', '#188038', '#1a73e8', '#9334e6']
const HIGHLIGHT_COLORS = ['#ffffff', '#fce8b2', '#f8d8d8', '#d4e8d2', '#d5e5f7', '#e8d7f4']

function id(): string {
  return Math.random().toString(36).slice(2)
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function markdownOf(editor: Editor): string {
  return (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown()
}

function restoreDocument(editor: Editor, document: Record<string, unknown>): void {
  const next = editor.schema.nodeFromJSON(document as unknown as JSONContent)
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content))
}

/** Plain-text find: match positions inside single text nodes (case-insensitive). */
function computeFindMatches(editor: Editor, query: string): FindRange[] {
  const q = query.toLowerCase()
  const out: FindRange[] = []
  if (!q) return out
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    // ponytail: misses matches that span two text nodes (e.g. bold mid-word); fine for prose
    const text = node.text.toLowerCase()
    let i = text.indexOf(q)
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + q.length })
      i = text.indexOf(q, i + q.length)
    }
  })
  return out
}

function stripMarkdown(markdown: string): string {
  return markdown.replace(/^#{1,6}\s+/gm, '').replace(/[`*_~>]/g, '')
}

function App(): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [book, setBook] = useState<BookMeta | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [chapterWords, setChapterWords] = useState<Record<string, number>>({})
  const [newBookTitle, setNewBookTitle] = useState('My Book')
  const [chatText, setChatText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [claudeRunning, setClaudeRunning] = useState(false)
  const [reviews, setReviews] = useState<ReviewEntry[]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [conflictText, setConflictText] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesText, setRulesText] = useState('')
  const [claudeDetect, setClaudeDetect] = useState<DetectResult>(emptyDetect)
  const [codexDetect, setCodexDetect] = useState<DetectResult>(emptyDetect)
  const [setupMessage, setSetupMessage] = useState('')
  const [needsClaudeSetup, setNeedsClaudeSetup] = useState(false)
  const [draggingChapterId, setDraggingChapterId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ chapterId: string; title: string } | null>(
    null
  )
  const [theme, setTheme] = useState<string>(
    () => window.localStorage.getItem('bookdesk-theme') ?? 'light'
  )
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findState, setFindState] = useState({ active: 0, total: 0 })
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tocQuery, setTocQuery] = useState('')
  const [tocResults, setTocResults] = useState<
    { chapterId: string; title: string; count: number; snippet: string }[] | null
  >(null)

  const bookIdRef = useRef<string | null>(null)
  const selectedChapterIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const loadingRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const saveNowRef = useRef<() => Promise<void>>(async () => {})
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const findInputRef = useRef<HTMLInputElement | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextStyle,
      FontSize,
      Color.configure({ types: ['textStyle'] }),
      FontFamily.configure({ types: ['textStyle'] }),
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      DocumentLayout,
      FindHighlight,
      Link.configure({ openOnClick: false }),
      Markdown.configure({ html: false })
    ],
    content: '',
    editorProps: {
      attributes: { class: 'editor-page' }
    },
    onUpdate: ({ editor: updated }) => {
      if (loadingRef.current) return
      dirtyRef.current = true
      const markdown = markdownOf(updated)
      const chapterId = selectedChapterIdRef.current
      if (chapterId) setChapterWords((words) => ({ ...words, [chapterId]: wordCount(markdown) }))
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => void saveNowRef.current(), 2000)
    }
  })

  const selectedChapter = useMemo(
    () => book?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [book, selectedChapterId]
  )
  const totalWords = useMemo(
    () => Object.values(chapterWords).reduce((sum, count) => sum + count, 0),
    [chapterWords]
  )

  const appendMessage = useCallback((speaker: ChatMessage['speaker'], text: string) => {
    setMessages((items) => [...items, { id: id(), speaker, text }])
  }, [])

  const appendAgentEvent = useCallback(
    (speaker: 'claude' | 'codex', event: AgentEvent) => {
      if (event.kind === 'text') {
        setMessages((items) => {
          const last = items[items.length - 1]
          if (last?.speaker === speaker)
            return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
          return [...items, { id: id(), speaker, text: event.text }]
        })
        return
      }
      if (event.kind === 'tool') appendMessage('claude-tool', event.label)
      if (event.kind === 'done' && speaker === 'claude') {
        setClaudeRunning(false)
        if (event.summary) appendMessage('system', 'Claude finished.')
      }
      if (event.kind === 'error') {
        if (speaker === 'claude') setClaudeRunning(false)
        appendMessage('system', event.message)
        if (
          speaker === 'claude' &&
          /auth|log ?in|not logged|unauthori[sz]ed/i.test(event.message)
        ) {
          setNeedsClaudeSetup(true)
          setSetupMessage('Claude needs a sign-in. Run claude once in Terminal, then try again.')
        }
      }
    },
    [appendMessage]
  )

  const refreshBooks = useCallback(async () => setBooks(await window.api.books.list()), [])

  const loadWordCounts = useCallback(async (nextBook: BookMeta) => {
    const pairs = await Promise.all(
      nextBook.chapters.map(
        async (chapter) =>
          [chapter.id, wordCount(await window.api.chapters.read(nextBook.id, chapter.id))] as const
      )
    )
    setChapterWords(Object.fromEntries(pairs))
  }, [])

  const openBook = useCallback(
    async (bookId: string) => {
      const nextBook = await window.api.books.open(bookId)
      bookIdRef.current = nextBook.id
      setBook(nextBook)
      setSelectedChapterId(nextBook.chapters[0]?.id ?? null)
      setReviews(await window.api.review.list(nextBook.id))
      await loadWordCounts(nextBook)
      setMessages([])
    },
    [loadWordCounts]
  )

  const saveNow = useCallback(async () => {
    if (!editor || !bookIdRef.current || !selectedChapterIdRef.current || !dirtyRef.current) return
    const markdown = markdownOf(editor)
    await window.api.chapters.writeContent(
      bookIdRef.current,
      selectedChapterIdRef.current,
      markdown,
      editor.getJSON() as unknown as Record<string, unknown>
    )
    dirtyRef.current = false
  }, [editor])

  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  const loadChapter = useCallback(
    async (chapterId: string | null) => {
      selectedChapterIdRef.current = chapterId
      setSelectedChapterId(chapterId)
      setConflictText(null)
      if (!editor || !bookIdRef.current || !chapterId) return
      const content = await window.api.chapters.readContent(bookIdRef.current, chapterId)
      loadingRef.current = true
      if (content.document) restoreDocument(editor, content.document)
      else editor.commands.setContent(content.markdown, false)
      loadingRef.current = false
      dirtyRef.current = false
      setChapterWords((words) => ({ ...words, [chapterId]: wordCount(content.markdown) }))
    },
    [editor]
  )

  useEffect(() => {
    // auto-scroll to newest message unless the user scrolled up to read history
    const el = messagesRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('bookdesk-theme', theme)
  }, [theme])

  // ---- Find in chapter ----
  const applyFind = useCallback(
    (query: string, active: number, scroll: boolean) => {
      if (!editor) return
      const matches = computeFindMatches(editor, query)
      const index = matches.length
        ? ((active % matches.length) + matches.length) % matches.length
        : 0
      const storage = editor.storage.findHighlight as { ranges: FindRange[]; active: number }
      storage.ranges = matches
      storage.active = matches.length ? index : -1
      editor.view.dispatch(editor.state.tr) // repaint decorations
      setFindState({ active: matches.length ? index : 0, total: matches.length })
      if (scroll && matches.length) {
        editor.chain().setTextSelection(matches[index]).scrollIntoView().run()
      }
    },
    [editor]
  )

  const closeFind = useCallback(() => {
    setFindOpen(false)
    if (!editor) return
    const storage = editor.storage.findHighlight as { ranges: FindRange[]; active: number }
    storage.ranges = []
    storage.active = -1
    editor.view.dispatch(editor.state.tr)
    editor.commands.focus()
  }, [editor])

  useEffect(() => {
    if (findOpen) applyFind(findQuery, 0, true)
  }, [findOpen, findQuery, selectedChapterId, applyFind])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setFindOpen(true)
        window.setTimeout(() => findInputRef.current?.select(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- Search across all chapters (sidebar) ----
  useEffect(() => {
    const query = tocQuery.trim().toLowerCase()
    if (!book || query.length < 2) {
      setTocResults(null)
      return
    }
    const bookAtStart = book
    const timer = window.setTimeout(async () => {
      const results: { chapterId: string; title: string; count: number; snippet: string }[] = []
      for (const chapter of bookAtStart.chapters) {
        const text = stripMarkdown(await window.api.chapters.read(bookAtStart.id, chapter.id))
        const lower = text.toLowerCase()
        let count = 0
        let i = lower.indexOf(query)
        const first = i
        while (i !== -1) {
          count++
          i = lower.indexOf(query, i + query.length)
        }
        if (count > 0) {
          const start = Math.max(0, first - 32)
          const snippet =
            (start > 0 ? '…' : '') +
            text.slice(start, first + query.length + 48).replace(/\s+/g, ' ') +
            '…'
          results.push({ chapterId: chapter.id, title: chapter.title, count, snippet })
        }
      }
      setTocResults(results)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [tocQuery, book])

  useEffect(() => {
    void refreshBooks()
    void window.api.detect.claude().then(setClaudeDetect)
    void window.api.detect.codex().then(setCodexDetect)
  }, [refreshBooks])

  useEffect(() => {
    if (selectedChapterId && editor) void loadChapter(selectedChapterId)
  }, [editor, loadChapter, selectedChapterId])

  useEffect(() => {
    const offClaude = window.api.claude.onEvent((payload) => {
      if (payload.bookId === bookIdRef.current) appendAgentEvent('claude', payload.event)
    })
    const offCodex = window.api.codex.onEvent((payload) => {
      if (payload.bookId === bookIdRef.current) appendAgentEvent('codex', payload.event)
    })
    const offReview = window.api.claude.onReview((payload) => {
      if (payload.bookId === bookIdRef.current) setReviews(payload.entries)
    })
    const offExternal = window.api.onChapterExternalChange((payload) => {
      if (payload.bookId !== bookIdRef.current) return
      setChapterWords((words) => ({ ...words, [payload.chapterId]: wordCount(payload.content) }))
      if (payload.chapterId !== selectedChapterIdRef.current || !editor) return
      if (dirtyRef.current) {
        setConflictText(payload.content)
        return
      }
      loadingRef.current = true
      editor.commands.setContent(payload.content, false)
      loadingRef.current = false
    })
    const offBookReload = window.api.onBookReload((payload) => {
      if (payload.bookId === bookIdRef.current) void openBook(payload.bookId)
    })
    return () => {
      offClaude()
      offCodex()
      offReview()
      offExternal()
      offBookReload()
    }
  }, [appendAgentEvent, editor, openBook])

  async function createBook(): Promise<void> {
    const nextBook = await window.api.books.create(newBookTitle.trim() || 'Untitled Book')
    await refreshBooks()
    await openBook(nextBook.id)
  }

  async function chooseChapter(chapterId: string): Promise<void> {
    await saveNow()
    await loadChapter(chapterId)
  }

  async function addChapter(): Promise<void> {
    if (!book) return
    // window.prompt throws in Electron — add with a default title, rename after
    const nextBook = await window.api.chapters.add(book.id, `Chapter ${book.chapters.length + 1}`)
    setBook(nextBook)
    await loadWordCounts(nextBook)
    await loadChapter(nextBook.chapters[nextBook.chapters.length - 1].id)
  }

  function renameChapter(chapterId: string): void {
    if (!book) return
    const chapter = book.chapters.find((item) => item.id === chapterId)
    setRenameTarget({ chapterId, title: chapter?.title ?? '' })
  }

  async function saveRename(): Promise<void> {
    if (!book || !renameTarget) return
    const title = renameTarget.title.trim()
    if (title) setBook(await window.api.chapters.rename(book.id, renameTarget.chapterId, title))
    setRenameTarget(null)
  }

  async function deleteChapter(chapterId: string): Promise<void> {
    if (!book || !window.confirm('Delete this chapter?')) return
    const nextBook = await window.api.chapters.delete(book.id, chapterId)
    setBook(nextBook)
    await loadWordCounts(nextBook)
    await loadChapter(nextBook.chapters[0]?.id ?? null)
  }

  async function moveChapter(targetId: string): Promise<void> {
    if (!book || !draggingChapterId || draggingChapterId === targetId) return
    const chapters = [...book.chapters]
    const from = chapters.findIndex((chapter) => chapter.id === draggingChapterId)
    const to = chapters.findIndex((chapter) => chapter.id === targetId)
    if (from < 0 || to < 0) return
    const [moved] = chapters.splice(from, 1)
    chapters.splice(to, 0, moved)
    setBook(
      await window.api.chapters.reorder(
        book.id,
        chapters.map((chapter) => chapter.id)
      )
    )
    setDraggingChapterId(null)
  }

  async function saveBookTitle(): Promise<void> {
    if (!book) return
    const nextBook = await window.api.books.rename(book.id, book.title)
    setBook(nextBook)
    await refreshBooks()
  }

  async function sendClaude(): Promise<void> {
    if (!book || !chatText.trim() || claudeRunning) return
    await saveNow()
    const text = chatText.trim()
    setChatText('')
    appendMessage('user', text)
    setClaudeRunning(true)
    const result = await window.api.claude.send(book.id, text)
    if (!result.started) {
      setClaudeRunning(false)
      appendMessage('system', 'Claude is already working on a message.')
    }
  }

  async function sendCodex(): Promise<void> {
    if (!book || !chatText.trim()) return
    if (!codexDetect.found) {
      appendMessage('system', 'Codex is optional. Install the codex CLI to use Second opinion.')
      return
    }
    const text = chatText.trim()
    setChatText('')
    appendMessage('user', text)
    await window.api.codex.send(book.id, text)
  }

  async function openRules(): Promise<void> {
    if (!book) return
    setRulesText(await window.api.writingRules.read(book.id))
    setRulesOpen(true)
  }

  async function saveRules(): Promise<void> {
    if (!book) return
    await window.api.writingRules.write(book.id, rulesText)
    setRulesOpen(false)
  }

  async function changeModel(model: string): Promise<void> {
    if (!book) return
    await window.api.settings.setModel(book.id, model)
    setBook({ ...book, model })
  }

  async function showDiff(entry: ReviewEntry): Promise<void> {
    if (book) setDiff(await window.api.review.diff(book.id, entry.chapterId))
  }

  async function undoReview(entry: ReviewEntry): Promise<void> {
    if (!book) return
    await window.api.review.undo(book.id, entry.chapterId)
    setReviews(await window.api.review.list(book.id))
    if (entry.chapterId === selectedChapterIdRef.current) await loadChapter(entry.chapterId)
    await loadWordCounts(book)
  }

  async function testClaude(): Promise<void> {
    setSetupMessage('Testing Claude...')
    setSetupMessage((await window.api.detect.testClaude()).message)
  }

  function activeBlock(): 'paragraph' | 'heading' | 'blockquote' {
    if (editor?.isActive('heading')) return 'heading'
    if (editor?.isActive('blockquote')) return 'blockquote'
    return 'paragraph'
  }

  function setLineSpacing(value: string): void {
    if (!editor) return
    editor.chain().focus().updateAttributes(activeBlock(), { lineSpacing: value }).run()
  }

  function changeIndent(delta: number): void {
    if (!editor) return
    const block = activeBlock()
    const current = Number(editor.getAttributes(block).indent || 0)
    editor
      .chain()
      .focus()
      .updateAttributes(block, { indent: Math.max(0, current + delta) })
      .run()
  }

  function setStyle(value: string): void {
    if (!editor) return
    if (value === 'normal') editor.chain().focus().setParagraph().run()
    else if (value === 'title') editor.chain().focus().setNode('heading', { level: 1 }).run()
    else
      editor
        .chain()
        .focus()
        .setNode('heading', { level: Number(value.slice(-1)) as 1 | 2 | 3 })
        .run()
  }

  function currentStyleLabel(): string {
    for (const level of [1, 2, 3] as const)
      if (editor?.isActive('heading', { level })) return `Heading ${level}`
    return 'Normal text'
  }

  function currentFontLabel(): string {
    const family = (editor?.getAttributes('textStyle').fontFamily as string) ?? ''
    return FONT_FAMILIES.find(([, value]) => value === family)?.[0] ?? 'Georgia'
  }

  function currentSizeLabel(): string {
    const size = (editor?.getAttributes('textStyle').fontSize as string) ?? ''
    return size ? size.replace('pt', '') : '12'
  }

  function currentAlignIcon(): React.JSX.Element {
    if (editor?.isActive({ textAlign: 'center' })) return <IcAlignCenter />
    if (editor?.isActive({ textAlign: 'right' })) return <IcAlignRight />
    if (editor?.isActive({ textAlign: 'justify' })) return <IcAlignJustify />
    return <IcAlignLeft />
  }

  async function jumpToSearchResult(chapterId: string): Promise<void> {
    await chooseChapter(chapterId)
    setFindQuery(tocQuery.trim())
    setFindOpen(true)
  }

  async function historyRestored(chapterId: string): Promise<void> {
    setHistoryOpen(false)
    if (book) await loadWordCounts(book)
    if (chapterId === selectedChapterIdRef.current) await loadChapter(chapterId)
  }

  if (!claudeDetect.found || needsClaudeSetup) {
    return (
      <main className="setup">
        <section className="setup-panel">
          <h1>{needsClaudeSetup ? 'Sign in to Claude' : 'Connect Claude'}</h1>
          <p>
            {needsClaudeSetup
              ? 'BookDesk found Claude, but it needs a sign-in before it can edit your book.'
              : 'BookDesk needs the Claude CLI before it can edit your book.'}
          </p>
          <pre>npm install -g @anthropic-ai/claude-code</pre>
          <p>
            Then run <code>claude</code> once in Terminal and sign in.
          </p>
          <div className="setup-actions">
            <button onClick={() => void window.api.detect.claude().then(setClaudeDetect)}>
              Check again
            </button>
            <button onClick={() => void testClaude()}>Test connection</button>
          </div>
          {setupMessage && <p className="setup-message">{setupMessage}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-glyph" aria-hidden="true">
              <IcBook />
            </span>
            <div>
              <h1>BookDesk</h1>
              <p>{totalWords.toLocaleString()} words in this book</p>
            </div>
          </div>
          <button
            className="icon-button"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <IcSun /> : <IcMoon />}
          </button>
        </div>
        <div className="book-picker">
          <select value={book?.id ?? ''} onChange={(event) => void openBook(event.target.value)}>
            <option value="" disabled>
              Open a book
            </option>
            {books.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <div className="new-book">
            <input
              value={newBookTitle}
              onChange={(event) => setNewBookTitle(event.target.value)}
              aria-label="New book title"
            />
            <button onClick={() => void createBook()}>New</button>
          </div>
        </div>
        {book && (
          <>
            <div className="sidebar-search">
              <span className="sidebar-search-icon" aria-hidden="true">
                <IcSearch />
              </span>
              <input
                value={tocQuery}
                onChange={(event) => setTocQuery(event.target.value)}
                placeholder="Search all chapters"
                aria-label="Search all chapters"
              />
              {tocQuery && (
                <button
                  className="icon-button"
                  title="Clear search"
                  aria-label="Clear search"
                  onClick={() => setTocQuery('')}
                >
                  <IcClose />
                </button>
              )}
            </div>
            {tocResults !== null ? (
              <div className="search-results">
                {tocResults.length === 0 && (
                  <p className="search-none">No chapters mention “{tocQuery.trim()}”.</p>
                )}
                {tocResults.map((result) => (
                  <button
                    key={result.chapterId}
                    className="search-result"
                    onClick={() => void jumpToSearchResult(result.chapterId)}
                  >
                    <span className="search-result-title">
                      {result.title}
                      <small>
                        {result.count} {result.count === 1 ? 'match' : 'matches'}
                      </small>
                    </span>
                    <span className="search-result-snippet">{result.snippet}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="sidebar-row">
                  <h2>Chapters</h2>
                  <button onClick={() => void addChapter()}>Add</button>
                </div>
                <ol className="chapter-list">
                  {book.chapters.map((chapter, index) => (
                    <li
                      key={chapter.id}
                      draggable
                      onDragStart={() => setDraggingChapterId(chapter.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => void moveChapter(chapter.id)}
                      className={chapter.id === selectedChapterId ? 'active' : ''}
                    >
                      <button
                        className="chapter-main"
                        onClick={() => void chooseChapter(chapter.id)}
                      >
                        <span className="chapter-number" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span className="chapter-title">{chapter.title}</span>
                        <small>{(chapterWords[chapter.id] ?? 0).toLocaleString()}</small>
                      </button>
                      <button title="Rename chapter" onClick={() => renameChapter(chapter.id)}>
                        Rename
                      </button>
                      <button title="Delete chapter" onClick={() => void deleteChapter(chapter.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <button className="rules-button" onClick={() => void openRules()}>
              Writing Rules
            </button>
          </>
        )}
      </aside>

      <section className="editor-pane">
        {book && selectedChapter ? (
          <>
            <header className="editor-header">
              <input
                className="document-title"
                value={book.title}
                onChange={(event) => setBook({ ...book, title: event.target.value })}
                onBlur={() => void saveBookTitle()}
                aria-label="Document title"
              />
              <span className="chapter-crumb">{selectedChapter.title}</span>
              <span className="header-spacer" />
              <button
                className="icon-button"
                title="Find in chapter (Ctrl/Cmd+F)"
                aria-label="Find in chapter"
                onClick={() => {
                  setFindOpen(true)
                  window.setTimeout(() => findInputRef.current?.select(), 0)
                }}
              >
                <IcSearch />
              </button>
              <button
                className="icon-button"
                title="Version history"
                aria-label="Version history"
                onClick={() => setHistoryOpen(true)}
              >
                <IcHistory />
              </button>
            </header>
            <div className="docs-toolbar" aria-label="Document formatting toolbar">
              <div className="toolbar-group">
                <button
                  title="Undo (Ctrl/Cmd+Z)"
                  aria-label="Undo"
                  onClick={() => editor?.chain().focus().undo().run()}
                >
                  <IcUndo />
                </button>
                <button
                  title="Redo (Ctrl/Cmd+Y)"
                  aria-label="Redo"
                  onClick={() => editor?.chain().focus().redo().run()}
                >
                  <IcRedo />
                </button>
              </div>
              <div className="toolbar-group">
                <ToolbarMenu
                  title="Text style"
                  className="menu-trigger style-trigger"
                  trigger={
                    <>
                      {currentStyleLabel()} <IcChevronDown />
                    </>
                  }
                >
                  {[
                    ['normal', 'Normal text'],
                    ['title', 'Title'],
                    ['heading-1', 'Heading 1'],
                    ['heading-2', 'Heading 2'],
                    ['heading-3', 'Heading 3']
                  ].map(([value, label]) => (
                    <button key={value} className="menu-item" onClick={() => setStyle(value)}>
                      {label}
                    </button>
                  ))}
                </ToolbarMenu>
                <ToolbarMenu
                  title="Font family"
                  className="menu-trigger font-trigger"
                  trigger={
                    <>
                      {currentFontLabel()} <IcChevronDown />
                    </>
                  }
                >
                  {FONT_FAMILIES.map(([label, value]) => (
                    <button
                      key={label}
                      className="menu-item"
                      style={{ fontFamily: value }}
                      onClick={() => editor?.chain().focus().setFontFamily(value).run()}
                    >
                      {label}
                    </button>
                  ))}
                </ToolbarMenu>
                <ToolbarMenu
                  title="Font size"
                  className="menu-trigger size-trigger"
                  trigger={
                    <>
                      {currentSizeLabel()} <IcChevronDown />
                    </>
                  }
                >
                  {[10, 11, 12, 14, 16, 18, 24, 32].map((size) => (
                    <button
                      key={size}
                      className="menu-item"
                      onClick={() =>
                        editor
                          ?.chain()
                          .focus()
                          .setMark('textStyle', { fontSize: `${size}pt` })
                          .run()
                      }
                    >
                      {size}
                    </button>
                  ))}
                </ToolbarMenu>
              </div>
              <div className="toolbar-group">
                <button
                  title="Bold (Ctrl/Cmd+B)"
                  aria-label="Bold"
                  className={editor?.isActive('bold') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                >
                  <b>B</b>
                </button>
                <button
                  title="Italic (Ctrl/Cmd+I)"
                  aria-label="Italic"
                  className={editor?.isActive('italic') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                >
                  <i>I</i>
                </button>
                <button
                  title="Underline (Ctrl/Cmd+U)"
                  aria-label="Underline"
                  className={editor?.isActive('underline') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleUnderline().run()}
                >
                  <u>U</u>
                </button>
                <button
                  title="Strikethrough"
                  aria-label="Strikethrough"
                  className={editor?.isActive('strike') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleStrike().run()}
                >
                  <s>S</s>
                </button>
              </div>
              <div className="toolbar-group">
                <ToolbarMenu
                  title="Text color"
                  className="menu-trigger"
                  trigger={
                    <>
                      A<span className="color-bar text-color" />
                    </>
                  }
                >
                  <div className="color-palette">
                    {TEXT_COLORS.map((color) => (
                      <button
                        key={color}
                        title={color}
                        aria-label={`Text color ${color}`}
                        className="color-swatch"
                        style={{ background: color }}
                        onClick={() => editor?.chain().focus().setColor(color).run()}
                      />
                    ))}
                  </div>
                </ToolbarMenu>
                <ToolbarMenu
                  title="Highlight color"
                  className="menu-trigger"
                  trigger={
                    <>
                      <span className="highlight-glyph">H</span>
                      <span className="color-bar highlight-color" />
                    </>
                  }
                >
                  <div className="color-palette">
                    {HIGHLIGHT_COLORS.map((color) => (
                      <button
                        key={color}
                        title={color === '#ffffff' ? 'No highlight' : color}
                        aria-label={`Highlight ${color}`}
                        className="color-swatch"
                        style={{ background: color }}
                        onClick={() =>
                          color === '#ffffff'
                            ? editor?.chain().focus().unsetHighlight().run()
                            : editor?.chain().focus().toggleHighlight({ color }).run()
                        }
                      />
                    ))}
                  </div>
                </ToolbarMenu>
              </div>
              <div className="toolbar-group">
                <ToolbarMenu
                  title="Alignment"
                  className="menu-trigger"
                  trigger={
                    <>
                      {currentAlignIcon()} <IcChevronDown />
                    </>
                  }
                >
                  {(
                    [
                      ['left', 'Left', <IcAlignLeft key="l" />],
                      ['center', 'Center', <IcAlignCenter key="c" />],
                      ['right', 'Right', <IcAlignRight key="r" />],
                      ['justify', 'Justify', <IcAlignJustify key="j" />]
                    ] as const
                  ).map(([value, label, icon]) => (
                    <button
                      key={value}
                      className="menu-item"
                      onClick={() => editor?.chain().focus().setTextAlign(value).run()}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </ToolbarMenu>
                <ToolbarMenu
                  title="Line spacing"
                  className="menu-trigger"
                  trigger={
                    <>
                      ↕ <IcChevronDown />
                    </>
                  }
                >
                  {['1.0', '1.15', '1.5', '2.0'].map((spacing) => (
                    <button
                      key={spacing}
                      className="menu-item"
                      onClick={() => setLineSpacing(spacing)}
                    >
                      {spacing}
                    </button>
                  ))}
                </ToolbarMenu>
              </div>
              <div className="toolbar-group">
                <button
                  title="Bullet list"
                  aria-label="Bullet list"
                  className={editor?.isActive('bulletList') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                >
                  <IcBullets />
                </button>
                <button
                  title="Numbered list"
                  aria-label="Numbered list"
                  className={editor?.isActive('orderedList') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                >
                  <IcNumbers />
                </button>
                <button
                  title="Decrease indent"
                  aria-label="Decrease indent"
                  onClick={() => changeIndent(-1)}
                >
                  <IcOutdent />
                </button>
                <button
                  title="Increase indent"
                  aria-label="Increase indent"
                  onClick={() => changeIndent(1)}
                >
                  <IcIndent />
                </button>
                <button
                  title="Blockquote"
                  aria-label="Blockquote"
                  className={editor?.isActive('blockquote') ? 'is-active' : ''}
                  onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                >
                  <IcQuote />
                </button>
                <button
                  title="Clear formatting"
                  aria-label="Clear formatting"
                  onClick={() =>
                    editor?.chain().focus().unsetAllMarks().clearNodes().setTextAlign('left').run()
                  }
                >
                  <IcClearFormat />
                </button>
              </div>
            </div>
            {findOpen && (
              <div className="find-bar">
                <span className="find-icon" aria-hidden="true">
                  <IcSearch />
                </span>
                <input
                  ref={findInputRef}
                  autoFocus
                  value={findQuery}
                  placeholder="Find in this chapter"
                  aria-label="Find in this chapter"
                  onChange={(event) => setFindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeFind()
                    if (event.key === 'Enter')
                      applyFind(findQuery, findState.active + (event.shiftKey ? -1 : 1), true)
                  }}
                />
                <span className="find-count">
                  {findState.total ? `${findState.active + 1} of ${findState.total}` : 'No matches'}
                </span>
                <button
                  className="icon-button"
                  title="Previous match (Shift+Enter)"
                  aria-label="Previous match"
                  disabled={!findState.total}
                  onClick={() => applyFind(findQuery, findState.active - 1, true)}
                >
                  <IcArrowUp />
                </button>
                <button
                  className="icon-button"
                  title="Next match (Enter)"
                  aria-label="Next match"
                  disabled={!findState.total}
                  onClick={() => applyFind(findQuery, findState.active + 1, true)}
                >
                  <IcArrowDown />
                </button>
                <button
                  className="icon-button"
                  title="Close (Esc)"
                  aria-label="Close find"
                  onClick={closeFind}
                >
                  <IcClose />
                </button>
              </div>
            )}
            {conflictText && (
              <div className="conflict-banner">
                <span>Claude edited this chapter.</span>
                <button
                  onClick={() => {
                    loadingRef.current = true
                    editor?.commands.setContent(conflictText, false)
                    loadingRef.current = false
                    dirtyRef.current = false
                    setConflictText(null)
                  }}
                >
                  Reload
                </button>
                <button onClick={() => setConflictText(null)}>Keep mine</button>
              </div>
            )}
            {reviews.length > 0 && (
              <div className="review-strip">
                {reviews.map((entry) => (
                  <div key={entry.chapterId} className="review-item">
                    <span>
                      Claude changed {entry.chapterTitle} (+{entry.addedWords} / -
                      {entry.removedWords} words)
                    </span>
                    <button onClick={() => void showDiff(entry)}>View changes</button>
                    <button onClick={() => void undoReview(entry)}>Undo</button>
                  </div>
                ))}
              </div>
            )}
            <div className="editor-wrap">
              <EditorContent editor={editor} />
            </div>
            <footer className="editor-footer">
              {(chapterWords[selectedChapter.id] ?? 0).toLocaleString()} words
            </footer>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-glyph" aria-hidden="true">
              <IcBook size={44} />
            </span>
            <h2>Begin your book</h2>
            <p>Open a book from the list on the left, or give a new one a title and press New.</p>
          </div>
        )}
      </section>

      <aside className="chat-pane">
        <header>
          <div>
            <h2>Co-author</h2>
            <p>{claudeDetect.version ?? 'Claude connected'}</p>
          </div>
          {book && (
            <select value={book.model} onChange={(event) => void changeModel(event.target.value)}>
              {CLAUDE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
        </header>
        <div
          className="messages"
          ref={messagesRef}
          onScroll={(event) => {
            const el = event.currentTarget
            stickToBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
          }}
        >
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.speaker}`}>
              {message.speaker === 'claude-tool' ? (
                <span>{message.text}</span>
              ) : (
                <>
                  {(message.speaker === 'claude' || message.speaker === 'codex') && (
                    <span className="message-avatar" aria-hidden="true">
                      {message.speaker === 'claude' ? 'C' : 'X'}
                    </span>
                  )}
                  <span>{message.text}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <footer>
          <textarea
            value={chatText}
            onChange={(event) => setChatText(event.target.value)}
            placeholder="Ask Claude to revise, expand, or critique this chapter."
          />
          <div className="chat-actions">
            <button
              className="primary"
              disabled={!book || claudeRunning || !chatText.trim()}
              onClick={() => void sendClaude()}
            >
              {claudeRunning ? 'Claude is writing…' : 'Send to Claude'}
            </button>
            <button disabled={!book || !chatText.trim()} onClick={() => void sendCodex()}>
              Second opinion (Codex)
            </button>
          </div>
        </footer>
      </aside>

      {rulesOpen && (
        <div className="modal-backdrop">
          <section className="modal rules-modal">
            <header>
              <h2>Writing Rules</h2>
              <button onClick={() => setRulesOpen(false)}>Close</button>
            </header>
            <textarea value={rulesText} onChange={(event) => setRulesText(event.target.value)} />
            <footer>
              <button onClick={() => void saveRules()}>Save rules</button>
            </footer>
          </section>
        </div>
      )}
      {renameTarget && (
        <div className="modal-backdrop">
          <section className="modal rename-modal">
            <header>
              <h2>Rename chapter</h2>
              <button onClick={() => setRenameTarget(null)}>Close</button>
            </header>
            <input
              autoFocus
              value={renameTarget.title}
              aria-label="Chapter title"
              onChange={(event) => setRenameTarget({ ...renameTarget, title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveRename()
              }}
            />
            <footer>
              <button onClick={() => void saveRename()}>Save</button>
            </footer>
          </section>
        </div>
      )}
      {historyOpen && book && (
        <HistoryModal
          bookId={book.id}
          chapters={book.chapters}
          initialChapterId={selectedChapterId}
          onClose={() => setHistoryOpen(false)}
          onRestored={(chapterId) => void historyRestored(chapterId)}
        />
      )}
      {diff && (
        <div className="modal-backdrop">
          <section className="modal diff-modal">
            <header>
              <h2>{diff.chapterTitle}</h2>
              <button onClick={() => setDiff(null)}>Close</button>
            </header>
            <div className="diff-body">
              {diff.parts.map((part, index) => (
                <span key={index} className={part.added ? 'added' : part.removed ? 'removed' : ''}>
                  {part.value}
                </span>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
