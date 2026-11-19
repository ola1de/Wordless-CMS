/**
 * Revisions service.
 *
 * - createRevision: snapshot the current post before an update is applied.
 *   Called from posts/service.updatePost (not for trash/restore transitions).
 * - saveAutosave: one autosave revision per post + author, updated in place.
 * - restoreRevision: snapshot the current content as a new revision first,
 *   then copy the revision's title/content/excerpt back onto the post.
 *   Slug, status and type of the live post are never changed by a restore.
 * - diffRevisions: line-based diff (LCS; set-based fallback for very long
 *   content). No new dependencies.
 */
import { nowIso } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { findPostById, updatePostRow } from "../posts/repo";
import type { Post } from "../posts/types";
import {
  countRevisions,
  findAutosave,
  findRevisionById,
  findRevisionsByPost,
  insertRevisionRow,
  updateRevisionRow,
} from "./repo";
import type { Revision, RevisionDiff } from "./types";

/** Snapshot `post` as a new revision row. Returns the revision. */
export async function createRevision(db: Db, post: Post): Promise<Revision> {
  const version = (await countRevisions(db, post.id)) + 1;
  const slug = `${post.id}-revision-v${version}`;
  const id = await insertRevisionRow(db, post, slug);
  const revision = await findRevisionById(db, id);
  if (!revision) throw new Error("Failed to read back the created revision.");
  return revision;
}

export async function listRevisions(db: Db, postId: number): Promise<Revision[]> {
  const post = await findPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  return findRevisionsByPost(db, postId);
}

export async function getRevision(db: Db, id: number): Promise<Revision> {
  const revision = await findRevisionById(db, id);
  if (!revision) throw notFound(`Revision ${id} not found.`);
  return revision;
}

export async function saveAutosave(
  db: Db,
  postId: number,
  authorId: number,
  patch: { title?: string; content?: string; excerpt?: string },
): Promise<Revision> {
  const post = await findPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  const now = nowIso();
  const title = patch.title !== undefined ? patch.title : post.title;
  const content = patch.content !== undefined ? patch.content : post.content;
  const excerpt = patch.excerpt !== undefined ? patch.excerpt : post.excerpt;
  const existing = await findAutosave(db, postId, authorId);
  if (existing) {
    await updateRevisionRow(db, existing.id, { title, content, excerpt, date: now });
    const updated = await findRevisionById(db, existing.id);
    if (!updated) throw new Error("Failed to read back the autosave.");
    return updated;
  }
  const snapshot: Post = { ...post, authorId, title, content, excerpt };
  const id = await insertRevisionRow(db, snapshot, `${postId}-autosave-v1`);
  const created = await findRevisionById(db, id);
  if (!created) throw new Error("Failed to read back the autosave.");
  return created;
}

export async function restoreRevision(db: Db, revisionId: number): Promise<Post> {
  const revision = await findRevisionById(db, revisionId);
  if (!revision) throw notFound(`Revision ${revisionId} not found.`);
  const post = await findPostById(db, revision.postId);
  if (!post) throw notFound(`Post ${revision.postId} not found.`);
  // Snapshot the pre-restore content first, so the restore itself is undoable.
  await createRevision(db, post);
  const now = nowIso();
  await updatePostRow(
    db,
    post.id,
    ["post_title = ?", "post_content = ?", "post_excerpt = ?", "post_modified = ?", "post_modified_gmt = ?"],
    [revision.title, revision.content, revision.excerpt, now, now],
  );
  const restored = await findPostById(db, post.id);
  if (!restored) throw new Error("Failed to read back the restored post.");
  return restored;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

const LCS_LINE_LIMIT = 1000;
const DIFF_SAMPLE = 10;

/**
 * Line diff between two texts. For inputs up to 1000 lines each, an LCS
 * diff gives exact added/removed lines in order. Above that, a set-based
 * comparison is used (counts may under-count repeated lines); the method
 * is reported honestly in the result via `exact: false`.
 */
export function diffLines(from: string, to: string): RevisionDiff & { exact: boolean } {
  const a = splitLines(from);
  const b = splitLines(to);
  if (a.length > LCS_LINE_LIMIT || b.length > LCS_LINE_LIMIT) {
    const setA = new Set(a);
    const setB = new Set(b);
    const addedLines = b.filter((line) => !setA.has(line)).slice(0, DIFF_SAMPLE);
    const removedLines = a.filter((line) => !setB.has(line)).slice(0, DIFF_SAMPLE);
    return {
      added: b.filter((line) => !setA.has(line)).length,
      removed: a.filter((line) => !setB.has(line)).length,
      addedLines,
      removedLines,
      exact: false,
    };
  }
  // LCS dynamic-programming table (a.length+1) x (b.length+1).
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const row = dp[i];
      if (row === undefined) continue;
      row[j] =
        a[i] === b[j]
          ? (dp[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      removed += 1;
      const line = a[i];
      if (removedLines.length < DIFF_SAMPLE && line !== undefined) removedLines.push(line);
      i += 1;
    } else {
      added += 1;
      const line = b[j];
      if (addedLines.length < DIFF_SAMPLE && line !== undefined) addedLines.push(line);
      j += 1;
    }
  }
  while (i < m) {
    removed += 1;
    const line = a[i];
    if (removedLines.length < DIFF_SAMPLE && line !== undefined) removedLines.push(line);
    i += 1;
  }
  while (j < n) {
    added += 1;
    const line = b[j];
    if (addedLines.length < DIFF_SAMPLE && line !== undefined) addedLines.push(line);
    j += 1;
  }
  return { added, removed, addedLines, removedLines, exact: true };
}

export async function diffRevisions(
  db: Db,
  fromId: number,
  toId: number,
): Promise<RevisionDiff & { exact: boolean; fromId: number; toId: number }> {
  const from = await findRevisionById(db, fromId);
  if (!from) throw notFound(`Revision ${fromId} not found.`);
  const to = await findRevisionById(db, toId);
  if (!to) throw notFound(`Revision ${toId} not found.`);
  if (from.postId !== to.postId) {
    throw badRequest("Cannot diff revisions of different posts.");
  }
  return { ...diffLines(from.content, to.content), fromId, toId };
}
