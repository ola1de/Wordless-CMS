/**
 * SEO engine tests (Milestone 7): per-post fields, deterministic
 * analysis, head tags, paginated sitemap, robots validation, 404 log,
 * redirects, content templates + calendar, Yoast/Rank Math import,
 * and the seo-auditor agent wired to the engine. All numbers come
 * from stored content — nothing here invents a ranking or traffic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { InMemoryMediaStorage } from "../../test/fake-storage";
import type { Env } from "../../env";
import { createPost } from "../posts/service";
import { uploadMedia } from "../media/service";
import { createUser } from "../users/service";
import { setOption } from "../options/service";
import { getPostSeo, setPostSeo } from "./meta";
import { analyzePostSeo, analyzeSeoContent, fleschReadingEase, textFromContent } from "./analyze";
import { buildPageSeo } from "./head";
import { collectSitemapUrls, sitemapIndexXml, sitemapXml } from "./sitemap";
import { getRobotsTxt, setRobotsTxt } from "./robots";
import { createRedirect, deleteRedirect, listRedirects, updateRedirect } from "./redirects";
import { deleteNotFound, listNotFound, logNotFound, normalize404Path } from "./notfound";
import { contentCalendar, createFromTemplate, getTemplate, listTemplates } from "./studio";
import { importSeoMetadata } from "./import";
import { createAiTask, runAiTask } from "../../ai/orchestrator";
import { setSelectedProviderId } from "../../ai/providers/index";

const emptyEnv = {} as unknown as Env;

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

async function seedAuthor(): Promise<number> {
  const user = await createUser(tdb.db, { login: "ed", email: "ed@example.test", password: "password-123" });
  return user.id;
}

/** ~370 words of short, plain sentences about the ridge trail. */
function goodContent(): string {
  const intro =
    "The ridge trail is the pack's favourite route. " +
    "It winds through pine forest and open grass. ".repeat(12);
  const body =
    "The pack moves as one along the ridge trail. " +
    "Each wolf watches the one ahead. " +
    "The trail stays clear because all walk it each day. ".repeat(12);
  const rest =
    "When the sun climbs high, the pack rests by the stream. " +
    "The water is cold and clear. " +
    "The shade gives all a place to rest. ".repeat(12);
  return (
    `<!-- wp:paragraph --><p>${intro}</p><!-- /wp:paragraph -->` +
    `<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">How the pack travels the ridge trail</h2><!-- /wp:heading -->` +
    `<!-- wp:paragraph --><p>${body}</p><!-- /wp:paragraph -->` +
    `<!-- wp:paragraph --><p>${rest}</p><!-- /wp:paragraph -->` +
    `<!-- wp:paragraph --><p>Read the <a href="/trail-guide">trail guide</a> and our <a href="https://example.org/wolves">friends elsewhere</a>.</p><!-- /wp:paragraph -->` +
    `<!-- wp:image --><figure class="wp-block-image"><img src="/media/x.png" alt="A wolf on the ridge trail"/></figure><!-- /wp:image -->`
  );
}

describe("SEO fields (postmeta)", () => {
  it("round-trips fields and clears on empty string", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, { title: "Hello", content: "Body.", authorId });
    const saved = await setPostSeo(tdb.db, post.id, {
      title: "Hello — the pack",
      description: "A short description of the post.",
      focusKeyword: "ridge trail",
      canonical: "https://example.test/hello",
      noindex: true,
      ogTitle: "Hello (social)",
      ogDescription: "Social description.",
      twitterCard: "summary_large_image",
    });
    expect(saved.title).toBe("Hello — the pack");
    expect(saved.noindex).toBe(true);
    expect(saved.twitterCard).toBe("summary_large_image");
    const readBack = await getPostSeo(tdb.db, post.id);
    expect(readBack.canonical).toBe("https://example.test/hello");
    const cleared = await setPostSeo(tdb.db, post.id, { title: "", noindex: false });
    expect(cleared.title).toBe("");
    expect(cleared.noindex).toBe(false);
    expect(cleared.description).toBe("A short description of the post.");
  });

  it("validates limits and values", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, { title: "Hello", content: "Body.", authorId });
    await expect(setPostSeo(tdb.db, post.id, { title: "x".repeat(71) })).rejects.toThrow("too long");
    await expect(setPostSeo(tdb.db, post.id, { description: "x".repeat(161) })).rejects.toThrow("too long");
    await expect(setPostSeo(tdb.db, post.id, { focusKeyword: "x".repeat(101) })).rejects.toThrow("too long");
    await expect(setPostSeo(tdb.db, post.id, { canonical: "not a url" })).rejects.toThrow("absolute http");
    await expect(setPostSeo(tdb.db, post.id, { canonical: "ftp://example.test/x" })).rejects.toThrow("absolute http");
    await expect(setPostSeo(tdb.db, post.id, { twitterCard: "player" as never })).rejects.toThrow("summary");
    await expect(setPostSeo(tdb.db, post.id, { ogImageId: 9999 })).rejects.toThrow("existing media item");
    await expect(setPostSeo(tdb.db, post.id, { noindex: "yes" as never })).rejects.toThrow("true or false");
    await expect(getPostSeo(tdb.db, 9999)).rejects.toThrow("not found");
  });

  it("accepts an existing attachment as the OG image", async () => {
    const authorId = await seedAuthor();
    const storage = new InMemoryMediaStorage();
    const record = await uploadMedia(tdb.db, storage, {
      filename: "wolf.png",
      mimeType: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      authorId,
      alt: "A wolf",
    });
    const post = await createPost(tdb.db, { title: "Hello", content: "Body.", authorId });
    const saved = await setPostSeo(tdb.db, post.id, { ogImageId: record.id });
    expect(saved.ogImageId).toBe(record.id);
  });
});

describe("SEO analysis (deterministic)", () => {
  it("scores a well-built post 100", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, {
      title: "Walking the Ridge Trail at Dawn",
      content: goodContent(),
      excerpt: "A plain walk along the ridge trail at dawn, with the pack.",
      status: "publish",
      authorId,
    });
    await setPostSeo(tdb.db, post.id, {
      description: "Walk the ridge trail at dawn with the pack — route, rest stops and what to bring.",
      focusKeyword: "ridge trail",
      canonical: "https://example.test/walking-the-ridge-trail-at-dawn",
    });
    const analysis = await analyzePostSeo(tdb.db, post.id, "http://localhost:8787");
    expect(analysis.score).toBe(100);
    expect(analysis.wordCount).toBeGreaterThanOrEqual(300);
    expect(analysis.internalLinks).toBe(1);
    expect(analysis.externalLinks).toBe(1);
    expect(analysis.images).toBe(1);
    expect(analysis.imagesMissingAlt).toBe(0);
    expect(analysis.readingEase).not.toBeNull();
    expect(analysis.readingEase ?? 0).toBeGreaterThanOrEqual(60);
    expect(analysis.checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("scores an empty post 50 with the expected failures", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, { title: "x", content: "", status: "publish", authorId });
    const analysis = await analyzePostSeo(tdb.db, post.id, "http://localhost:8787");
    expect(analysis.score).toBe(50);
    const byId = new Map(analysis.checks.map((c) => [c.id, c.status]));
    expect(byId.get("description")).toBe("fail");
    expect(byId.get("word-count")).toBe("fail");
    expect(byId.get("keyword")).toBe("warn");
    expect(byId.get("headings")).toBe("pass");
    expect(analysis.readingEase).toBeNull();
  });

  it("flags missing alt text, H1s in content and skipped heading levels", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, {
      title: "Alt test post title here",
      content: `<h1>Bad H1</h1><h2>Section</h2><h4>Skipped</h4><img src="/x.png"><img src="/y.png" alt="">`,
      excerpt: "An excerpt that is long enough to pass the description check.",
      status: "publish",
      authorId,
    });
    const analysis = await analyzePostSeo(tdb.db, post.id, "http://localhost:8787");
    const byId = new Map(analysis.checks.map((c) => [c.id, c]));
    expect(byId.get("images")?.status).toBe("fail");
    expect(analysis.imagesMissingAlt).toBe(2);
    expect(byId.get("headings")?.status).toBe("fail");
  });

  it("flags a keyword missing from the title and intro", async () => {
    const result = analyzeSeoContent({
      title: "Walking the Ridge Trail at Dawn",
      slug: "walking-the-ridge-trail-at-dawn",
      content: "<p>Some plain text about walking.</p>".repeat(30),
      excerpt: "",
      seoTitle: "",
      seoDescription: "A description that is long enough to pass the check here.",
      focusKeyword: "volcano",
      canonical: "",
      siteUrl: "http://localhost:8787",
    });
    const byId = new Map(result.checks.map((c) => [c.id, c.status]));
    expect(byId.get("keyword-title")).toBe("fail");
    expect(byId.get("keyword-intro")).toBe("fail");
    expect(byId.get("keyword-slug")).toBe("warn");
  });

  it("estimates readability and strips block comments", () => {
    expect(fleschReadingEase("The cat sat on the mat. ".repeat(20))).toBe(100);
    expect(fleschReadingEase("Short.")).toBeNull();
    expect(textFromContent('<!-- wp:paragraph --><p>Hello &amp; goodbye</p><!-- /wp:paragraph -->')).toBe(
      "Hello & goodbye",
    );
  });
});

describe("head tags", () => {
  it("emits canonical, OG, Twitter and JSON-LD for a post with SEO fields", async () => {
    const authorId = await seedAuthor();
    await setOption(tdb.db, "blogname", "Wolf Site");
    await setOption(tdb.db, "siteurl", "https://example.test");
    const post = await createPost(tdb.db, {
      title: "Walking the Ridge Trail at Dawn",
      content: goodContent(),
      excerpt: "A plain walk along the ridge trail at dawn.",
      status: "publish",
      authorId,
    });
    await setPostSeo(tdb.db, post.id, {
      title: "Ridge Trail at Dawn",
      description: "Walk the ridge trail at dawn with the pack.",
      canonical: "https://example.test/ridge-trail",
      twitterCard: "summary_large_image",
    });
    const page = await buildPageSeo(tdb.db, {
      kind: "single",
      title: post.title,
      description: post.excerpt,
      canonicalPath: "/walking-the-ridge-trail-at-dawn",
      post,
      breadcrumbs: [{ name: post.title, path: "/walking-the-ridge-trail-at-dawn" }],
    });
    expect(page.title).toBe("Ridge Trail at Dawn");
    expect(page.description).toBe("Walk the ridge trail at dawn with the pack.");
    expect(page.headTags).toContain('<link rel="canonical" href="https://example.test/ridge-trail">');
    expect(page.headTags).toContain('<meta property="og:type" content="article">');
    expect(page.headTags).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page.headTags).toContain('"@type":"Article"');
    expect(page.headTags).toContain('"@type":"BreadcrumbList"');
    expect(page.headTags).toContain('"@type":"WebSite"');
    expect(page.headTags).not.toContain("noindex");
  });

  it("falls back to post title and excerpt, and honours noindex", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, {
      title: "Plain Post",
      content: "Body text here.",
      excerpt: "The excerpt.",
      status: "publish",
      authorId,
    });
    await setPostSeo(tdb.db, post.id, { noindex: true });
    const page = await buildPageSeo(tdb.db, {
      kind: "single",
      title: post.title,
      description: post.excerpt,
      canonicalPath: "/plain-post",
      post,
    });
    expect(page.title).toBe("Plain Post");
    expect(page.description).toBe("The excerpt.");
    expect(page.headTags).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(page.headTags).toContain('<link rel="canonical" href="http://localhost:8787/plain-post">');
  });

  it("marks search and 404 pages noindex with no canonical", async () => {
    const search = await buildPageSeo(tdb.db, { kind: "search", title: "Search: wolves", description: "", canonicalPath: null });
    expect(search.headTags).toContain("noindex");
    expect(search.headTags).not.toContain("canonical");
    const notFound = await buildPageSeo(tdb.db, { kind: "404", title: "Not found", description: "", canonicalPath: null });
    expect(notFound.headTags).toContain("noindex");
  });

  it("escapes a hostile title in JSON-LD", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, {
      title: 'Evil </script><script>alert("x")</script>',
      content: "Body.",
      status: "publish",
      authorId,
    });
    const page = await buildPageSeo(tdb.db, { kind: "single", title: post.title, description: "", canonicalPath: "/evil", post });
    expect(page.headTags).not.toContain("</script><script>");
    expect(page.headTags).toContain("\\u003c/script\\u003e");
  });
});

describe("sitemap (paginated)", () => {
  it("serves a single urlset under 1,000 URLs with changefreq/priority", async () => {
    const authorId = await seedAuthor();
    await createPost(tdb.db, { title: "Hello", content: "Body.", status: "publish", authorId });
    const xml = await sitemapXml(tdb.db);
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<sitemapindex");
    expect(xml).toContain("<changefreq>daily</changefreq><priority>1.0</priority>");
    expect(xml).toContain("<loc>http://localhost:8787/hello</loc>");
  });

  it("paginates at 1,000 URLs with a 1,050-post fixture", async () => {
    const authorId = await seedAuthor();
    // Bulk insert (the service path would take too long for 1,050 posts).
    const values: string[] = [];
    for (let i = 1; i <= 1050; i++) {
      values.push(`(${authorId}, '2026-11-19 00:00:00', '2026-11-19 00:00:00', 'Body ${i}', 'Post ${i}', '', 'publish', 'post-${i}', '2026-11-19 00:00:00', '2026-11-19 00:00:00', 0, 'post', '', 'open')`);
    }
    tdb.sqlite.exec(
      `INSERT INTO wp_posts (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, post_name, post_modified, post_modified_gmt, post_parent, post_type, post_mime_type, comment_status) VALUES ${values.join(",")}`,
    );
    const urls = await collectSitemapUrls(tdb.db);
    expect(urls.length).toBe(1051); // home + 1,050 posts
    const index = await sitemapIndexXml(tdb.db, urls);
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("/sitemap.xml?page=1");
    expect(index).toContain("/sitemap.xml?page=2");
    const page1 = await sitemapXml(tdb.db, 1);
    expect((page1.match(/<url>/g) ?? []).length).toBe(1000);
    const page2 = await sitemapXml(tdb.db, 2);
    expect((page2.match(/<url>/g) ?? []).length).toBe(51);
    const asIndex = await sitemapXml(tdb.db);
    expect(asIndex).toContain("<sitemapindex");
  });

  it("includes image entries only for attachments that exist", async () => {
    const authorId = await seedAuthor();
    const storage = new InMemoryMediaStorage();
    const record = await uploadMedia(tdb.db, storage, {
      filename: "wolf.png",
      mimeType: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      authorId,
      title: "Wolf photo",
      alt: "A wolf",
    });
    await createPost(tdb.db, {
      title: "With image",
      content: `<!-- wp:image {"id":${record.id}} --><figure class="wp-block-image"><img src="${record.url}" alt="A wolf"/></figure><!-- /wp:image --><!-- wp:image {"id":99999} --><figure class="wp-block-image"><img src="/media/nope.png" alt="Missing"/></figure><!-- /wp:image -->`,
      status: "publish",
      authorId,
    });
    const xml = await sitemapXml(tdb.db);
    expect(xml).toContain("<image:image>");
    expect(xml).toContain(record.url);
    expect(xml).toContain("<image:title>Wolf photo</image:title>");
    expect(xml).not.toContain("/media/nope.png");
  });
});

describe("robots.txt", () => {
  it("serves the default and round-trips a custom file", async () => {
    const def = await getRobotsTxt(tdb.db);
    expect(def).toContain("User-agent: *");
    expect(def).toContain("Sitemap: http://localhost:8787/sitemap.xml");
    const custom = await setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /private/\n");
    expect(custom).toContain("Disallow: /private/");
    expect(custom).toContain("Sitemap: http://localhost:8787/sitemap.xml");
    expect(await getRobotsTxt(tdb.db)).toBe(custom);
    const cleared = await setRobotsTxt(tdb.db, "");
    expect(cleared).toContain("Allow: /");
  });

  it("rejects rules that would block the admin or the API", async () => {
    await expect(setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /\n")).rejects.toThrow("/admin");
    await expect(setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /admin\n")).rejects.toThrow("/admin");
    await expect(setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /api\n")).rejects.toThrow("/api");
    await expect(setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /a\n")).rejects.toThrow("/admin");
    await expect(setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /private\nBanana: yes\n")).rejects.toThrow("Unknown robots.txt directive");
    // But a rule that merely shares a prefix is fine.
    const ok = await setRobotsTxt(tdb.db, "User-agent: *\nDisallow: /apiary/\nDisallow: /administrator/\n");
    expect(ok).toContain("Disallow: /apiary/");
  });
});

describe("404 log", () => {
  it("strips query strings and fragments, counts repeats", async () => {
    expect(normalize404Path("/old-page?token=abc&x=1")).toBe("/old-page");
    expect(normalize404Path("/old-page#frag")).toBe("/old-page");
    expect(normalize404Path("/favicon.ico")).toBeNull();
    expect(normalize404Path("/api/posts")).toBeNull();
    expect(normalize404Path("/admin")).toBeNull();
    await logNotFound(tdb.db, "/gone?secret=hunter2", "https://example.test/");
    await logNotFound(tdb.db, "/gone");
    await logNotFound(tdb.db, "/other");
    const list = await listNotFound(tdb.db);
    expect(list.total).toBe(2);
    expect(list.entries[0]?.path).toBe("/gone");
    expect(list.entries[0]?.count).toBe(2);
    expect(list.entries[0]?.referrer).toBe("https://example.test/");
    expect(await deleteNotFound(tdb.db, "/gone?x=1")).toBe(true);
    expect((await listNotFound(tdb.db)).total).toBe(1);
  });

  it("prunes to the 500 most recently seen paths", async () => {
    for (let i = 0; i < 505; i++) {
      await logNotFound(tdb.db, `/missing-${i}`);
    }
    const list = await listNotFound(tdb.db, { perPage: 100 });
    expect(list.total).toBe(500);
  });
});

describe("redirect manager", () => {
  it("creates, lists, updates and deletes redirects", async () => {
    const created = await createRedirect(tdb.db, { oldPath: "/old", newPath: "/new" });
    expect(created.oldPath).toBe("/old");
    expect((await listRedirects(tdb.db)).total).toBe(1);
    const updated = await updateRedirect(tdb.db, created.id, { newPath: "/newer" });
    expect(updated.newPath).toBe("/newer");
    expect(await deleteRedirect(tdb.db, created.id)).toBe(true);
    expect((await listRedirects(tdb.db)).total).toBe(0);
  });

  it("validates paths and duplicates", async () => {
    await createRedirect(tdb.db, { oldPath: "/old", newPath: "/new" });
    await expect(createRedirect(tdb.db, { oldPath: "/old", newPath: "/other" })).rejects.toThrow("already exists");
    await expect(createRedirect(tdb.db, { oldPath: "no-slash", newPath: "/x" })).rejects.toThrow('start with "/"');
    await expect(createRedirect(tdb.db, { oldPath: "/same", newPath: "/same" })).rejects.toThrow("point at itself");
    await expect(createRedirect(tdb.db, { oldPath: "/x", newPath: "javascript:alert(1)" })).rejects.toThrow("site path or an absolute");
    const offsite = await createRedirect(tdb.db, { oldPath: "/away", newPath: "https://example.org/elsewhere" });
    expect(offsite.newPath).toBe("https://example.org/elsewhere");
    await expect(updateRedirect(tdb.db, 9999, { newPath: "/x" })).rejects.toThrow("not found");
  });
});

describe("content studio", () => {
  it("lists the three templates and creates real drafts from them", async () => {
    const authorId = await seedAuthor();
    expect(listTemplates()).toHaveLength(3);
    expect(getTemplate("how-to")?.name).toBe("How-to guide");
    expect(getTemplate("nope")).toBeUndefined();
    for (const template of listTemplates()) {
      const post = await createFromTemplate(tdb.db, template.slug, { authorId });
      expect(post.status).toBe("draft");
      expect(post.content).toContain("<!-- wp:");
      expect(post.content).toContain("wp-block-heading");
    }
    await expect(createFromTemplate(tdb.db, "nope", { authorId })).rejects.toThrow("Unknown content template");
  });

  it("groups posts by date for the next 30 days", async () => {
    const authorId = await seedAuthor();
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    tdb.sqlite.exec(
      `INSERT INTO wp_posts (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, post_name, post_modified, post_modified_gmt, post_parent, post_type, post_mime_type, comment_status) VALUES
       (${authorId}, '${today} 09:00:00', '${today} 09:00:00', 'Body', 'Today post', '', 'publish', 'today-post', '${today} 09:00:00', '${today} 09:00:00', 0, 'post', '', 'open'),
       (${authorId}, '${future} 09:00:00', '${future} 09:00:00', 'Body', 'Future draft', '', 'draft', 'future-draft', '${future} 09:00:00', '${future} 09:00:00', 0, 'post', '', 'open'),
       (${authorId}, '${far} 09:00:00', '${far} 09:00:00', 'Body', 'Too far', '', 'draft', 'too-far', '${far} 09:00:00', '${far} 09:00:00', 0, 'post', '', 'open')`,
    );
    const calendar = await contentCalendar(tdb.db, 30);
    expect(calendar.days).toHaveLength(30);
    expect(calendar.total).toBe(2);
    const todayDay = calendar.days.find((d) => d.date === today);
    expect(todayDay?.posts).toHaveLength(1);
    const futureDay = calendar.days.find((d) => d.date === future);
    expect(futureDay?.posts[0]?.title).toBe("Future draft");
  });
});

describe("Yoast / Rank Math import", () => {
  it("applies Yoast keys by slug and Rank Math keys by id", async () => {
    const authorId = await seedAuthor();
    const a = await createPost(tdb.db, { title: "Yoast Post", content: "Body.", authorId });
    const b = await createPost(tdb.db, { title: "Rank Post", content: "Body.", authorId });
    const result = await importSeoMetadata(tdb.db, [
      {
        slug: a.slug,
        meta: {
          _yoast_wpseo_title: "Yoast Title",
          _yoast_wpseo_metadesc: "Yoast description here.",
          _yoast_wpseo_focuskw: "yoast",
          _yoast_wpseo_canonical: "https://example.test/yoast",
          "_yoast_wpseo_meta-robots-noindex": "1",
        },
      },
      {
        postId: b.id,
        meta: {
          rank_math_title: "Rank Title",
          rank_math_description: "Rank description here.",
          rank_math_focus_keyword: "rank",
          rank_math_robots: ["index", "noindex"],
        },
      },
    ]);
    expect(result.applied).toBe(2);
    expect(result.skipped).toHaveLength(0);
    const seoA = await getPostSeo(tdb.db, a.id);
    expect(seoA.title).toBe("Yoast Title");
    expect(seoA.focusKeyword).toBe("yoast");
    expect(seoA.noindex).toBe(true);
    const seoB = await getPostSeo(tdb.db, b.id);
    expect(seoB.title).toBe("Rank Title");
    expect(seoB.noindex).toBe(true);
  });

  it("skips unknown posts, invalid values and unknown keys honestly", async () => {
    const authorId = await seedAuthor();
    const post = await createPost(tdb.db, { title: "Kept", content: "Body.", authorId });
    const result = await importSeoMetadata(tdb.db, [
      { slug: "no-such-slug", meta: { _yoast_wpseo_title: "X" } },
      { postId: post.id, meta: { _yoast_wpseo_canonical: "not a url" } },
      { postId: post.id, meta: { _yoast_wpseo_title: "Fine", some_plugin_key: "ignored" } },
      { meta: { _yoast_wpseo_title: "No identity" } },
    ]);
    expect(result.applied).toBe(1);
    // 4 skipped entries: unknown slug, invalid canonical, no identity —
    // plus the applied row's own note about its ignored unknown key.
    expect(result.skipped).toHaveLength(4);
    expect(result.skipped.some((s) => s.reason.includes("unknown keys"))).toBe(true);
    expect(result.skipped.some((s) => s.reason.includes("No post with slug"))).toBe(true);
    expect((await getPostSeo(tdb.db, post.id)).title).toBe("Fine");
  });
});

describe("seo-auditor agent uses the engine", () => {
  it("reports the engine's average score and matches a direct analysis", async () => {
    const authorId = await seedAuthor();
    await setSelectedProviderId(tdb.db, "mock");
    const post = await createPost(tdb.db, {
      title: "Walking the Ridge Trail at Dawn",
      content: goodContent(),
      excerpt: "A plain walk along the ridge trail at dawn, with the pack.",
      status: "publish",
      authorId,
    });
    await setPostSeo(tdb.db, post.id, {
      description: "Walk the ridge trail at dawn with the pack — route, rest stops and what to bring.",
      focusKeyword: "ridge trail",
      canonical: "https://example.test/walking-the-ridge-trail-at-dawn",
    });
    const direct = await analyzePostSeo(tdb.db, post.id, "http://localhost:8787");
    expect(direct.score).toBe(100);
    const created = await createAiTask(tdb.db, { agent: "seo-auditor", input: "Audit the site" });
    const finished = await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: authorId });
    expect(finished.status).toBe("done");
    expect(finished.result?.data?.averageScore).toBe(100);
    expect(finished.result?.data?.total).toBe(1);
    expect(finished.result?.summary).toContain("average score 100/100");
    // M6 fields are still present (backwards compatible).
    expect(finished.result?.data?.missingExcerpt).toBe(0);
    expect(finished.result?.data?.missingTerms).toBe(1);
  });
});
