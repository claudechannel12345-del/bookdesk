import fs from 'fs/promises'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { chaptersDir, snapshotsDir } from './paths'

/** Copies every chapter .md file into .snapshots/<timestamp>/ and returns the timestamp id. */
export async function snapshotAll(bookId: string): Promise<string> {
  const ts = String(Date.now())
  const dest = join(snapshotsDir(bookId), ts)
  mkdirSync(dest, { recursive: true })
  const dir = chaptersDir(bookId)
  if (existsSync(dir)) {
    const files = await fs.readdir(dir)
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      await fs.copyFile(join(dir, file), join(dest, file))
    }
  }
  return ts
}

/** Newest-first snapshot list: timestamp id + which chapter files it contains. */
export async function listSnapshots(
  bookId: string
): Promise<{ ts: string; chapterIds: string[] }[]> {
  const root = snapshotsDir(bookId)
  if (!existsSync(root)) return []
  const dirs = (await fs.readdir(root)).filter((d) => /^\d+$/.test(d))
  dirs.sort((a, b) => Number(b) - Number(a))
  const out: { ts: string; chapterIds: string[] }[] = []
  for (const ts of dirs.slice(0, 100)) {
    // ponytail: cap at 100 newest; add pruning if .snapshots ever gets heavy
    const files = await fs.readdir(join(root, ts))
    out.push({ ts, chapterIds: files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) })
  }
  return out
}

export async function readSnapshotChapter(
  bookId: string,
  ts: string,
  chapterId: string
): Promise<string> {
  try {
    return await fs.readFile(join(snapshotsDir(bookId), ts, `${chapterId}.md`), 'utf8')
  } catch {
    return ''
  }
}

/** Restores one chapter file from a snapshot (per-file undo). */
export async function restoreChapterFromSnapshot(
  bookId: string,
  ts: string,
  chapterId: string
): Promise<void> {
  const content = await readSnapshotChapter(bookId, ts, chapterId)
  await fs.writeFile(join(chaptersDir(bookId), `${chapterId}.md`), content, 'utf8')
}
