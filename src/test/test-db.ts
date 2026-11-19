/**
 * Test-only helper: an in-memory SQLite database (Node 24's node:sqlite)
 * with migrations/0001_init.sql applied. D1 is SQLite, so schema + SQL
 * behaviour tested here matches production. NEVER a live D1 in tests.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db, DbStatement } from "../db";

class SqliteStatement implements DbStatement {
  private bound: unknown[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): DbStatement {
    this.bound = params;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const stmt = this.sqlite.prepare(this.sql);
    // Bound params arrive as unknown[] from the Db interface; node:sqlite
    // only accepts SQLInputValue, so narrow at the call site.
    const rows = stmt.all(...(this.bound as SQLInputValue[])) as unknown as T[];
    return { results: rows };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const stmt = this.sqlite.prepare(this.sql);
    const row = stmt.get(...(this.bound as SQLInputValue[])) as unknown as T | undefined;
    return row ?? null;
  }

  async run(): Promise<{ success: boolean; meta: { last_row_id: number | null; changes: number } }> {
    const stmt = this.sqlite.prepare(this.sql);
    const result = stmt.run(...(this.bound as SQLInputValue[]));
    return {
      success: true,
      meta: {
        last_row_id: result.lastInsertRowid === null ? null : Number(result.lastInsertRowid),
        changes: Number(result.changes),
      },
    };
  }
}

class SqliteDb implements Db {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): DbStatement {
    return new SqliteStatement(this.sqlite, sql);
  }
}

export interface TestDb {
  db: Db;
  sqlite: DatabaseSync;
  close(): void;
}

export function createTestDb(): TestDb {
  const sqlite = new DatabaseSync(":memory:");
  const migration1 = fileURLToPath(new URL("../../migrations/0001_init.sql", import.meta.url));
  const migration2 = fileURLToPath(new URL("../../migrations/0002_m2.sql", import.meta.url));
  const migration5 = fileURLToPath(new URL("../../migrations/0005_m5.sql", import.meta.url));
  const migration6 = fileURLToPath(new URL("../../migrations/0006_m6.sql", import.meta.url));
  const migration7 = fileURLToPath(new URL("../../migrations/0007_m7.sql", import.meta.url));
  // Applied in order, exactly as `wrangler d1 migrations apply` does.
  // (No 0003/0004 exist: M3 and M4 needed no schema change.)
  sqlite.exec(readFileSync(migration1, "utf8"));
  sqlite.exec(readFileSync(migration2, "utf8"));
  sqlite.exec(readFileSync(migration5, "utf8"));
  sqlite.exec(readFileSync(migration6, "utf8"));
  sqlite.exec(readFileSync(migration7, "utf8"));
  return {
    db: new SqliteDb(sqlite),
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}
