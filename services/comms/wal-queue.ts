/**
 * Phase 7: WAL Outbound Queue
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface WALEntry {
  id: number;
  topic: string;
  payload: string;
  created_at: number;
  attempts: number;
}

export class WALQueue {
  private db: ReturnType<typeof Database>;

  constructor(dbPath: string = '/tmp/wal-queue.db') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS wal_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);`);
  }

  enqueue(topic: string, payload: unknown): number {
    return this.db.prepare('INSERT INTO wal_queue (topic, payload, created_at, attempts) VALUES (?, ?, ?, 0)').run(topic, JSON.stringify(payload), Date.now()).lastInsertRowid as number;
  }

  dequeue(limit = 50): WALEntry[] {
    return this.db.prepare('SELECT * FROM wal_queue ORDER BY id ASC LIMIT ?').all(limit) as WALEntry[];
  }

  ack(id: number): void { this.db.prepare('DELETE FROM wal_queue WHERE id = ?').run(id); }
  incrementAttempts(id: number): void { this.db.prepare('UPDATE wal_queue SET attempts = attempts + 1 WHERE id = ?').run(id); }
  size(): number { return (this.db.prepare('SELECT COUNT(*) as cnt FROM wal_queue').get() as { cnt: number }).cnt; }
  close(): void { this.db.close(); }
}
