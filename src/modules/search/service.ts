/**
 * Search service (v1).
 *
 * LIKE-based matching on post_title / post_content, case-insensitive
 * (SQLite LIKE is case-insensitive for ASCII). Title matches rank first,
 * then newest first. Only published posts and pages are searchable.
 *
 * NOTE: this is NOT full-text search. LIKE scans the posts table, so it
 * is fine for small sites and slow for very large ones; an FTS5 index is
 * a later optimisation (see README). Do not describe this as full-text.
 */
import { queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import { rowToPost } from "../posts/repo";
import type { Post } from "../posts/types";

export interface SearchOptions {
  page?: number;
  perPage?: number;
  type?: string;
}

export interface SearchResult {
  query: string;
  posts: Post[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/** Escape LIKE wildcards so a query matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function searchPosts(db: Db, query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = query.trim();
  if (q.length === 0 || q.length > 200) {
    throw badRequest('Query parameter "q" is required and must be 1–200 characters.');
  }
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage = opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;
  const like = `%${escapeLike(q)}%`;
  const typeFilter = opts.type !== undefined ? " AND post_type = ?" : "";
  const typeParams: unknown[] = opts.type !== undefined ? [opts.type.toLowerCase()] : [];

  const where = `WHERE post_status = 'publish' AND post_type IN ('post', 'page')${typeFilter} AND (post_title LIKE ? ESCAPE '\\' OR post_content LIKE ? ESCAPE '\\')`;
  const countRow = await queryOne<{ total: unknown }>(
    db,
    `SELECT COUNT(*) AS total FROM wp_posts ${where}`,
    [...typeParams, like, like],
  );
  const total = Number(countRow?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM wp_posts ${where}
      ORDER BY CASE WHEN post_title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
               post_date DESC, ID DESC
      LIMIT ? OFFSET ?`,
    [...typeParams, like, like, like, perPage, (page - 1) * perPage],
  );
  return { query: q, posts: rows.map(rowToPost), total, page, perPage, totalPages };
}
