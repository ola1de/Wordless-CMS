/**
 * SEO module types (Milestone 7).
 *
 * SEO fields are stored as wp_postmeta (keys `_wl_seo_*`) so they travel
 * with the post and the WordPress importer (M9) can map them directly.
 * Nothing here is a guess: the analysis score is computed from the
 * site's own stored content, and every check names what it measured.
 */

export interface PostSeo {
  /** Full SEO title WITHOUT the site name (the renderer appends it). */
  title: string;
  description: string;
  focusKeyword: string;
  canonical: string;
  noindex: boolean;
  ogTitle: string;
  ogDescription: string;
  /** Attachment post ID for the Open Graph image (0 = none). */
  ogImageId: number;
  twitterCard: TwitterCard;
}

export type TwitterCard = "summary" | "summary_large_image";

export const EMPTY_SEO: PostSeo = {
  title: "",
  description: "",
  focusKeyword: "",
  canonical: "",
  noindex: false,
  ogTitle: "",
  ogDescription: "",
  ogImageId: 0,
  twitterCard: "summary",
};

/** Partial input accepted by setPostSeo. Unknown keys are rejected. */
export type PostSeoInput = Partial<PostSeo>;

export type CheckStatus = "pass" | "warn" | "fail";

export interface SeoCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was measured, in plain language (never invented). */
  detail: string;
}

/**
 * Deterministic SEO analysis of one post.
 *
 * Score formula (documented, no magic): each check contributes
 * pass = 1, warn = 0.5, fail = 0; score = round(100 * sum / checks).
 * A post with no checks at all (impossible in practice — the word-count
 * check always runs) scores 0. Readability is a Flesch reading-ease
 * ESTIMATE (syllables counted by a vowel-group heuristic) and is
 * labelled as such everywhere it is shown.
 */
export interface SeoAnalysis {
  postId: number;
  score: number;
  checks: SeoCheck[];
  wordCount: number;
  /** Flesch reading-ease estimate, 0–100 (higher = easier to read). */
  readingEase: number | null;
  internalLinks: number;
  externalLinks: number;
  images: number;
  imagesMissingAlt: number;
}

export interface RedirectRecord {
  id: number;
  oldPath: string;
  newPath: string;
  postId: number;
  createdAt: string;
}

export interface RedirectList {
  redirects: RedirectRecord[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface NotFoundEntry {
  path: string;
  count: number;
  referrer: string;
  firstSeen: string;
  lastSeen: string;
}

export interface NotFoundList {
  entries: NotFoundEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ContentTemplate {
  slug: string;
  name: string;
  description: string;
  /** Suggested title (the admin may change it before creating). */
  title: string;
  /** Gutenberg block-comment HTML (real blocks, created as a draft). */
  content: string;
}

export interface CalendarDay {
  date: string;
  posts: Array<{ id: number; title: string; status: string; type: string; slug: string }>;
}

export interface ContentCalendar {
  from: string;
  to: string;
  days: CalendarDay[];
  total: number;
}

/** One row of a Yoast / Rank Math / Wordless SEO metadata import. */
export interface SeoImportRow {
  postId?: number;
  slug?: string;
  /** Meta keys: Wordless `_wl_seo_*`, Yoast `_yoast_wpseo_*`, or Rank Math `rank_math_*`. */
  meta: Record<string, unknown>;
}

export interface SeoImportResult {
  applied: number;
  skipped: Array<{ post: string; reason: string }>;
}

/** The page-level SEO data the renderers need. Built by head.ts. */
export interface PageSeo {
  /** Effective <title> text WITHOUT the site name (renderers append it). */
  title: string;
  description: string;
  /** Head tags AFTER title/description (canonical, robots, OG, Twitter, JSON-LD). */
  headTags: string;
}
