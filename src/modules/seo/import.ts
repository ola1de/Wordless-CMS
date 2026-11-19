/**
 * SEO metadata import — Yoast SEO + Rank Math (Milestone 7).
 *
 * Accepts a JSON body of posts, each with either a post ID or a slug
 * plus a `meta` object whose keys may be:
 * - Wordless: `_wl_seo_title`, `_wl_seo_description`,
 *   `_wl_seo_focus_keyword`, `_wl_seo_canonical`, `_wl_seo_noindex`,
 *   `_wl_seo_og_title`, `_wl_seo_og_description`, `_wl_seo_og_image`,
 *   `_wl_seo_twitter_card`
 * - Yoast SEO: `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`,
 *   `_yoast_wpseo_focuskw`, `_yoast_wpseo_canonical`,
 *   `_yoast_wpseo_meta-robots-noindex`, `_yoast_wpseo_opengraph-title`,
 *   `_yoast_wpseo_opengraph-description`,
 *   `_yoast_wpseo_opengraph-image-id`, `_yoast_wpseo_twitter-card`
 * - Rank Math: `rank_math_title`, `rank_math_description`,
 *   `rank_math_focus_keyword`, `rank_math_canonical_url`,
 *   `rank_math_robots` (array or string; "noindex" is honoured),
 *   `rank_math_facebook_title`, `rank_math_facebook_description`,
 *   `rank_math_facebook_image_id`, `rank_math_twitter_card_type`
 *
 * Keys that are not recognised are reported as skipped (never silently
 * dropped or mis-mapped). Every value goes through the same validation
 * as the SEO editor (setPostSeo), so an invalid row is skipped with
 * its reason instead of aborting the whole import. At most 500 rows.
 */
import { badRequest } from "../../kernel/errors";
import type { Db } from "../../db";
import { getPostById, getPostBySlug } from "../posts/service";
import { setPostSeo } from "./meta";
import type { PostSeoInput, SeoImportResult, SeoImportRow } from "./types";

export const MAX_IMPORT_ROWS = 500;

/** Normalise one meta object to Wordless field names. Unknown keys are returned separately. */
function normalizeMeta(meta: Record<string, unknown>): { input: PostSeoInput; unknownKeys: string[] } {
  const input: PostSeoInput = {};
  const unknownKeys: string[] = [];
  const take = (keys: string[]): unknown => {
    for (const k of keys) {
      if (meta[k] !== undefined) return meta[k];
    }
    return undefined;
  };
  const title = take(["_wl_seo_title", "_yoast_wpseo_title", "rank_math_title"]);
  if (title !== undefined) input.title = String(title);
  const description = take(["_wl_seo_description", "_yoast_wpseo_metadesc", "rank_math_description"]);
  if (description !== undefined) input.description = String(description);
  const keyword = take(["_wl_seo_focus_keyword", "_yoast_wpseo_focuskw", "rank_math_focus_keyword"]);
  if (keyword !== undefined) input.focusKeyword = String(keyword);
  const canonical = take(["_wl_seo_canonical", "_yoast_wpseo_canonical", "rank_math_canonical_url"]);
  if (canonical !== undefined) input.canonical = String(canonical);
  const ogTitle = take(["_wl_seo_og_title", "_yoast_wpseo_opengraph-title", "rank_math_facebook_title"]);
  if (ogTitle !== undefined) input.ogTitle = String(ogTitle);
  const ogDescription = take(["_wl_seo_og_description", "_yoast_wpseo_opengraph-description", "rank_math_facebook_description"]);
  if (ogDescription !== undefined) input.ogDescription = String(ogDescription);
  const ogImage = take(["_wl_seo_og_image", "_yoast_wpseo_opengraph-image-id", "rank_math_facebook_image_id"]);
  if (ogImage !== undefined) input.ogImageId = typeof ogImage === "number" ? ogImage : Number(ogImage);
  const twitter = take(["_wl_seo_twitter_card", "_yoast_wpseo_twitter-card", "rank_math_twitter_card_type"]);
  if (twitter !== undefined) {
    const t = String(twitter);
    input.twitterCard = t === "summary_large_image" ? "summary_large_image" : "summary";
  }
  // noindex: Yoast "1"/"0" or true/false; Rank Math robots array/string containing "noindex".
  const yoastNoindex = meta["_yoast_wpseo_meta-robots-noindex"];
  const wlNoindex = meta["_wl_seo_noindex"];
  const rankRobots = meta["rank_math_robots"];
  if (wlNoindex !== undefined) input.noindex = wlNoindex === true || wlNoindex === "1" || wlNoindex === 1;
  else if (yoastNoindex !== undefined) input.noindex = yoastNoindex === true || yoastNoindex === "1" || yoastNoindex === 1;
  else if (rankRobots !== undefined) {
    const list = Array.isArray(rankRobots) ? rankRobots.map(String) : [String(rankRobots)];
    input.noindex = list.some((v) => v.toLowerCase().includes("noindex"));
  }
  const known = new Set([
    "_wl_seo_title", "_wl_seo_description", "_wl_seo_focus_keyword", "_wl_seo_canonical", "_wl_seo_noindex",
    "_wl_seo_og_title", "_wl_seo_og_description", "_wl_seo_og_image", "_wl_seo_twitter_card",
    "_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_focuskw", "_yoast_wpseo_canonical",
    "_yoast_wpseo_meta-robots-noindex", "_yoast_wpseo_opengraph-title", "_yoast_wpseo_opengraph-description",
    "_yoast_wpseo_opengraph-image-id", "_yoast_wpseo_twitter-card",
    "rank_math_title", "rank_math_description", "rank_math_focus_keyword", "rank_math_canonical_url",
    "rank_math_robots", "rank_math_facebook_title", "rank_math_facebook_description",
    "rank_math_facebook_image_id", "rank_math_twitter_card_type",
  ]);
  for (const k of Object.keys(meta)) {
    if (!known.has(k)) unknownKeys.push(k);
  }
  return { input, unknownKeys };
}

export async function importSeoMetadata(db: Db, rows: SeoImportRow[]): Promise<SeoImportResult> {
  if (!Array.isArray(rows)) throw badRequest('Import body must be an object with a "posts" array.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw badRequest(`Import is limited to ${MAX_IMPORT_ROWS} posts per request.`);
  }
  let applied = 0;
  const skipped: Array<{ post: string; reason: string }> = [];
  for (const row of rows) {
    const label = row.postId !== undefined ? `post ${row.postId}` : row.slug !== undefined ? `slug "${row.slug}"` : "row";
    try {
      if (row.meta === undefined || typeof row.meta !== "object" || row.meta === null || Array.isArray(row.meta)) {
        skipped.push({ post: label, reason: 'Row has no "meta" object.' });
        continue;
      }
      let postId: number | null = null;
      if (row.postId !== undefined) {
        const post = await getPostById(db, row.postId);
        if (!post) {
          skipped.push({ post: label, reason: `Post ${row.postId} does not exist.` });
          continue;
        }
        postId = post.id;
      } else if (row.slug !== undefined) {
        const post = await getPostBySlug(db, row.slug);
        if (!post) {
          skipped.push({ post: label, reason: `No post with slug "${row.slug}".` });
          continue;
        }
        postId = post.id;
      } else {
        skipped.push({ post: label, reason: "Row has neither postId nor slug." });
        continue;
      }
      const { input, unknownKeys } = normalizeMeta(row.meta);
      if (Object.keys(input).length === 0) {
        skipped.push({ post: label, reason: "No recognised SEO fields in meta." });
        continue;
      }
      await setPostSeo(db, postId, input);
      applied++;
      if (unknownKeys.length > 0) {
        skipped.push({ post: label, reason: `Applied, but ignored unknown keys: ${unknownKeys.join(", ")}.` });
      }
    } catch (err) {
      skipped.push({ post: label, reason: err instanceof Error ? err.message : "Import failed." });
    }
  }
  return { applied, skipped };
}
