/** Repository: raw D1 access for wp_posts. No business rules here. */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import type { Post, PostStatus } from "./types";
import { isPostStatus } from "./types";

type Row = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function rowToPost(row: Row): Post {
  const status = asText(row.post_status);
  return {
    id: asInt(row.ID),
    authorId: asInt(row.post_author),
    date: asText(row.post_date),
    dateGmt: asText(row.post_date_gmt),
    content: asText(row.post_content),
    title: asText(row.post_title),
    excerpt: asText(row.post_excerpt),
    status: isPostStatus(status) ? status : "draft",
    commentStatus: asText(row.comment_status),
    pingStatus: asText(row.ping_status),
    password: asText(row.post_password),
    slug: asText(row.post_name),
    modified: asText(row.post_modified),
    modifiedGmt: asText(row.post_modified_gmt),
    contentFiltered: asText(row.post_content_filtered),
    parentId: asInt(row.post_parent),
    guid: asText(row.guid),
    menuOrder: asInt(row.menu_order),
    type: asText(row.post_type),
    mimeType: asText(row.post_mime_type),
    commentCount: asInt(row.comment_count),
  };
}

export async function insertPostRow(
  db: Db,
  row: {
    authorId: number;
    date: string;
    content: string;
    title: string;
    excerpt: string;
    status: PostStatus;
    slug: string;
    parentId: number;
    type: string;
    mimeType: string;
    /** Defaults to 'open' at the DB layer; the service passes the site setting. */
    commentStatus?: string;
  },
): Promise<number> {
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_posts
       (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
        post_status, post_name, post_modified, post_modified_gmt, post_parent,
        post_type, post_mime_type, comment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.authorId,
      row.date,
      row.date,
      row.content,
      row.title,
      row.excerpt,
      row.status,
      row.slug,
      row.date,
      row.date,
      row.parentId,
      row.type,
      row.mimeType,
      row.commentStatus ?? "open",
    ],
  );
  return lastRowId ?? 0;
}

export async function findPostById(db: Db, id: number): Promise<Post | null> {
  const row = await queryOne<Row>(db, "SELECT * FROM wp_posts WHERE ID = ? LIMIT 1", [id]);
  return row ? rowToPost(row) : null;
}

export async function findPostBySlug(db: Db, slug: string): Promise<Post | null> {
  const row = await queryOne<Row>(
    db,
    "SELECT * FROM wp_posts WHERE post_name = ? AND post_type IN ('post', 'page') LIMIT 1",
    [slug],
  );
  return row ? rowToPost(row) : null;
}

export async function countPosts(db: Db, where: string, params: unknown[]): Promise<number> {
  const row = await queryOne<{ total: unknown }>(
    db,
    `SELECT COUNT(*) AS total FROM wp_posts ${where}`,
    params,
  );
  return asInt(row?.total);
}

export async function findPosts(
  db: Db,
  where: string,
  params: unknown[],
  limit: number,
  offset: number,
): Promise<Post[]> {
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM wp_posts ${where} ORDER BY post_date DESC, ID DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToPost);
}

export async function updatePostRow(
  db: Db,
  id: number,
  sets: string[],
  params: unknown[],
): Promise<number> {
  const { changes } = await execRun(
    db,
    `UPDATE wp_posts SET ${sets.join(", ")} WHERE ID = ?`,
    [...params, id],
  );
  return changes;
}

export async function deletePostRow(db: Db, id: number): Promise<number> {
  await execRun(db, "DELETE FROM wp_postmeta WHERE post_id = ?", [id]);
  // Revisions and autosaves belong to the post; they go with it.
  await execRun(db, "DELETE FROM wp_posts WHERE post_parent = ? AND post_type = 'revision'", [id]);
  const { changes } = await execRun(db, "DELETE FROM wp_posts WHERE ID = ?", [id]);
  return changes;
}
