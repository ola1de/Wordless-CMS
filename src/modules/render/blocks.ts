/**
 * Gutenberg block rendering (v1).
 *
 * post_content stores block-comment HTML, e.g.
 *   <!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->
 *   <!-- wp:heading {"level":3} --><h3>Title</h3><!-- /wp:heading -->
 * This renderer parses those comments and emits clean HTML for the
 * supported blocks below. Unknown blocks render their inner HTML
 * unchanged (never dropped silently). Content with no block markers
 * (classic posts) is returned as stored.
 *
 * Safety: author content is trusted (only logged-in editors/authors can
 * write it), but <script> tags, inline event handlers and javascript:
 * links are stripped as defence in depth. This is a best-effort strip,
 * not a full HTML sanitizer — untrusted-HTML rendering is out of scope
 * for M2.
 */
import { escapeHtml } from "./theme";

export interface Block {
  name: string;
  attrs: Record<string, unknown>;
  inner: string;
  selfClosing: boolean;
}

const OPEN_RE = /<!--\s*wp:([a-z0-9]+(?:\/[a-z0-9-]+)?)\s*(\{[^>]*\})?\s*\/?-->/g;
const CLOSE_RE = /<!--\s*\/wp:([a-z0-9]+(?:\/[a-z0-9-]+)?)\s*-->/g;

export function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, ' href="#"');
}

function parseAttrs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Split stored content into blocks (plus any unparsed leading/trailing HTML). */
export function parseBlocks(content: string): { blocks: Block[]; hasBlocks: boolean } {
  const blocks: Block[] = [];
  let lastIndex = 0;
  let hasBlocks = false;
  OPEN_RE.lastIndex = 0;
  let open: RegExpExecArray | null;
  while ((open = OPEN_RE.exec(content)) !== null) {
    const name = open[1] ?? "";
    const attrsRaw = open[2];
    const openEnd = open.index + open[0].length;
    const selfClosing = /\/\s*-->$/.test(open[0]);
    hasBlocks = true;
    // Text before this block that is not inside a block is kept as raw HTML.
    const before = content.slice(lastIndex, open.index).trim();
    if (before.length > 0) {
      blocks.push({ name: "freeform", attrs: {}, inner: before, selfClosing: false });
    }
    if (selfClosing) {
      blocks.push({ name, attrs: parseAttrs(attrsRaw), inner: "", selfClosing: true });
      lastIndex = openEnd;
      continue;
    }
    CLOSE_RE.lastIndex = openEnd;
    const close = CLOSE_RE.exec(content);
    if (!close) {
      // Unterminated block: treat the rest as its inner HTML.
      blocks.push({ name, attrs: parseAttrs(attrsRaw), inner: content.slice(openEnd), selfClosing: false });
      lastIndex = content.length;
      break;
    }
    blocks.push({ name, attrs: parseAttrs(attrsRaw), inner: content.slice(openEnd, close.index), selfClosing: false });
    lastIndex = close.index + close[0].length;
  }
  const tail = content.slice(lastIndex).trim();
  if (tail.length > 0) {
    blocks.push({ name: "freeform", attrs: {}, inner: tail, selfClosing: false });
  }
  return { blocks, hasBlocks };
}

function renderBlock(block: Block): string {
  const inner = stripDangerousHtml(block.inner.trim());
  switch (block.name) {
    case "freeform":
      return inner;
    case "paragraph": {
      if (/^<p[\s>]/.test(inner)) return inner;
      return inner ? `<p>${inner}</p>` : "";
    }
    case "heading": {
      const level = typeof block.attrs.level === "number" && block.attrs.level >= 1 && block.attrs.level <= 6
        ? Math.floor(block.attrs.level)
        : 2;
      const text = inner.replace(/<\/?h[1-6][^>]*>/gi, "");
      return text ? `<h${level}>${text}</h${level}>` : "";
    }
    case "list": {
      if (/^<(ul|ol)[\s>]/.test(inner)) return inner;
      return inner ? `<ul>${inner}</ul>` : "";
    }
    case "quote": {
      const text = inner.replace(/<\/?blockquote[^>]*>/gi, "");
      return text ? `<blockquote>${text}</blockquote>` : "";
    }
    case "image": {
      if (/^<figure[\s>]/.test(inner)) return inner;
      const url = typeof block.attrs.url === "string" ? block.attrs.url : "";
      const alt = typeof block.attrs.alt === "string" ? block.attrs.alt : "";
      const caption = typeof block.attrs.caption === "string" ? block.attrs.caption : "";
      if (!url) return "";
      return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    case "code": {
      const text = inner.replace(/<\/?(pre|code)[^>]*>/gi, "");
      return text ? `<pre><code>${escapeHtml(text)}</code></pre>` : "";
    }
    case "separator":
      return "<hr>";
    case "spacer":
      return "";
    default:
      // Unknown block: render inner HTML unchanged (never silently dropped).
      return inner;
  }
}

/** Render stored post_content to safe HTML. */
export function renderContent(content: string): string {
  const { blocks, hasBlocks } = parseBlocks(content);
  if (!hasBlocks) return stripDangerousHtml(content);
  return blocks
    .map(renderBlock)
    .filter((html) => html.length > 0)
    .join("\n");
}
