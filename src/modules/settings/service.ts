/**
 * Site settings (Milestone 3) — a validated view over wp_options.
 *
 * Keys (all stored as JSON in wp_options):
 * - blogname / blogdescription: site title / tagline
 * - posts_per_page: int 1–100 (used by public list rendering)
 * - permalink_structure: plain | postname | day-name | month-name
 *   (changing it does NOT break existing URLs: M2 records old slugs in
 *   wl_redirects and the resolver 301s them — see permalinks/service.ts)
 * - timezone_string: IANA zone name or "UTC" (used by the admin to format
 *   dates; post dates are always stored in UTC)
 * - default_comment_status: "open" | "closed" — comment_status for newly
 *   created posts (see posts/service.ts)
 * - comment_max_links: int 0–10 — comments with more links stay pending
 *   (already read by comments/service.ts)
 */
import { getOption, setOption } from "../options/service";
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import { isPermalinkStructure, type PermalinkStructure } from "../permalinks/types";

export interface SiteSettings {
  siteTitle: string;
  siteTagline: string;
  postsPerPage: number;
  permalinkStructure: PermalinkStructure;
  timezone: string;
  defaultCommentStatus: "open" | "closed";
  commentMaxLinks: number;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  siteTitle: "Wordless",
  siteTagline: "",
  postsPerPage: 10,
  permalinkStructure: "postname",
  timezone: "UTC",
  defaultCommentStatus: "open",
  commentMaxLinks: 2,
};

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export async function getSettings(db: Db): Promise<SiteSettings> {
  const title = asText(await getOption<unknown>(db, "blogname", DEFAULT_SETTINGS.siteTitle), DEFAULT_SETTINGS.siteTitle);
  const tagline = asText(await getOption<unknown>(db, "blogdescription", ""), "");
  const perPageRaw = await getOption<unknown>(db, "posts_per_page", DEFAULT_SETTINGS.postsPerPage);
  const perPage = Math.min(Math.max(asInt(perPageRaw, 10), 1), 100);
  const structureRaw = asText(
    await getOption<unknown>(db, "permalink_structure", DEFAULT_SETTINGS.permalinkStructure),
    DEFAULT_SETTINGS.permalinkStructure,
  );
  const timezone = asText(await getOption<unknown>(db, "timezone_string", "UTC"), "UTC");
  const commentStatusRaw = asText(
    await getOption<unknown>(db, "default_comment_status", "open"),
    "open",
  );
  const maxLinksRaw = await getOption<unknown>(db, "comment_max_links", DEFAULT_SETTINGS.commentMaxLinks);
  return {
    siteTitle: title.length > 0 ? title : DEFAULT_SETTINGS.siteTitle,
    siteTagline: tagline,
    postsPerPage: perPage,
    permalinkStructure: isPermalinkStructure(structureRaw) ? structureRaw : DEFAULT_SETTINGS.permalinkStructure,
    timezone: timezone.length > 0 ? timezone : "UTC",
    defaultCommentStatus: commentStatusRaw === "closed" ? "closed" : "open",
    commentMaxLinks: Math.min(Math.max(asInt(maxLinksRaw, 2), 0), 10),
  };
}

/** Validate a partial settings patch; returns the cleaned values to store. */
export function validateSettings(patch: Record<string, unknown>): Partial<SiteSettings> {
  const out: Partial<SiteSettings> = {};
  if (patch.siteTitle !== undefined) {
    if (typeof patch.siteTitle !== "string" || patch.siteTitle.trim().length === 0) {
      throw badRequest('Field "siteTitle" must be a non-empty string.');
    }
    if (patch.siteTitle.trim().length > 200) {
      throw badRequest('Field "siteTitle" must be at most 200 characters.');
    }
    out.siteTitle = patch.siteTitle.trim();
  }
  if (patch.siteTagline !== undefined) {
    if (typeof patch.siteTagline !== "string") throw badRequest('Field "siteTagline" must be a string.');
    if (patch.siteTagline.length > 500) {
      throw badRequest('Field "siteTagline" must be at most 500 characters.');
    }
    out.siteTagline = patch.siteTagline;
  }
  if (patch.postsPerPage !== undefined) {
    if (typeof patch.postsPerPage !== "number" || !Number.isInteger(patch.postsPerPage)) {
      throw badRequest('Field "postsPerPage" must be an integer.');
    }
    if (patch.postsPerPage < 1 || patch.postsPerPage > 100) {
      throw badRequest('Field "postsPerPage" must be between 1 and 100.');
    }
    out.postsPerPage = patch.postsPerPage;
  }
  if (patch.permalinkStructure !== undefined) {
    if (typeof patch.permalinkStructure !== "string" || !isPermalinkStructure(patch.permalinkStructure)) {
      throw badRequest('Field "permalinkStructure" must be one of plain, postname, day-name, month-name.');
    }
    out.permalinkStructure = patch.permalinkStructure;
  }
  if (patch.timezone !== undefined) {
    if (typeof patch.timezone !== "string" || patch.timezone.trim().length === 0) {
      throw badRequest('Field "timezone" must be a non-empty string.');
    }
    if (patch.timezone.trim().length > 100) {
      throw badRequest('Field "timezone" must be at most 100 characters.');
    }
    try {
      // Rejects nonsense zones ("Mars/Olympus") while accepting real ones.
      new Intl.DateTimeFormat("en", { timeZone: patch.timezone.trim() });
    } catch {
      throw badRequest(`Field "timezone" is not a valid IANA timezone name (e.g. "Africa/Lagos" or "UTC").`);
    }
    out.timezone = patch.timezone.trim();
  }
  if (patch.defaultCommentStatus !== undefined) {
    if (patch.defaultCommentStatus !== "open" && patch.defaultCommentStatus !== "closed") {
      throw badRequest('Field "defaultCommentStatus" must be "open" or "closed".');
    }
    out.defaultCommentStatus = patch.defaultCommentStatus;
  }
  if (patch.commentMaxLinks !== undefined) {
    if (typeof patch.commentMaxLinks !== "number" || !Number.isInteger(patch.commentMaxLinks)) {
      throw badRequest('Field "commentMaxLinks" must be an integer.');
    }
    if (patch.commentMaxLinks < 0 || patch.commentMaxLinks > 10) {
      throw badRequest('Field "commentMaxLinks" must be between 0 and 10.');
    }
    out.commentMaxLinks = patch.commentMaxLinks;
  }
  return out;
}

export async function updateSettings(db: Db, patch: Record<string, unknown>): Promise<SiteSettings> {
  const clean = validateSettings(patch);
  if (clean.siteTitle !== undefined) await setOption(db, "blogname", clean.siteTitle);
  if (clean.siteTagline !== undefined) await setOption(db, "blogdescription", clean.siteTagline);
  if (clean.postsPerPage !== undefined) await setOption(db, "posts_per_page", clean.postsPerPage);
  if (clean.permalinkStructure !== undefined) await setOption(db, "permalink_structure", clean.permalinkStructure);
  if (clean.timezone !== undefined) await setOption(db, "timezone_string", clean.timezone);
  if (clean.defaultCommentStatus !== undefined) {
    await setOption(db, "default_comment_status", clean.defaultCommentStatus);
  }
  if (clean.commentMaxLinks !== undefined) await setOption(db, "comment_max_links", clean.commentMaxLinks);
  return getSettings(db);
}

/** Posts-per-page for public list rendering (clamped 1–100, default 10). */
export async function getPostsPerPage(db: Db): Promise<number> {
  const raw = await getOption<unknown>(db, "posts_per_page", 10);
  return Math.min(Math.max(asInt(raw, 10), 1), 100);
}

/** Default comment_status for newly created posts ("open" | "closed"). */
export async function getDefaultCommentStatus(db: Db): Promise<"open" | "closed"> {
  const raw = asText(await getOption<unknown>(db, "default_comment_status", "open"), "open");
  return raw === "closed" ? "closed" : "open";
}
