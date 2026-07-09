import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentEvent,
  BookMeta,
  BookSummary,
  ChapterContent,
  DetectResult,
  DiffResult,
  ReviewEntry,
  TestConnectionResult
} from '../shared/types'

function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  books: {
    list: (): Promise<BookSummary[]> => ipcRenderer.invoke('books:list'),
    create: (title: string): Promise<BookMeta> => ipcRenderer.invoke('books:create', title),
    rename: (bookId: string, title: string): Promise<BookMeta> =>
      ipcRenderer.invoke('books:rename', bookId, title),
    open: (bookId: string): Promise<BookMeta> => ipcRenderer.invoke('books:open', bookId),
    setActive: (bookId: string | null): Promise<void> =>
      ipcRenderer.invoke('books:setActive', bookId)
  },
  chapters: {
    add: (bookId: string, title: string): Promise<BookMeta> =>
      ipcRenderer.invoke('chapters:add', bookId, title),
    rename: (bookId: string, chapterId: string, title: string): Promise<BookMeta> =>
      ipcRenderer.invoke('chapters:rename', bookId, chapterId, title),
    delete: (bookId: string, chapterId: string): Promise<BookMeta> =>
      ipcRenderer.invoke('chapters:delete', bookId, chapterId),
    reorder: (bookId: string, orderedIds: string[]): Promise<BookMeta> =>
      ipcRenderer.invoke('chapters:reorder', bookId, orderedIds),
    read: (bookId: string, chapterId: string): Promise<string> =>
      ipcRenderer.invoke('chapters:read', bookId, chapterId),
    readContent: (bookId: string, chapterId: string): Promise<ChapterContent> =>
      ipcRenderer.invoke('chapters:readContent', bookId, chapterId),
    write: (bookId: string, chapterId: string, markdown: string): Promise<void> =>
      ipcRenderer.invoke('chapters:write', bookId, chapterId, markdown),
    writeContent: (
      bookId: string,
      chapterId: string,
      markdown: string,
      document: Record<string, unknown>
    ): Promise<void> =>
      ipcRenderer.invoke('chapters:writeContent', bookId, chapterId, markdown, document)
  },
  writingRules: {
    read: (bookId: string): Promise<string> => ipcRenderer.invoke('writingRules:read', bookId),
    write: (bookId: string, text: string): Promise<void> =>
      ipcRenderer.invoke('writingRules:write', bookId, text)
  },
  settings: {
    setModel: (bookId: string, model: string): Promise<void> =>
      ipcRenderer.invoke('settings:setModel', bookId, model)
  },
  detect: {
    claude: (): Promise<DetectResult> => ipcRenderer.invoke('detect:claude'),
    codex: (): Promise<DetectResult> => ipcRenderer.invoke('detect:codex'),
    testClaude: (): Promise<TestConnectionResult> => ipcRenderer.invoke('detect:testClaude')
  },
  claude: {
    send: (bookId: string, prompt: string): Promise<{ started: boolean }> =>
      ipcRenderer.invoke('claude:send', bookId, prompt),
    onEvent: (cb: (payload: { bookId: string; event: AgentEvent }) => void) =>
      on('claude:event', cb),
    onReview: (cb: (payload: { bookId: string; entries: ReviewEntry[] }) => void) =>
      on('claude:review', cb)
  },
  codex: {
    send: (bookId: string, prompt: string): Promise<{ started: boolean }> =>
      ipcRenderer.invoke('codex:send', bookId, prompt),
    onEvent: (cb: (payload: { bookId: string; event: AgentEvent }) => void) => on('codex:event', cb)
  },
  review: {
    list: (bookId: string): Promise<ReviewEntry[]> => ipcRenderer.invoke('review:list', bookId),
    diff: (bookId: string, chapterId: string): Promise<DiffResult | null> =>
      ipcRenderer.invoke('review:diff', bookId, chapterId),
    undo: (bookId: string, chapterId: string): Promise<void> =>
      ipcRenderer.invoke('review:undo', bookId, chapterId),
    dismiss: (bookId: string, chapterId: string): Promise<void> =>
      ipcRenderer.invoke('review:dismiss', bookId, chapterId)
  },
  history: {
    list: (bookId: string): Promise<{ ts: string; chapterIds: string[] }[]> =>
      ipcRenderer.invoke('history:list', bookId),
    read: (bookId: string, ts: string, chapterId: string): Promise<string> =>
      ipcRenderer.invoke('history:read', bookId, ts, chapterId),
    restore: (bookId: string, ts: string, chapterId: string): Promise<void> =>
      ipcRenderer.invoke('history:restore', bookId, ts, chapterId)
  },
  importDocx: (bookId: string): Promise<{ chaptersCreated: number } | null> =>
    ipcRenderer.invoke('import:docx', bookId),
  onChapterExternalChange: (
    cb: (payload: { bookId: string; chapterId: string; content: string }) => void
  ) => on('chapter:external-change', cb),
  onBookReload: (cb: (payload: { bookId: string }) => void) => on('book:reload', cb)
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
