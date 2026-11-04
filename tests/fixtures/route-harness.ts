import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const routeEnv: Record<string, any> = {};
(globalThis as any).__routeTestEnv = routeEnv;

export function createRouteHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)');
  sqlite.exec(readFileSync(new URL('../../drizzle/0001_episode_allowances.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql: string) {
    let values: any[] = [];
    const statement = {
      bind(...bound: any[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
    };
    return statement;
  } };
  const objects = new Map<string, { bytes: Uint8Array; httpMetadata?: Record<string, string> }>();
  const BUCKET = {
    async put(key: string, value: string | Uint8Array | ArrayBuffer, options?: any) {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { bytes, httpMetadata: options?.httpMetadata }); return {};
    },
    async head(key: string) { const object = objects.get(key); return object ? { size: object.bytes.length, httpMetadata: object.httpMetadata } : null; },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const object = objects.get(key); if (!object) return null;
      const bytes = options?.range ? object.bytes.slice(options.range.offset, options.range.offset + options.range.length) : object.bytes;
      return { body: bytes, size: bytes.length, async text() { return new TextDecoder().decode(bytes); }, async arrayBuffer() { return bytes.slice().buffer; } };
    },
  };
  for (const key of Object.keys(routeEnv)) delete routeEnv[key];
  Object.assign(routeEnv, { DB, BUCKET, OPENAI_API_KEY: 'offline-fixture-only', V2_TEXT_PILOT_ENABLED: 'true', EPISODE_OWNER_USER_ID: 'route-owner' });
  return {
    sqlite, DB, BUCKET,
    job(id: string): any { const row = sqlite.prepare('SELECT job_json FROM episodes WHERE id = ?').get(id) as any; return row ? JSON.parse(row.job_json) : null; },
    update(job: any) { sqlite.prepare('UPDATE episodes SET job_json = ?, status = ? WHERE id = ?').run(JSON.stringify(job), job.status, job.id); },
    active(userId = 'route-owner') { return sqlite.prepare('SELECT id FROM episodes WHERE active_user_id = ?').get(userId); },
    close() { sqlite.close(); },
  };
}
export function routeRequest(path = '/api/episodes', options: { method?: string; body?: unknown; user?: string | null; origin?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: options.origin ?? 'https://podcast.test', ...options.headers };
  if (options.user !== null) headers['oai-authenticated-user-id'] = options.user ?? 'route-owner';
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://podcast.test${path}`, { method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
}
export const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });
