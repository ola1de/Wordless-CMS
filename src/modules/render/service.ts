/**
 * Public rendering service — server-rendered HTML pages.
 *
 * Milestone 5: pages render through the ACTIVE theme when it is a block
 * theme with templates (template hierarchy + template parts + the
 * theme.json stylesheet at /theme.css). When the active theme is classic
 * (CSS only) or has no matching template, the M2 built-in layout renders
 * instead — still linked to /theme.css so the theme's stylesheet applies.
 * All titles, excerpts, names and URLs are escaped by the theme; post
 * content goes through the block renderer.
 */
import type { Db } from "../../db";
import { getOption } from "../options/service";
import { getPostsPerPage } from "../settings/service";
import { listApprovedThreaded } from "../comments/service";
import type { Comment } from "../comments/types";
import { postUrl } from "../permalinks/service";
import { listPostsByDatePrefix } from "../permalinks/service";
import { listPosts } from "../posts/service";
import type { Post } from "../posts/types";
import { searchPosts } from "../search/service";
import { resolveMenuByLocation } from "../menus/service";
import { getPostTerms, listPostsByTerm } from "../terms/service";
import type { Term } from "../terms/types";
import type { MediaStorage } from "../media/storage";
import { loadActiveTheme } from "../themes/service";
import {
  renderTemplateFile,
  resolveTemplateName,
  themedDocument,
  type TemplateContext,
  type TemplatePostData,
} from "../themes/templates";
import { renderContent } from "./blocks";
import { escapeHtml, layout, type NavItem } from "./theme";

export interface RenderedPage {
  status: number;
  html: string;
}

/** Options threaded through public rendering (M5 themes + preview). */
export interface RenderOptions {
  /** R2 storage for theme files; without it, rendering uses the M2 layout. */
  storage?: MediaStorage;
  /** Customizer variation settings to apply over the active theme. */
  variation?: Record<string, unknown>;
  /** Preview token (kept on the /theme.css URL so preview CSS loads). */
  previewToken?: string;
}

async function siteInfo(db: Db): Promise<{ name: string; description: string }> {
  return {
    name: await getOption<string>(db, "blogname", "Wordless"),
    description: await getOption<string>(db, "blogdescription", ""),
  };
}

async function navItems(db: Db): Promise<NavItem[]> {
  const resolved = await resolveMenuByLocation(db, "primary");
  return resolved.items
    .flatMap((item) => [item, ...(item.children ?? [])])
    .map((item) => ({ title: item.title, url: item.url }));
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function pagination(current: number, totalPages: number, base: string, query = ""): string {
  if (totalPages <= 1) return "";
  const sep = base.includes("?") ? "&" : "?";
  const prev =
    current > 1 ? `<a href="${escapeHtml(`${base}${sep}page=${current - 1}${query}`)}">&larr; Newer</a>` : "<span></span>";
  const next =
    current < totalPages
      ? `<a href="${escapeHtml(`${base}${sep}page=${current + 1}${query}`)}">Older &rarr;</a>`
      : "<span></span>";
  return `<nav class="pagination" aria-label="Pagination">${prev}${next}</nav>`;
}

async function toTemplatePost(db: Db, post: Post, includeTerms: boolean): Promise<TemplatePostData> {
  const url = await postUrl(db, post);
  const terms: Array<{ name: string; url: string; taxonomy: string }> = [];
  if (includeTerms) {
    const assigned = await getPostTerms(db, post.id);
    for (const term of assigned) {
      const base = term.taxonomy === "category" ? "/category" : term.taxonomy === "tag" ? "/tag" : `/${term.taxonomy}`;
      terms.push({ name: term.name, url: `${base}/${term.slug}`, taxonomy: term.taxonomy });
    }
  }
  return {
    title: post.title,
    date: post.date,
    excerpt: post.excerpt ?? "",
    contentHtml: renderContent(post.content),
    url,
    commentCount: post.commentCount,
    terms,
  };
}

interface FallbackPage {
  title: string;
  siteName: string;
  description: string;
  nav: NavItem[];
  body: string;
  headExtra?: string;
  status?: number;
}

/**
 * Finish a page: render through the active block theme when possible,
 * otherwise fall back to the M2 layout (still linked to /theme.css).
 * Any theme-loading failure falls back silently to the M2 layout — a
 * broken theme must never take the public site down.
 */
async function finishPage(
  db: Db,
  opts: RenderOptions | undefined,
  ctx: TemplateContext,
  fallback: FallbackPage,
  extraBody?: string,
): Promise<RenderedPage> {
  const status = fallback.status ?? 200;
  if (opts?.storage !== undefined) {
    try {
      const loaded = await loadActiveTheme(db, opts.storage, opts.variation);
      const href =
        `/theme.css?v=${loaded.stylesheetHash}` +
        (opts.previewToken !== undefined ? `&wl_preview=${encodeURIComponent(opts.previewToken)}` : "");
      if (loaded.record.kind === "block") {
        const available = new Set(
          [...loaded.files.keys()].filter((k) => k.startsWith("templates/")).map((k) => k.slice("templates/".length)),
        );
        const name = resolveTemplateName(ctx.kind, available);
        if (name !== null) {
          const rendered = renderTemplateFile(name, loaded.files, ctx);
          return {
            status: ctx.kind === "404" ? 404 : 200,
            html: themedDocument({
              title: ctx.title,
              siteName: ctx.siteName,
              description: ctx.description,
              stylesheetHref: href,
              body: rendered.html,
              extraBody,
            }),
          };
        }
      }
      return {
        status,
        html: layout({ ...fallback, stylesheetHref: href }),
      };
    } catch {
      // Theme loading failed — fall through to the M2 layout below.
    }
  }
  return { status, html: layout(fallback) };
}

async function postListHtml(db: Db, posts: Post[]): Promise<string> {
  const items = await Promise.all(
    posts.map(async (post) => {
      const url = await postUrl(db, post);
      return `<li><h2><a href="${escapeHtml(url)}">${escapeHtml(post.title || "(untitled)")}</a></h2>
<div class="meta">${escapeHtml(formatDate(post.date))}</div>
${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ""}</li>`;
    }),
  );
  return `<ul class="post-list">${items.join("")}</ul>`;
}

function renderComment(comment: Comment, depth: number): string {
  const children = (comment.children ?? []).map((c) => renderComment(c, depth + 1)).join("");
  const childList = children ? `<ol>${children}</ol>` : "";
  return `<li><div class="comment-meta"><strong>${escapeHtml(comment.author)}</strong> · ${escapeHtml(formatDate(comment.date))}</div>
<p>${escapeHtml(comment.content).replace(/\n/g, "<br>")}</p>${childList}</li>`;
}

async function commentsHtml(db: Db, post: Post): Promise<string> {
  const comments = await listApprovedThreaded(db, post.id);
  const list = comments.length > 0 ? `<ol>${comments.map((c) => renderComment(c, 0)).join("")}</ol>` : "<p>No comments yet.</p>";
  // The form posts to /{slug}/comments (slug path, any permalink structure);
  // the worker accepts form data there and redirects back to the post.
  const form =
    post.commentStatus === "open"
      ? `<h3>Leave a reply</h3>
<form class="comment-form" method="post" action="/${escapeHtml(post.slug)}/comments">
  <label for="comment-author">Name</label>
  <input id="comment-author" name="author" required maxlength="100">
  <label for="comment-email">Email (not published)</label>
  <input id="comment-email" name="author_email" type="email" maxlength="100">
  <label for="comment-content">Comment</label>
  <textarea id="comment-content" name="content" rows="5" required maxlength="10000"></textarea>
  <input type="text" name="website" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true">
  <button type="submit">Post comment</button>
</form>
<p><small>Comments are moderated before they appear.</small></p>`
      : `<p><small>Comments are closed for this post.</small></p>`;
  return `<section class="comments" id="comments">
<h2>Comments (${comments.length})</h2>
${list}
${form}
</section>`;
}

export async function renderHome(db: Db, page = 1, opts?: RenderOptions): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const perPage = await getPostsPerPage(db);
  const result = await listPosts(db, { status: "publish", type: "post", page, perPage });
  const body =
    result.posts.length === 0
      ? "<p>No posts published yet.</p>"
      : (await postListHtml(db, result.posts)) + pagination(page, result.totalPages, "/");
  const posts = await Promise.all(result.posts.map((p) => toTemplatePost(db, p, false)));
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "home",
      title: "Home",
      posts,
      page,
      totalPages: result.totalPages,
      baseUrl: "/",
    },
    {
      title: "Home",
      siteName: site.name,
      description: site.description,
      nav,
      body,
      headExtra: `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)}" href="/feed">`,
    },
  );
}

export async function renderSingle(db: Db, post: Post, opts?: RenderOptions): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const comments = post.commentStatus === "open" || post.commentCount > 0 ? await commentsHtml(db, post) : "";
  const body = `<article>
<h1>${escapeHtml(post.title || "(untitled)")}</h1>
<div class="meta">${escapeHtml(formatDate(post.date))}</div>
${renderContent(post.content)}
</article>${comments}`;
  const postData = await toTemplatePost(db, post, true);
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "single",
      title: post.title || "(untitled)",
      post: postData,
      page: 1,
      totalPages: 1,
      baseUrl: postData.url,
    },
    { title: post.title || "(untitled)", siteName: site.name, description: site.description, nav, body },
    // Comments are appended after the template body in v1: block themes
    // have no simple comments block, so the existing section is reused.
    comments !== "" ? comments : undefined,
  );
}

export async function renderPage(db: Db, post: Post, opts?: RenderOptions): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const body = `<article>
<h1>${escapeHtml(post.title || "(untitled)")}</h1>
${renderContent(post.content)}
</article>`;
  const postData = await toTemplatePost(db, post, false);
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "page",
      title: post.title || "(untitled)",
      post: postData,
      page: 1,
      totalPages: 1,
      baseUrl: postData.url,
    },
    { title: post.title || "(untitled)", siteName: site.name, description: site.description, nav, body },
  );
}

export async function renderTermArchive(db: Db, term: Term, page = 1, opts?: RenderOptions): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const perPage = await getPostsPerPage(db);
  const result = await listPostsByTerm(db, term.termTaxonomyId, { page, perPage });
  const kind = term.taxonomy === "category" ? "Category" : term.taxonomy === "tag" ? "Tag" : term.taxonomy;
  const base = term.taxonomy === "category" ? `/category/${term.slug}` : `/tag/${term.slug}`;
  const body =
    `<h1>${escapeHtml(kind)}: ${escapeHtml(term.name)}</h1>` +
    (term.description ? `<p>${escapeHtml(term.description)}</p>` : "") +
    (result.posts.length === 0
      ? "<p>No posts in this term yet.</p>"
      : (await postListHtml(db, result.posts)) + pagination(page, result.totalPages, base));
  const posts = await Promise.all(result.posts.map((p) => toTemplatePost(db, p, false)));
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "archive",
      title: `${kind}: ${term.name}`,
      archiveTitle: `${kind}: ${term.name}`,
      posts,
      page,
      totalPages: result.totalPages,
      baseUrl: base,
    },
    { title: `${kind}: ${term.name}`, siteName: site.name, description: site.description, nav, body },
  );
}

export async function renderDateArchive(
  db: Db,
  year: number,
  month: number | undefined,
  page = 1,
  opts?: RenderOptions,
): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const prefix = month !== undefined ? `${year}-${String(month).padStart(2, "0")}` : `${year}`;
  const perPage = await getPostsPerPage(db);
  const posts = await listPostsByDatePrefix(db, prefix, perPage, (page - 1) * perPage);
  const title = month !== undefined ? `Archive: ${year}-${String(month).padStart(2, "0")}` : `Archive: ${year}`;
  const body =
    `<h1>${escapeHtml(title)}</h1>` +
    (posts.length === 0 ? "<p>No posts in this period.</p>" : await postListHtml(db, posts));
  const templatePosts = await Promise.all(posts.map((p) => toTemplatePost(db, p, false)));
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "archive",
      title,
      archiveTitle: title,
      posts: templatePosts,
      page,
      totalPages: 1,
      baseUrl: month !== undefined ? `/${year}/${String(month).padStart(2, "0")}` : `/${year}`,
    },
    { title, siteName: site.name, description: site.description, nav, body },
  );
}

export async function renderSearchPage(db: Db, query: string, page = 1, opts?: RenderOptions): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const perPage = await getPostsPerPage(db);
  const result = await searchPosts(db, query, { page, perPage });
  const body =
    `<h1>Search results for &ldquo;${escapeHtml(query)}&rdquo;</h1>` +
    `<p>${result.total} result${result.total === 1 ? "" : "s"}.</p>` +
    (result.posts.length === 0
      ? ""
      : (await postListHtml(db, result.posts)) +
        pagination(page, result.totalPages, "/search", `&q=${encodeURIComponent(query)}`));
  const posts = await Promise.all(result.posts.map((p) => toTemplatePost(db, p, false)));
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "search",
      title: `Search: ${query}`,
      query,
      posts,
      page,
      totalPages: result.totalPages,
      baseUrl: `/search?q=${encodeURIComponent(query)}`,
    },
    { title: `Search: ${query}`, siteName: site.name, description: site.description, nav, body },
  );
}

export async function renderNotFound(db: Db, opts?: RenderOptions): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  return finishPage(
    db,
    opts,
    {
      siteName: site.name,
      description: site.description,
      nav,
      kind: "404",
      title: "Not found",
      page: 1,
      totalPages: 1,
      baseUrl: "/",
    },
    {
      title: "Not found",
      siteName: site.name,
      description: site.description,
      nav,
      body: "<h1>Page not found</h1><p>The page you asked for does not exist. <a href=\"/\">Go home</a>.</p>",
      status: 404,
    },
  );
}
