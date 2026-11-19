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
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; color: #122019; background: #fff; line-height: 1.65; }
  a { color: #0b7c74; }
  header.site { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,0.88); backdrop-filter: blur(10px); border-bottom: 1px solid #e6edeb; padding: 16px 24px; }
  header.site a.brand { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; color: inherit; text-decoration: none; }
  header.site p.tagline { margin: 2px 0 0; color: #64748b; font-size: 14px; }
  nav ul { list-style: none; margin: 12px 0 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
  nav a { color: #122019; text-decoration: none; font-weight: 600; font-size: 15px; padding: 6px 12px; border-radius: 999px; }
  nav a:hover { background: #f0f5f3; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
  article h1 { font-size: 34px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.02em; }
  article .meta { color: #64748b; font-size: 14px; margin-bottom: 20px; }
  article img { max-width: 100%; height: auto; border-radius: 12px; }
  article blockquote { border-left: 3px solid #0d9488; background: #f4f8f7; border-radius: 0 12px 12px 0; margin: 16px 0; padding: 16px 20px; color: #3d4f48; }
  article pre { background: #061a1e; color: #d7ece7; padding: 14px; border-radius: 10px; overflow-x: auto; }
  article code { background: #f0f5f3; padding: 1px 5px; border-radius: 4px; }
  .post-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .post-list li { padding: 24px; border: 1px solid #e6edeb; border-radius: 16px; box-shadow: 0 1px 2px rgba(6,26,30,0.05); }
  .post-list h2 { margin: 0 0 6px; font-size: 24px; line-height: 1.3; letter-spacing: -0.01em; }
  .post-list h2 a { color: inherit; text-decoration: none; }
  .post-list h2 a:hover { color: #0b7c74; }
  .post-list .meta { color: #64748b; font-size: 14px; margin-bottom: 8px; }
  .post-card { padding: 24px; border: 1px solid #e6edeb; border-radius: 16px; background: #fff; box-shadow: 0 1px 2px rgba(6,26,30,0.05); margin-bottom: 16px; }
  .post-card h2 { margin: 0 0 6px; font-size: 24px; line-height: 1.3; letter-spacing: -0.01em; }
  .post-card h2 a { color: inherit; text-decoration: none; }
  .post-card h2 a:hover { color: #0b7c74; }
  .post-card time { display: block; color: #64748b; font-size: 14px; margin-bottom: 8px; }
  .product-list { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .product-list li { padding: 24px; border: 1px solid #e6edeb; border-radius: 16px; box-shadow: 0 1px 2px rgba(6,26,30,0.05); }
  .product-list h2 { margin: 0 0 6px; font-size: 20px; line-height: 1.3; }
  .product-list h2 a { color: inherit; text-decoration: none; }
  .product-list h2 a:hover { color: #0b7c74; }
  .product-list .price { font-weight: 700; font-size: 18px; margin: 0 0 8px; }
  .pagination { margin-top: 32px; display: flex; gap: 12px; }
  .pagination a { padding: 8px 16px; border: 1px solid #dde7e3; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px; }
  .comments { margin-top: 48px; border-top: 1px solid #e6edeb; padding-top: 24px; }
  .comments ol { list-style: none; padding: 0; }
  .comments li { padding: 16px 0; border-bottom: 1px solid #f0f5f3; }
  .comments .comment-meta { color: #64748b; font-size: 13px; }
  form.comment-form label { display: block; margin: 12px 0 6px; font-weight: 600; }
  form.comment-form input, form.comment-form textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #c3d2cc; border-radius: 10px; font: inherit; }
  form.comment-form input:focus, form.comment-form textarea:focus { outline: none; border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,0.22); }
  form.comment-form button { margin-top: 16px; padding: 10px 20px; background: #0d9488; color: #fff; border: 0; border-radius: 999px; font-weight: 600; cursor: pointer; }
  footer.site { border-top: 1px solid #e6edeb; padding: 24px; color: #64748b; font-size: 14px; text-align: center; }
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
