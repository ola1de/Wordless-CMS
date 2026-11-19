import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost } from "../posts/service";
import { renderContent } from "./blocks";
import { renderHome, renderNotFound, renderSingle } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("block rendering", () => {
  it("renders paragraph, heading, list, quote, image and code blocks", () => {
    const content = [
      "<!-- wp:paragraph --><p>Hello <strong>world</strong></p><!-- /wp:paragraph -->",
      '<!-- wp:heading {"level":3} --><h3>Section</h3><!-- /wp:heading -->',
      "<!-- wp:list --><ul><li>one</li><li>two</li></ul><!-- /wp:list -->",
      "<!-- wp:quote --><blockquote>Quoted</blockquote><!-- /wp:quote -->",
      '<!-- wp:image {"url":"https://example.com/a.png","alt":"Alt text"} /-->',
      "<!-- wp:code --><pre><code>const x = 1;</code></pre><!-- /wp:code -->",
      "<!-- wp:separator /-->",
    ].join("\n");
    const html = renderContent(content);
    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("<h3>Section</h3>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<blockquote>Quoted</blockquote>");
    expect(html).toContain('<img src="https://example.com/a.png" alt="Alt text">');
    expect(html).toContain("<pre><code>const x = 1;</code></pre>");
    expect(html).toContain("<hr>");
  });

  it("renders unknown blocks' inner HTML unchanged and strips scripts", () => {
    const content =
      '<!-- wp:gallery --><figure><img src="x.png"></figure><!-- /wp:gallery -->' +
      '<script>alert("xss")</script>' +
      '<!-- wp:paragraph --><p onclick="evil()">Safe</p><!-- /wp:paragraph -->';
    const html = renderContent(content);
    expect(html).toContain('<figure><img src="x.png"></figure>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<p>Safe</p>");
  });

  it("returns classic content as stored when there are no blocks", () => {
    expect(renderContent("<p>Classic</p>")).toBe("<p>Classic</p>");
    expect(renderContent("plain text")).toBe("plain text");
  });
});

describe("public pages", () => {
  it("home lists published posts only, with escaped titles", async () => {
    await createPost(tdb.db, { title: "Public <script>", content: "Body", authorId: 1, status: "publish" });
    await createPost(tdb.db, { title: "Draft One", content: "Body", authorId: 1, status: "draft" });
    const page = await renderHome(tdb.db, 1);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Public &lt;script&gt;");
    expect(page.html).not.toContain("<script>");
    expect(page.html).not.toContain("Draft One");
    expect(page.html).toContain('href="/feed"');
  });

  it("single post page renders blocks and escapes the title", async () => {
    const post = await createPost(tdb.db, {
      title: "A & B",
      content: "<!-- wp:paragraph --><p>Body text</p><!-- /wp:paragraph -->",
      authorId: 1,
      status: "publish",
    });
    const page = await renderSingle(tdb.db, post);
    expect(page.status).toBe(200);
    expect(page.html).toContain("<title>A &amp; B — Wordless</title>");
    expect(page.html).toContain("<p>Body text</p>");
    expect(page.html).toContain("Leave a reply");
  });

  it("404 page returns status 404 with a home link", async () => {
    const page = await renderNotFound(tdb.db);
    expect(page.status).toBe(404);
    expect(page.html).toContain("Page not found");
    expect(page.html).toContain('href="/"');
  });
});
