/**
 * Media records live in wp_posts with post_type = 'attachment'
 * (the WordPress model). The object bytes live in R2 via MediaStorage.
 */
import type { Db } from "../../db";
import { execRun } from "../../db";
import { createPost, getPostById, listPosts } from "../posts/service";
import type { Post, PostListResult } from "../posts/types";

export interface MediaRecord {
  id: number;
  title: string;
  slug: string;
  mimeType: string;
  /** R2 object key, e.g. "2026/11/photo.jpg". Empty until an object is stored. */
  objectKey: string;
  authorId: number;
  date: string;
  url: string;
}

export interface CreateMediaInput {
  title: string;
  mimeType: string;
  objectKey?: string;
  authorId: number;
}

function toRecord(post: Post, objectKey: string): MediaRecord {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    mimeType: post.mimeType,
    objectKey,
    authorId: post.authorId,
    date: post.date,
    url: objectKey.length > 0 ? `/media/${objectKey}` : "",
  };
}

export async function createMediaRecord(db: Db, input: CreateMediaInput): Promise<MediaRecord> {
  const post = await createPost(db, {
    title: input.title,
    status: "publish",
    type: "attachment",
    authorId: input.authorId,
    mimeType: input.mimeType,
  });
  const objectKey = input.objectKey ?? "";
  if (objectKey.length > 0) {
    // STUB (M1): the record exists; the bytes are not uploaded yet — see storage.ts.
    await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [
      post.id,
      "_wp_attached_file",
      objectKey,
    ]);
  }
  return toRecord(post, objectKey);
}

export async function getMediaRecord(db: Db, id: number): Promise<MediaRecord | null> {
  const post = await getPostById(db, id);
  if (!post || post.type !== "attachment") return null;
  return toRecord(post, "");
}

export async function listMedia(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<PostListResult> {
  return listPosts(db, { type: "attachment", page: opts.page, perPage: opts.perPage });
}
