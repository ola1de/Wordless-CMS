/**
 * Block-theme template engine (Milestone 5).
 *
 * Resolves the WordPress template hierarchy, parses block templates
 * (which may nest — unlike flat post content, so this parser is a
 * stack-based tree parser, not the flat parser in render/blocks.ts) and
 * renders them with a plain data context prepared by render/service.ts.
 *
 * Supported template blocks (v1): template-part, site-title, site-tagline,
 * navigation, query, post-template, post-title, post-content, post-excerpt,
 * post-date, post-terms, query-title, query-pagination, search, group,
 * columns, column, and every content block render/blocks.ts already knows
 * (paragraph, heading, list, quote, image, code, separator, spacer).
 * `pattern` blocks are recorded, not rendered (patterns are registered
 * fragments; rendering them is out of scope for v1). `post-featured-image`
 * renders nothing — Wordless has no featured-image assignment yet.
 * Unknown blocks render their inner HTML unchanged, same policy as M2.
 */
import { escapeHtml } from "../render/theme";
import { parseBlocks, renderBlock, type Block } from "../render/blocks";

export type TemplateKind = "home" | "single" | "page" | "archive" | "search" | "404" | "index";

export interface TemplateLink {
  title: string;
  url: string;
}

export interface TemplatePostData {
  title: string;
  date: string;
  excerpt: string;
  /** Already-rendered post content HTML (via renderContent). */
  contentHtml: string;
  url: string;
  commentCount: number;
  terms: Array<{ name: string; url: string; taxonomy: string }>;
}

export interface TemplateContext {
  siteName: string;
  description: string;
  nav: TemplateLink[];
  kind: TemplateKind;
  /** Page <title> text (without the site name suffix). */
  title: string;
  post?: TemplatePostData;
  posts?: TemplatePostData[];
  page: number;
  totalPages: number;
  /** Base URL for pagination links (path + existing query, without page=). */
  baseUrl: string;
  /** Search query, when kind === "search". */
  query?: string;
  /** Archive heading, when kind === "archive". */
  archiveTitle?: string;
}

export interface TemplateBlock {
  name: string;
  attrs: Record<string, unknown>;
  /** Raw inner HTML between the open/close comments (leaf blocks). */
  innerHtml: string;
  children: TemplateBlock[];
  selfClosing: boolean;
}

export interface RenderedTemplate {
  html: string;
  warnings: string[];
}

const TEMPLATE_CANDIDATES: Record<TemplateKind, string[]> = {
  home: ["home.html", "index.html"],
  single: ["single.html", "singular.html", "index.html"],
  page: ["page.html", "singular.html", "index.html"],
  archive: ["archive.html", "index.html"],
  search: ["search.html", "archive.html", "index.html"],
  "404": ["404.html", "index.html"],
  index: ["index.html"],
};

/** First template that exists for this kind, or null when none do. */
export function resolveTemplateName(kind: TemplateKind, available: Set<string>): string | null {
  for (const name of TEMPLATE_CANDIDATES[kind]) {
    if (available.has(name)) return name;
  }
  return null;
}

const TOKEN_RE = /<!--\s*(\/?)wp:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?)\s*(\{[^>]*\})?\s*(\/?)-->/g;

function parseAttrs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Stack-based tree parser for block templates. Handles nesting (group >
 * paragraph, query > post-template) that the flat post-content parser
 * cannot. Unmatched closes are ignored; unclosed opens keep the rest.
 */
export function parseTemplateBlocks(html: string): TemplateBlock[] {
  const root: TemplateBlock[] = [];
  const stack: TemplateBlock[] = [];
  const push = (block: TemplateBlock): void => {
    if (stack.length > 0) {
      (stack[stack.length - 1] as TemplateBlock).children.push(block);
    } else {
      root.push(block);
    }
  };
  const text = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === "") return;
    push({ name: "freeform", attrs: {}, innerHtml: raw, children: [], selfClosing: false });
  };

  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(html)) !== null) {
    const full = match[0];
    const isClose = match[1] === "/";
    const name = match[2] ?? "";
    const before = html.slice(lastIndex, match.index);
    if (before.trim() !== "") {
      // Raw HTML between blocks belongs to the innermost open block.
      const top = stack[stack.length - 1];
      if (top !== undefined) {
        top.innerHtml += before;
      } else {
        text(before);
      }
    }
    lastIndex = match.index + full.length;
    if (isClose) {
      // Pop until the matching open block (tolerates a missing open).
      while (stack.length > 0) {
        const popped = stack.pop() as TemplateBlock;
        if (popped.name === name) break;
      }
      continue;
    }
    const selfClosing = match[4] === "/";
    const block: TemplateBlock = {
      name,
      attrs: parseAttrs(match[3]),
      innerHtml: "",
      children: [],
      selfClosing,
    };
    push(block);
    if (!selfClosing) stack.push(block);
  }
  const tail = html.slice(lastIndex);
  if (tail.trim() !== "") {
    const top = stack[stack.length - 1];
    if (top !== undefined) top.innerHtml += tail;
    else text(tail);
  }
  return root;
}

function paginationHtml(ctx: TemplateContext): string {
  if (ctx.totalPages <= 1) return "";
  const sep = ctx.baseUrl.includes("?") ? "&" : "?";
  const prev =
    ctx.page > 1
      ? `<a href="${escapeHtml(`${ctx.baseUrl}${sep}page=${ctx.page - 1}`)}">&larr; Newer</a>`
      : "<span></span>";
  const next =
    ctx.page < ctx.totalPages
      ? `<a href="${escapeHtml(`${ctx.baseUrl}${sep}page=${ctx.page + 1}`)}">Older &rarr;</a>`
      : "<span></span>";
  return `<nav class="pagination" aria-label="Pagination">${prev}${next}</nav>`;
}

function inlineStyleFromAttrs(attrs: Record<string, unknown>): string {
  const parts: string[] = [];
  const style = attrs.style;
  if (style !== null && typeof style === "object") {
    const s = style as Record<string, unknown>;
    const spacing = s.spacing;
    if (spacing !== null && typeof spacing === "object") {
      const sp = spacing as Record<string, unknown>;
      for (const key of ["padding", "margin"] as const) {
        const value = sp[key];
        if (typeof value === "string") parts.push(`${key}: ${value}`);
        else if (value !== null && typeof value === "object") {
          const obj = value as Record<string, unknown>;
          for (const side of ["top", "right", "bottom", "left"] as const) {
            if (typeof obj[side] === "string") parts.push(`${key}-${side}: ${obj[side] as string}`);
          }
        }
      }
    }
    const typography = s.typography;
    if (typography !== null && typeof typography === "object") {
      const ty = typography as Record<string, unknown>;
      if (typeof ty.fontSize === "string") parts.push(`font-size: ${ty.fontSize}`);
      if (typeof ty.lineHeight === "string") parts.push(`line-height: ${ty.lineHeight}`);
    }
    const color = s.color;
    if (color !== null && typeof color === "object") {
      const c = color as Record<string, unknown>;
      if (typeof c.background === "string") parts.push(`background-color: ${c.background}`);
      if (typeof c.text === "string") parts.push(`color: ${c.text}`);
    }
  }
  // Resolve preset vars (var:preset|spacing|60 → var(--wp--preset--spacing--60)).
  return parts
    .map((p) =>
      p.replace(/var:preset\|([a-z-]+)\|([a-z0-9-]+)/g, (_m, kind: string, slug: string) =>
        kind === "custom" ? `var(--wp--custom--${slug})` : `var(--wp--preset--${kind}--${slug})`,
      ),
    )
    .join("; ");
}

function blockClass(attrs: Record<string, unknown>, base: string): string {
  const classes = [base];
  if (typeof attrs.className === "string" && attrs.className !== "") classes.push(attrs.className);
  if (typeof attrs.align === "string" && attrs.align !== "") classes.push(`align${attrs.align}`);
  if (typeof attrs.backgroundColor === "string") classes.push(`has-${attrs.backgroundColor}-background-color`);
  if (typeof attrs.textColor === "string") classes.push(`has-${attrs.textColor}-color`);
  if (typeof attrs.fontSize === "string") classes.push(`has-${attrs.fontSize}-font-size`);
  if (typeof attrs.fontFamily === "string") classes.push(`has-${attrs.fontFamily}-font-family`);
  return classes.join(" ");
}

interface RenderState {
  files: Map<string, string>;
  depth: number;
  warnings: string[];
}

function toContentBlock(block: TemplateBlock): Block {
  return { name: block.name, attrs: block.attrs, inner: block.innerHtml, selfClosing: block.selfClosing };
}

function renderBlocks(blocks: TemplateBlock[], ctx: TemplateContext, state: RenderState): string {
  return blocks.map((b) => renderTemplateBlock(b, ctx, state)).join("\n");
}

function renderTemplateBlock(block: TemplateBlock, ctx: TemplateContext, state: RenderState): string {
  const attrs = block.attrs;
  switch (block.name) {
    case "freeform":
      return block.innerHtml;
    case "template-part": {
      const slug = typeof attrs.slug === "string" ? attrs.slug : "";
      if (slug === "") return "";
      if (state.depth >= 5) {
        state.warnings.push(`Template part "${slug}" skipped: nesting too deep.`);
        return "";
      }
      const part = state.files.get(`parts/${slug}.html`);
      if (part === undefined) {
        state.warnings.push(`Template part "${slug}" not found in the theme.`);
        return "";
      }
      const inner = parseTemplateBlocks(part);
      return renderBlocks(inner, ctx, { ...state, depth: state.depth + 1 });
    }
    case "site-title": {
      const level = typeof attrs.level === "number" && attrs.level >= 1 && attrs.level <= 6 ? Math.floor(attrs.level) : 1;
      const text = `<a href="/">${escapeHtml(ctx.siteName)}</a>`;
      return `<h${level} class="wp-block-site-title">${text}</h${level}>`;
    }
    case "site-tagline":
      return ctx.description ? `<p class="wp-block-site-tagline">${escapeHtml(ctx.description)}</p>` : "";
    case "navigation": {
      if (ctx.nav.length === 0) return "";
      const items = ctx.nav
        .map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`)
        .join("");
      return `<nav class="wp-block-navigation" aria-label="Primary"><ul>${items}</ul></nav>`;
    }
    case "query": {
      const posts = ctx.posts ?? [];
      const template = block.children.find((c) => c.name === "post-template");
      if (template === undefined) {
        // No post-template: render children once (static query content).
        return renderBlocks(block.children, ctx, state);
      }
      if (posts.length === 0) {
        return `<p>No posts found.</p>`;
      }
      return posts
        .map((post) => renderBlocks(template.children, { ...ctx, post }, state))
        .join("\n");
    }
    case "post-template":
      // Only meaningful inside a query; render children with current post.
      return renderBlocks(block.children, ctx, state);
    case "post-title": {
      if (ctx.post === undefined) return "";
      const level =
        typeof attrs.level === "number" && attrs.level >= 1 && attrs.level <= 6 ? Math.floor(attrs.level) : 1;
      const text = escapeHtml(ctx.post.title || "(untitled)");
      const inner = attrs.isLink === true ? `<a href="${escapeHtml(ctx.post.url)}">${text}</a>` : text;
      return `<h${level} class="wp-block-post-title">${inner}</h${level}>`;
    }
    case "post-content":
      return ctx.post !== undefined ? ctx.post.contentHtml : "";
    case "post-excerpt":
      return ctx.post !== undefined && ctx.post.excerpt !== ""
        ? `<p class="wp-block-post-excerpt">${escapeHtml(ctx.post.excerpt)}</p>`
        : "";
    case "post-date":
      return ctx.post !== undefined ? `<time class="wp-block-post-date" datetime="${escapeHtml(ctx.post.date)}">${escapeHtml(ctx.post.date.slice(0, 10))}</time>` : "";
    case "post-terms": {
      if (ctx.post === undefined) return "";
      const taxonomy = typeof attrs.term === "string" ? attrs.term : "category";
      const separator = typeof attrs.separator === "string" ? attrs.separator : ", ";
      const terms = ctx.post.terms.filter((t) => t.taxonomy === taxonomy);
      if (terms.length === 0) return "";
      return `<div class="wp-block-post-terms">${terms
        .map((t) => `<a href="${escapeHtml(t.url)}">${escapeHtml(t.name)}</a>`)
        .join(escapeHtml(separator))}</div>`;
    }
    case "post-featured-image":
      // Wordless has no featured-image assignment yet (M5): nothing to show.
      state.warnings.push("post-featured-image renders nothing: featured images are not assigned yet.");
      return "";
    case "query-title": {
      const type = typeof attrs.type === "string" ? attrs.type : "";
      let text = ctx.title;
      if (type === "search" && ctx.query !== undefined) text = `Search results for “${ctx.query}”`;
      else if (type === "archive" && ctx.archiveTitle !== undefined) text = ctx.archiveTitle;
      return `<h1 class="wp-block-query-title">${escapeHtml(text)}</h1>`;
    }
    case "query-pagination":
      return paginationHtml(ctx);
    case "search":
      return `<form role="search" method="get" action="/search" class="wp-block-search"><label>Search <input type="search" name="q" value="${escapeHtml(ctx.query ?? "")}"></label> <button type="submit">Search</button></form>`;
    case "pattern":
      // Patterns are registered fragments, not executed in v1.
      state.warnings.push(`Pattern "${typeof attrs.slug === "string" ? attrs.slug : ""}" recorded but not rendered (v1).`);
      return "";
    case "group":
    case "columns":
    case "column": {
      const tag = typeof attrs.tagName === "string" && /^[a-z][a-z0-9]*$/.test(attrs.tagName) ? attrs.tagName : "div";
      const style = inlineStyleFromAttrs(attrs);
      const cls = blockClass(attrs, `wp-block-${block.name}`);
      // A block template's literal HTML repeats the wrapper the attrs
      // describe (e.g. <header class="wp-block-group site-header"> …
      // </header>). Build the wrapper from the attrs and drop those
      // literal tags, or the page gets nested duplicate wrappers. Any
      // other literal text inside the group is rare; keep it, after the
      // children (its exact position is not tracked by the parser).
      const literal = block.innerHtml
        .replace(/<!--\s*\/?wp:[^>]*-->/g, "")
        .replace(new RegExp(`^\\s*<${tag}(\\s[^>]*)?>`, "i"), "")
        .replace(new RegExp(`</${tag}>\\s*$`, "i"), "");
      const inner = renderBlocks(block.children, ctx, state) + (literal.trim() !== "" ? literal : "");
      return `<${tag} class="${escapeHtml(cls)}"${style !== "" ? ` style="${escapeHtml(style)}"` : ""}>${inner}</${tag}>`;
    }
    default: {
      // Content blocks (paragraph, heading, list, quote, image, code,
      // separator, spacer, button(s), …): reuse the M2 block renderer.
      // Nested children render first; leaf blocks use their stored HTML.
      if (block.children.length > 0) {
        const inner = renderBlocks(block.children, ctx, state);
        return renderBlock({ name: block.name, attrs, inner, selfClosing: false });
      }
      // parseBlocks-compatible: a template leaf block's inner HTML is
      // stored as-is; renderBlock handles it like post content.
      const { blocks } = parseBlocks(block.innerHtml);
      if (blocks.length > 0 && block.innerHtml.includes("<!--")) {
        return blocks.map((b) => renderBlock(b)).join("\n");
      }
      return renderBlock(toContentBlock(block));
    }
  }
}

/**
 * Render a full template file into page body HTML.
 * `files` maps relative paths (templates/*.html, parts/*.html) to content.
 */
export function renderTemplateFile(
  name: string,
  files: Map<string, string>,
  ctx: TemplateContext,
): RenderedTemplate {
  const source = files.get(`templates/${name}`);
  if (source === undefined) {
    return { html: "", warnings: [`Template "${name}" not found in the theme.`] };
  }
  const state: RenderState = { files, depth: 0, warnings: [] };
  const blocks = parseTemplateBlocks(source);
  return { html: renderBlocks(blocks, ctx, state), warnings: state.warnings };
}

/** Wrap rendered template body in a full HTML document. */
export function themedDocument(opts: {
  title: string;
  siteName: string;
  description: string;
  stylesheetHref: string;
  body: string;
  extraBody?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — ${escapeHtml(opts.siteName)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="stylesheet" href="${escapeHtml(opts.stylesheetHref)}">
</head>
<body>
${opts.body}
${opts.extraBody ?? ""}
</body>
</html>`;
}
