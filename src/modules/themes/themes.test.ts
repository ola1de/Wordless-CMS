/**
 * Themes (Milestone 5) — theme.json engine, templates, import, classic
 * analysis, variations, preview, compat.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { InMemoryMediaStorage } from "../../test/fake-storage";
import { createWordPressApi } from "../../compat/wordpress";
import {
  generateThemeCss,
  generateThemeCssWithVariation,
  mergeThemeSettings,
  parseThemeJson,
  stylesheetHash,
  validateThemeSettings,
} from "./themejson";
import {
  parseTemplateBlocks,
  renderTemplateFile,
  resolveTemplateName,
  type TemplateContext,
} from "./templates";
import { analyzeClassicTheme, parseStyleCssHeader } from "./classic";
import { extractThemeZip } from "./zip";
import {
  activateTheme,
  createPreview,
  deleteTheme,
  getPreview,
  getTheme,
  getVariation,
  importClassicTheme,
  importTheme,
  listThemes,
  loadActiveTheme,
  saveVariation,
} from "./service";
import { setOption } from "../options/service";
import { execRun, queryOne } from "../../db";
import type { Db } from "../../db";
import {
  DEFAULT_THEME_FILES,
  DEFAULT_THEME_JSON,
  DEFAULT_THEME_STYLE_CSS,
  DEFAULT_THEME_VERSION,
} from "./default-theme";

const MINIMAL_V3 = {
  version: 3,
  settings: {
    color: {
      palette: [
        { slug: "base", color: "#FFFFFF", name: "Base" },
        { slug: "primary", color: "#2563EB", name: "Primary" },
      ],
    },
    typography: {
      fontSizes: [{ slug: "medium", size: "1rem", name: "Medium" }],
    },
    layout: { contentSize: "680px", wideSize: "1080px" },
  },
  styles: {
    color: { background: "var:preset|color|base", text: "var:preset|color|contrast" },
    typography: { fontFamily: "system-ui, sans-serif", lineHeight: "1.7" },
    elements: { link: { color: { text: "var:preset|color|primary" } } },
  },
};

const MINIMAL_V3_CSS = `:root {
  --wp--preset--color--base: #FFFFFF;
  --wp--preset--color--primary: #2563EB;
  --wp--preset--font-size--medium: 1rem;
  --wp--style--global--content-size: 680px;
  --wp--style--global--wide-size: 1080px;
}
body {
  background-color: var(--wp--preset--color--base);
  color: var(--wp--preset--color--contrast);
  font-family: system-ui, sans-serif;
  line-height: 1.7;
}
a {
  color: var(--wp--preset--color--primary);
}
main, .wp-site-blocks {
  max-width: var(--wp--style--global--content-size);
  margin-left: auto;
  margin-right: auto;
}
.alignwide {
  max-width: var(--wp--style--global--wide-size);
}
`;

function fixturePath(rel: string): string {
  return fileURLToPath(new URL(`./fixtures/classic-sample/${rel}`, import.meta.url));
}

function classicSampleFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of ["style.css", "index.php", "single.php", "functions.php"]) {
    files.set(name, readFileSync(fixturePath(name), "utf8"));
  }
  return files;
}

function zipOf(files: Record<string, string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    input[path] = new TextEncoder().encode(content);
  }
  return zipSync(input);
}

const BLOCK_ZIP_STYLE = `/*
Theme Name: Test Block
Version: 1.2.0
Author: Wordless Test
Description: A minimal block theme for tests.
Text Domain: test-block
*/
body { color: #111; }
`;

function blockThemeZip(): Uint8Array {
  return zipOf({
    "test-block/style.css": BLOCK_ZIP_STYLE,
    "test-block/theme.json": JSON.stringify(MINIMAL_V3),
    "test-block/templates/index.html":
      '<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:query --><!-- wp:post-template --><!-- wp:post-title {"level":2,"isLink":true} /--><!-- /wp:post-template --><!-- /wp:query -->\n<!-- wp:template-part {"slug":"footer"} /-->',
    "test-block/parts/header.html": "<!-- wp:site-title /-->",
    "test-block/parts/footer.html": "<!-- wp:paragraph --><p>Footer</p><!-- /wp:paragraph -->",
  });
}

function baseContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    siteName: "Test Site",
    description: "A test site",
    nav: [{ title: "Home", url: "/" }],
    kind: "home",
    title: "Home",
    posts: [
      {
        title: "Hello Post",
        date: "2026-11-19T00:00:00.000Z",
        excerpt: "An excerpt.",
        contentHtml: "<p>Hello world.</p>",
        url: "/hello-post",
        commentCount: 0,
        terms: [{ name: "News", url: "/category/news", taxonomy: "category" }],
      },
      {
        title: "Second Post",
        date: "2026-11-18T00:00:00.000Z",
        excerpt: "",
        contentHtml: "<p>Second.</p>",
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

function defaultThemeFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [path, content] of Object.entries(DEFAULT_THEME_FILES)) files.set(path, content);
  files.set("style.css", DEFAULT_THEME_STYLE_CSS);
  return files;
}

describe("theme.json parsing + validation", () => {
  it("parses a valid v3 theme.json with no errors", () => {
    const parsed = parseThemeJson(MINIMAL_V3);
    expect(parsed.version).toBe(3);
    expect(parsed.errors).toEqual([]);
  });

  it("rejects a bad version and a palette entry without a colour", () => {
    const parsed = parseThemeJson({
      version: 4,
      settings: { color: { palette: [{ slug: "x", name: "X" }] } },
    });
    expect(parsed.errors.map((e) => e.path)).toContain("version");
    expect(parsed.errors.map((e) => e.path)).toContain("settings.color.palette[0].color");
  });

  it("rejects a font size without a size", () => {
    const parsed = parseThemeJson({
      version: 3,
      settings: { typography: { fontSizes: [{ slug: "big", name: "Big" }] } },
    });
    expect(parsed.errors.map((e) => e.path)).toContain("settings.typography.fontSizes[0].size");
  });

  it("rejects non-object theme.json", () => {
    expect(parseThemeJson("nope").errors.length).toBeGreaterThan(0);
    expect(parseThemeJson(null).errors.length).toBeGreaterThan(0);
  });

  it("records v1 gaps as unsupported warnings, not errors", () => {
    const parsed = parseThemeJson({
      version: 1,
      settings: { custom: { radius: "4px" } },
      customTemplates: [{ name: "x", title: "X" }],
      templateParts: [{ name: "header", title: "Header" }],
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.unsupported.join(" ")).toContain("settings.custom");
    expect(parsed.unsupported.join(" ")).toContain("customTemplates");
    expect(parsed.unsupported.join(" ")).toContain("templateParts");
  });

  it("records v2 gaps (writingMode, per-block elements) as unsupported", () => {
    const parsed = parseThemeJson({
      version: 2,
      settings: { typography: { writingMode: true } },
      styles: { blocks: { "core/quote": { elements: { link: { color: { text: "#000" } } } } } },
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.unsupported.join(" ")).toContain("writingMode");
    expect(parsed.unsupported.join(" ")).toContain("styles.blocks.core/quote.elements");
  });

  it("validates a variation's partial settings with the same rules", () => {
    expect(validateThemeSettings({ color: { palette: [{ slug: "x", color: "#fff", name: "X" }] } })).toEqual([]);
    const bad = validateThemeSettings({ color: { palette: [{ slug: "x", name: "X" }] } });
    expect(bad.map((e) => e.path)).toContain("settings.color.palette[0].color");
  });
});

describe("theme.json → CSS", () => {
  it("generates the exact expected stylesheet for a minimal v3 theme", () => {
    const parsed = parseThemeJson(MINIMAL_V3);
    expect(generateThemeCss(parsed)).toBe(MINIMAL_V3_CSS);
  });

  it("generates preset vars, fluid sizes and per-block styles", () => {
    const parsed = parseThemeJson({
      version: 3,
      settings: {
        color: { palette: [{ slug: "accent", color: "#0D9488", name: "Accent" }] },
        typography: {
          fontSizes: [{ slug: "large", size: "1.25rem", name: "Large", fluid: { min: "1.125rem", max: "1.5rem" } }],
        },
        spacing: { spacingSizes: [{ slug: "50", size: "30px", name: "Regular" }] },
        custom: { radius: "6px" },
      },
      styles: {
        blocks: { "core/quote": { color: { text: "var:preset|color|accent" } } },
        elements: { button: { color: { background: "var:preset|color|accent", text: "#fff" } } },
      },
    });
    const css = generateThemeCss(parsed);
    expect(css).toContain("--wp--preset--color--accent: #0D9488;");
    expect(css).toContain("--wp--preset--font-size--large: clamp(1.125rem,");
    expect(css).toContain("--wp--preset--spacing--50: 30px;");
    expect(css).toContain("--wp--custom--radius: 6px;");
    expect(css).toContain(".wp-block-quote {");
    expect(css).toContain("color: var(--wp--preset--color--accent);");
    expect(css).toContain("button, .wp-element-button");
  });

  it("hashes deterministically and changes with the CSS", () => {
    expect(stylesheetHash("a{}")).toBe(stylesheetHash("a{}"));
    expect(stylesheetHash("a{}")).not.toBe(stylesheetHash("b{}"));
    expect(stylesheetHash("a{}")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("merges variation settings by slug", () => {
    const merged = mergeThemeSettings(
      { color: { palette: [{ slug: "primary", color: "#111", name: "P" }] } },
      { color: { palette: [{ slug: "primary", color: "#F00" }, { slug: "new", color: "#0F0", name: "N" }] } },
    );
    const palette = (merged.color as { palette: Array<Record<string, unknown>> }).palette;
    expect(palette).toHaveLength(2);
    expect(palette[0]?.color).toBe("#F00");
    expect(palette[1]?.slug).toBe("new");
  });

  it("applies a variation to the generated CSS", () => {
    const parsed = parseThemeJson(MINIMAL_V3);
    const css = generateThemeCssWithVariation(parsed, {
      color: { palette: [{ slug: "primary", color: "#FF0000", name: "Primary" }] },
    });
    expect(css).toContain("--wp--preset--color--primary: #FF0000;");
    expect(css).toContain("--wp--preset--color--base: #FFFFFF;");
  });
});

describe("template hierarchy + rendering", () => {
  it("resolves single → singular → index in order", () => {
    expect(resolveTemplateName("single", new Set(["single.html", "index.html"]))).toBe("single.html");
    expect(resolveTemplateName("single", new Set(["singular.html", "index.html"]))).toBe("singular.html");
    expect(resolveTemplateName("single", new Set(["index.html"]))).toBe("index.html");
    expect(resolveTemplateName("single", new Set([]))).toBeNull();
    expect(resolveTemplateName("home", new Set(["index.html"]))).toBe("index.html");
    expect(resolveTemplateName("404", new Set(["404.html"]))).toBe("404.html");
  });

  it("parses nested blocks into a tree (group > paragraph)", () => {
    const blocks = parseTemplateBlocks(
      '<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph --></div><!-- /wp:group -->',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe("group");
    expect(blocks[0]?.children).toHaveLength(1);
    expect(blocks[0]?.children[0]?.name).toBe("paragraph");
    expect(blocks[0]?.children[0]?.innerHtml).toContain("<p>Hi</p>");
  });

  it("renders the default theme's index with posts, header and footer parts", () => {
    const rendered = renderTemplateFile("index.html", defaultThemeFiles(), baseContext());
    expect(rendered.html).toContain("Test Site");
    expect(rendered.html).toContain("Hello Post");
    expect(rendered.html).toContain("Second Post");
    expect(rendered.html).toContain("/hello-post");
    expect(rendered.html).toContain("Powered by");
    // No nested duplicate wrappers: the template's literal <header>/<main>/
    // <footer> tags must not be emitted alongside the constructed ones.
    const count = (html: string, needle: string): number => html.split(needle).length - 1;
    expect(count(rendered.html, '<header class="wp-block-group site-header">')).toBe(1);
    expect(count(rendered.html, '<main class="wp-block-group">')).toBe(1);
    expect(count(rendered.html, '<footer class="wp-block-group site-footer">')).toBe(1);
  });

  it("renders a single post with content and terms", () => {
    const post = baseContext().posts?.[0];
    const rendered = renderTemplateFile(
      "single.html",
      defaultThemeFiles(),
      baseContext({ kind: "single", post, title: "Hello Post" }),
    );
    expect(rendered.html).toContain("<p>Hello world.</p>");
    expect(rendered.html).toContain("Hello Post");
    expect(rendered.html).toContain("/category/news");
  });

  it("renders an empty query as 'No posts found'", () => {
    const rendered = renderTemplateFile("index.html", defaultThemeFiles(), baseContext({ posts: [] }));
    expect(rendered.html).toContain("No posts found.");
  });

  it("reports a missing template part instead of failing", () => {
    const files = new Map<string, string>([
      ["templates/index.html", '<!-- wp:template-part {"slug":"nope"} /-->'],
    ]);
    const rendered = renderTemplateFile("index.html", files, baseContext());
    expect(rendered.html).toBe("");
    expect(rendered.warnings.join(" ")).toContain("nope");
  });
});

describe("default theme bundle", () => {
  it("matches the repo source files byte for byte", () => {
    const repoJson = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../themes/wordless-default/theme.json", import.meta.url)), "utf8"),
    ) as unknown;
    expect(DEFAULT_THEME_JSON).toEqual(repoJson);
    const repoCss = readFileSync(
      fileURLToPath(new URL("../../../themes/wordless-default/style.css", import.meta.url)),
      "utf8",
    );
    expect(DEFAULT_THEME_STYLE_CSS.trim()).toBe(repoCss.trim());
    for (const [path, content] of Object.entries(DEFAULT_THEME_FILES)) {
      const repo = readFileSync(
        fileURLToPath(new URL(`../../../themes/wordless-default/${path}`, import.meta.url)),
        "utf8",
      );
      expect(content.trim(), path).toBe(repo.trim());
    }
  });

  it("parses cleanly as a v3 theme.json", () => {
    const parsed = parseThemeJson(DEFAULT_THEME_JSON);
    expect(parsed.version).toBe(3);
    expect(parsed.errors).toEqual([]);
  });
});

describe("theme ZIP import", () => {
  it("rejects a non-ZIP and an oversized ZIP", () => {
    expect(() => extractThemeZip(new TextEncoder().encode("not a zip"))).toThrow();
    expect(() => extractThemeZip(new Uint8Array(51 * 1024 * 1024))).toThrow(/50 MB/);
  });

  it("accepts a ZIP with 201 files (M11: the old 200-file cap is gone)", () => {
    const input: Record<string, Uint8Array> = { "style.css": new TextEncoder().encode("/* Theme Name: Big */") };
    for (let i = 0; i < 200; i++) {
      input[`part-${i}.html`] = new TextEncoder().encode("<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->");
    }
    const out = extractThemeZip(zipSync(input));
    expect(out.files.size).toBe(201);
  });

  it("rejects a ZIP with more than 10000 files", () => {
    const input: Record<string, Uint8Array> = { "style.css": new TextEncoder().encode("/* Theme Name: Huge */") };
    for (let i = 0; i < 10000; i++) {
      input[`part-${i}.html`] = new TextEncoder().encode("x");
    }
    expect(() => extractThemeZip(zipSync(input))).toThrow(/limit is 10000/);
  });

  it("rejects a path-traversal entry", () => {
    const zip = zipOf({ "../evil.txt": "x", "style.css": "/* Theme Name: X */" });
    expect(() => extractThemeZip(zip)).toThrow(/unsafe path/);
  });

  it("strips a single top-level folder", () => {
    const { files } = extractThemeZip(blockThemeZip());
    expect([...files.keys()].sort()).toEqual([
      "parts/footer.html",
      "parts/header.html",
      "style.css",
      "templates/index.html",
      "theme.json",
    ]);
  });

  it("imports, activates and deletes a block theme", async () => {
    const tdb = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const imported = await importTheme(tdb.db, storage, "test-block.zip", blockThemeZip());
      expect(imported.theme.slug).toBe("test-block");
      expect(imported.theme.kind).toBe("block");
      expect(imported.theme.status).toBe("inactive");
      expect(imported.files).toContain("theme.json");
      expect(await storage.list("themes/test-block/")).toHaveLength(5);

      const active = await activateTheme(tdb.db, "test-block");
      expect(active.status).toBe("active");
      const loaded = await loadActiveTheme(tdb.db, storage);
      expect(loaded.record.slug).toBe("test-block");
      expect(loaded.stylesheet).toContain("--wp--preset--color--primary: #2563EB;");
      expect(loaded.stylesheet).toContain("body { color: #111; }");

      // Cannot delete the active theme.
      await expect(deleteTheme(tdb.db, storage, "test-block")).rejects.toThrow(/active theme/);
      await activateTheme(tdb.db, "wordless-default");
      expect(await deleteTheme(tdb.db, storage, "test-block")).toBe(true);
      await expect(getTheme(tdb.db, "test-block")).rejects.toThrow();
    } finally {
      tdb.close();
    }
  });

  it("rejects a block import without theme.json", async () => {
    const tdb = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const zip = zipOf({ "style.css": BLOCK_ZIP_STYLE });
      await expect(importTheme(tdb.db, storage, "bad.zip", zip)).rejects.toThrow(/theme\.json/);
    } finally {
      tdb.close();
    }
  });

  it("auto-converts the theme PHP on import and carries settings over (M11)", async () => {
    const tdb = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const zip = zipOf({
        "test-block/style.css": BLOCK_ZIP_STYLE,
        "test-block/theme.json": JSON.stringify(MINIMAL_V3),
        "test-block/templates/index.html":
          '<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:query --><!-- wp:post-template --><!-- wp:post-title {"level":2,"isLink":true} /--><!-- /wp:post-template --><!-- /wp:query -->',
        "test-block/parts/header.html": "<!-- wp:site-title /-->",
        "test-block/parts/footer.html": "<!-- wp:paragraph --><p>Footer</p><!-- /wp:paragraph -->",
        "test-block/functions.php":
          "<?php\nif (!defined('ABSPATH')) exit;\nfunction test_block_setup() {\n  add_action('after_setup_theme', 'test_block_setup');\n  return get_option('test_block_mode', 'standard');\n}\n",
      });
      const imported = await importTheme(tdb.db, storage, "test-block.zip", zip);
      const conversion = (imported.theme.report as Record<string, unknown> | null)?.conversion as
        | Record<string, unknown>
        | undefined;
      expect(conversion).toBeDefined();
      expect(conversion?.converted).toBe(1);
      expect(conversion?.partial).toBe(0);
      expect(conversion?.blocked).toBe(0);
      const files = (conversion?.files as Array<Record<string, unknown>>) ?? [];
      expect(files[0]?.generatedPath).toBe("converted/functions.ts");
      expect(await storage.exists("themes/test-block/converted/functions.ts")).toBe(true);
      const settings = conversion?.settings as
        | { carriedOver: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>> }
        | undefined;
      const carriedKeys = (settings?.carriedOver ?? []).map((e) => e.key as string);
      expect(carriedKeys).toContain("test_block_mode");
      expect(carriedKeys).toContain("theme.json color palette");
      expect(carriedKeys).toContain("theme.json font sizes");
      expect(carriedKeys).toContain("theme.json layout widths");
      const { getOption } = await import("../options/service");
      expect(await getOption(tdb.db, "test_block_mode", null)).toBe("standard");
      // The look still carries over: activate and the theme.json presets
      // are in the served stylesheet.
      await activateTheme(tdb.db, "test-block");
      const loaded = await loadActiveTheme(tdb.db, storage);
      expect(loaded.record.slug).toBe("test-block");
      expect(loaded.stylesheet).toContain("--wp--preset--color--primary: #2563EB;");
    } finally {
      tdb.close();
    }
  });

  it("seeds the built-in default theme on first read", async () => {
    const tdb = createTestDb();
    try {
      const themes = await listThemes(tdb.db);
      expect(themes).toHaveLength(1);
      expect(themes[0]?.slug).toBe("wordless-default");
      expect(themes[0]?.status).toBe("active");
      const loaded = await loadActiveTheme(tdb.db, new InMemoryMediaStorage());
      expect(loaded.stylesheet).toContain("--wp--preset--color--primary: #0D9488;");
      expect(loaded.files.has("templates/single.html")).toBe(true);
    } finally {
      tdb.close();
    }
  });
});

describe("built-in default theme refresh on upgrade", () => {
  async function seedThemeRow(
    db: Db,
    row: { slug: string; version: string; stylesheet: string; source: string },
  ): Promise<void> {
    await execRun(
      db,
      `INSERT INTO wl_themes
       (slug, name, version, author, kind, status, theme_json, stylesheet, stylesheet_hash, source, report_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.slug,
        row.slug,
        row.version,
        "Wordless",
        "block",
        "active",
        "{}",
        row.stylesheet,
        "stale-hash",
        row.source,
        null,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ],
    );
  }

  it("refreshes a stale built-in row when the bundled theme is newer", async () => {
    const tdb = createTestDb();
    try {
      await seedThemeRow(tdb.db, {
        slug: "wordless-default",
        version: "0.5.0",
        stylesheet: "/* stale */",
        source: "builtin",
      });
      const themes = await listThemes(tdb.db);
      const def = themes.find((t) => t.slug === "wordless-default");
      expect(def?.version).toBe(DEFAULT_THEME_VERSION);
      expect(def?.version).not.toBe("0.5.0");
      const stored = await queryOne<{ stylesheet: string; stylesheet_hash: string }>(
        tdb.db,
        "SELECT stylesheet, stylesheet_hash FROM wl_themes WHERE slug = 'wordless-default'",
      );
      expect(stored?.stylesheet).toContain(".post-card");
      expect(stored?.stylesheet_hash).not.toBe("stale-hash");
    } finally {
      tdb.close();
    }
  });

  it("never downgrades a built-in row newer than the bundle", async () => {
    const tdb = createTestDb();
    try {
      await seedThemeRow(tdb.db, {
        slug: "wordless-default",
        version: "9.9.9",
        stylesheet: "/* newer */",
        source: "builtin",
      });
      await listThemes(tdb.db);
      const stored = await queryOne<{ version: string; stylesheet: string }>(
        tdb.db,
        "SELECT version, stylesheet FROM wl_themes WHERE slug = 'wordless-default'",
      );
      expect(stored?.version).toBe("9.9.9");
      expect(stored?.stylesheet).toBe("/* newer */");
    } finally {
      tdb.close();
    }
  });

  it("leaves imported and custom themes alone", async () => {
    const tdb = createTestDb();
    try {
      await seedThemeRow(tdb.db, {
        slug: "wordless-default",
        version: "0.5.0",
        stylesheet: "/* stale */",
        source: "builtin",
      });
      await seedThemeRow(tdb.db, {
        slug: "custom",
        version: "1.0.0",
        stylesheet: "/* custom */",
        source: "imported",
      });
      await listThemes(tdb.db);
      const custom = await queryOne<{ version: string; stylesheet: string }>(
        tdb.db,
        "SELECT version, stylesheet FROM wl_themes WHERE slug = 'custom'",
      );
      expect(custom?.version).toBe("1.0.0");
      expect(custom?.stylesheet).toBe("/* custom */");
      const def = await queryOne<{ version: string }>(
        tdb.db,
        "SELECT version FROM wl_themes WHERE slug = 'wordless-default'",
      );
      expect(def?.version).toBe(DEFAULT_THEME_VERSION);
    } finally {
      tdb.close();
    }
  });
});

describe("classic themes", () => {
  it("parses a style.css header", () => {
    const header = parseStyleCssHeader(classicSampleFiles().get("style.css") ?? "");
    expect(header?.name).toBe("Classic Sample");
    expect(header?.version).toBe("1.0.0");
    expect(header?.textDomain).toBe("classic-sample");
  });

  it("analyses the synthetic classic fixture (all convertible, tags found)", () => {
    const report = analyzeClassicTheme(classicSampleFiles());
    expect(report).not.toBeNull();
    expect(report?.convertible).toBe(3);
    expect(report?.partial).toBe(0);
    expect(report?.blocked).toBe(0);
    const index = report?.files.find((f) => f.file === "index.php");
    expect(index?.templateTags).toContain("get_header");
    expect(index?.templateTags).toContain("have_posts");
    expect(index?.templateTags).toContain("the_content");
    const functions = report?.files.find((f) => f.file === "functions.php");
    expect(functions?.hooks.map((h) => h.tag)).toContain("after_setup_theme");
    expect(functions?.hooks.map((h) => h.tag)).toContain("wp_enqueue_scripts");
  });

  it("imports a classic theme: stylesheet + report, CSS-only activation", async () => {
    const tdb = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const zip = zipOf(Object.fromEntries(classicSampleFiles()));
      const { theme, report } = await importClassicTheme(tdb.db, storage, "classic-sample.zip", zip);
      expect(theme.slug).toBe("classic-sample");
      expect(theme.kind).toBe("classic");
      expect(report.convertible).toBe(3);
      expect(theme.stylesheetHash).not.toBe("");
      const loaded = await loadActiveTheme(tdb.db, storage);
      expect(loaded.record.slug).toBe("wordless-default");
      const active = await activateTheme(tdb.db, "classic-sample");
      expect(active.status).toBe("active");
      const classicLoaded = await loadActiveTheme(tdb.db, storage);
      expect(classicLoaded.record.kind).toBe("classic");
      expect(classicLoaded.stylesheet).toContain("background: #fff;");
    } finally {
      tdb.close();
    }
  });
});

describe("variations + preview", () => {
  it("saves, loads and applies a variation", async () => {
    const tdb = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const variation = await saveVariation(tdb.db, "wordless-default", {
        name: "Red",
        settings: { color: { palette: [{ slug: "primary", color: "#FF0000", name: "Primary" }] } },
      });
      expect(variation.name).toBe("Red");
      expect(await getVariation(tdb.db, "wordless-default")).toEqual(variation);
      const loaded = await loadActiveTheme(tdb.db, storage, variation.settings);
      expect(loaded.stylesheet).toContain("--wp--preset--color--primary: #FF0000;");
      expect(loaded.stylesheet).toContain("--wp--preset--color--base: #FFFFFF;");
      // The stylesheet hash must change with the variation, or the live
      // site's /theme.css?v=<hash> link would keep serving cached CSS.
      const unvaried = await loadActiveTheme(tdb.db, storage);
      expect(loaded.stylesheetHash).not.toBe(unvaried.stylesheetHash);
    } finally {
      tdb.close();
    }
  });

  it("rejects an invalid variation and a classic-theme variation", async () => {
    const tdb = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      await expect(
        saveVariation(tdb.db, "wordless-default", {
          settings: { color: { palette: [{ slug: "x", name: "X" }] } },
        }),
      ).rejects.toThrow(/invalid/);
      const zip = zipOf(Object.fromEntries(classicSampleFiles()));
      await importClassicTheme(tdb.db, storage, "classic-sample.zip", zip);
      await expect(saveVariation(tdb.db, "classic-sample", { settings: {} })).rejects.toThrow(/block themes only/);
    } finally {
      tdb.close();
    }
  });

  it("creates a preview token and honours expiry", async () => {
    const tdb = createTestDb();
    try {
      const preview = await createPreview(tdb.db, "wordless-default", {
        color: { palette: [{ slug: "primary", color: "#00FF00", name: "Primary" }] },
      });
      expect(preview.token).toMatch(/^[0-9a-f]{32}$/);
      const resolved = await getPreview(tdb.db, preview.token);
      expect(resolved?.slug).toBe("wordless-default");
      expect(await getPreview(tdb.db, "deadbeef")).toBeNull();
      // Expire it by hand and confirm it no longer resolves.
      await setOption(tdb.db, "wl_theme_preview", { ...preview, expiresAt: "2020-01-01T00:00:00.000Z" });
      expect(await getPreview(tdb.db, preview.token)).toBeNull();
    } finally {
      tdb.close();
    }
  });
});

describe("theme compat functions", () => {
  it("wp_get_theme / get_stylesheet / get_template / get_theme_root", async () => {
    const tdb = createTestDb();
    try {
      const wp = createWordPressApi({ db: tdb.db, currentUser: null });
      expect(wp.get_theme_root()).toBe("themes/");
      expect(await wp.get_stylesheet()).toBe("wordless-default");
      expect(await wp.get_template()).toBe("wordless-default");
      const theme = await wp.wp_get_theme();
      expect(theme.slug).toBe("wordless-default");
      expect(theme.name).toBe("Wordless");
      expect(theme.status).toBe("active");
    } finally {
      tdb.close();
    }
  });
});
