// Types shared between main and renderer processes.

export interface ChapterMeta {
  id: string
  title: string
}

/** Markdown remains the Claude-editable source; document preserves editor-only formatting. */
export interface ChapterContent {
  markdown: string
  document: Record<string, unknown> | null
}

export interface BookMeta {
  id: string
  title: string
  chapters: ChapterMeta[]
  claudeSessionId: string | null
  model: string
}

export interface BookSummary {
  id: string
  title: string
  updatedAt: number
}

export type ChatSpeaker = 'user' | 'claude' | 'claude-tool' | 'codex' | 'system'

export interface ChatMessage {
  id: string
  speaker: ChatSpeaker
  text: string
}

/** Events streamed from main -> renderer while a Claude or Codex turn runs. */
export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; label: string }
  | { kind: 'done'; ok: boolean; summary?: string }
  | { kind: 'error'; message: string }

export interface ReviewEntry {
  chapterId: string
  chapterTitle: string
  addedWords: number
  removedWords: number
  snapshotTs: string
}

export interface DetectResult {
  found: boolean
  path?: string
  version?: string
}

export interface TestConnectionResult {
  ok: boolean
  message: string
}

export interface DiffResult {
  chapterTitle: string
  parts: { value: string; added?: boolean; removed?: boolean }[]
}

// Sonnet 5 is natively 1M-context; the "[1m]" alias is rejected by headless `claude -p`
export const CLAUDE_MODELS = ['sonnet', 'opus'] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]
