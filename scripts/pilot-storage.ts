import { DatabaseSync } from "node:sqlite";
import type { EpisodeDatabase } from "../lib/episode-v2/persistence.ts";

/** Workspace synchronization can replace a database inode between provider polls. */
export function withPilotDatabase<T>(path: string, operation: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path);
  try { return operation(database); } finally { database.close(); }
}

export function createPilotDatabase(path: string): EpisodeDatabase {
  withPilotDatabase(path, database => database.exec("CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)"));
  return { prepare(sql) {
    let params: (string | number | null)[] = [];
    const query = {
      bind(...bound: (string | number | null)[]) { params = bound; return query; },
      async first<T>() { return withPilotDatabase(path, database => (database.prepare(sql).get(...params) ?? null) as T | null); },
      async run() { return withPilotDatabase(path, database => ({ meta: { changes: Number(database.prepare(sql).run(...params).changes) } })); },
    };
    return query;
  } };
}
