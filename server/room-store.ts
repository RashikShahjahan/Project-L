import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GameState } from '../src/game/state.js'

export interface StoredRoom {
  code: string
  hostPlayerId: string
  seats: { playerId: string; name: string; token: string }[]
  state: GameState | null
  revision: number
  lastActivity: number
  decisions: [string, { fingerprint: string; revision: number }][]
}

/** One row per room keeps game changes and command retry receipts atomic. */
export class RoomStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS rooms (
          code TEXT PRIMARY KEY,
          last_activity INTEGER NOT NULL,
          data TEXT NOT NULL CHECK (json_valid(data))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS rooms_last_activity ON rooms(last_activity);
        CREATE TABLE IF NOT EXISTS feedback (
          id INTEGER PRIMARY KEY,
          message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 5000),
          created_at INTEGER NOT NULL
        ) STRICT;
      `)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  get(code: string): StoredRoom | undefined {
    const row = this.db.prepare('SELECT data FROM rooms WHERE code = ?').get(code)
    return row ? JSON.parse(row.data as string) as StoredRoom : undefined
  }

  save(room: StoredRoom): void {
    this.db.prepare(`
      INSERT INTO rooms (code, last_activity, data) VALUES (?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET last_activity = excluded.last_activity, data = excluded.data
    `).run(room.code, room.lastActivity, JSON.stringify(room))
  }

  delete(code: string): void { this.db.prepare('DELETE FROM rooms WHERE code = ?').run(code) }

  deleteExpired(before: number): string[] {
    return this.db.prepare('DELETE FROM rooms WHERE last_activity < ? RETURNING code').all(before).map((row) => row.code as string)
  }

  count(): number { return this.db.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count as number }
  saveFeedback(message: string, createdAt: number): void {
    this.db.prepare('INSERT INTO feedback (message, created_at) VALUES (?, ?)').run(message, createdAt)
  }
  close(): void { if (this.db.isOpen) this.db.close() }
}
