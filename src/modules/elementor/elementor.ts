/**
 * Elementor content renderer (Milestone 11).
 *
 * WordPress pages built with Elementor store their layout in the
 * `_elementor_data` postmeta key: a JSON array of elements
 * (sections → columns → widgets). This module reads that JSON and
 * renders it with plain Wordless HTML — no Elementor code runs, no
 * Elementor assets are loaded, and nothing here executes PHP.
 *
 * Scope, stated plainly:
 * - This renders Elementor *content* on the public site. The
 *   Elementor drag-and-drop editor is a separate JavaScript
 *   application and is NOT included: pages are edited in Wordless's
 *   own block editor.
 * - Supported widgets: heading, text-editor, image, button, spacer,
 *   divider, video, icon-list, image-box, google-maps. Unknown widgets
 *   render nothing; their types are collected in `unsupported` and
 *   listed in the docs so the gap is visible, never silent.
 * - Icon glyphs are not rendered (Elementor icons are a Font Awesome
 *   font Wordless does not bundle); icon-list items render as a plain
 *   list with their text.
 * - Video embeds only allow YouTube, Vimeo and Dailymotion embeds and
 *   self-hosted <video> files. Anything else renders nothing.
 * - All text is escaped; all URLs must be http(s) or site-relative.
 *   text-editor HTML goes through the same `stripDangerousHtml` the
 *   block renderer uses (scripts, event handlers and javascript: links
 *   removed).
 */
import { queryOne } from "../../db";
import type { Db } from "../../db";
import { escapeHtml } from "../render/theme";
import { stripDangerousHtml } from "../render/blocks";

/** The widgets this renderer knows how to render. */
export const SUPPORTED_ELEMENTOR_WIDGETS = [
  "heading",
  "text-editor",
  "image",
  "button",
  "spacer",
  "divider",
  "video",
  "icon-list",
  "image-box",
  "google-maps",
] as const;

export interface ElementorRenderResult {
  html: string;
  /** Widget types seen but not rendered (unknown or unrenderable). */
  unsupported: string[];
}

type Settings = Record<string, unknown>;

interface ElementorElement {
  elType?: unknown;
  widgetType?: unknown;
  settings?: unknown;
  elements?: unknown;
}

function asSettings(value: unknown): Settings {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Settings)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

/** Only http(s) and site-relative URLs are ever emitted. */
function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (url === "") return "";
  if (url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    return "";
  }
  return "";
}

function alignStyle(settings: Settings): string {
  const align = asString(settings.align);
  if (align === "center" || align === "right" || align === "left") return `text-align:${align};`;
  return "";
}

function linkAttrs(link: unknown): { href: string; extra: string } {
  const settings = asSettings(link);
  const href = safeUrl(settings.url);
  if (href === "") return { href: "", extra: "" };
  let extra = "";
  if (settings.is_external === true) extra += ' target="_blank" rel="noopener"';
  else if (settings.nofollow === true) extra += ' rel="nofollow"';
  if (settings.nofollow === true && settings.is_external === true) extra = ' target="_blank" rel="noopener nofollow"';
  return { href, extra };
}

function imageUrl(settings: Settings): { url: string; alt: string } {
  const image = asSettings(settings.image);
  return { url: safeUrl(image.url), alt: asString(image.alt) };
}

function youTubeId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (parsed.hostname.endsWith("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts") return parts[1] ?? "";
    }
  } catch {
    return "";
  }
  return "";
}

function vimeoId(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("vimeo.com")) return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return /^\d+$/.test(last) ? last : "";
  } catch {
    return "";
  }
}

function dailymotionId(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("dailymotion.com")) return "";
    const match = /\/video\/([^/?#]+)/.exec(parsed.pathname);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function renderWidget(widgetType: string, settings: Settings, unsupported: string[]): string {
  switch (widgetType) {
    case "heading": {
      const title = asString(settings.title);
      if (title === "") return "";
      const level = ["h1", "h2", "h3", "h4", "h5", "h6"].includes(asString(settings.header_size))
        ? asString(settings.header_size)
        : "h2";
      const style = alignStyle(settings);
      return `<${level}${style !== "" ? ` style="${style}"` : ""}>${escapeHtml(title)}</${level}>`;
    }
    case "text-editor": {
      const editor = asString(settings.editor);
      if (editor.trim() === "") return "";
      return stripDangerousHtml(editor);
    }
    case "image": {
      const { url, alt } = imageUrl(settings);
      if (url === "") return "";
      const caption = asString(settings.caption);
      const link = linkAttrs(settings.link);
      const img = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`;
      const inner = link.href !== "" ? `<a href="${escapeHtml(link.href)}"${link.extra}>${img}</a>` : img;
      return `<figure class="elementor-widget-image">${inner}${caption !== "" ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    case "button": {
      const text = asString(settings.text);
      if (text === "") return "";
      const link = linkAttrs(settings.link);
      const style = alignStyle(settings);
      const inner =
        link.href !== ""
          ? `<a class="elementor-button" href="${escapeHtml(link.href)}"${link.extra}>${escapeHtml(text)}</a>`
          : `<span class="elementor-button">${escapeHtml(text)}</span>`;
      return `<div class="elementor-widget-button"${style !== "" ? ` style="${style}"` : ""}>${inner}</div>`;
    }
    case "spacer": {
      const space = asSettings(settings.space);
      const size = asNumber(space.size, 50);
      return `<div class="elementor-spacer" style="height:${Math.max(0, Math.min(size, 2000))}px" aria-hidden="true"></div>`;
    }
    case "divider":
      return `<hr class="elementor-divider">`;
    case "video": {
      const type = asString(settings.video_type) || "youtube";
      if (type === "youtube") {
        const id = youTubeId(asString(settings.youtube_url));
        if (id === "") return "";
        return `<div class="elementor-video"><iframe src="https://www.youtube.com/embed/${escapeHtml(id)}" title="YouTube video" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
      }
      if (type === "vimeo") {
        const id = vimeoId(asString(settings.vimeo_url));
        if (id === "") return "";
        return `<div class="elementor-video"><iframe src="https://player.vimeo.com/video/${escapeHtml(id)}" title="Vimeo video" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
      }
      if (type === "dailymotion") {
        const id = dailymotionId(asString(settings.dailymotion_url));
        if (id === "") return "";
        return `<div class="elementor-video"><iframe src="https://www.dailymotion.com/embed/video/${escapeHtml(id)}" title="Dailymotion video" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
      }
      if (type === "hosted") {
        const hosted = asSettings(settings.hosted_url);
        const url = safeUrl(hosted.url ?? settings.external_url);
        if (url === "") return "";
        return `<div class="elementor-video"><video controls preload="none" src="${escapeHtml(url)}"></video></div>`;
      }
      return "";
    }
    case "icon-list": {
      const items = Array.isArray(settings.icon_list) ? settings.icon_list : [];
      const texts = items.map((item) => asString(asSettings(item).text)).filter((t) => t !== "");
      if (texts.length === 0) return "";
      return `<ul class="elementor-icon-list">${texts.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
    }
    case "image-box": {
      const { url, alt } = imageUrl(settings);
      const title = asString(settings.title_text);
      const description = asString(settings.description_text);
      if (url === "" && title === "" && description === "") return "";
      const link = linkAttrs(settings.link);
      const inner = `${url !== "" ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">` : ""}${title !== "" ? `<h3>${escapeHtml(title)}</h3>` : ""}${description !== "" ? `<p>${escapeHtml(description)}</p>` : ""}`;
      const boxed = `<div class="elementor-image-box">${inner}</div>`;
      return link.href !== "" ? `<a href="${escapeHtml(link.href)}"${link.extra}>${boxed}</a>` : boxed;
    }
    case "google-maps": {
      const address = asString(settings.address);
      if (address === "") return "";
      const zoom = asNumber(asSettings(settings.zoom).size, 10);
      const height = asNumber(asSettings(settings.height).size, 400);
      const src = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=${Math.max(1, Math.min(Math.round(zoom), 21))}&output=embed`;
      return `<div class="elementor-google-maps"><iframe src="${escapeHtml(src)}" style="height:${Math.max(100, Math.min(height, 1200))}px;width:100%;border:0" loading="lazy" title="Map: ${escapeHtml(address)}"></iframe></div>`;
    }
    default:
      return "";
  }
}

function renderElement(el: unknown, unsupported: string[], depth: number): string {
  if (depth > 10) return "";
  if (el === null || typeof el !== "object" || Array.isArray(el)) return "";
  const element = el as ElementorElement;
  const settings = asSettings(element.settings);
  const children = Array.isArray(element.elements) ? element.elements : [];
  const childHtml = children.map((c) => renderElement(c, unsupported, depth + 1)).join("");
  const elType = asString(element.elType);
  if (elType === "section") {
    return `<section class="elementor-section">${childHtml}</section>`;
  }
  if (elType === "column") {
    return `<div class="elementor-column">${childHtml}</div>`;
  }
  if (elType === "widget") {
    const widgetType = asString(element.widgetType);
    if ((SUPPORTED_ELEMENTOR_WIDGETS as readonly string[]).includes(widgetType)) {
      return renderWidget(widgetType, settings, unsupported);
    }
    if (widgetType !== "" && !unsupported.includes(widgetType)) unsupported.push(widgetType);
    return "";
  }
  return childHtml;
}

/** Render parsed `_elementor_data` (the elements array) to HTML. */
export function renderElementorData(data: unknown): ElementorRenderResult {
  const unsupported: string[] = [];
  if (!Array.isArray(data)) return { html: "", unsupported };
  const html = data.map((el) => renderElement(el, unsupported, 0)).join("");
  return { html, unsupported };
}

export const ELEMENTOR_META_KEY = "_elementor_data";

/** Read a post's `_elementor_data` meta and parse it. Null when absent or not valid Elementor JSON. */
export async function getElementorData(db: Db, postId: number): Promise<unknown[] | null> {
  const row = await queryOne<{ meta_value: unknown }>(
    db,
    "SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1",
    [postId, ELEMENTOR_META_KEY],
  );
  if (row === null || typeof row.meta_value !== "string" || row.meta_value.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(row.meta_value);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** True when a post carries Elementor data (used by the admin editor notice). */
export async function hasElementorData(db: Db, postId: number): Promise<boolean> {
  return (await getElementorData(db, postId)) !== null;
}
