import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
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

function id(): string {
  return Math.random().toString(36).slice(2)
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function chapterLabel(index: number, title: string): string {
  return `${index + 1}. ${title}`
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

  const bookIdRef = useRef<string | null>(null)
  const selectedChapterIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const loadingRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const saveNowRef = useRef<() => Promise<void>>(async () => {})

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false }),
      Markdown.configure({ html: false })
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'editor-page'
      }
    },
    onUpdate: ({ editor }) => {
      if (loadingRef.current) return
      dirtyRef.current = true
      const markdown = (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown()
      const chapterId = selectedChapterIdRef.current
      if (chapterId) setChapterWords((words) => ({ ...words, [chapterId]: wordCount(markdown) }))
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        void saveNowRef.current()
      }, 2000)
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
          if (last?.speaker === speaker) {
            return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
          }
          return [...items, { id: id(), speaker, text: event.text }]
        })
        return
      }
      if (event.kind === 'tool') appendMessage('claude-tool', event.label)
      if (event.kind === 'done') {
        setClaudeRunning(false)
        if (event.summary && speaker === 'claude') appendMessage('system', 'Claude finished.')
      }
      if (event.kind === 'error') {
        setClaudeRunning(false)
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

  const refreshBooks = useCallback(async () => {
    setBooks(await window.api.books.list())
  }, [])

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
    const markdown = (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown()
    await window.api.chapters.write(bookIdRef.current, selectedChapterIdRef.current, markdown)
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
      const markdown = await window.api.chapters.read(bookIdRef.current, chapterId)
      loadingRef.current = true
      editor.commands.setContent(markdown, false)
      loadingRef.current = false
      dirtyRef.current = false
      setChapterWords((words) => ({ ...words, [chapterId]: wordCount(markdown) }))
    },
    [editor]
  )

  useEffect(() => {
    void refreshBooks()
    void window.api.detect.claude().then(setClaudeDetect)
    void window.api.detect.codex().then(setCodexDetect)
  }, [refreshBooks])

  useEffect(() => {
    if (!selectedChapterId || !editor) return
    void loadChapter(selectedChapterId)
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
    const title = newBookTitle.trim() || 'Untitled Book'
    const nextBook = await window.api.books.create(title)
    await refreshBooks()
    await openBook(nextBook.id)
  }

  async function chooseChapter(chapterId: string): Promise<void> {
    await saveNow()
    await loadChapter(chapterId)
  }

  async function addChapter(): Promise<void> {
    if (!book) return
    const title = window.prompt('Chapter title', `Chapter ${book.chapters.length + 1}`)
    if (!title) return
    const nextBook = await window.api.chapters.add(book.id, title)
    setBook(nextBook)
    await loadWordCounts(nextBook)
    await loadChapter(nextBook.chapters[nextBook.chapters.length - 1].id)
  }

  async function renameChapter(chapterId: string): Promise<void> {
    if (!book) return
    const chapter = book.chapters.find((item) => item.id === chapterId)
    const title = window.prompt('Chapter title', chapter?.title ?? '')
    if (!title) return
    setBook(await window.api.chapters.rename(book.id, chapterId, title))
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
    const nextBook = await window.api.chapters.reorder(
      book.id,
      chapters.map((chapter) => chapter.id)
    )
    setBook(nextBook)
    setDraggingChapterId(null)
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
      appendMessage(
        'system',
        'Codex is optional. Install the codex CLI to use Second opinion; this app will keep working without it.'
      )
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
    if (!book) return
    setDiff(await window.api.review.diff(book.id, entry.chapterId))
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
    const result = await window.api.detect.testClaude()
    setSetupMessage(result.message)
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
            <button
              onClick={() =>
                void window.api.detect.claude().then((result) => {
                  setClaudeDetect(result)
                  if (result.found) setNeedsClaudeSetup(false)
                })
              }
            >
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
            <input value={newBookTitle} onChange={(event) => setNewBookTitle(event.target.value)} />
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
                  <button title="Rename chapter" onClick={() => void renameChapter(chapter.id)}>
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
              <div>
                <p>{book.title}</p>
                <h2>{selectedChapter.title}</h2>
              </div>
              <div className="toolbar">
                <button onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
                  H1
                </button>
                <button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
                  H2
                </button>
                <button onClick={() => editor?.chain().focus().toggleBold().run()}>B</button>
                <button onClick={() => editor?.chain().focus().toggleItalic().run()}>I</button>
                <button onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
                  Quote
                </button>
                <button onClick={() => editor?.chain().focus().toggleBulletList().run()}>
                  Bullets
                </button>
                <button onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
                  List
                </button>
              </div>
            </header>

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
        <div className="messages">
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
