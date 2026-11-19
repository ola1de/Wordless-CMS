/**
 * Feeds + sitemap + robots — generated from the same query layer as the
 * public renderer. All XML is built with escaping (never string-interpolated
 * user content) and uses absolute URLs from the site URL option.
 */
import { queryAll } from "../../db";
import type { Db } from "../../db";
import { getOption } from "../options/service";
import { postUrl } from "../permalinks/service";
import { rowToPost } from "../posts/repo";
import type { Post } from "../posts/types";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function siteUrl(db: Db): Promise<string> {
  const url = await getOption<string>(db, "siteurl", "http://localhost:8787");
  return url.replace(/\/+$/, "");
}

export async function siteName(db: Db): Promise<string> {
  return getOption<string>(db, "blogname", "Wordless");
}

async function latestPublished(db: Db, limit: number): Promise<Post[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM wp_posts
      WHERE post_status = 'publish' AND post_type IN ('post', 'page')
      ORDER BY post_date DESC, ID DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToPost);
}

/** RSS 2.0 feed of the latest 20 published posts/pages. */
export async function rssFeed(db: Db): Promise<string> {
  const base = await siteUrl(db);
  const name = await siteName(db);
  const posts = await latestPublished(db, 20);
  const items = await Promise.all(
    posts.map(async (post) => {
      const link = base + (await postUrl(db, post));
      const pubDate = post.date ? new Date(post.date).toUTCString() : new Date().toUTCString();
      return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${escapeXml(link)}</link>
    <guid isPermaLink="true">${escapeXml(link)}</guid>
    <pubDate>${escapeXml(pubDate)}</pubDate>
    <description>${escapeXml(post.excerpt || post.content.slice(0, 500))}</description>
  </item>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeXml(name)}</title>
  <link>${escapeXml(base)}/</link>
  <description>${escapeXml(name)}</description>
  <generator>Wordless</generator>
${items.join("\n")}
</channel>
</rss>`;
}

/**
 * Sitemap + robots moved to the SEO module in Milestone 7
 * (src/modules/seo/sitemap.ts, src/modules/seo/robots.ts) — this file
 * keeps RSS only. The old sitemapXml/robotsTxt exports are gone; use
 * the SEO module (its sitemap is paginated and its robots.txt is
 * configurable). The feeds tests import from there.
 */
