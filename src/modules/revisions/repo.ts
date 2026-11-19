/** Repository: raw D1 access for revision rows in wp_posts. No business rules. */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import type { Post } from "../posts/types";
import type { Revision } from "./types";

type Row = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function rowToRevision(row: Row): Revision {
  const slug = asText(row.post_name);
  return {
    id: asInt(row.ID),
    postId: asInt(row.post_parent),
    authorId: asInt(row.post_author),
    date: asText(row.post_date),
    title: asText(row.post_title),
    content: asText(row.post_content),
    excerpt: asText(row.post_excerpt),
    slug,
    status: asText(row.post_status),
    isAutosave: slug.endsWith("-autosave-v1"),
  };
}

/** Insert a revision snapshot of `post`. Returns the revision row id. */
export async function insertRevisionRow(db: Db, post: Post, slug: string): Promise<number> {
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_posts
       (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
        post_status, post_name, post_modified, post_modified_gmt, post_parent,
        post_type, post_mime_type)
     VALUES (?, ?, ?, ?, ?, ?, 'inherit', ?, ?, ?, ?, 'revision', '')`,
    [
      post.authorId,
      post.modified || post.date,
      post.modifiedGmt || post.dateGmt,
      post.content,
      post.title,
      post.excerpt,
      slug,
      post.modified || post.date,
      post.modifiedGmt || post.dateGmt,
      post.id,
    ],
  );
  return lastRowId ?? 0;
}

export async function findRevisionsByPost(db: Db, postId: number, limit = 100): Promise<Revision[]> {
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM wp_posts
      WHERE post_parent = ? AND post_type = 'revision'
      ORDER BY post_date DESC, ID DESC LIMIT ?`,
    [postId, limit],
  );
  return rows.map(rowToRevision);
}

export async function findRevisionById(db: Db, id: number): Promise<Revision | null> {
  const row = await queryOne<Row>(
    db,
    "SELECT * FROM wp_posts WHERE ID = ? AND post_type = 'revision' LIMIT 1",
    [id],
  );
  return row ? rowToRevision(row) : null;
}

export async function findAutosave(db: Db, postId: number, authorId: number): Promise<Revision | null> {
  const row = await queryOne<Row>(
    db,
    `SELECT * FROM wp_posts
      WHERE post_parent = ? AND post_type = 'revision' AND post_author = ?
        AND post_name = ? LIMIT 1`,
    [postId, authorId, `${postId}-autosave-v1`],
  );
  return row ? rowToRevision(row) : null;
}

export async function updateRevisionRow(
  db: Db,
  id: number,
  fields: { title: string; content: string; excerpt: string; date: string },
): Promise<number> {
  const { changes } = await execRun(
    db,
    `UPDATE wp_posts SET post_title = ?, post_content = ?, post_excerpt = ?,
       post_date = ?, post_date_gmt = ?, post_modified = ?, post_modified_gmt = ?
     WHERE ID = ? AND post_type = 'revision'`,
    [fields.title, fields.content, fields.excerpt, fields.date, fields.date, fields.date, fields.date, id],
  );
  return changes;
}

export async function countRevisions(db: Db, postId: number): Promise<number> {
  const row = await queryOne<{ total: unknown }>(
    db,
    "SELECT COUNT(*) AS total FROM wp_posts WHERE post_parent = ? AND post_type = 'revision'",
    [postId],
  );
  return asInt(row?.total);
}
