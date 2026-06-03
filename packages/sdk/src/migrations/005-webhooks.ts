import type Database from 'better-sqlite3';

export const version = 6;
export const name = 'adding webhooks table';

export const up = (db: Database): void => {
  db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_triggered_at INTEGER,
        failure_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);
      CREATE INDEX IF NOT EXISTS idx_webhooks_created_at ON webhooks(created_at);
  `);
};
