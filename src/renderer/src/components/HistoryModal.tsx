import { useCallback, useEffect, useState } from 'react'
import type { ChapterMeta } from '../../../shared/types'

interface Snapshot {
  ts: string
  chapterIds: string[]
}

function snapshotLabel(ts: string): string {
  return new Date(Number(ts)).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * Version history: browse the .snapshots/ folder (one snapshot before every
 * Claude edit and every restore), preview a chapter's old text, restore it.
 */
export function HistoryModal(props: {
  bookId: string
  chapters: ChapterMeta[]
  initialChapterId: string | null
  onClose: () => void
  onRestored: (chapterId: string) => void
}): React.JSX.Element {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const [selectedTs, setSelectedTs] = useState<string | null>(null)
  const [chapterId, setChapterId] = useState<string | null>(props.initialChapterId)
  const [preview, setPreview] = useState('')
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    void window.api.history.list(props.bookId).then((list) => {
      setSnapshots(list)
      if (list.length > 0) setSelectedTs(list[0].ts)
    })
  }, [props.bookId])

  const snapshot = snapshots?.find((s) => s.ts === selectedTs) ?? null
  // only chapters that both still exist and were in this snapshot
  const availableChapters = props.chapters.filter((c) => snapshot?.chapterIds.includes(c.id))
  const effectiveChapterId =
    chapterId && availableChapters.some((c) => c.id === chapterId)
      ? chapterId
      : (availableChapters[0]?.id ?? null)

  useEffect(() => {
    if (!selectedTs || !effectiveChapterId) {
      setPreview('')
      return
    }
    void window.api.history
      .read(props.bookId, selectedTs, effectiveChapterId)
      .then((text) => setPreview(text))
  }, [props.bookId, selectedTs, effectiveChapterId])

  const restore = useCallback(async () => {
    if (!selectedTs || !effectiveChapterId || restoring) return
    setRestoring(true)
    await window.api.history.restore(props.bookId, selectedTs, effectiveChapterId)
    props.onRestored(effectiveChapterId)
  }, [props, selectedTs, effectiveChapterId, restoring])

  return (
    <div className="modal-backdrop">
      <section className="modal history-modal">
        <header>
          <h2>Version history</h2>
          <button onClick={props.onClose}>Close</button>
        </header>
        {snapshots !== null && snapshots.length === 0 ? (
          <div className="history-empty">
            <p>No versions saved yet.</p>
            <p>
              A version is saved automatically every time Claude edits your book, and every time you
              restore an older version.
            </p>
          </div>
        ) : (
          <div className="history-body">
            <ol className="history-list">
              {(snapshots ?? []).map((s) => (
                <li key={s.ts}>
                  <button
                    className={s.ts === selectedTs ? 'is-active' : ''}
                    onClick={() => setSelectedTs(s.ts)}
                  >
                    {snapshotLabel(s.ts)}
                  </button>
                </li>
              ))}
            </ol>
            <div className="history-preview">
              <div className="history-preview-bar">
                <select
                  aria-label="Chapter"
                  value={effectiveChapterId ?? ''}
                  onChange={(event) => setChapterId(event.target.value)}
                >
                  {availableChapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  disabled={!effectiveChapterId || restoring}
                  onClick={() => void restore()}
                >
                  {restoring ? 'Restoring…' : 'Restore this version'}
                </button>
              </div>
              <div className="history-text">
                {preview ||
                  (effectiveChapterId
                    ? 'This chapter was empty at this point.'
                    : 'This version has no chapters to show.')}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
