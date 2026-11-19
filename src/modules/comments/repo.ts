/** Repository: raw D1 access for wp_comments. No business rules. */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { fromStoredStatus, toStoredStatus, type Comment, type CommentStatus } from "./types";

type Row = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function rowToComment(row: Row): Comment {
  return {
    id: asInt(row.comment_ID),
    postId: asInt(row.comment_post_ID),
    author: asText(row.comment_author),
    authorEmail: asText(row.comment_author_email),
    authorUrl: asText(row.comment_author_url),
    authorIp: asText(row.comment_author_IP),
    date: asText(row.comment_date),
    dateGmt: asText(row.comment_date_gmt),
    content: asText(row.comment_content),
    status: fromStoredStatus(asText(row.comment_approved)),
    parentId: asInt(row.comment_parent),
    userId: asInt(row.user_id),
  };
}

export async function insertCommentRow(
  db: Db,
  row: {
    postId: number;
    author: string;
    authorEmail: string;
    authorUrl: string;
    authorIp: string;
    date: string;
    content: string;
    status: CommentStatus;
    parentId: number;
    userId: number;
  },
): Promise<number> {
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_comments
       (comment_post_ID, comment_author, comment_author_email, comment_author_url,
        comment_author_IP, comment_date, comment_date_gmt, comment_content,
        comment_approved, comment_agent, comment_type, comment_parent, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'comment', ?, ?)`,
    [
      row.postId,
      row.author,
      row.authorEmail,
      row.authorUrl,
      row.authorIp,
      row.date,
      row.date,
      row.content,
      toStoredStatus(row.status),
      row.parentId,
      row.userId,
    ],
  );
  return lastRowId ?? 0;
}

export async function findCommentById(db: Db, id: number): Promise<Comment | null> {
  const row = await queryOne<Row>(db, "SELECT * FROM wp_comments WHERE comment_ID = ? LIMIT 1", [id]);
  return row ? rowToComment(row) : null;
}

export async function countComments(db: Db, where: string, params: unknown[]): Promise<number> {
  const row = await queryOne<{ total: unknown }>(db, `SELECT COUNT(*) AS total FROM wp_comments ${where}`, params);
  return asInt(row?.total);
}

export async function findComments(
  db: Db,
  where: string,
  params: unknown[],
  limit: number,
  offset: number,
): Promise<Comment[]> {
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM wp_comments ${where} ORDER BY comment_date ASC, comment_ID ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToComment);
}

export async function updateCommentStatus(db: Db, id: number, status: CommentStatus): Promise<number> {
  const { changes } = await execRun(db, "UPDATE wp_comments SET comment_approved = ? WHERE comment_ID = ?", [
    toStoredStatus(status),
    id,
  ]);
  return changes;
}

export async function deleteCommentRow(db: Db, id: number): Promise<number> {
  // Replies to a deleted comment become top-level (WordPress deletes the
  // whole thread only on explicit trash-empty; M2 keeps replies).
  await execRun(db, "UPDATE wp_comments SET comment_parent = 0 WHERE comment_parent = ?", [id]);
  const { changes } = await execRun(db, "DELETE FROM wp_comments WHERE comment_ID = ?", [id]);
  return changes;
}

export async function countApprovedCommentsForPost(db: Db, postId: number): Promise<number> {
  const row = await queryOne<{ total: unknown }>(
    db,
    "SELECT COUNT(*) AS total FROM wp_comments WHERE comment_post_ID = ? AND comment_approved = '1'",
    [postId],
  );
  return asInt(row?.total);
}

/** Sync the denormalised comment_count on wp_posts (approved comments only). */
export async function syncPostCommentCount(db: Db, postId: number): Promise<void> {
  const count = await countApprovedCommentsForPost(db, postId);
  await execRun(db, "UPDATE wp_posts SET comment_count = ? WHERE ID = ?", [count, postId]);
}
