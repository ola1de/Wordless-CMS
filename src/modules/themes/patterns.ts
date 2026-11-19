/**
 * Block-pattern rendering (Milestone 10 — closes the M5 known gap).
 *
 * WordPress block themes (notably Twenty Twenty-Five) build their
 * templates and template parts almost entirely from `wp:pattern` blocks:
 * a pattern is a reusable block fragment registered by the theme and
 * stored as a file under `patterns/<name>.php` (or `.html`). In M5 the
 * renderer recorded patterns and rendered nothing, so such themes
 * imported cleanly but rendered nearly empty pages.
 *
 * This module resolves a pattern slug to its file and extracts the block
 * HTML from it. The PHP in a pattern file is a static header comment
 * (an opening PHP tag, a docblock with Title/Slug, then a closing tag)
 * followed by block HTML — the header is stripped and the rest is
 * rendered as blocks. **No PHP is ever executed**: if anything that
 * looks like PHP remains after the leading header block, extraction
 * fails and the pattern renders nothing (with a warning), exactly like
 * the M4 safety rule for converted code.
 *
 * Limits (honest, tested):
 * - Only the file-based patterns a theme ships are resolved
 *   (`patterns/<name>.php`, falling back to `.html`). Patterns registered
 *   by plugins or by `theme.json`'s `patterns` list without a file are
 *   not rendered — the renderer warns and renders nothing.
 * - Pattern nesting is bounded (depth 5, shared with template parts)
 *   and a pattern that references itself (directly or through a cycle)
 *   renders once and warns, so a bad theme cannot loop the renderer.
 */
import { badRequest } from "../../kernel/errors";

/** `twentytwentyfive/template-query-loop` → `template-query-loop.php`. */
export function patternFileName(slug: string): string {
  const base = slug.split("/").pop() ?? "";
  const clean = base.replace(/[^a-z0-9_-]/gi, "");
  if (clean === "") throw badRequest(`Pattern slug "${slug}" has no usable name.`);
  return `${clean}.php`;
}

const LEADING_PHP_RE = /^\s*<\?php[\s\S]*?\?>\s*/;

/**
 * Extract the block HTML from a pattern file's source: strip the leading
 * PHP header block and return the rest, which may still contain inline
 * PHP snippets — those are evaluated by pattern-php.ts (allowlisted
 * i18n/escaping calls only). Returns null when the remaining content is
 * empty.
 */
export function extractPatternHtml(source: string): string | null {
  const withoutHeader = source.replace(LEADING_PHP_RE, "");
  const html = withoutHeader.trim();
  return html === "" ? null : html;
}

/**
 * Find a pattern file in a theme's files map (relative path → content).
 * Tries `patterns/<name>.php` then `patterns/<name>.html`.
 */
export function findPatternFile(
  files: Map<string, string>,
  slug: string,
): { path: string; source: string } | null {
  const base = patternFileName(slug).replace(/\.php$/, "");
  for (const ext of [".php", ".html"]) {
    const path = `patterns/${base}${ext}`;
    const source = files.get(path);
    if (source !== undefined) return { path, source };
  }
  return null;
}
