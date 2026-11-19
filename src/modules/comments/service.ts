/**
 * Comments service.
 *
 * - New comments are `pending` by default. A logged-in user who can
 *   `moderate_comments` gets their comment `approved` immediately.
 * - Spam guard (no external service in M2): a filled honeypot field, or
 *   more links than `comment_max_links` (option, default 2), forces the
 *   comment to `spam` (honeypot) or `pending` (too many links).
 * - Comments only on posts whose comment_status is `open`.
 * - comment_count on wp_posts counts approved comments only and is kept
 *   in sync on every create / status change / delete.
 */
import { nowIso } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { getOption } from "../options/service";
import { findPostById } from "../posts/repo";
import {
  deleteCommentRow,
  findCommentById,
  findComments,
  countComments,
  insertCommentRow,
  syncPostCommentCount,
  updateCommentStatus,
} from "./repo";
import type { Comment, CommentListResult, CommentStatus, CreateCommentInput, ListCommentsOptions } from "./types";
import { isCommentStatus } from "./types";

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const ANCHOR_RE = /<a\s[^>]*href=/gi;

export function countLinks(content: string): number {
  const urls = content.match(URL_RE) ?? [];
  const anchors = content.match(ANCHOR_RE) ?? [];
  // Count distinct link signals; an <a href="https://…"> counts once.
  const anchorUrls = new Set<string>();
  for (const m of content.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    if (m[1] !== undefined) anchorUrls.add(m[1]);
  }
  const plainUrls = urls.filter((u) => !anchorUrls.has(u));
  return anchorUrls.size + plainUrls.length;
}

export async function createComment(
  db: Db,
  input: CreateCommentInput,
  opts: { canModerate?: boolean } = {},
): Promise<Comment> {
  const post = await findPostById(db, input.postId);
  if (!post) throw notFound(`Post ${input.postId} not found.`);
  if (post.commentStatus !== "open") {
    throw badRequest("Comments are closed for this post.");
  }
  const author = input.author.trim();
  if (author.length === 0 || author.length > 100) {
    throw badRequest('Field "author" is required and must be at most 100 characters.');
  }
  const content = input.content.trim();
  if (content.length === 0 || content.length > 10000) {
    throw badRequest('Field "content" is required and must be at most 10000 characters.');
  }
  if (input.parentId !== undefined && input.parentId !== 0) {
    const parent = await findCommentById(db, input.parentId);
    if (!parent) throw notFound(`Parent comment ${input.parentId} not found.`);
    if (parent.postId !== input.postId) throw badRequest("A reply must belong to the same post as its parent.");
  }

  let status: CommentStatus = opts.canModerate === true ? "approved" : "pending";
  // Honeypot: a bot that fills the hidden field is spam, full stop.
  if (input.honeypot !== undefined && input.honeypot.trim().length > 0) {
    status = "spam";
  } else {
    const maxLinks = await getOption<number>(db, "comment_max_links", 2);
    const limit = typeof maxLinks === "number" && maxLinks >= 0 ? Math.floor(maxLinks) : 2;
    if (countLinks(content) > limit) status = "pending";
  }

  const now = nowIso();
  const id = await insertCommentRow(db, {
    postId: input.postId,
    author,
    authorEmail: input.authorEmail?.trim() ?? "",
    authorUrl: input.authorUrl?.trim() ?? "",
    authorIp: input.authorIp ?? "",
    date: now,
    content,
    status,
    parentId: input.parentId ?? 0,
    userId: input.userId ?? 0,
  });
  await syncPostCommentCount(db, input.postId);
  const created = await findCommentById(db, id);
  if (!created) throw new Error("Failed to read back the created comment.");
  return created;
}

export async function getComment(db: Db, id: number): Promise<Comment> {
  const comment = await findCommentById(db, id);
  if (!comment) throw notFound(`Comment ${id} not found.`);
  return comment;
}

export async function listComments(db: Db, opts: ListCommentsOptions = {}): Promise<CommentListResult> {
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage = opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;
  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (opts.postId !== undefined) {
    whereParts.push("comment_post_ID = ?");
    params.push(opts.postId);
  }
  if (opts.status !== undefined) {
    if (!isCommentStatus(opts.status)) throw badRequest(`Unknown comment status "${opts.status}".`);
    whereParts.push("comment_approved = ?");
    params.push(opts.status === "approved" ? "1" : opts.status === "pending" ? "0" : opts.status);
  }
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  const total = await countComments(db, where, params);
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const comments = await findComments(db, where, params, perPage, (page - 1) * perPage);
  return { comments, total, page, perPage, totalPages };
}

/** Approved comments for a post, nested into threads (children arrays). */
export async function listApprovedThreaded(db: Db, postId: number): Promise<Comment[]> {
  const { comments } = await listComments(db, { postId, status: "approved", perPage: 100 });
  const byId = new Map<number, Comment>();
  const roots: Comment[] = [];
  for (const comment of comments) {
    byId.set(comment.id, { ...comment, children: [] });
  }
  for (const comment of comments) {
    const node = byId.get(comment.id);
    if (!node) continue;
    if (comment.parentId !== 0) {
      const parent = byId.get(comment.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  return roots;
}

export async function setCommentStatus(db: Db, id: number, status: CommentStatus): Promise<Comment> {
  if (!isCommentStatus(status)) throw badRequest(`Unknown comment status "${status}".`);
  const comment = await findCommentById(db, id);
  if (!comment) throw notFound(`Comment ${id} not found.`);
  await updateCommentStatus(db, id, status);
  await syncPostCommentCount(db, comment.postId);
  const updated = await findCommentById(db, id);
  if (!updated) throw new Error("Failed to read back the updated comment.");
  return updated;
}

export async function deleteComment(db: Db, id: number): Promise<boolean> {
  const comment = await findCommentById(db, id);
  if (!comment) throw notFound(`Comment ${id} not found.`);
  const changes = await deleteCommentRow(db, id);
  await syncPostCommentCount(db, comment.postId);
  return changes > 0;
}
