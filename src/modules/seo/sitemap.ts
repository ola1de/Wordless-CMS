/**
 * Paginated XML sitemap (Milestone 7 — extends the M2 sitemap).
 *
 * One sitemap file holds at most 1,000 URLs. Up to 1,000 URLs the
 * single /sitemap.xml is a plain <urlset> (M2 behaviour, kept). Above
 * that, /sitemap.xml becomes a <sitemapindex> and each chunk is served
 * at /sitemap.xml?page=N. Total collection is capped at 50,000 URLs
 * (the sitemap protocol's per-file ceiling, applied to the whole set).
 *
 * changefreq / priority formula (documented, computed from stored data):
 * - home: daily / 1.0
 * - post, updated < 7 days ago: daily / 0.9
 * - post, updated < 30 days ago: weekly / 0.8
 * - post, updated < 365 days ago: monthly / 0.6
 * - post, older: yearly / 0.5
 * - page: monthly / 0.7
 * - term archive: weekly / 0.5
 *
 * Image entries come from `wp:image {"id":N}` blocks in post content
 * and are only included when the attachment actually exists in the
 * media library (checked via getMediaRecord). At most 10 images per URL.
 */
import { queryAll } from "../../db";
import type { Db } from "../../db";
import { escapeXml, siteUrl } from "../feeds/service";
import { postUrl, termUrl } from "../permalinks/service";
import { rowToPost } from "../posts/repo";
import type { Post } from "../posts/types";
import { getMediaRecord } from "../media/service";
import { listTerms } from "../terms/service";

export const SITEMAP_PAGE_SIZE = 1000;
export const SITEMAP_MAX_URLS = 50000;
const MAX_IMAGES_PER_URL = 10;

export interface SitemapImage {
  loc: string;
  title?: string;
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq: string;
  priority: string;
  images?: SitemapImage[];
}

function ageDays(iso: string, now: Date): number {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return 9999;
  return Math.max(0, (now.getTime() - d) / 86400000);
}

function postFreqPriority(post: Post, now: Date): { changefreq: string; priority: string } {
  if (post.type === "page") return { changefreq: "monthly", priority: "0.7" };
  const age = ageDays(post.modifiedGmt || post.modified || post.date || "", now);
  if (age < 7) return { changefreq: "daily", priority: "0.9" };
  if (age < 30) return { changefreq: "weekly", priority: "0.8" };
  if (age < 365) return { changefreq: "monthly", priority: "0.6" };
  return { changefreq: "yearly", priority: "0.5" };
}

async function postImages(db: Db, base: string, post: Post): Promise<SitemapImage[]> {
  const images: SitemapImage[] = [];
  const re = /<!--\s*wp:image\s+(\{[^}]*\})\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(post.content)) !== null && images.length < MAX_IMAGES_PER_URL) {
    let id = 0;
    try {
      const attrs = JSON.parse(m[1] ?? "{}") as { id?: unknown };
      id = typeof attrs.id === "number" ? attrs.id : 0;
    } catch {
      continue;
    }
    if (id <= 0) continue;
    const record = await getMediaRecord(db, id);
    if (!record || record.url === "") continue;
    images.push({
      loc: record.url.startsWith("http") ? record.url : `${base}${record.url}`,
      title: record.title !== "" ? record.title : undefined,
    });
  }
  return images;
}

/** Every URL the sitemap covers, in sitemap order (home, posts, terms). */
export async function collectSitemapUrls(db: Db): Promise<SitemapUrl[]> {
  const base = await siteUrl(db);
  const now = new Date();
  const urls: SitemapUrl[] = [{ loc: `${base}/`, changefreq: "daily", priority: "1.0" }];
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM wp_posts
      WHERE post_status = 'publish' AND post_type IN ('post', 'page')
      ORDER BY post_date DESC, ID DESC LIMIT ?`,
    [SITEMAP_MAX_URLS],
  );
  for (const row of rows) {
    const post = rowToPost(row);
    const { changefreq, priority } = postFreqPriority(post, now);
    const lastmod = (post.modifiedGmt || post.modified || post.date || "").slice(0, 10);
    const entry: SitemapUrl = {
      loc: base + (await postUrl(db, post)),
      changefreq,
      priority,
      ...(lastmod !== "" ? { lastmod } : {}),
    };
    if (post.type === "post") {
      const images = await postImages(db, base, post);
      if (images.length > 0) entry.images = images;
    }
    urls.push(entry);
    if (urls.length >= SITEMAP_MAX_URLS) break;
  }
  for (const taxonomy of ["category", "tag"] as const) {
    const { terms } = await listTerms(db, taxonomy, { perPage: 100 });
    for (const term of terms) {
      if (term.count === 0) continue;
      urls.push({ loc: `${base}${termUrl(term.taxonomy, term.slug)}`, changefreq: "weekly", priority: "0.5" });
      if (urls.length >= SITEMAP_MAX_URLS) break;
    }
    if (urls.length >= SITEMAP_MAX_URLS) break;
  }
  return urls;
}

function urlXml(u: SitemapUrl): string {
  const images =
    u.images && u.images.length > 0
      ? u.images
          .map(
            (img) =>
              `    <image:image><image:loc>${escapeXml(img.loc)}</image:loc>${img.title ? `<image:title>${escapeXml(img.title)}</image:title>` : ""}</image:image>`,
          )
          .join("\n")
      : "";
  return `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : ""}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority>${images === "" ? "" : `\n${images}`}</url>`;
}

function urlsetXml(urls: SitemapUrl[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(urlXml).join("\n")}
</urlset>`;
}

/** Sitemap index: one <sitemap> per 1,000-URL chunk. */
export async function sitemapIndexXml(db: Db, precollected?: SitemapUrl[]): Promise<string> {
  const base = await siteUrl(db);
  const urls = precollected ?? (await collectSitemapUrls(db));
  const pages = Math.max(1, Math.ceil(urls.length / SITEMAP_PAGE_SIZE));
  const entries: string[] = [];
  for (let p = 1; p <= pages; p++) {
    const chunk = urls.slice((p - 1) * SITEMAP_PAGE_SIZE, p * SITEMAP_PAGE_SIZE);
    const lastmod = chunk
      .map((u) => u.lastmod ?? "")
      .filter((d) => d !== "")
      .sort()
      .pop();
    entries.push(
      `  <sitemap><loc>${escapeXml(`${base}/sitemap.xml?page=${p}`)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ""}</sitemap>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</sitemapindex>`;
}

/**
 * Sitemap for a page. page = undefined means "the whole sitemap":
 * a plain <urlset> when there are ≤ 1,000 URLs, otherwise the index.
 * page = N returns chunk N of the paginated sitemap (1-based).
 */
export async function sitemapXml(db: Db, page?: number): Promise<string> {
  const urls = await collectSitemapUrls(db);
  if (page === undefined) {
    if (urls.length <= SITEMAP_PAGE_SIZE) return urlsetXml(urls);
    return sitemapIndexXml(db, urls);
  }
  const totalPages = Math.max(1, Math.ceil(urls.length / SITEMAP_PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page)), totalPages);
  return urlsetXml(urls.slice((p - 1) * SITEMAP_PAGE_SIZE, p * SITEMAP_PAGE_SIZE));
}
