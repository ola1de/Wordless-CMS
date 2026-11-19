/** Repository: raw D1 access for wl_redirects. No business rules. */
import { execRun, nowIso, queryOne } from "../../db";
import type { Db } from "../../db";

export async function insertRedirect(db: Db, oldPath: string, newPath: string, postId: number): Promise<void> {
  await execRun(
    db,
    `INSERT OR IGNORE INTO wl_redirects (old_path, new_path, post_id, created_at)
     VALUES (?, ?, ?, ?)`,
    [oldPath, newPath, postId, nowIso()],
  );
}

export async function findRedirectByPath(db: Db, path: string): Promise<string | null> {
  const row = await queryOne<{ new_path: unknown }>(
    db,
    "SELECT new_path FROM wl_redirects WHERE old_path = ? LIMIT 1",
    [path],
  );
  return row ? String(row.new_path) : null;
}

/** Match a redirect whose old path ends with the given slug segment. */
export async function findRedirectBySlug(db: Db, slug: string): Promise<string | null> {
  const row = await queryOne<{ new_path: unknown }>(
    db,
    "SELECT new_path FROM wl_redirects WHERE old_path LIKE ? LIMIT 1",
    [`%/${slug}`],
  );
  return row ? String(row.new_path) : null;
}
