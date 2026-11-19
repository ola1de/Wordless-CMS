/**
 * Media service (Milestone 3).
 *
 * Media records live in wp_posts with post_type = 'attachment' (the
 * WordPress model). The object bytes live in R2 via MediaStorage
 * (R2MediaStorage in production/local dev, InMemoryMediaStorage in tests).
 *
 * Postmeta keys:
 * - _wp_attached_file: the R2 object key (e.g. "a1b2c3-photo.jpg")
 * - _wp_attachment_metadata: JSON { filename, size, alt }
 *
 * Documented gap (M3, resolved in M9): image derivatives / WebP
 * conversion now exist via the Cloudflare Images binding — see
 * src/modules/performance/derivatives.ts. When the binding is absent,
 * originals only.
 */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { createPost, deletePost, getPostById } from "../posts/service";
import { rowToPost } from "../posts/repo";
import type { Post } from "../posts/types";
import { verifyUploadBytes } from "../security/magic";
import type { MediaStorage } from "./storage";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
]);

export interface MediaRecord {
  id: number;
  title: string;
  slug: string;
  mimeType: string;
  /** R2 object key (flat, no slashes — served at /media/:key). */
  objectKey: string;
  authorId: number;
  date: string;
  url: string;
  filename: string;
  size: number;
  alt: string;
}

export interface MediaListResult {
  media: MediaRecord[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface UploadMediaInput {
  title?: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
  authorId: number;
  alt?: string;
}

interface AttachmentMeta {
  filename: string;
  size: number;
  alt: string;
}

const ATTACHED_FILE_KEY = "_wp_attached_file";
const METADATA_KEY = "_wp_attachment_metadata";

function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "file";
}

function objectKeyFor(filename: string): string {
  return `${crypto.randomUUID().slice(0, 8)}-${safeFilename(filename)}`;
}

function parseMeta(raw: unknown): AttachmentMeta {
  const fallback: AttachmentMeta = { filename: "", size: 0, alt: "" };
  if (typeof raw !== "string") return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return fallback;
    const rec = parsed as Record<string, unknown>;
    return {
      filename: typeof rec.filename === "string" ? rec.filename : "",
      size: typeof rec.size === "number" ? rec.size : 0,
      alt: typeof rec.alt === "string" ? rec.alt : "",
    };
  } catch {
    return fallback;
  }
}

async function readMeta(db: Db, postId: number): Promise<{ objectKey: string; meta: AttachmentMeta }> {
  const rows = await queryAll<{ meta_key: unknown; meta_value: unknown }>(
    db,
    "SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key IN (?, ?)",
    [postId, ATTACHED_FILE_KEY, METADATA_KEY],
  );
  let objectKey = "";
  let meta: AttachmentMeta = { filename: "", size: 0, alt: "" };
  for (const row of rows) {
    if (row.meta_key === ATTACHED_FILE_KEY && typeof row.meta_value === "string") {
      objectKey = row.meta_value;
    } else if (row.meta_key === METADATA_KEY) {
      meta = parseMeta(row.meta_value);
    }
  }
  return { objectKey, meta };
}

async function writeMeta(db: Db, postId: number, objectKey: string, meta: AttachmentMeta): Promise<void> {
  await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [
    postId,
    ATTACHED_FILE_KEY,
    objectKey,
  ]);
  await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [
    postId,
    METADATA_KEY,
    JSON.stringify(meta),
  ]);
}

function toRecord(post: Post, objectKey: string, meta: AttachmentMeta): MediaRecord {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    mimeType: post.mimeType,
    objectKey,
    authorId: post.authorId,
    date: post.date,
    url: objectKey.length > 0 ? `/media/${encodeURIComponent(objectKey)}` : "",
    filename: meta.filename,
    size: meta.size,
    alt: meta.alt,
  };
}

/** Validate an upload before any bytes are stored. */
export function validateUpload(mimeType: string, size: number): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw badRequest(
      `File type "${mimeType}" is not allowed. Allowed types: JPEG, PNG, GIF, WebP, AVIF, SVG, PDF.`,
    );
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw badRequest(`File is too large (${size} bytes). Maximum upload size is ${MAX_UPLOAD_BYTES} bytes.`);
  }
  if (size === 0) {
    throw badRequest("Uploaded file is empty.");
  }
}

/** Store bytes in R2 and create the attachment record. */
export async function uploadMedia(
  db: Db,
  storage: MediaStorage,
  input: UploadMediaInput,
): Promise<MediaRecord> {
  validateUpload(input.mimeType, input.data.byteLength);
  const filename = safeFilename(input.filename);
  // Milestone 9: magic-byte sniffing — a PHP script renamed to .jpg is
  // rejected here, before any bytes reach R2.
  verifyUploadBytes(filename, input.mimeType, input.data);
  const key = objectKeyFor(filename);
  const title = input.title?.trim() || filename;
  const stored = await storage.put(key, input.data, input.mimeType);
  const post = await createPost(db, {
    title,
    status: "publish",
    type: "attachment",
    authorId: input.authorId,
    mimeType: input.mimeType,
  });
  const meta: AttachmentMeta = { filename, size: stored.size, alt: input.alt?.trim() ?? "" };
  await writeMeta(db, post.id, key, meta);
  return toRecord(post, key, meta);
}

export async function getMediaRecord(db: Db, id: number): Promise<MediaRecord | null> {
  const post = await getPostById(db, id);
  if (!post || post.type !== "attachment") return null;
  const { objectKey, meta } = await readMeta(db, id);
  return toRecord(post, objectKey, meta);
}

/** Find an attachment by its R2 object key (powers GET /media/:key). */
export async function findMediaByKey(db: Db, objectKey: string): Promise<MediaRecord | null> {
  const row = await queryOne<{ post_id: unknown }>(
    db,
    "SELECT post_id FROM wp_postmeta WHERE meta_key = ? AND meta_value = ? LIMIT 1",
    [ATTACHED_FILE_KEY, objectKey],
  );
  if (!row || typeof row.post_id !== "number") return null;
  return getMediaRecord(db, row.post_id);
}

export async function listMedia(
  db: Db,
  opts: { page?: number; perPage?: number; mimeType?: string } = {},
): Promise<MediaListResult> {
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage = opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;
  const where = ["post_type = ?", "post_status != ?"];
  const params: unknown[] = ["attachment", "trash"];
  if (opts.mimeType !== undefined) {
    where.push("post_mime_type = ?");
    params.push(opts.mimeType);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const totalRow = await queryOne<{ n: unknown }>(
    db,
    `SELECT COUNT(*) AS n FROM wp_posts ${whereSql}`,
    params,
  );
  const total = typeof totalRow?.n === "number" ? totalRow.n : 0;
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM wp_posts ${whereSql} ORDER BY post_date DESC, ID DESC LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  const media: MediaRecord[] = [];
  for (const row of rows) {
    const post = rowToPost(row);
    const { objectKey, meta } = await readMeta(db, post.id);
    media.push(toRecord(post, objectKey, meta));
  }
  return { media, total, page, perPage, totalPages: total === 0 ? 0 : Math.ceil(total / perPage) };
}

/** Update alt text (stored in _wp_attachment_metadata). */
export async function updateMediaAlt(db: Db, id: number, alt: string): Promise<MediaRecord> {
  const record = await getMediaRecord(db, id);
  if (!record) throw notFound(`Media item ${id} not found.`);
  const cleanAlt = alt.trim().slice(0, 500);
  const meta: AttachmentMeta = { filename: record.filename, size: record.size, alt: cleanAlt };
  await execRun(db, "UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?", [
    JSON.stringify(meta),
    id,
    METADATA_KEY,
  ]);
  return { ...record, alt: cleanAlt };
}

/** Delete the R2 object, the attachment post and its meta. */
export async function deleteMedia(db: Db, storage: MediaStorage, id: number): Promise<boolean> {
  const record = await getMediaRecord(db, id);
  if (!record) throw notFound(`Media item ${id} not found.`);
  if (record.objectKey.length > 0) {
    await storage.delete(record.objectKey);
  }
  return deletePost(db, id);
}
