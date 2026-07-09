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
import { DocumentLayout, FontSize } from './editorExtensions'
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

function chapterLabel(index: number, title: string): string {
  return `${index + 1}. ${title}`
}

function markdownOf(editor: Editor): string {
  return (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown()
}

function restoreDocument(editor: Editor, document: Record<string, unknown>): void {
  const next = editor.schema.nodeFromJSON(document as unknown as JSONContent)
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content))
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

  const bookIdRef = useRef<string | null>(null)
  const selectedChapterIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const loadingRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const saveNowRef = useRef<() => Promise<void>>(async () => {})
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

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
          <h1>BookDesk</h1>
          <p>{totalWords.toLocaleString()} words</p>
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
                  <button className="chapter-main" onClick={() => void chooseChapter(chapter.id)}>
                    <span>{chapterLabel(index, chapter.title)}</span>
                    <small>{(chapterWords[chapter.id] ?? 0).toLocaleString()} words</small>
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
              <span>{selectedChapter.title}</span>
            </header>
            <div className="docs-toolbar" aria-label="Document formatting toolbar">
              <div className="toolbar-group">
                <button
                  title="Undo (Ctrl/Cmd+Z)"
                  aria-label="Undo"
                  onClick={() => editor?.chain().focus().undo().run()}
                >
                  ↶
                </button>
                <button
                  title="Redo (Ctrl/Cmd+Y)"
                  aria-label="Redo"
                  onClick={() => editor?.chain().focus().redo().run()}
                >
                  ↷
                </button>
              </div>
              <div className="toolbar-group toolbar-selects">
                <select
                  title="Text style"
                  aria-label="Text style"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) setStyle(event.target.value)
                    event.target.value = ''
                  }}
                >
                  <option value="" disabled>
                    Normal text
                  </option>
                  <option value="normal">Normal text</option>
                  <option value="title">Title</option>
                  <option value="heading-1">Heading 1</option>
                  <option value="heading-2">Heading 2</option>
                  <option value="heading-3">Heading 3</option>
                </select>
                <select
                  title="Font"
                  aria-label="Font family"
                  defaultValue=""
                  onChange={(event) =>
                    editor?.chain().focus().setFontFamily(event.target.value).run()
                  }
                >
                  <option value="" disabled>
                    Font
                  </option>
                  {FONT_FAMILIES.map(([label, value]) => (
                    <option key={label} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  title="Font size"
                  aria-label="Font size"
                  defaultValue=""
                  onChange={(event) =>
                    editor
                      ?.chain()
                      .focus()
                      .setMark('textStyle', { fontSize: event.target.value })
                      .run()
                  }
                >
                  <option value="" disabled>
                    Size
                  </option>
                  {[10, 11, 12, 14, 16, 18, 24, 32].map((size) => (
                    <option key={size} value={`${size}pt`}>
                      {size}
                    </option>
                  ))}
                </select>
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
              <div className="toolbar-group color-tools">
                <details>
                  <summary title="Text color" aria-label="Text color">
                    A<span className="color-bar text-color" />
                  </summary>
                  <div className="color-palette">
                    {TEXT_COLORS.map((color) => (
                      <button
                        key={color}
                        title={color}
                        aria-label={`Text color ${color}`}
                        className="color-swatch"
                        style={{ background: color }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => editor?.chain().focus().setColor(color).run()}
                      />
                    ))}
                  </div>
                </details>
                <details>
                  <summary title="Highlight color" aria-label="Highlight color">
                    ▰<span className="color-bar highlight-color" />
                  </summary>
                  <div className="color-palette">
                    {HIGHLIGHT_COLORS.map((color) => (
                      <button
                        key={color}
                        title={color}
                        aria-label={`Highlight ${color}`}
                        className="color-swatch"
                        style={{ background: color }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => editor?.chain().focus().toggleHighlight({ color }).run()}
                      />
                    ))}
                  </div>
                </details>
              </div>
              <div className="toolbar-group toolbar-selects">
                <select
                  title="Alignment"
                  aria-label="Alignment"
                  defaultValue="left"
                  onChange={(event) =>
                    editor?.chain().focus().setTextAlign(event.target.value).run()
                  }
                >
                  <option value="left">⇤</option>
                  <option value="center">≡</option>
                  <option value="right">⇥</option>
                  <option value="justify">☰</option>
                </select>
                <select
                  title="Line spacing"
                  aria-label="Line spacing"
                  defaultValue=""
                  onChange={(event) => setLineSpacing(event.target.value)}
                >
                  <option value="" disabled>
                    Spacing
                  </option>
                  {['1.0', '1.15', '1.5', '2.0'].map((spacing) => (
                    <option key={spacing} value={spacing}>
                      {spacing}
                    </option>
                  ))}
                </select>
              </div>
              <div className="toolbar-group">
                <button
                  title="Bullet list"
                  aria-label="Bullet list"
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                >
                  •≡
                </button>
                <button
                  title="Numbered list"
                  aria-label="Numbered list"
                  onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                >
                  1≡
                </button>
                <button
                  title="Decrease indent"
                  aria-label="Decrease indent"
                  onClick={() => changeIndent(-1)}
                >
                  ⇤
                </button>
                <button
                  title="Increase indent"
                  aria-label="Increase indent"
                  onClick={() => changeIndent(1)}
                >
                  ⇥
                </button>
                <button
                  title="Blockquote"
                  aria-label="Blockquote"
                  onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                >
                  ❝
                </button>
                <button
                  title="Clear formatting"
                  aria-label="Clear formatting"
                  onClick={() =>
                    editor?.chain().focus().unsetAllMarks().clearNodes().setTextAlign('left').run()
                  }
                >
                  Tx
                </button>
              </div>
            </div>
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
            <h2>Start with a book</h2>
            <p>Create a book or open one from the list.</p>
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
              disabled={!book || claudeRunning || !chatText.trim()}
              onClick={() => void sendClaude()}
            >
              {claudeRunning ? 'Claude is writing...' : 'Send to Claude'}
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
