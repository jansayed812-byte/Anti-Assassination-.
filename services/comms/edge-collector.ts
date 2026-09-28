/**
 * Edge Collector - SQLite WAL buffer for offline resilience
 */
import * as sqlite3 from 'sqlite3';
import { BaseEvent } from './event-contracts';
import { NatsService } from './nats-service';

interface CollectorConfig {
  databasePath?: string;
  bufferRetentionDays?: number;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class EdgeCollector {
  private db!: sqlite3.Database;
  private nats: NatsService;
  private config: Required<CollectorConfig>;
  private eventBuffer: BaseEvent[] = [];
  private flushInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(nats: NatsService, config: CollectorConfig = {}) {
    this.nats = nats;
    this.config = {
      databasePath: config.databasePath || './local-buffer.db',
      bufferRetentionDays: config.bufferRetentionDays || 7,
      batchSize: config.batchSize || 100,
      flushIntervalMs: config.flushIntervalMs || 5000
    };
  }

  async initialize(): Promise<void> {
    await this.setupDatabase();
    await this.setupEventBuffering();
    this.isInitialized = true;
  }

  private setupDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.config.databasePath, (err) => {
        if (err) { reject(err); return; }
        this.db.serialize(() => {
          this.db.run(`CREATE TABLE IF NOT EXISTS event_buffer (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, source_id TEXT NOT NULL, source_type TEXT NOT NULL, captured_at TEXT NOT NULL, received_at TEXT NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL, quality TEXT, integrity TEXT, sync_status TEXT DEFAULT 'pending', synced_at TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, retry_count INTEGER DEFAULT 0)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_sync_status ON event_buffer(sync_status)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_source_id ON event_buffer(source_id)`, () => resolve());
        });
      });
    });
  }

  private async setupEventBuffering(): Promise<void> {
    await this.cleanupOldEvents();
    this.flushInterval = setInterval(() => { this.flushBuffer().catch(console.error); }, this.config.flushIntervalMs);
    await this.syncPendingEvents();
  }

  async collectEvent(event: BaseEvent): Promise<void> {
    if (!this.isInitialized) throw new Error('EdgeCollector not initialized');
    this.eventBuffer.push(event);
    await this.saveEventToBuffer(event);
    if (this.eventBuffer.length >= this.config.batchSize) await this.flushBuffer();
  }

  private saveEventToBuffer(event: BaseEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR IGNORE INTO event_buffer (event_id, source_id, source_type, captured_at, received_at, sequence, payload, quality, integrity, sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [event.event_id, event.source_id, event.source_type, event.captured_at, event.received_at, event.sequence, JSON.stringify(event.payload), JSON.stringify(event.quality), JSON.stringify(event.integrity)],
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;
    const eventsToSync = [...this.eventBuffer];
    this.eventBuffer = [];
    for (const event of eventsToSync) {
      try {
        await this.nats.publishEvent(event);
        await this.markEventSynced(event.event_id);
      } catch {
        this.eventBuffer.push(event);
        await this.incrementRetryCount(event.event_id);
      }
    }
  }

  private syncPendingEvents(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM event_buffer WHERE sync_status = 'pending' ORDER BY created_at ASC LIMIT ?`, [this.config.batchSize], async (err, rows: any[]) => {
        if (err) { reject(err); return; }
        for (const row of rows) {
          const event: BaseEvent = { event_id: row.event_id, source_id: row.source_id, source_type: row.source_type, captured_at: row.captured_at, received_at: row.received_at, sequence: row.sequence, payload: JSON.parse(row.payload), quality: JSON.parse(row.quality || '{}'), integrity: JSON.parse(row.integrity || '{}') };
          try { await this.nats.publishEvent(event); await this.markEventSynced(event.event_id); } catch {}
        }
        resolve();
      });
    });
  }

  private markEventSynced(eventId: string): Promise<void> {
    return new Promise((resolve, reject) => { this.db.run(`UPDATE event_buffer SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP WHERE event_id = ?`, [eventId], (err) => err ? reject(err) : resolve()); });
  }

  private incrementRetryCount(eventId: string): Promise<void> {
    return new Promise((resolve, reject) => { this.db.run(`UPDATE event_buffer SET retry_count = retry_count + 1 WHERE event_id = ?`, [eventId], (err) => err ? reject(err) : resolve()); });
  }

  private cleanupOldEvents(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.config.bufferRetentionDays);
      this.db.run(`DELETE FROM event_buffer WHERE sync_status = 'synced' AND synced_at < ?`, [cutoff.toISOString()], (err) => err ? reject(err) : resolve());
    });
  }

  async getBufferStats(): Promise<Record<string, number>> {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT sync_status, COUNT(*) as count FROM event_buffer GROUP BY sync_status`, (err, rows: any[]) => {
        if (err) { reject(err); return; }
        const stats: Record<string, number> = { pending: 0, synced: 0, total: 0 };
        for (const row of rows) { stats[row.sync_status] = row.count; stats.total += row.count; }
        resolve(stats);
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) clearInterval(this.flushInterval);
    await this.flushBuffer();
    return new Promise((resolve, reject) => { this.db.close((err) => err ? reject(err) : resolve()); });
  }
}

export async function createTestCollector(nats: NatsService): Promise<EdgeCollector> {
  const collector = new EdgeCollector(nats, { databasePath: ':memory:', flushIntervalMs: 2000 });
  await collector.initialize();
  return collector;
}
