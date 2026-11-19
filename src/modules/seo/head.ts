/**
 * SEO head tags (Milestone 7).
 *
 * buildPageSeo returns what the two document builders (M2 layout and
 * M5 themedDocument) need: an effective title + description (the
 * builders already emit <title> and <meta name="description">, appending
 * " — <site name>" to the title), plus the remaining head tags
 * (canonical, robots, Open Graph, Twitter Card, JSON-LD).
 *
 * Rules:
 * - The SEO title field is the page title WITHOUT the site name; the
 *   renderer appends the site name, exactly like WordPress does.
 * - Fallbacks, in order: SEO field → post title / excerpt → site
 *   title / tagline. A page is never given a title or description that
 *   was not stored somewhere on the site.
 * - Search and 404 pages are noindex and carry no canonical.
 * - All attribute values are escaped; JSON-LD is serialised with
 *   JSON.stringify and < > & escaped so a title can never break out
 *   of the <script> block.
 */
import { getOption } from "../options/service";
import { getPostSeo } from "./meta";
import { getMediaRecord } from "../media/service";
import { getUserById } from "../users/service";
import { postUrl } from "../permalinks/service";
import { escapeHtml } from "../render/theme";
import type { Db } from "../../db";
import type { Post } from "../posts/types";
import type { PageSeo } from "./types";

export type PageKind = "home" | "single" | "page" | "archive" | "search" | "404";

export interface PageSeoContext {
  kind: PageKind;
  /** Page title without the site name (e.g. post title, "Category: News"). */
  title: string;
  /** Fallback description (site tagline, term description). */
  description: string;
  /** Canonical path (e.g. "/hello-world"); null = no canonical tag. */
  canonicalPath: string | null;
  /** The post being rendered (single/page only). */
  post?: Post | null;
  /** Breadcrumb trail after Home (label + absolute path). */
  breadcrumbs?: Array<{ name: string; path: string }>;
}

function escapeJsonLd(json: string): string {
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export async function buildPageSeo(db: Db, ctx: PageSeoContext): Promise<PageSeo> {
  const siteName = await getOption<string>(db, "blogname", "Wordless");
  const siteUrl = (await getOption<string>(db, "siteurl", "http://localhost:8787")).replace(/\/+$/, "");
  const tags: string[] = [];

  let title = ctx.title;
  let description = ctx.description;
  let noindex = ctx.kind === "search" || ctx.kind === "404";
  let canonical: string | null = ctx.canonicalPath === null ? null : `${siteUrl}${ctx.canonicalPath}`;
  let ogTitle = title;
  let ogDescription = description;
  let ogImage: string | null = null;
  let twitterCard: "summary" | "summary_large_image" = "summary";
  let articleJsonLd: Record<string, unknown> | null = null;

  const post = ctx.post ?? null;
  if (post !== null) {
    const seo = await getPostSeo(db, post.id);
    if (seo.title !== "") title = seo.title;
    if (seo.description !== "") description = seo.description;
    else if (post.excerpt !== "") description = post.excerpt;
    if (seo.canonical !== "") canonical = seo.canonical;
    else canonical = `${siteUrl}${await postUrl(db, post)}`;
    if (seo.noindex) noindex = true;
    ogTitle = seo.ogTitle !== "" ? seo.ogTitle : title;
    ogDescription = seo.ogDescription !== "" ? seo.ogDescription : description;
    twitterCard = seo.twitterCard;
    if (seo.ogImageId > 0) {
      const record = await getMediaRecord(db, seo.ogImageId);
      if (record && record.url !== "") {
        ogImage = record.url.startsWith("http") ? record.url : `${siteUrl}${record.url}`;
      }
    }
    if (post.type === "post") {
      const author = await getUserById(db, post.authorId);
      articleJsonLd = {
        "@type": "Article",
        headline: title,
        datePublished: post.date || undefined,
        dateModified: post.modified || undefined,
        author: author ? { "@type": "Person", name: author.displayName || author.login } : undefined,
      };
    }
  }

  if (canonical !== null) {
    tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  }
  if (noindex) {
    tags.push(`<meta name="robots" content="noindex, nofollow">`);
  }
  const ogType = post !== null && post.type === "post" ? "article" : "website";
  tags.push(`<meta property="og:type" content="${ogType}">`);
  tags.push(`<meta property="og:title" content="${escapeHtml(ogTitle)}">`);
  if (ogDescription !== "") tags.push(`<meta property="og:description" content="${escapeHtml(ogDescription)}">`);
  tags.push(`<meta property="og:url" content="${escapeHtml(canonical ?? siteUrl)}">`);
  tags.push(`<meta property="og:site_name" content="${escapeHtml(siteName)}">`);
  if (ogImage !== null) tags.push(`<meta property="og:image" content="${escapeHtml(ogImage)}">`);
  tags.push(`<meta name="twitter:card" content="${twitterCard}">`);
  tags.push(`<meta name="twitter:title" content="${escapeHtml(ogTitle)}">`);
  if (ogDescription !== "") tags.push(`<meta name="twitter:description" content="${escapeHtml(ogDescription)}">`);
  if (ogImage !== null) tags.push(`<meta name="twitter:image" content="${escapeHtml(ogImage)}">`);

  const graph: Array<Record<string, unknown>> = [
    { "@type": "WebSite", name: siteName, url: `${siteUrl}/` },
  ];
  if (articleJsonLd !== null) graph.push(articleJsonLd);
  const crumbs = [{ name: "Home", path: "/" }, ...(ctx.breadcrumbs ?? [])];
  if (crumbs.length > 1) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.name,
        item: `${siteUrl}${c.path}`,
      })),
    });
  }
  tags.push(
    `<script type="application/ld+json">${escapeJsonLd(JSON.stringify({ "@context": "https://schema.org", "@graph": graph }))}</script>`,
  );

  return { title, description, headTags: tags.join("\n") };
}
