/** Minimal D1 wrapper. Values are always bound parameters — never interpolated. */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export interface DbStatement {
  bind(...params: unknown[]): DbStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: { last_row_id: number | null; changes: number } }>;
}

export interface Db {
  prepare(sql: string): DbStatement;
}

class D1Statement implements DbStatement {
  constructor(private readonly stmt: D1PreparedStatement) {}

  bind(...params: unknown[]): DbStatement {
    return new D1Statement(this.stmt.bind(...params));
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const result = await this.stmt.all<T>();
    return { results: result.results ?? [] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = await this.stmt.first<T>();
    return row ?? null;
  }

  async run(): Promise<{ success: boolean; meta: { last_row_id: number | null; changes: number } }> {
    const result = await this.stmt.run();
    return {
      success: result.success,
      meta: {
        last_row_id: result.meta?.last_row_id ?? null,
        changes: result.meta?.changes ?? 0,
      },
    };
  }
}

/** Adapt a real Cloudflare D1Database to the Db interface used by services. */
export function adaptD1(d1: D1Database): Db {
  return {
    prepare(sql: string): DbStatement {
      return new D1Statement(d1.prepare(sql));
    },
  };
}

export async function queryAll<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function queryOne<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function execRun(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<{ lastRowId: number | null; changes: number }> {
  const result = await db.prepare(sql).bind(...params).run();
  return { lastRowId: result.meta.last_row_id, changes: result.meta.changes };
}

/** Current UTC time as an ISO-8601 string (the only date format stored in D1). */
export function nowIso(): string {
  return new Date().toISOString();
}
