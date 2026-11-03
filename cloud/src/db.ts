// Dünne Helfer um die SQLite-Datenbank eines Realms (Durable Object Storage): typisierte Abfragen,
// Inserts mit ID, Transaktionen. Jeder Realm hat seine eigene, vollständig getrennte Datenbank.
import type { Realm } from "./realm";

export interface Env {
  /** Realm-Verzeichnis (und Altbestand aus der Zeit vor den Realms) */
  DB: D1Database;
  ASSETS: Fetcher;
  REALM: DurableObjectNamespace<Realm>;
  APP_NAME: string;
}

export const now = () => Date.now();

/** DO-SQLite kennt keine Booleans und keine Typed Arrays als Parameter. */
const bindable = (v: unknown): SqlStorageValue => {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  return v as SqlStorageValue;
};

export interface RunResult { meta: { changes: number; last_row_id: number } }

export class Db {
  constructor(private storage: DurableObjectStorage) {}
  private get sql() { return this.storage.sql; }

  private exec(sql: string, params: unknown[]) {
    return this.sql.exec(sql, ...params.map(bindable));
  }
  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.exec(sql, params).toArray() as T[];
  }
  async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
    const rows = this.exec(sql, params).toArray();
    return (rows[0] as T) ?? null;
  }
  runSync(sql: string, params: unknown[] = []): RunResult {
    const c = this.exec(sql, params);
    c.toArray();
    const changes = c.rowsWritten;
    const id = Number((this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id);
    return { meta: { changes, last_row_id: id } };
  }
  async run(sql: string, ...params: unknown[]): Promise<RunResult> { return this.runSync(sql, params); }
  async insert(sql: string, ...params: unknown[]): Promise<number> { return this.runSync(sql, params).meta.last_row_id; }
  /** Mehrere Statements in einer Transaktion. */
  async batch(stmts: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (!stmts.length) return;
    this.storage.transactionSync(() => { for (const s of stmts) this.runSync(s.sql, s.params ?? []); });
  }
  async setting(key: string): Promise<string | null> {
    const r = await this.first<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
    return r?.value ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    await this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }
}

export const bool = (v: unknown) => v === 1 || v === true || v === "1";
export const nul = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);
