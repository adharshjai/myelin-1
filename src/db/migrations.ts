/** Inline SQL migrations, applied in order. Never edit an entry after it ships: append a new one. */

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_jobs',
    sql: `
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  description_text TEXT NOT NULL DEFAULT '',
  posted_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- When a run handed this posting to its caller. NULL: stored, not yet reported.
  reported_at TEXT,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_jobs_url ON jobs (url);
CREATE INDEX idx_jobs_external ON jobs (source, external_id);
`,
  },
]
