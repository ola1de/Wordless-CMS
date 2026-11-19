/**
 * Public rendering service — server-rendered HTML pages with the built-in
 * default theme (see theme.ts). All titles, excerpts, names and URLs are
 * escaped by the theme; post content goes through the block renderer.
 */
import type { Db } from "../../db";
import { getOption } from "../options/service";
import { listApprovedThreaded } from "../comments/service";
import type { Comment } from "../comments/types";
import { postUrl } from "../permalinks/service";
import { listPostsByDatePrefix } from "../permalinks/service";
import { listPosts } from "../posts/service";
import type { Post } from "../posts/types";
import { searchPosts } from "../search/service";
import { resolveMenuByLocation } from "../menus/service";
import { listPostsByTerm } from "../terms/service";
import type { Term } from "../terms/types";
import { renderContent } from "./blocks";
import { escapeHtml, layout, type NavItem } from "./theme";

export interface RenderedPage {
  status: number;
  html: string;
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

export async function renderHome(db: Db, page = 1): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const result = await listPosts(db, { status: "publish", type: "post", page, perPage: 10 });
  const body =
    result.posts.length === 0
      ? "<p>No posts published yet.</p>"
      : (await postListHtml(db, result.posts)) + pagination(page, result.totalPages, "/");
  return {
    status: 200,
    html: layout({
      title: "Home",
      siteName: site.name,
      description: site.description,
      nav,
      body,
      headExtra: `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)}" href="/feed">`,
    }),
  };
}

export async function renderSingle(db: Db, post: Post): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const comments = post.commentStatus === "open" || post.commentCount > 0 ? await commentsHtml(db, post) : "";
  const body = `<article>
<h1>${escapeHtml(post.title || "(untitled)")}</h1>
<div class="meta">${escapeHtml(formatDate(post.date))}</div>
${renderContent(post.content)}
</article>${comments}`;
  return {
    status: 200,
    html: layout({ title: post.title || "(untitled)", siteName: site.name, description: site.description, nav, body }),
  };
}

export async function renderPage(db: Db, post: Post): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const body = `<article>
<h1>${escapeHtml(post.title || "(untitled)")}</h1>
${renderContent(post.content)}
</article>`;
  return {
    status: 200,
    html: layout({ title: post.title || "(untitled)", siteName: site.name, description: site.description, nav, body }),
  };
}

export async function renderTermArchive(db: Db, term: Term, page = 1): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const result = await listPostsByTerm(db, term.termTaxonomyId, { page, perPage: 10 });
  const kind = term.taxonomy === "category" ? "Category" : term.taxonomy === "tag" ? "Tag" : term.taxonomy;
  const base = term.taxonomy === "category" ? `/category/${term.slug}` : `/tag/${term.slug}`;
  const body =
    `<h1>${escapeHtml(kind)}: ${escapeHtml(term.name)}</h1>` +
    (term.description ? `<p>${escapeHtml(term.description)}</p>` : "") +
    (result.posts.length === 0
      ? "<p>No posts in this term yet.</p>"
      : (await postListHtml(db, result.posts)) + pagination(page, result.totalPages, base));
  return {
    status: 200,
    html: layout({ title: `${kind}: ${term.name}`, siteName: site.name, description: site.description, nav, body }),
  };
}

export async function renderDateArchive(db: Db, year: number, month: number | undefined, page = 1): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const prefix = month !== undefined ? `${year}-${String(month).padStart(2, "0")}` : `${year}`;
  const posts = await listPostsByDatePrefix(db, prefix, 10, (page - 1) * 10);
  const title = month !== undefined ? `Archive: ${year}-${String(month).padStart(2, "0")}` : `Archive: ${year}`;
  const body =
    `<h1>${escapeHtml(title)}</h1>` +
    (posts.length === 0 ? "<p>No posts in this period.</p>" : await postListHtml(db, posts));
  return {
    status: 200,
    html: layout({ title, siteName: site.name, description: site.description, nav, body }),
  };
}

export async function renderSearchPage(db: Db, query: string, page = 1): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  const result = await searchPosts(db, query, { page, perPage: 10 });
  const body =
    `<h1>Search results for &ldquo;${escapeHtml(query)}&rdquo;</h1>` +
    `<p>${result.total} result${result.total === 1 ? "" : "s"}.</p>` +
    (result.posts.length === 0
      ? ""
      : (await postListHtml(db, result.posts)) +
        pagination(page, result.totalPages, "/search", `&q=${encodeURIComponent(query)}`));
  return {
    status: 200,
    html: layout({ title: `Search: ${query}`, siteName: site.name, description: site.description, nav, body }),
  };
}

export async function renderNotFound(db: Db): Promise<RenderedPage> {
  const site = await siteInfo(db);
  const nav = await navItems(db);
  return {
    status: 404,
    html: layout({
      title: "Not found",
      siteName: site.name,
      description: site.description,
      nav,
      body: "<h1>Page not found</h1><p>The page you asked for does not exist. <a href=\"/\">Go home</a>.</p>",
    }),
  };
}
