import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { MIGRATIONS } from './migrations'

export const DEFAULT_DB_PATH = 'data/jobs.db'

let db: Database.Database | null = null
let dbPath = process.env.MYELIN_DB || DEFAULT_DB_PATH

/** Point the store at another file (or ':memory:'). Closes any open database. */
export function useDb(path: string): void {
  closeDb()
  dbPath = path
}

/** The file the store is pointed at. */
export function dbFile(): string {
  return dbPath
}

export function getDb(): Database.Database {
  if (!db) {
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true })
    const opened = new Database(dbPath)
    try {
      opened.pragma('journal_mode = WAL')
      migrate(opened)
    } catch (err) {
      // Never hand out a database its migrations did not finish on.
      opened.close()
      throw err
    }
    db = opened
  }
  return db
}

function migrate(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  )
  const applied = new Set(
    db.prepare(`SELECT name FROM _migrations`).all().map((r) => (r as { name: string }).name),
  )
  const record = db.prepare(
    `INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))`,
  )
  for (const { name, sql } of MIGRATIONS) {
    if (applied.has(name)) continue
    db.transaction(() => {
      db.exec(sql)
      record.run(name)
    })()
  }
}

export function closeDb(): void {
  db?.close()
  db = null
}
