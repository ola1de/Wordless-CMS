/**
 * Permalinks — URL building and path resolution.
 *
 * Structures (stored in option `permalink_structure`, default `postname`):
 * - plain:      /?p=123
 * - postname:   /hello-world
 * - day-name:   /2026/11/19/hello-world
 * - month-name: /2026/11/hello-world
 * Pages always use /slug. Terms use /category/slug and /tag/slug.
 *
 * Resolution order for a path: exact redirect → home → term archive →
 * date archive → dated post/page → plain slug → redirect by trailing slug
 * → not-found. Redirects are checked before 404, so renamed slugs 301.
 */
import { queryAll } from "../../db";
import type { Db } from "../../db";
import { getOption, setOption } from "../options/service";
import { findPostById, findPostBySlug, rowToPost } from "../posts/repo";
import type { Post } from "../posts/types";
import { findTermBySlug } from "../terms/repo";
import { findRedirectByPath, findRedirectBySlug, insertRedirect } from "./repo";
import { isPermalinkStructure, type PermalinkStructure, type ResolvedPath } from "./types";

export const PERMALINK_OPTION = "permalink_structure";
export const DEFAULT_STRUCTURE: PermalinkStructure = "postname";

export async function getPermalinkStructure(db: Db): Promise<PermalinkStructure> {
  const raw = await getOption<string>(db, PERMALINK_OPTION, DEFAULT_STRUCTURE);
  return isPermalinkStructure(raw) ? raw : DEFAULT_STRUCTURE;
}

export async function setPermalinkStructure(db: Db, structure: string): Promise<PermalinkStructure> {
  if (!isPermalinkStructure(structure)) {
    throw new Error(`Unknown permalink structure "${structure}".`);
  }
  await setOption(db, PERMALINK_OPTION, structure);
  return structure;
}

function dateParts(iso: string): { year: string; month: string; day: string } {
  // Dates are ISO-8601 UTC text (e.g. 2026-11-19T00:00:00.000Z).
  return { year: iso.slice(0, 4), month: iso.slice(5, 7), day: iso.slice(8, 10) };
}

/** Public URL path for a post or page under the current structure. */
export async function postUrl(db: Db, post: Post): Promise<string> {
  if (post.type === "page") return `/${post.slug}`;
  const structure = await getPermalinkStructure(db);
  if (structure === "plain") return `/?p=${post.id}`;
  const { year, month, day } = dateParts(post.date || post.dateGmt);
  if (structure === "day-name") return `/${year}/${month}/${day}/${post.slug}`;
  if (structure === "month-name") return `/${year}/${month}/${post.slug}`;
  return `/${post.slug}`;
}

/** Public URL path for a term. */
export function termUrl(taxonomy: string, slug: string): string {
  if (taxonomy === "category") return `/category/${slug}`;
  if (taxonomy === "tag") return `/tag/${slug}`;
  return `/${taxonomy}/${slug}`;
}

/**
 * Record a 301 for a published post whose slug changed. No redirect is
 * recorded for the `plain` structure (the URL is /?p=ID and never changes).
 */
export async function recordSlugChange(db: Db, post: Post, newSlug: string): Promise<void> {
  const oldPath = await postUrl(db, post);
  const newPath = await postUrl(db, { ...post, slug: newSlug });
  if (oldPath === newPath) return;
  await insertRedirect(db, oldPath, newPath, post.id);
}

function normalizePath(path: string): string {
  return decodeURIComponent(path.replace(/^\/+|\/+$/g, ""));
}

function isDigits(s: string, len: number): boolean {
  return s.length === len && /^\d+$/.test(s);
}

export async function resolvePath(db: Db, rawPath: string): Promise<ResolvedPath> {
  const path = normalizePath(rawPath);
  // 1. Exact redirect match (old permalink path).
  const redirect = await findRedirectByPath(db, `/${path}`);
  if (redirect) return { kind: "redirect", target: redirect };
  if (path === "") return { kind: "home" };

  const segments = path.split("/");
  const first = segments[0] ?? "";

  // 2. Term archives: /category/slug, /tag/slug.
  if ((first === "category" || first === "tag") && segments.length === 2) {
    const term = await findTermBySlug(db, first, segments[1] ?? "");
    if (term) return { kind: "term", term };
    return { kind: "not-found" };
  }

  // 3. Date archives: /YYYY/ and /YYYY/MM/.
  if (isDigits(first, 4) && segments.length <= 2) {
    const year = Number(first);
    const month = segments.length === 2 && isDigits(segments[1] ?? "", 2) ? Number(segments[1]) : undefined;
    if (month === undefined || (month >= 1 && month <= 12)) {
      return { kind: "date-archive", year, month };
    }
    return { kind: "not-found" };
  }

  // 4. Dated post: /YYYY/MM/DD/slug or /YYYY/MM/slug — verify the date
  //    matches the post's date so a slug cannot be hijacked by any date.
  const slug = segments[segments.length - 1] ?? "";
  if (segments.length === 3 || segments.length === 4) {
    const dated = segments.length === 4
      ? isDigits(segments[0] ?? "", 4) && isDigits(segments[1] ?? "", 2) && isDigits(segments[2] ?? "", 2)
      : isDigits(segments[0] ?? "", 4) && isDigits(segments[1] ?? "", 2);
    if (dated) {
      const post = await findPostBySlug(db, slug);
      if (post && post.status === "publish") {
        const { year, month, day } = dateParts(post.date || post.dateGmt);
        const dateMatches =
          segments.length === 4
            ? segments[0] === year && segments[1] === month && segments[2] === day
            : segments[0] === year && segments[1] === month;
        if (dateMatches) return { kind: post.type === "page" ? "page" : "post", post };
      }
      return { kind: "not-found" };
    }
  }

  // 5. Plain slug: /hello-world (post or page).
  if (segments.length === 1) {
    const post = await findPostBySlug(db, slug);
    if (post && post.status === "publish") {
      return { kind: post.type === "page" ? "page" : "post", post };
    }
    // 6. Redirect by trailing slug (covers renamed slugs under any structure).
    const target = await findRedirectBySlug(db, slug);
    if (target) return { kind: "redirect", target };
    return { kind: "not-found" };
  }

  return { kind: "not-found" };
}

/** Resolve /?p=ID (plain structure) to a published post or page. */
export async function resolvePostById(db: Db, id: number): Promise<Post | null> {
  const post = await findPostById(db, id);
  if (!post || post.status !== "publish" || (post.type !== "post" && post.type !== "page")) return null;
  return post;
}

/** Published posts whose post_date starts with the given prefix (YYYY or YYYY-MM). */
export async function listPostsByDatePrefix(
  db: Db,
  prefix: string,
  limit = 20,
  offset = 0,
): Promise<Post[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM wp_posts
      WHERE post_type = 'post' AND post_status = 'publish' AND post_date LIKE ?
      ORDER BY post_date DESC, ID DESC LIMIT ? OFFSET ?`,
    [`${prefix}%`, limit, offset],
  );
  return rows.map(rowToPost);
}
