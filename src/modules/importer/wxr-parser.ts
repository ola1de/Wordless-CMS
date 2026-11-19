/**
 * WordPress eXtended RSS (WXR) parser (Milestone 9).
 *
 * Uses fast-xml-parser — a real XML parser, never regex — with CDATA
 * preserved and namespaced tags kept (`wp:post_id`, `content:encoded`,
 * `dc:creator`). Values stay strings; numbers are parsed by the
 * importer, which decides what a field means.
 *
 * The parser returns a plain, typed structure; all importing decisions
 * (status mapping, slug dedup, forced password reset) live in
 * service.ts.
 */
import { XMLParser } from "fast-xml-parser";

const ARRAY_TAGS = new Set([
  "item",
  "wp:category",
  "wp:tag",
  "wp:term",
  "wp:author",
  "wp:comment",
  "wp:postmeta",
  "wp:commentmeta",
  "category",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  isArray: (name) => ARRAY_TAGS.has(name),
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export interface WxrAuthor {
  id: number;
  login: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
}

export interface WxrTermDef {
  id: number;
  taxonomy: "category" | "post_tag" | string;
  slug: string;
  name: string;
  /** Parent category nicename (slug) — WXR gives a slug, not an ID. */
  parent: string;
  description: string;
}

export interface WxrMeta {
  key: string;
  value: string;
}

export interface WxrComment {
  id: number;
  author: string;
  authorEmail: string;
  authorUrl: string;
  authorIp: string;
  date: string;
  dateGmt: string;
  content: string;
  approved: string;
  type: string;
  parent: number;
  userId: number;
  meta: WxrMeta[];
}

export interface WxrItem {
  title: string;
  link: string;
  pubDate: string;
  creator: string;
  guid: string;
  description: string;
  content: string;
  excerpt: string;
  postId: number;
  postDate: string;
  postDateGmt: string;
  postName: string;
  status: string;
  postType: string;
  postParent: number;
  menuOrder: number;
  postPassword: string;
  isSticky: boolean;
  commentStatus: string;
  pingStatus: string;
  categories: Array<{ domain: string; nicename: string; name: string }>;
  meta: WxrMeta[];
  comments: WxrComment[];
}

export interface WxrExport {
  title: string;
  link: string;
  authors: WxrAuthor[];
  terms: WxrTermDef[];
  items: WxrItem[];
}

/** Extract the text of a parsed node (string, number, CDATA, or #text object). */
export function textValue(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.length > 0 ? textValue(node[0]) : "";
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.__cdata === "string") return obj.__cdata;
    if (obj["#text"] !== undefined) return textValue(obj["#text"]);
  }
  return "";
}

function numValue(node: unknown): number {
  const n = Number(textValue(node));
  return Number.isFinite(n) ? n : 0;
}

function asArray<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function parseMeta(raw: unknown): WxrMeta[] {
  return asArray<Record<string, unknown>>(raw).map((m) => ({
    key: textValue((m as Record<string, unknown>)["wp:meta_key"]),
    value: textValue((m as Record<string, unknown>)["wp:meta_value"]),
  }));
}

function parseComment(raw: Record<string, unknown>): WxrComment {
  return {
    id: numValue(raw["wp:comment_id"]),
    author: textValue(raw["wp:comment_author"]),
    authorEmail: textValue(raw["wp:comment_author_email"]),
    authorUrl: textValue(raw["wp:comment_author_url"]),
    authorIp: textValue(raw["wp:comment_author_IP"]),
    date: textValue(raw["wp:comment_date"]),
    dateGmt: textValue(raw["wp:comment_date_gmt"]),
    content: textValue(raw["wp:comment_content"]),
    approved: textValue(raw["wp:comment_approved"]),
    type: textValue(raw["wp:comment_type"]),
    parent: numValue(raw["wp:comment_parent"]),
    userId: numValue(raw["wp:comment_user_id"]),
    meta: parseMeta(raw["wp:commentmeta"]),
  };
}

export function parseWxr(xml: string): WxrExport {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`WXR file is not valid XML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const rss = (parsed.rss ?? parsed) as Record<string, unknown>;
  const channel = (rss.channel ?? {}) as Record<string, unknown>;

  const authors: WxrAuthor[] = asArray<Record<string, unknown>>(channel["wp:author"]).map((a) => ({
    id: numValue(a["wp:author_id"]),
    login: textValue(a["wp:author_login"]),
    email: textValue(a["wp:author_email"]),
    displayName: textValue(a["wp:author_display_name"]),
    firstName: textValue(a["wp:author_first_name"]),
    lastName: textValue(a["wp:author_last_name"]),
  }));

  const terms: WxrTermDef[] = [];
  for (const c of asArray<Record<string, unknown>>(channel["wp:category"])) {
    terms.push({
      id: numValue(c["wp:term_id"]),
      taxonomy: "category",
      slug: textValue(c["wp:category_nicename"]),
      name: textValue(c["wp:cat_name"]),
      parent: textValue(c["wp:category_parent"]),
      description: textValue(c["wp:category_description"]),
    });
  }
  for (const t of asArray<Record<string, unknown>>(channel["wp:tag"])) {
    terms.push({
      id: numValue(t["wp:term_id"]),
      taxonomy: "post_tag",
      slug: textValue(t["wp:tag_slug"]),
      name: textValue(t["wp:tag_name"]),
      parent: "",
      description: textValue(t["wp:tag_description"]),
    });
  }
  for (const t of asArray<Record<string, unknown>>(channel["wp:term"])) {
    terms.push({
      id: numValue(t["wp:term_id"]),
      taxonomy: textValue(t["wp:term_taxonomy"]),
      slug: textValue(t["wp:term_slug"]),
      name: textValue(t["wp:term_name"]),
      parent: "",
      description: textValue(t["wp:term_description"]),
    });
  }

  const items: WxrItem[] = asArray<Record<string, unknown>>(channel.item).map((it) => {
    const categories = asArray<Record<string, unknown>>(it.category).map((c) => ({
      domain: typeof c["@_domain"] === "string" ? (c["@_domain"] as string) : "category",
      nicename: typeof c["@_nicename"] === "string" ? (c["@_nicename"] as string) : "",
      name: textValue(c["#text"] ?? c),
    }));
    return {
      title: textValue(it.title),
      link: textValue(it.link),
      pubDate: textValue(it.pubDate),
      creator: textValue(it["dc:creator"]),
      guid: textValue(it.guid),
      description: textValue(it.description),
      content: textValue(it["content:encoded"]),
      excerpt: textValue(it["excerpt:encoded"]),
      postId: numValue(it["wp:post_id"]),
      postDate: textValue(it["wp:post_date"]),
      postDateGmt: textValue(it["wp:post_date_gmt"]),
      postName: textValue(it["wp:post_name"]),
      status: textValue(it["wp:post_status"]),
      postType: textValue(it["wp:post_type"]),
      postParent: numValue(it["wp:post_parent"]),
      menuOrder: numValue(it["wp:menu_order"]),
      postPassword: textValue(it["wp:post_password"]),
      isSticky: textValue(it["wp:is_sticky"]) === "1",
      commentStatus: textValue(it["wp:comment_status"]),
      pingStatus: textValue(it["wp:ping_status"]),
      categories,
      meta: parseMeta(it["wp:postmeta"]),
      comments: asArray<Record<string, unknown>>(it["wp:comment"]).map(parseComment),
    };
  });

  return {
    title: textValue(channel.title),
    link: textValue(channel.link),
    authors,
    terms,
    items,
  };
}
