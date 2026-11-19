/**
 * Per-post SEO fields (Milestone 7).
 *
 * Stored as wp_postmeta so they travel with the post (export, import,
 * revisions of the post row are unaffected — meta is per post, not per
 * revision). Keys use the `_wl_seo_` prefix; Yoast (`_yoast_wpseo_*`)
 * and Rank Math (`rank_math_*`) keys are only understood by the
 * importer (import.ts), never read as live fields.
 *
 * Validation limits (enforced on write, never silently truncated):
 * - SEO title ≤ 70 chars, meta description ≤ 160, focus keyword ≤ 100.
 * - Canonical must be an absolute http(s) URL or empty.
 * - OG image must be an existing attachment post ID (0 = none).
 * - Twitter card is "summary" or "summary_large_image".
 */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { getPostById } from "../posts/service";
import { getMediaRecord } from "../media/service";
import type { PostSeo, PostSeoInput, TwitterCard } from "./types";
import { EMPTY_SEO } from "./types";

export const META_KEYS = {
  title: "_wl_seo_title",
  description: "_wl_seo_description",
  focusKeyword: "_wl_seo_focus_keyword",
  canonical: "_wl_seo_canonical",
  noindex: "_wl_seo_noindex",
  ogTitle: "_wl_seo_og_title",
  ogDescription: "_wl_seo_og_description",
  ogImageId: "_wl_seo_og_image",
  twitterCard: "_wl_seo_twitter_card",
} as const;

const LIMITS = { title: 70, description: 160, focusKeyword: 100, ogTitle: 70, ogDescription: 160 } as const;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

async function getMeta(db: Db, postId: number, key: string): Promise<string> {
  const row = await queryOne<{ meta_value: unknown }>(
    db,
    "SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1",
    [postId, key],
  );
  return asText(row?.meta_value);
}

async function setMeta(db: Db, postId: number, key: string, value: string): Promise<void> {
  const existing = await queryOne<{ meta_id: unknown }>(
    db,
    "SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1",
    [postId, key],
  );
  if (existing) {
    await execRun(db, "UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?", [value, postId, key]);
  } else {
    await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [postId, key, value]);
  }
}

async function deleteMeta(db: Db, postId: number, key: string): Promise<void> {
  await execRun(db, "DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?", [postId, key]);
}

function requireSeoString(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw badRequest(`Field "${field}" must be a string.`);
  if (value.length > max) throw badRequest(`Field "${field}" is too long (max ${max} characters).`);
  return value;
}

function requireCanonical(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw badRequest('Field "canonical" must be a string.');
  const trimmed = value.trim();
  if (trimmed === "") return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw badRequest('Field "canonical" must be a valid absolute http(s) URL or empty.');
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest('Field "canonical" must be a valid absolute http(s) URL or empty.');
  }
  return trimmed;
}

async function requireOgImageId(db: Db, value: unknown): Promise<number> {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) throw badRequest('Field "ogImageId" must be a media attachment ID or 0.');
  if (n === 0) return 0;
  const record = await getMediaRecord(db, n);
  if (!record) throw badRequest(`Field "ogImageId" does not match an existing media item (${n}).`);
  return n;
}

function requireTwitterCard(value: unknown): TwitterCard {
  if (value === undefined || value === null || value === "") return "summary";
  if (value === "summary" || value === "summary_large_image") return value;
  throw badRequest('Field "twitterCard" must be "summary" or "summary_large_image".');
}

/** Read a post's SEO fields (all empty/false when nothing was set). */
export async function getPostSeo(db: Db, postId: number): Promise<PostSeo> {
  const post = await getPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  const rows = await queryAll<{ meta_key: unknown; meta_value: unknown }>(
    db,
    "SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key LIKE '_wl_seo_%'",
    [postId],
  );
  const byKey = new Map<string, string>();
  for (const row of rows) byKey.set(asText(row.meta_key), asText(row.meta_value));
  const ogImageRaw = byKey.get(META_KEYS.ogImageId) ?? "";
  const ogImageId = Number(ogImageRaw);
  return {
    title: byKey.get(META_KEYS.title) ?? "",
    description: byKey.get(META_KEYS.description) ?? "",
    focusKeyword: byKey.get(META_KEYS.focusKeyword) ?? "",
    canonical: byKey.get(META_KEYS.canonical) ?? "",
    noindex: byKey.get(META_KEYS.noindex) === "1",
    ogTitle: byKey.get(META_KEYS.ogTitle) ?? "",
    ogDescription: byKey.get(META_KEYS.ogDescription) ?? "",
    ogImageId: Number.isInteger(ogImageId) && ogImageId > 0 ? ogImageId : 0,
    twitterCard: byKey.get(META_KEYS.twitterCard) === "summary_large_image" ? "summary_large_image" : "summary",
  };
}

/**
 * Validate + save a post's SEO fields. Only the keys present in `input`
 * are changed; an empty string clears a text field. Returns the full
 * field set after saving.
 */
export async function setPostSeo(db: Db, postId: number, input: PostSeoInput): Promise<PostSeo> {
  const post = await getPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  // Validate everything before writing anything.
  const validated: Partial<Record<keyof PostSeo, string | number | boolean>> = {};
  if (input.title !== undefined) validated.title = requireSeoString(input.title, "title", LIMITS.title);
  if (input.description !== undefined) validated.description = requireSeoString(input.description, "description", LIMITS.description);
  if (input.focusKeyword !== undefined) validated.focusKeyword = requireSeoString(input.focusKeyword, "focusKeyword", LIMITS.focusKeyword);
  if (input.canonical !== undefined) validated.canonical = requireCanonical(input.canonical);
  if (input.noindex !== undefined) {
    if (typeof input.noindex !== "boolean") throw badRequest('Field "noindex" must be true or false.');
    validated.noindex = input.noindex;
  }
  if (input.ogTitle !== undefined) validated.ogTitle = requireSeoString(input.ogTitle, "ogTitle", LIMITS.ogTitle);
  if (input.ogDescription !== undefined) validated.ogDescription = requireSeoString(input.ogDescription, "ogDescription", LIMITS.ogDescription);
  if (input.ogImageId !== undefined) validated.ogImageId = await requireOgImageId(db, input.ogImageId);
  if (input.twitterCard !== undefined) validated.twitterCard = requireTwitterCard(input.twitterCard);

  const write = async (key: string, value: string): Promise<void> => {
    if (value === "") await deleteMeta(db, postId, key);
    else await setMeta(db, postId, key, value);
  };
  if (validated.title !== undefined) await write(META_KEYS.title, validated.title as string);
  if (validated.description !== undefined) await write(META_KEYS.description, validated.description as string);
  if (validated.focusKeyword !== undefined) await write(META_KEYS.focusKeyword, validated.focusKeyword as string);
  if (validated.canonical !== undefined) await write(META_KEYS.canonical, validated.canonical as string);
  if (validated.noindex !== undefined) {
    if (validated.noindex) await setMeta(db, postId, META_KEYS.noindex, "1");
    else await deleteMeta(db, postId, META_KEYS.noindex);
  }
  if (validated.ogTitle !== undefined) await write(META_KEYS.ogTitle, validated.ogTitle as string);
  if (validated.ogDescription !== undefined) await write(META_KEYS.ogDescription, validated.ogDescription as string);
  if (validated.ogImageId !== undefined) {
    if ((validated.ogImageId as number) === 0) await deleteMeta(db, postId, META_KEYS.ogImageId);
    else await setMeta(db, postId, META_KEYS.ogImageId, String(validated.ogImageId));
  }
  if (validated.twitterCard !== undefined) await write(META_KEYS.twitterCard, validated.twitterCard as string);
  return getPostSeo(db, postId);
}

/** The empty field set, for callers that need a default without a DB read. */
export function emptySeo(): PostSeo {
  return { ...EMPTY_SEO };
}
