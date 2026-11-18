/**
 * Posts service — business rules on top of the repo.
 * Statuses: draft / publish / private / trash (WordPress defaults).
 * Slugs are unique per site; collisions get a numeric suffix (-2, -3, ...).
 */
import { nowIso } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { optionalString, requireString } from "../../kernel/validate";
import {
  countPosts,
  deletePostRow,
  findPostById,
  findPostBySlug,
  findPosts,
  insertPostRow,
  updatePostRow,
} from "./repo";
import type { CreatePostInput, ListPostsOptions, Post, PostListResult, UpdatePostInput } from "./types";
import { isPostStatus } from "./types";

/** "Hello, World!" -> "hello-world"; "Café & Bar" -> "cafe-bar"; "" -> "post". */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 200) : "post";
}

export async function ensureUniqueSlug(db: Db, base: string, excludeId?: number): Promise<string> {
  let candidate = base;
  let n = 2;
  for (;;) {
    const existing = await findPostBySlug(db, candidate);
    if (!existing || (excludeId !== undefined && existing.id === excludeId)) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

const TYPE_RE = /^[a-z0-9_]+$/;

function validateType(type: string): string {
  if (!TYPE_RE.test(type)) throw badRequest('Field "type" must be a lowercase post-type key (letters, digits, underscore).');
  return type;
}

export async function createPost(db: Db, input: CreatePostInput): Promise<Post> {
  const title = requireString(input.title, "title", { max: 1000 });
  const content = optionalString(input.content, "content", 1_000_000) ?? "";
  const excerpt = optionalString(input.excerpt, "excerpt", 10000) ?? "";
  const status = input.status ?? "draft";
  if (!isPostStatus(status)) throw badRequest(`Field "status" must be one of draft, publish, private, trash.`);
  const type = validateType((input.type ?? "post").toLowerCase());
  const baseSlug = input.slug !== undefined ? slugify(input.slug) : slugify(title);
  const slug = await ensureUniqueSlug(db, baseSlug);
  const now = nowIso();
  const id = await insertPostRow(db, {
    authorId: input.authorId,
    date: now,
    content,
    title,
    excerpt,
    status,
    slug,
    parentId: input.parentId ?? 0,
    type,
    mimeType: input.mimeType ?? "",
  });
  const created = await findPostById(db, id);
  if (!created) throw new Error("Failed to read back the created post.");
  return created;
}

export async function getPostById(db: Db, id: number): Promise<Post | null> {
  return findPostById(db, id);
}

/** Public lookup: trashed posts are never returned by slug. */
export async function getPostBySlug(db: Db, slug: string): Promise<Post | null> {
  const post = await findPostBySlug(db, slug);
  if (!post || post.status === "trash") return null;
  return post;
}

export async function listPosts(db: Db, opts: ListPostsOptions = {}): Promise<PostListResult> {
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage =
    opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (opts.status !== undefined) {
    if (!isPostStatus(opts.status)) throw badRequest(`Unknown post status "${opts.status}".`);
    whereParts.push("post_status = ?");
    params.push(opts.status);
  } else if (!opts.includeTrash) {
    whereParts.push("post_status != ?");
    params.push("trash");
  }
  if (opts.type !== undefined) {
    whereParts.push("post_type = ?");
    params.push(validateType(opts.type.toLowerCase()));
  }
  if (opts.authorId !== undefined) {
    whereParts.push("post_author = ?");
    params.push(opts.authorId);
  }
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const total = await countPosts(db, where, params);
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const posts = await findPosts(db, where, params, perPage, (page - 1) * perPage);
  return { posts, total, page, perPage, totalPages };
}

export async function updatePost(db: Db, id: number, patch: UpdatePostInput): Promise<Post> {
  const existing = await findPostById(db, id);
  if (!existing) throw notFound(`Post ${id} not found.`);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("post_title = ?");
    params.push(requireString(patch.title, "title", { max: 1000 }));
  }
  if (patch.content !== undefined) {
    sets.push("post_content = ?");
    params.push(optionalString(patch.content, "content", 1_000_000) ?? "");
  }
  if (patch.excerpt !== undefined) {
    sets.push("post_excerpt = ?");
    params.push(optionalString(patch.excerpt, "excerpt", 10000) ?? "");
  }
  if (patch.status !== undefined) {
    if (!isPostStatus(patch.status)) throw badRequest(`Field "status" must be one of draft, publish, private, trash.`);
    sets.push("post_status = ?");
    params.push(patch.status);
  }
  if (patch.slug !== undefined) {
    const base = slugify(patch.slug);
    sets.push("post_name = ?");
    params.push(await ensureUniqueSlug(db, base, id));
  }
  if (patch.type !== undefined) {
    sets.push("post_type = ?");
    params.push(validateType(patch.type.toLowerCase()));
  }
  if (patch.parentId !== undefined) {
    sets.push("post_parent = ?");
    params.push(patch.parentId);
  }
  if (sets.length === 0) return existing;

  const now = nowIso();
  sets.push("post_modified = ?", "post_modified_gmt = ?");
  params.push(now, now);
  await updatePostRow(db, id, sets, params);
  const updated = await findPostById(db, id);
  if (!updated) throw new Error("Failed to read back the updated post.");
  return updated;
}

export async function trashPost(db: Db, id: number): Promise<Post> {
  return updatePost(db, id, { status: "trash" });
}

export async function restorePost(db: Db, id: number): Promise<Post> {
  const existing = await findPostById(db, id);
  if (!existing) throw notFound(`Post ${id} not found.`);
  if (existing.status !== "trash") return existing;
  return updatePost(db, id, { status: "draft" });
}

/** Permanently delete a post and its postmeta. Irreversible — routes must gate it. */
export async function deletePost(db: Db, id: number): Promise<boolean> {
  const existing = await findPostById(db, id);
  if (!existing) throw notFound(`Post ${id} not found.`);
  const changes = await deletePostRow(db, id);
  return changes > 0;
}
