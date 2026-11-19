import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost } from "../posts/service";
import { createTerm } from "../terms/service";
import { setPostTerms } from "../terms/service";
import { rssFeed } from "./service";
// Sitemap + robots moved to the SEO module in Milestone 7; the feeds
// tests still cover them here as regression tests.
import { getRobotsTxt as robotsTxt } from "../seo/robots";
import { sitemapXml } from "../seo/sitemap";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

/** Minimal well-formedness check: tags balance (ignoring <?...?>, comments, self-closing). */
export function assertWellFormedXml(xml: string): void {
  const stack: string[] = [];
  const tagRe = /<(?:\?[^?]*\?|!--[\s\S]*?--|(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?))>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const raw = m[0];
    if (raw.startsWith("<?") || raw.startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const name = m[2] ?? "";
    const selfClosing = m[3] === "/" || raw.endsWith("/>");
    if (!name) continue;
    if (closing) {
      const open = stack.pop();
      expect(open).toBe(name);
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  expect(stack).toEqual([]);
}

describe("feeds + sitemap", () => {
  it("renders an RSS 2.0 feed of published posts, escaped", async () => {
    await createPost(tdb.db, { title: "Fish & Chips <b>", content: "Body & more", authorId: 1, status: "publish" });
    await createPost(tdb.db, { title: "Draft Post", content: "Hidden", authorId: 1, status: "draft" });
    const xml = await rssFeed(tdb.db);
    assertWellFormedXml(xml);
    expect(xml).toContain("<rss version=\"2.0\">");
    expect(xml).toContain("Fish &amp; Chips &lt;b&gt;");
    expect(xml).not.toContain("Draft Post");
    expect(xml).toContain("<generator>Wordless</generator>");
  });

  it("renders a sitemap with posts and terms", async () => {
    const post = await createPost(tdb.db, { title: "Hello", content: "Body", authorId: 1, status: "publish" });
    const cat = await createTerm(tdb.db, { name: "News", taxonomy: "category" });
    await setPostTerms(tdb.db, post.id, "category", [cat.termTaxonomyId]);
    const xml = await sitemapXml(tdb.db);
    assertWellFormedXml(xml);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>http://localhost:8787/hello</loc>");
    expect(xml).toContain("<loc>http://localhost:8787/category/news</loc>");
    expect(xml).toContain("<lastmod>");
  });

  it("renders robots.txt with the sitemap line", async () => {
    const txt = await robotsTxt(tdb.db);
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Sitemap: http://localhost:8787/sitemap.xml");
  });
});
