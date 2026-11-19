/**
 * Repository: raw D1 access for menu items (wp_posts rows of type
 * nav_menu_item + wp_postmeta fields, linked to their menu term via
 * wp_term_relationships). No business rules.
 */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";

type Row = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export interface MenuItemRow {
  id: number;
  title: string;
  parentId: number;
  order: number;
  meta: Record<string, string>;
}

export async function insertMenuItemRow(
  db: Db,
  row: { title: string; parentId: number; order: number },
): Promise<number> {
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_posts
       (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
        post_status, post_name, post_modified, post_modified_gmt, post_parent,
        post_type, post_mime_type, menu_order)
     VALUES (0, datetime('now'), datetime('now'), '', ?, '', 'publish', '', datetime('now'), datetime('now'), ?, 'nav_menu_item', '', ?)`,
    [row.title, row.parentId, row.order],
  );
  return lastRowId ?? 0;
}

export async function setPostMeta(db: Db, postId: number, key: string, value: string): Promise<void> {
  const { changes } = await execRun(db, "UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?", [
    value,
    postId,
    key,
  ]);
  if (changes === 0) {
    await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [
      postId,
      key,
      value,
    ]);
  }
}

export async function getPostMetaMap(db: Db, postId: number): Promise<Record<string, string>> {
  const rows = await queryAll<Row>(db, "SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ?", [postId]);
  const map: Record<string, string> = {};
  for (const row of rows) map[asText(row.meta_key)] = asText(row.meta_value);
  return map;
}

export async function linkItemToMenu(db: Db, itemId: number, menuTermTaxonomyId: number): Promise<void> {
  await execRun(
    db,
    "INSERT OR IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)",
    [itemId, menuTermTaxonomyId],
  );
}

export async function findMenuItemRows(db: Db, menuTermTaxonomyId: number): Promise<MenuItemRow[]> {
  const rows = await queryAll<Row>(
    db,
    `SELECT p.ID, p.post_title, p.post_parent, p.menu_order
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
      WHERE tr.term_taxonomy_id = ? AND p.post_type = 'nav_menu_item'
      ORDER BY p.menu_order ASC, p.ID ASC`,
    [menuTermTaxonomyId],
  );
  const items: MenuItemRow[] = [];
  for (const row of rows) {
    const id = asInt(row.ID);
    items.push({
      id,
      title: asText(row.post_title),
      parentId: asInt(row.post_parent),
      order: asInt(row.menu_order),
      meta: await getPostMetaMap(db, id),
    });
  }
  return items;
}

export async function findMenuItemRow(db: Db, itemId: number): Promise<MenuItemRow | null> {
  const row = await queryOne<Row>(
    db,
    "SELECT ID, post_title, post_parent, menu_order FROM wp_posts WHERE ID = ? AND post_type = 'nav_menu_item' LIMIT 1",
    [itemId],
  );
  if (!row) return null;
  const id = asInt(row.ID);
  return {
    id,
    title: asText(row.post_title),
    parentId: asInt(row.post_parent),
    order: asInt(row.menu_order),
    meta: await getPostMetaMap(db, id),
  };
}

export async function maxMenuOrder(db: Db, menuTermTaxonomyId: number): Promise<number> {
  const row = await queryOne<{ m: unknown }>(
    db,
    `SELECT MAX(p.menu_order) AS m FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
      WHERE tr.term_taxonomy_id = ? AND p.post_type = 'nav_menu_item'`,
    [menuTermTaxonomyId],
  );
  return asInt(row?.m);
}

export async function updateMenuItemRow(
  db: Db,
  itemId: number,
  patch: { title?: string; parentId?: number; order?: number },
): Promise<number> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("post_title = ?");
    params.push(patch.title);
  }
  if (patch.parentId !== undefined) {
    sets.push("post_parent = ?");
    params.push(patch.parentId);
  }
  if (patch.order !== undefined) {
    sets.push("menu_order = ?");
    params.push(patch.order);
  }
  if (sets.length === 0) return 0;
  const { changes } = await execRun(
    db,
    `UPDATE wp_posts SET ${sets.join(", ")} WHERE ID = ? AND post_type = 'nav_menu_item'`,
    [...params, itemId],
  );
  return changes;
}

export async function deleteMenuItemRow(db: Db, itemId: number): Promise<number> {
  await execRun(db, "DELETE FROM wp_postmeta WHERE post_id = ?", [itemId]);
  await execRun(db, "DELETE FROM wp_term_relationships WHERE object_id = ?", [itemId]);
  // Children of a deleted item become top-level items.
  await execRun(db, "UPDATE wp_posts SET post_parent = 0 WHERE post_parent = ? AND post_type = 'nav_menu_item'", [
    itemId,
  ]);
  const { changes } = await execRun(db, "DELETE FROM wp_posts WHERE ID = ? AND post_type = 'nav_menu_item'", [itemId]);
  return changes;
}

export async function deleteMenuItems(db: Db, menuTermTaxonomyId: number): Promise<void> {
  const rows = await findMenuItemRows(db, menuTermTaxonomyId);
  for (const row of rows) await deleteMenuItemRow(db, row.id);
}
