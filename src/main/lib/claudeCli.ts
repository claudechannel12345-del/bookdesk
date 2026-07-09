import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import type { AgentEvent, DetectResult, TestConnectionResult } from '../../shared/types'

const FALLBACK_PATHS =
  process.platform === 'win32'
    ? [
        join(
          process.env.APPDATA ?? '',
          'npm',
          'node_modules',
          '@anthropic-ai',
          'claude-code',
          'bin',
          'claude.exe'
        )
      ]
    : [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        `${process.env.HOME}/.claude/local/claude`
      ]

function tryVersion(bin: string): string | null {
  try {
    const res = spawnSync(bin, ['--version'], { timeout: 10000, windowsHide: true })
    if (res.status === 0) return res.stdout.toString().trim()
  } catch {
    // fall through
  }
  return null
}

export function detectClaude(): DetectResult {
  if (process.platform !== 'win32') {
    const version = tryVersion('claude')
    if (version) return { found: true, path: 'claude', version }
  }
  for (const candidate of FALLBACK_PATHS) {
    const v = tryVersion(candidate)
    if (v) return { found: true, path: candidate, version: v }
  }
  return { found: false }
}

function claudeBinary(): string {
  if (process.platform === 'win32') {
    const installed = FALLBACK_PATHS.find((candidate) => existsSync(candidate))
    if (installed) return installed
  }
  return 'claude'
}

function describeTool(name: string, input: Record<string, unknown>): string {
  const file = typeof input.file_path === 'string' ? basename(input.file_path) : ''
  switch (name) {
    case 'Edit':
    case 'Write':
      return file ? `Editing ${file}…` : 'Editing a file…'
    case 'Read':
      return file ? `Reading ${file}…` : 'Reading a file…'
    case 'Glob':
    case 'Grep':
      return 'Searching the book…'
    default:
      return `Using ${name}…`
  }
}

const APPEND_SYSTEM_PROMPT =
  'You are a co-author/editor inside a book-writing app. The book is the markdown files in chapters/. ' +
  "Make edits directly to those files when asked. Keep the author's voice. " +
  'Never touch book.json, .snapshots, CLAUDE.md, or .bookdesk-format.'

export interface ClaudeTurnOptions {
  cwd: string
  prompt: string
  model: string
  resumeSessionId?: string | null
  onEvent: (event: AgentEvent) => void
}

export interface ClaudeTurnResult {
  ok: boolean
  sessionId: string | null
}

export function runClaudeTurn(opts: ClaudeTurnOptions): Promise<ClaudeTurnResult> {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep',
    '--append-system-prompt',
    APPEND_SYSTEM_PROMPT
  ]
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(claudeBinary(), args, {
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      opts.onEvent({ kind: 'error', message: 'Could not start the claude CLI.' })
      resolve({ ok: false, sessionId: null })
      return
    }

    let sessionId: string | null = null
    let done = false
    let buffer = ''
    let stderr = ''

    child.on('error', () => {
      if (done) return
      done = true
      opts.onEvent({ kind: 'error', message: 'Could not start the claude CLI. Is it installed?' })
      resolve({ ok: false, sessionId })
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        handleLine(line)
      }
    })

    function handleLine(line: string): void {
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line)
      } catch {
        return // ignore malformed/partial lines
      }

      if (obj.type === 'system' && obj.subtype === 'init') {
        sessionId = (obj.session_id as string) ?? sessionId
        return
      }

      if (obj.type === 'assistant') {
        const message = obj.message as { content?: unknown[] } | undefined
        for (const block of message?.content ?? []) {
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            opts.onEvent({ kind: 'text', text: b.text })
          } else if (b.type === 'tool_use' && typeof b.name === 'string') {
            opts.onEvent({
              kind: 'tool',
              label: describeTool(b.name, (b.input as Record<string, unknown>) ?? {})
            })
          }
        }
        return
      }

      if (obj.type === 'result') {
        done = true
        sessionId = (obj.session_id as string) ?? sessionId
        const ok = obj.is_error !== true
        opts.onEvent({
          kind: 'done',
          ok,
          summary: typeof obj.result === 'string' ? obj.result : undefined
        })
        resolve({ ok, sessionId })
      }
    }

    child.on('close', (code) => {
      if (done) return
      done = true
      const message = stderr.trim() || `claude exited with code ${code}`
      opts.onEvent({ kind: 'error', message })
      resolve({ ok: false, sessionId })
    })
  })
}

export function testConnection(): Promise<TestConnectionResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(
        claudeBinary(),
        [
          '-p',
          'Reply with exactly the single word: pong',
          '--output-format',
          'stream-json',
          '--verbose',
          '--model',
          'sonnet'
        ],
        { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch {
      resolve({ ok: false, message: 'Could not start the claude CLI.' })
      return
    }

    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c.toString()))
    child.stderr.on('data', (c) => (err += c.toString()))
    child.on('error', () => resolve({ ok: false, message: 'Could not start the claude CLI.' }))
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, message: err.trim() || `claude exited with code ${code}` })
        return
      }
      const resultLine = out
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return null
          }
        })
        .find((o) => o && o.type === 'result')
      if (resultLine && resultLine.is_error !== true) {
        resolve({
          ok: true,
          message: 'Connected. Claude replied: ' + String(resultLine.result).trim()
        })
      } else {
        resolve({
          ok: false,
          message: 'Claude did not respond as expected. Try logging in with `claude` in a terminal.'
        })
      }
    })
  })
}
