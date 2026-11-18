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
  const migrationPath = fileURLToPath(new URL("../../migrations/0001_init.sql", import.meta.url));
  sqlite.exec(readFileSync(migrationPath, "utf8"));
  return {
    db: new SqliteDb(sqlite),
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}
