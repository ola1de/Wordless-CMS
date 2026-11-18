/**
 * Admin shell (Milestone 1): a small static page served at `/`.
 * It calls the REAL API — /api/health and /api/posts — and renders what
 * comes back. No fake data: if a request fails, the page shows the error.
 * A full React admin arrives in Phase 3; this shell exists so M1 can be
 * smoke-tested in a browser with `wrangler dev`.
 */
export function adminHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wordless — Admin</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
  header { background: #1e293b; padding: 16px 24px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 4px 0 0; color: #94a3b8; font-size: 13px; }
  main { max-width: 860px; margin: 0 auto; padding: 24px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
  .ok { color: #4ade80; } .bad { color: #f87171; } .muted { color: #94a3b8; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 10px 0; border-bottom: 1px solid #334155; }
  li:last-child { border-bottom: 0; }
  .tag { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #334155; margin-left: 8px; }
  code { background: #0f172a; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<header>
  <h1>Wordless</h1>
  <p>Autonomous website operating system — Milestone 1 admin shell</p>
</header>
<main>
  <section class="card">
    <h2>System health</h2>
    <p id="health" class="muted">Checking /api/health&hellip;</p>
  </section>
  <section class="card">
    <h2>Posts <span class="muted" id="post-count"></span></h2>
    <ul id="posts"><li class="muted">Loading /api/posts&hellip;</li></ul>
    <p class="muted">Publishing, login and editing arrive with the Phase 3 admin. This shell is read-only.</p>
  </section>
  <section class="card">
    <h2>API</h2>
    <p class="muted">
      <code>GET /api/health</code> &middot; <code>GET /api/posts</code> &middot;
      <code>GET /api/posts/:slug</code> &middot; <code>POST /api/auth/login</code> &middot;
      <code>POST /api/auth/logout</code> &middot; <code>GET /api/options/:key</code>
    </p>
  </section>
</main>
<script>
(function () {
  var healthEl = document.getElementById('health');
  var postsEl = document.getElementById('posts');
  var countEl = document.getElementById('post-count');

  function showError(el, err) {
    el.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
    el.className = 'bad';
  }

  fetch('/api/health')
    .then(function (r) { return r.json(); })
    .then(function (body) {
      if (body.ok) {
        healthEl.textContent = 'OK — version ' + body.data.version + ' at ' + body.data.time;
        healthEl.className = 'ok';
      } else {
        healthEl.textContent = 'Unhealthy: ' + (body.error && body.error.message);
        healthEl.className = 'bad';
      }
    })
    .catch(function (err) { showError(healthEl, err); });

  fetch('/api/posts?per_page=20')
    .then(function (r) { return r.json(); })
    .then(function (body) {
      postsEl.textContent = '';
      if (!body.ok) {
        var li = document.createElement('li');
        li.className = 'bad';
        li.textContent = 'Could not load posts: ' + (body.error && body.error.message);
        postsEl.appendChild(li);
        return;
      }
      countEl.textContent = '(' + body.data.total + ' total)';
      if (body.data.posts.length === 0) {
        var empty = document.createElement('li');
        empty.className = 'muted';
        empty.textContent = 'No posts yet. Create one with POST /api/posts (requires login).';
        postsEl.appendChild(empty);
        return;
      }
      body.data.posts.forEach(function (post) {
        var li = document.createElement('li');
        var title = document.createElement('strong');
        title.textContent = post.title || '(untitled)';
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = post.status + ' · ' + post.type;
        var meta = document.createElement('div');
        meta.className = 'muted';
        meta.textContent = post.slug + ' · ' + post.date;
        li.appendChild(title);
        li.appendChild(tag);
        li.appendChild(meta);
        postsEl.appendChild(li);
      });
    })
    .catch(function (err) { showError(postsEl, err); });
})();
</script>
</body>
</html>`;
}
