import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let db: Database.Database | null = null;
let currentDbPath: string | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS personality_rooms (
  id TEXT PRIMARY KEY,
  owner_name TEXT,
  archetype_id TEXT NOT NULL,
  room_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personality_rooms_archetype ON personality_rooms(archetype_id);

CREATE TABLE IF NOT EXISTS personality_room_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(room_id) REFERENCES personality_rooms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_personality_room_events_room ON personality_room_events(room_id, created_at);
`;

export function initDatabase(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ?? process.env.DB_PATH ?? path.resolve("data/personality-escape-station.db");

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  currentDbPath = resolvedPath;
  db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function getDbPath(): string {
  if (!currentDbPath) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return currentDbPath;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
