/**
 * Options API — mirrors WordPress get_option / update_option / add_option /
 * delete_option, except values are stored as JSON, NOT PHP-serialized
 * strings (see migrations/0001_init.sql).
 */
import { execRun, queryOne } from "../../db";
import type { Db } from "../../db";
import { requireString } from "../../kernel/validate";

export async function getOption<T>(db: Db, key: string, defaultValue: T): Promise<T> {
  const name = requireString(key, "key", { max: 191 });
  const row = await queryOne<{ option_value: unknown }>(
    db,
    "SELECT option_value FROM wp_options WHERE option_name = ? LIMIT 1",
    [name],
  );
  if (!row) return defaultValue;
  try {
    return JSON.parse(typeof row.option_value === "string" ? row.option_value : "") as T;
  } catch {
    return defaultValue;
  }
}

export async function setOption(db: Db, key: string, value: unknown): Promise<void> {
  const name = requireString(key, "key", { max: 191 });
  await execRun(
    db,
    `INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, ?, 'yes')
     ON CONFLICT(option_name) DO UPDATE SET option_value = excluded.option_value`,
    [name, JSON.stringify(value)],
  );
}

/** Insert only if the option does not exist yet. Returns false if it already exists. */
export async function addOption(db: Db, key: string, value: unknown): Promise<boolean> {
  const name = requireString(key, "key", { max: 191 });
  const { changes } = await execRun(
    db,
    "INSERT OR IGNORE INTO wp_options (option_name, option_value, autoload) VALUES (?, ?, 'yes')",
    [name, JSON.stringify(value)],
  );
  return changes > 0;
}

export async function deleteOption(db: Db, key: string): Promise<boolean> {
  const name = requireString(key, "key", { max: 191 });
  const { changes } = await execRun(db, "DELETE FROM wp_options WHERE option_name = ?", [name]);
  return changes > 0;
}
