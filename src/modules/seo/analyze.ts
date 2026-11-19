/**
 * Deterministic SEO analysis (Milestone 7).
 *
 * Every number is computed from the site's own stored content — no
 * rankings, traffic or search-engine data is invented (Wordless has
 * none). The score formula is documented in types.ts: each check is
 * pass = 1, warn = 0.5, fail = 0; score = round(100 * sum / checks).
 *
 * Readability is a Flesch reading-ease ESTIMATE: syllables are counted
 * with a vowel-group heuristic (silent trailing "e" dropped, minimum
 * one syllable per word). It is labelled "estimate" wherever shown.
 * Headings: the post title renders as the page's <h1>, so content
 * <h1> tags are flagged, not required.
 */
import type { Db } from "../../db";
import { getPostById } from "../posts/service";
import { notFound } from "../../kernel/errors";
import { getPostSeo } from "./meta";
import type { CheckStatus, SeoAnalysis, SeoCheck } from "./types";

/** Strip Gutenberg block comments + HTML tags, decode common entities. */
export function textFromContent(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(text: string): string[] {
  if (text === "") return [];
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
}

/** Vowel-group syllable heuristic (estimate only). */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean === "") return 0;
  if (clean.length <= 3) return 1;
  const withoutSilentE = clean.endsWith("e") ? clean.slice(0, -1) : clean;
  const groups = withoutSilentE.match(/[aeiouy]+/g) ?? [];
  return Math.max(1, groups.length);
}

/** Flesch reading ease, 0–100, or null when there is too little text. */
export function fleschReadingEase(text: string): number | null {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s !== "");
  const words = wordsOf(text);
  if (sentences.length === 0 || words.length < 10) return null;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const ease = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  return Math.max(0, Math.min(100, Math.round(ease * 10) / 10));
}

interface ContentFacts {
  plainText: string;
  wordCount: number;
  readingEase: number | null;
  headings: Array<{ level: number; text: string }>;
  images: Array<{ alt: string | null }>;
  internalLinks: number;
  externalLinks: number;
  firstParagraph: string;
}

function parseContent(content: string, siteUrl: string): ContentFacts {
  const plainText = textFromContent(content);
  const words = wordsOf(plainText);
  const headings: Array<{ level: number; text: string }> = [];
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(content)) !== null) {
    headings.push({ level: Number(hm[1]), text: textFromContent(hm[2] ?? "") });
  }
  const images: Array<{ alt: string | null }> = [];
  const imgRe = /<img\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(content)) !== null) {
    const tag = im[0];
    const altMatch = /alt=(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    images.push({ alt: altMatch ? (altMatch[1] ?? altMatch[2] ?? "") : null });
  }
  let internalLinks = 0;
  let externalLinks = 0;
  const linkRe = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')/gi;
  let lm: RegExpExecArray | null;
  const siteHost = (() => {
    try {
      return new URL(siteUrl).host;
    } catch {
      return "";
    }
  })();
  while ((lm = linkRe.exec(content)) !== null) {
    const href = (lm[1] ?? lm[2] ?? "").trim();
    if (href === "" || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (href.startsWith("/") && !href.startsWith("//")) {
      internalLinks++;
      continue;
    }
    try {
      const u = new URL(href, siteUrl);
      if (siteHost !== "" && u.host === siteHost) internalLinks++;
      else externalLinks++;
    } catch {
      externalLinks++;
    }
  }
  const firstParagraph = (() => {
    const pMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(content);
    if (pMatch) return textFromContent(pMatch[1] ?? "");
    return plainText.split(/(?<=[.!?])\s+/)[0] ?? plainText;
  })();
  return {
    plainText,
    wordCount: words.length,
    readingEase: fleschReadingEase(plainText),
    headings,
    images,
    internalLinks,
    externalLinks,
    firstParagraph,
  };
}

function check(id: string, label: string, status: CheckStatus, detail: string): SeoCheck {
  return { id, label, status, detail };
}

function containsKeyword(haystack: string, keyword: string): boolean {
  // Slugs use hyphens ("ridge-trail") where text uses spaces ("ridge trail").
  const norm = (s: string): string => s.toLowerCase().replace(/-/g, " ");
  return norm(haystack).includes(norm(keyword));
}

/**
 * Analyse one post's SEO from its stored fields + content. `siteUrl`
 * is the site's base URL (for internal/external link classification).
 * Pure over its inputs — no DB access, so tests can call it directly.
 */
export function analyzeSeoContent(input: {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  canonical: string;
  siteUrl: string;
}): Omit<SeoAnalysis, "postId"> {
  const facts = parseContent(input.content, input.siteUrl);
  const effectiveTitle = input.seoTitle !== "" ? input.seoTitle : input.title;
  const effectiveDescription = input.seoDescription !== "" ? input.seoDescription : input.excerpt;
  const checks: SeoCheck[] = [];

  // 1. Title (effective: SEO title when set, else the post title).
  if (effectiveTitle.trim() === "") {
    checks.push(check("title", "Title", "fail", "The post has no title at all."));
  } else if (effectiveTitle.length >= 30 && effectiveTitle.length <= 70) {
    checks.push(
      check("title", "Title", "pass", `Title is ${effectiveTitle.length} characters (30–70 is the target range).`),
    );
  } else {
    checks.push(
      check(
        "title",
        "Title",
        "warn",
        `Title is ${effectiveTitle.length} characters — aim for 30–70 so it fits search results.`,
      ),
    );
  }

  // 2. Meta description (effective: SEO description when set, else excerpt).
  if (effectiveDescription.trim() === "") {
    checks.push(check("description", "Meta description", "fail", "No meta description and no excerpt to fall back on."));
  } else if (effectiveDescription.length >= 50 && effectiveDescription.length <= 160) {
    checks.push(
      check("description", "Meta description", "pass", `Description is ${effectiveDescription.length} characters (50–160 is the target range).`),
    );
  } else {
    checks.push(
      check(
        "description",
        "Meta description",
        "warn",
        `Description is ${effectiveDescription.length} characters — aim for 50–160 so it fits search results.`,
      ),
    );
  }

  // 3–6. Focus keyword (only when one is set).
  const keyword = input.focusKeyword.trim();
  if (keyword === "") {
    checks.push(check("keyword", "Focus keyword", "warn", "No focus keyword set — set one to check placement."));
  } else {
    checks.push(
      check(
        "keyword-title",
        "Keyword in title",
        containsKeyword(effectiveTitle, keyword) ? "pass" : "fail",
        containsKeyword(effectiveTitle, keyword)
          ? `The focus keyword appears in the title.`
          : `The focus keyword does not appear in the title.`,
      ),
    );
    checks.push(
      check(
        "keyword-intro",
        "Keyword in first paragraph",
        containsKeyword(facts.firstParagraph, keyword) ? "pass" : "fail",
        containsKeyword(facts.firstParagraph, keyword)
          ? `The focus keyword appears in the first paragraph.`
          : `The focus keyword does not appear in the first paragraph.`,
      ),
    );
    checks.push(
      check(
        "keyword-slug",
        "Keyword in slug",
        containsKeyword(input.slug, keyword) ? "pass" : "warn",
        containsKeyword(input.slug, keyword)
          ? `The focus keyword appears in the slug.`
          : `The focus keyword does not appear in the slug.`,
      ),
    );
    const inHeading = facts.headings.some((h) => containsKeyword(h.text, keyword));
    checks.push(
      check(
        "keyword-heading",
        "Keyword in a heading",
        inHeading ? "pass" : "warn",
        inHeading ? `The focus keyword appears in a heading.` : `The focus keyword does not appear in any heading.`,
      ),
    );
  }

  // 7. Heading structure.
  const h1Count = facts.headings.filter((h) => h.level === 1).length;
  const skipped = facts.headings.some((h, i) => i > 0 && h.level > (facts.headings[i - 1]?.level ?? 1) + 1);
  if (h1Count > 0) {
    checks.push(
      check("headings", "Heading structure", "fail", `Content has ${h1Count} <h1> heading(s) — the post title is already the page <h1>.`),
    );
  } else if (skipped) {
    checks.push(
      check("headings", "Heading structure", "warn", "Heading levels skip (e.g. H2 straight to H4) — keep levels in order."),
    );
  } else {
    checks.push(
      check("headings", "Heading structure", "pass", facts.headings.length === 0 ? "No headings in the content — fine for a short post." : `Headings are in order, no <h1> in the content (the title provides it).`),
    );
  }

  // 8. Image alt coverage.
  const missingAlt = facts.images.filter((img) => img.alt === null || img.alt.trim() === "").length;
  if (facts.images.length === 0) {
    checks.push(check("images", "Image alt text", "pass", "No images in the content."));
  } else if (missingAlt === 0) {
    checks.push(check("images", "Image alt text", "pass", `All ${facts.images.length} image(s) have alt text.`));
  } else {
    checks.push(
      check("images", "Image alt text", "fail", `${missingAlt} of ${facts.images.length} image(s) are missing alt text.`),
    );
  }

  // 9. Internal links.
  checks.push(
    check(
      "internal-links",
      "Internal links",
      facts.internalLinks >= 1 ? "pass" : "warn",
      facts.internalLinks >= 1
        ? `${facts.internalLinks} internal link(s) and ${facts.externalLinks} external link(s).`
        : `No internal links found (${facts.externalLinks} external link(s)) — link to related content on this site.`,
    ),
  );

  // 10. Word count.
  if (facts.wordCount >= 300) {
    checks.push(check("word-count", "Word count", "pass", `${facts.wordCount} words.`));
  } else if (facts.wordCount >= 100) {
    checks.push(check("word-count", "Word count", "warn", `Only ${facts.wordCount} words — 300+ gives search engines more to work with.`));
  } else {
    checks.push(check("word-count", "Word count", "fail", `Only ${facts.wordCount} words — this is very thin content.`));
  }

  // 11. Readability (Flesch estimate).
  if (facts.readingEase === null) {
    checks.push(check("readability", "Readability (estimate)", "warn", "Too little text to estimate readability."));
  } else if (facts.readingEase >= 60) {
    checks.push(check("readability", "Readability (estimate)", "pass", `Flesch reading-ease estimate ${facts.readingEase} (60+ is easy to read).`));
  } else if (facts.readingEase >= 30) {
    checks.push(check("readability", "Readability (estimate)", "warn", `Flesch reading-ease estimate ${facts.readingEase} — 60+ is easier to read.`));
  } else {
    checks.push(check("readability", "Readability (estimate)", "fail", `Flesch reading-ease estimate ${facts.readingEase} — this is hard to read.`));
  }

  // 12. Canonical.
  if (input.canonical.trim() !== "") {
    checks.push(check("canonical", "Canonical URL", "pass", "A canonical URL is set."));
  } else {
    checks.push(check("canonical", "Canonical URL", "warn", "No canonical URL set — the post URL is used as the canonical."));
  }

  const sum = checks.reduce((n, c) => n + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const score = checks.length === 0 ? 0 : Math.round((100 * sum) / checks.length);
  return {
    score,
    checks,
    wordCount: facts.wordCount,
    readingEase: facts.readingEase,
    internalLinks: facts.internalLinks,
    externalLinks: facts.externalLinks,
    images: facts.images.length,
    imagesMissingAlt: missingAlt,
  };
}

/** Analyse a stored post by ID (loads the post + its SEO fields). */
export async function analyzePostSeo(db: Db, postId: number, siteUrl: string): Promise<SeoAnalysis> {
  const post = await getPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  const seo = await getPostSeo(db, postId);
  return {
    postId,
    ...analyzeSeoContent({
      title: post.title,
      slug: post.slug,
      content: post.content,
      excerpt: post.excerpt,
      seoTitle: seo.title,
      seoDescription: seo.description,
      focusKeyword: seo.focusKeyword,
      canonical: seo.canonical,
      siteUrl,
    }),
  };
}
