import { dialog, net, shell } from 'electron'

// package.json version, baked in at build time (see electron.vite.config.ts).
// app.getVersion() is wrong when unpackaged — it returns Electron's own version.
declare const __APP_VERSION__: string

function appVersion(): string {
  return __APP_VERSION__
}

// BOOKDESK_UPDATE_REPO env var overrides it (used by tests; harmless otherwise).
export const UPDATE_REPO = process.env.BOOKDESK_UPDATE_REPO || 'claudechannel12345-del/bookdesk'

function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/**
 * Notify-and-open-browser update check against the latest GitHub Release.
 * No electron-updater / code signing involved (Mac build is unsigned).
 * interactive=false (launch check): fully silent when unset, offline, or up to date.
 */
export async function checkForUpdates(interactive: boolean): Promise<void> {
  if (!UPDATE_REPO) {
    if (interactive)
      await dialog.showMessageBox({ message: 'Update checks are not configured for this build.' })
    return
  }
  try {
    const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
    const release = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = (release.tag_name ?? '').replace(/^v/, '')
    if (!latest) throw new Error('release has no tag')
    if (isNewer(latest, appVersion())) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        message: `Version ${latest} available`,
        detail: `You have ${appVersion()}. Download the new version from GitHub?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      if (response === 0 && release.html_url) void shell.openExternal(release.html_url)
    } else if (interactive) {
      await dialog.showMessageBox({ message: `You're up to date (${appVersion()}).` })
    }
  } catch (error) {
    if (interactive)
      await dialog.showMessageBox({
        type: 'warning',
        message: 'Could not check for updates.',
        detail: String(error)
      })
    // launch check: stay silent (offline, rate-limited, etc.)
  }
}
