/**
 * Default built-in theme (M2).
 * Clean semantic HTML + minimal inline CSS. This is NOT the theme engine —
 * theme.json / block themes / the visual editor arrive in M5. The default
 * theme exists so M2 can serve real public pages today.
 * All interpolated text is escaped here; renderers must pass raw strings
 * and never pre-escape (double-escaping would show entities).
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface NavItem {
  title: string;
  url: string;
}

export interface LayoutOptions {
  title: string;
  siteName: string;
  description: string;
  nav: NavItem[];
  body: string;
  /** Extra <head> content (e.g. feed link). Already-escaped/HTML. */
  headExtra?: string;
  /**
   * Stylesheet URL to link instead of the inline default CSS (M5).
   * Used when a theme is active: the page links /theme.css?v=<hash>.
   * When absent, the built-in inline CSS is used (M2 behaviour).
   */
  stylesheetHref?: string;
}

export function layout(opts: LayoutOptions): string {
  const nav =
    opts.nav.length > 0
      ? `<nav aria-label="Primary"><ul>${opts.nav
          .map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`)
          .join("")}</ul></nav>`
      : "";
  const style = opts.stylesheetHref
    ? `<link rel="stylesheet" href="${escapeHtml(opts.stylesheetHref)}">`
    : `<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; color: #1a1a1a; background: #fff; line-height: 1.6; }
  header.site { border-bottom: 1px solid #e5e5e5; padding: 16px 24px; }
  header.site a.brand { font-size: 22px; font-weight: 700; color: inherit; text-decoration: none; }
  header.site p.tagline { margin: 2px 0 0; color: #666; font-size: 14px; }
  nav ul { list-style: none; margin: 12px 0 0; padding: 0; display: flex; gap: 18px; flex-wrap: wrap; }
  nav a { color: #2563eb; text-decoration: none; }
  main { max-width: 720px; margin: 0 auto; padding: 24px; }
  article h1 { font-size: 32px; line-height: 1.2; margin: 0 0 8px; }
  article .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
  article img { max-width: 100%; height: auto; }
  article blockquote { border-left: 3px solid #ddd; margin: 16px 0; padding: 4px 16px; color: #555; }
  article pre { background: #f5f5f5; padding: 12px; overflow-x: auto; }
  article code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
  .post-list { list-style: none; padding: 0; }
  .post-list li { padding: 16px 0; border-bottom: 1px solid #eee; }
  .post-list h2 { margin: 0 0 4px; font-size: 22px; }
  .post-list h2 a { color: inherit; text-decoration: none; }
  .post-list h2 a:hover { text-decoration: underline; }
  .post-list .meta { color: #666; font-size: 14px; }
  .pagination { margin-top: 24px; display: flex; gap: 16px; }
  .comments { margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px; }
  .comments ol { list-style: none; padding: 0; }
  .comments li { padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
  .comments .comment-meta { color: #666; font-size: 13px; }
  form.comment-form label { display: block; margin: 12px 0 4px; font-weight: 600; }
  form.comment-form input, form.comment-form textarea { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit; }
  form.comment-form button { margin-top: 12px; padding: 10px 18px; background: #2563eb; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  footer.site { border-top: 1px solid #e5e5e5; padding: 16px 24px; color: #666; font-size: 14px; text-align: center; }
</style>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — ${escapeHtml(opts.siteName)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
${opts.headExtra ?? ""}
${style}
</head>
<body>
<header class="site">
  <a class="brand" href="/">${escapeHtml(opts.siteName)}</a>
  ${opts.description ? `<p class="tagline">${escapeHtml(opts.description)}</p>` : ""}
  ${nav}
</header>
<main>
${opts.body}
</main>
<footer class="site">Powered by <a href="/admin">Wordless</a></footer>
</body>
</html>`;
}
