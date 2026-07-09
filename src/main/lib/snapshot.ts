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
