/**
 * Block-pattern rendering tests (Milestone 10).
 *
 * Proves the M5 gap is closed: a `wp:pattern` block renders the theme's
 * `patterns/<name>.php` file (header stripped, block HTML rendered),
 * including a query-loop pattern like Twenty Twenty-Five's
 * `template-query-loop`. Also proves the safety rules: PHP beyond the
 * header refuses the pattern (never executed), missing patterns warn,
 * and self-referencing patterns cannot loop the renderer.
 */
import { describe, expect, it } from "vitest";
import { extractPatternHtml, findPatternFile, patternFileName } from "./patterns";
import { renderTemplateFile, type TemplateContext } from "./templates";

function baseContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    siteName: "Pattern Site",
    description: "Patterns, rendered",
    nav: [],
    kind: "home",
    title: "Home",
    posts: [
      {
        title: "First Post",
        date: "2026-11-19T00:00:00.000Z",
        excerpt: "First excerpt.",
        contentHtml: "<p>First body.</p>",
        url: "/first-post",
        commentCount: 0,
        terms: [],
      },
      {
        title: "Second Post",
        date: "2026-11-18T00:00:00.000Z",
        excerpt: "",
        contentHtml: "<p>Second body.</p>",
        url: "/second-post",
        commentCount: 0,
        terms: [],
      },
    ],
    page: 1,
    totalPages: 1,
    baseUrl: "/",
    ...overrides,
  };
}

const LOOP_PATTERN = `<?php
/**
 * Title: Template Query Loop
 * Slug: testtheme/template-query-loop
 * Categories: query
 * Block Types: core/query
 */
?>
<!-- wp:query --><!-- wp:post-template --><!-- wp:post-title {"level":2,"isLink":true} /--><!-- wp:post-excerpt /--><!-- /wp:post-template --><!-- /wp:query -->`;

describe("patternFileName / findPatternFile", () => {
  it("maps a namespaced slug to its file", () => {
    expect(patternFileName("twentytwentyfive/template-query-loop")).toBe("template-query-loop.php");
    expect(patternFileName("plain-slug")).toBe("plain-slug.php");
  });

  it("finds .php first, then .html", () => {
    const files = new Map([
      ["patterns/a.html", "<!-- wp:paragraph --><p>html</p><!-- /wp:paragraph -->"],
      ["patterns/b.php", "<!-- wp:paragraph --><p>php</p><!-- /wp:paragraph -->"],
    ]);
    expect(findPatternFile(files, "theme/a")?.path).toBe("patterns/a.html");
    expect(findPatternFile(files, "theme/b")?.path).toBe("patterns/b.php");
    expect(findPatternFile(files, "theme/missing")).toBeNull();
  });
});

describe("extractPatternHtml", () => {
  it("strips the leading PHP header and keeps the block HTML", () => {
    const html = extractPatternHtml(LOOP_PATTERN);
    expect(html).toContain("wp:query");
    expect(html).not.toContain("<?php");
  });

  it("passes pure-HTML pattern files through", () => {
    expect(extractPatternHtml("<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->")).toContain("wp:paragraph");
  });

  it("keeps inline PHP snippets for the evaluator (it does not execute them)", () => {
    const source = `<?php /** Title: X */ ?>\n<!-- wp:paragraph --><p><?php esc_html_e( 'Hello', 'theme' ); ?></p><!-- /wp:paragraph -->`;
    const html = extractPatternHtml(source);
    expect(html).toContain("esc_html_e");
    expect(html).not.toContain("Title: X");
  });

  it("returns null for an empty pattern", () => {
    expect(extractPatternHtml(`<?php /** Title: Empty */ ?>\n`)).toBeNull();
  });
});

describe("renderTemplateFile with patterns", () => {
  it("renders a query-loop pattern (the Twenty Twenty-Five shape)", () => {
    const files = new Map<string, string>([
      [
        "templates/home.html",
        '<!-- wp:pattern {"slug":"testtheme/template-query-loop"} /-->',
      ],
      ["patterns/template-query-loop.php", LOOP_PATTERN],
    ]);
    const rendered = renderTemplateFile("home.html", files, baseContext());
    expect(rendered.html).toContain("First Post");
    expect(rendered.html).toContain("Second Post");
    expect(rendered.html).toContain("First excerpt.");
    expect(rendered.html).not.toContain("wp:pattern");
    expect(rendered.warnings).toEqual([]);
  });

  it("renders a pattern inside a template part (header/footer shape)", () => {
    const files = new Map<string, string>([
      [
        "templates/home.html",
        '<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->',
      ],
      [
        "parts/header.html",
        '<!-- wp:pattern {"slug":"testtheme/header"} /-->',
      ],
      [
        "patterns/header.php",
        `<?php /** Title: Header */ ?>\n<!-- wp:site-title /-->`,
      ],
    ]);
    const rendered = renderTemplateFile("home.html", files, baseContext());
    expect(rendered.html).toContain("Pattern Site");
    expect(rendered.html).toContain("Body");
  });

  it("renders nested patterns (a pattern referencing another pattern)", () => {
    const files = new Map<string, string>([
      ["templates/index.html", '<!-- wp:pattern {"slug":"testtheme/outer"} /-->'],
      [
        "patterns/outer.php",
        `<?php /** Title: Outer */ ?>\n<!-- wp:pattern {"slug":"testtheme/inner"} /-->`,
      ],
      [
        "patterns/inner.php",
        `<?php /** Title: Inner */ ?>\n<!-- wp:paragraph --><p>Inner content</p><!-- /wp:paragraph -->`,
      ],
    ]);
    const rendered = renderTemplateFile("index.html", files, baseContext());
    expect(rendered.html).toContain("Inner content");
    expect(rendered.warnings).toEqual([]);
  });

  it("warns and renders nothing for a missing pattern", () => {
    const files = new Map<string, string>([
      ["templates/index.html", '<!-- wp:pattern {"slug":"testtheme/gone"} /-->\n<!-- wp:paragraph --><p>Still here</p><!-- /wp:paragraph -->'],
    ]);
    const rendered = renderTemplateFile("index.html", files, baseContext());
    expect(rendered.html).toContain("Still here");
    expect(rendered.warnings.some((w) => w.includes("gone") && w.includes("not found"))).toBe(true);
  });

  it("refuses a pattern whose file has PHP outside the allowlist", () => {
    const files = new Map<string, string>([
      ["templates/index.html", '<!-- wp:pattern {"slug":"testtheme/danger"} /-->'],
      [
        "patterns/danger.php",
        `<?php /** Title: Danger */ ?>\n<!-- wp:paragraph --><p><?php echo $user_input; ?></p><!-- /wp:paragraph -->`,
      ],
      ["templates/index2.html", '<!-- wp:pattern {"slug":"testtheme/danger2"} /-->'],
      [
        "patterns/danger2.php",
        `<?php /** Title: Danger 2 */ ?>\n<!-- wp:paragraph --><p><?php system('id'); ?></p><!-- /wp:paragraph -->`,
      ],
    ]);
    const rendered = renderTemplateFile("index.html", files, baseContext());
    expect(rendered.html).not.toContain("user_input");
    expect(rendered.warnings.some((w) => w.includes("outside the allowlisted"))).toBe(true);
    const rendered2 = renderTemplateFile("index2.html", files, baseContext());
    expect(rendered2.warnings.some((w) => w.includes("outside the allowlisted"))).toBe(true);
  });

  it("evaluates a safe literal echo inside a pattern (Twenty Twenty-Five style)", () => {
    const files = new Map<string, string>([
      ["templates/index.html", '<!-- wp:pattern {"slug":"testtheme/heading"} /-->'],
      [
        "patterns/heading.php",
        `<?php /** Title: Heading */ ?>\n<!-- wp:heading --><h2><?php esc_html_e( 'Blog', 'testtheme' ); ?></h2><!-- /wp:heading -->`,
      ],
    ]);
    const rendered = renderTemplateFile("index.html", files, baseContext());
    expect(rendered.html).toContain("Blog");
    expect(rendered.html).not.toContain("<?php");
    expect(rendered.warnings).toEqual([]);
  });

  it("does not loop on a self-referencing pattern", () => {
    const files = new Map<string, string>([
      ["templates/index.html", '<!-- wp:pattern {"slug":"testtheme/loop"} /-->'],
      [
        "patterns/loop.php",
        `<?php /** Title: Loop */ ?>\n<!-- wp:paragraph --><p>Once</p><!-- /wp:paragraph -->\n<!-- wp:pattern {"slug":"testtheme/loop"} /-->`,
      ],
    ]);
    const rendered = renderTemplateFile("index.html", files, baseContext());
    expect(rendered.html.match(/Once/g)?.length).toBe(1);
    expect(rendered.warnings.some((w) => w.includes("cycle"))).toBe(true);
  });
});
