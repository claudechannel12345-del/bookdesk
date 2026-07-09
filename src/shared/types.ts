// Types shared between main and renderer processes.

export interface ChapterMeta {
  id: string
  title: string
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

export const CLAUDE_MODELS = ['sonnet[1m]', 'opus[1m]'] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]
