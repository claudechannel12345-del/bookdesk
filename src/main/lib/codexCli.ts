import { spawn, spawnSync } from 'child_process'
import type { AgentEvent, DetectResult } from '../../shared/types'

const useShell = process.platform === 'win32'

export function detectCodex(): DetectResult {
  // Deliberately only asks the OS where the command is. The optional CLI is not started on launch.
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const res = spawnSync(lookup, ['codex'], { timeout: 10000, windowsHide: true })
  if (res.status === 0) {
    const path = res.stdout.toString().split(/\r?\n/).find(Boolean)?.trim()
    if (path) return { found: true, path }
  }
  return { found: false }
}

export interface CodexTurnOptions {
  cwd: string
  prompt: string
  onEvent: (event: AgentEvent) => void
}

/** Codex is always read-only and never edits files (spec requirement). */
export function runCodexTurn(opts: CodexTurnOptions): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('codex', ['exec', '--sandbox', 'read-only', '-C', opts.cwd, opts.prompt], {
        shell: useShell,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      opts.onEvent({ kind: 'error', message: 'Could not start the codex CLI.' })
      resolve({ ok: false })
      return
    }

    let done = false
    let stderr = ''

    child.on('error', () => {
      if (done) return
      done = true
      opts.onEvent({ kind: 'error', message: 'Could not start the codex CLI. Is it installed?' })
      resolve({ ok: false })
    })

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      if (text.trim()) opts.onEvent({ kind: 'text', text })
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (done) return
      done = true
      const ok = code === 0
      if (!ok)
        opts.onEvent({ kind: 'error', message: stderr.trim() || `codex exited with code ${code}` })
      else opts.onEvent({ kind: 'done', ok: true })
      resolve({ ok })
    })
  })
}
