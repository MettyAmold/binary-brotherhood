// Dünne Helfer um D1: typisierte Abfragen, Inserts mit ID, Zeitstempel.
import type { Hub } from "./hub";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  HUB: DurableObjectNamespace<Hub>;
  APP_NAME: string;
}

export const now = () => Date.now();

export class Db {
  constructor(public d1: D1Database) {}
  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const r = await this.d1.prepare(sql).bind(...params).all<T>();
    return r.results ?? [];
  }
  async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (await this.d1.prepare(sql).bind(...params).first<T>()) ?? null;
  }
  async run(sql: string, ...params: unknown[]): Promise<D1Result> {
    return this.d1.prepare(sql).bind(...params).run();
  }
  async insert(sql: string, ...params: unknown[]): Promise<number> {
    const r = await this.d1.prepare(sql).bind(...params).run();
    return Number(r.meta.last_row_id);
  }
  /** Mehrere Statements in einem Batch (eine Transaktion). */
  async batch(stmts: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (!stmts.length) return;
    await this.d1.batch(stmts.map(s => this.d1.prepare(s.sql).bind(...(s.params ?? []))));
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
