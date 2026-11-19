/**
 * Admin shell (Milestone 2): tabs for Posts, Terms, Comments, Menus and
 * Activity, plus a login form. It calls the REAL API — every list, form
 * and button hits /api/*. No fake data: failures show the error.
 * A full React admin arrives in Phase 3; this shell exists so M2 can be
 * used and smoke-tested in a browser with `wrangler dev`.
 * The public site lives at `/`; the admin lives at `/admin`.
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
  header a { color: #93c5fd; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
  .ok { color: #4ade80; } .bad { color: #f87171; } .muted { color: #94a3b8; }
  .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .tabs button { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  .tabs button.active { background: #2563eb; border-color: #2563eb; }
  .tabpage { display: none; } .tabpage.active { display: block; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 10px 0; border-bottom: 1px solid #334155; }
  li:last-child { border-bottom: 0; }
  .tag { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #334155; margin-left: 8px; }
  code { background: #0f172a; padding: 2px 6px; border-radius: 4px; }
  input, select, textarea { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 8px; margin: 4px 4px 4px 0; font: inherit; }
  button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; margin: 2px; }
  button.small { padding: 4px 10px; font-size: 13px; background: #334155; }
  button.danger { background: #b91c1c; }
  form { margin: 12px 0; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
</head>
<body>
<header>
  <h1>Wordless</h1>
  <p>Autonomous website operating system — Milestone 2 admin shell &middot;
  <a href="/" target="_blank" rel="noopener">View site</a> &middot;
  <a href="/feed" target="_blank" rel="noopener">RSS feed</a> &middot;
  <a href="/sitemap.xml" target="_blank" rel="noopener">Sitemap</a></p>
</header>
<main>
  <section class="card" id="auth-card">
    <h2>Sign in</h2>
    <p id="auth-state" class="muted">Checking session&hellip;</p>
    <form id="login-form">
      <input name="login" placeholder="Username" required>
      <input name="password" type="password" placeholder="Password" required>
      <button type="submit">Log in</button>
      <button type="button" id="logout-btn">Log out</button>
    </form>
    <p class="muted">Mutations (create/edit/moderate) need a signed-in user with the right role. Reads work anonymously where the API allows.</p>
  </section>

  <section class="card">
    <h2>System health</h2>
    <p id="health" class="muted">Checking /api/health&hellip;</p>
    <p id="site-health" class="muted"></p>
  </section>

  <div class="tabs">
    <button data-tab="posts" class="active">Posts</button>
    <button data-tab="terms">Terms</button>
    <button data-tab="comments">Comments</button>
    <button data-tab="menus">Menus</button>
    <button data-tab="activity">Activity</button>
  </div>

  <section class="card tabpage active" id="tab-posts">
    <h2>Posts <span class="muted" id="post-count"></span></h2>
    <ul id="posts"><li class="muted">Loading /api/posts&hellip;</li></ul>
  </section>

  <section class="card tabpage" id="tab-terms">
    <h2>Terms</h2>
    <div class="row">
      <select id="terms-taxonomy"><option value="category">Categories</option><option value="tag">Tags</option></select>
      <button id="terms-refresh" type="button">Refresh</button>
    </div>
    <ul id="terms"><li class="muted">Loading&hellip;</li></ul>
    <form id="term-form">
      <input name="name" placeholder="New term name" required>
      <input name="slug" placeholder="slug (optional)">
      <button type="submit">Create term</button>
    </form>
  </section>

  <section class="card tabpage" id="tab-comments">
    <h2>Comments <span class="muted">(moderation needs sign-in)</span></h2>
    <div class="row">
      <select id="comments-status">
        <option value="">All</option><option value="pending">Pending</option>
        <option value="approved">Approved</option><option value="spam">Spam</option><option value="trash">Trash</option>
      </select>
      <button id="comments-refresh" type="button">Refresh</button>
    </div>
    <ul id="comments"><li class="muted">Loading&hellip;</li></ul>
  </section>

  <section class="card tabpage" id="tab-menus">
    <h2>Menus</h2>
    <ul id="menus"><li class="muted">Loading&hellip;</li></ul>
    <form id="menu-form">
      <input name="name" placeholder="New menu name" required>
      <button type="submit">Create menu</button>
    </form>
    <div id="menu-detail"></div>
  </section>

  <section class="card tabpage" id="tab-activity">
    <h2>Activity <span class="muted">(admin only)</span></h2>
    <ul id="activity"><li class="muted">Loading&hellip;</li></ul>
  </section>

  <section class="card">
    <h2>API</h2>
    <p class="muted">
      <code>GET /api/health</code> &middot; <code>GET /api/site-health</code> &middot;
      <code>GET /api/posts</code> &middot; <code>PUT /api/posts/:id</code> &middot;
      <code>GET /api/terms</code> &middot; <code>GET /api/comments</code> &middot;
      <code>GET /api/menus</code> &middot; <code>GET /api/search?q=</code> &middot;
      <code>GET /api/activity</code> &middot; <code>GET /feed</code> &middot; <code>GET /sitemap.xml</code>
    </p>
  </section>
</main>
<script>
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s); }
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}))
      .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); });
  }
  function li(text, cls) { var e = document.createElement('li'); if (cls) e.className = cls; e.textContent = text; return e; }

  // Tabs
  document.querySelectorAll('.tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tabpage').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      $('tab-' + btn.getAttribute('data-tab')).classList.add('active');
    });
  });

  // Auth state
  function checkAuth() {
    api('/api/options/blogname').then(function (res) {
      $('auth-state').textContent = res.status === 200 ? 'Signed in.' : 'Not signed in — mutations will fail until you log in.';
      $('auth-state').className = res.status === 200 ? 'ok' : 'muted';
    }).catch(function () { $('auth-state').textContent = 'Could not check session.'; });
  }
  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: fd.get('login'), password: fd.get('password') }),
    }).then(function (r) { return r.json(); }).then(function (body) {
      $('auth-state').textContent = body.ok ? 'Signed in as ' + body.data.user.login + ' (' + body.data.user.role + ').' : 'Login failed: ' + (body.error && body.error.message);
      $('auth-state').className = body.ok ? 'ok' : 'bad';
      if (body.ok) { loadAll(); }
    });
  });
  $('logout-btn').addEventListener('click', function () {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(function () { checkAuth(); loadAll(); });
  });

  // Health
  api('/api/health').then(function (res) {
    var el = $('health');
    if (res.body.ok) { el.textContent = 'OK — version ' + res.body.data.version + ' at ' + res.body.data.time; el.className = 'ok'; }
    else { el.textContent = 'Unhealthy: ' + (res.body.error && res.body.error.message); el.className = 'bad'; }
  });
  api('/api/site-health').then(function (res) {
    var el = $('site-health');
    if (!res.body.ok) { el.textContent = 'Site health unavailable.'; return; }
    el.textContent = res.body.data.checks.map(function (c) { return c.name + ': ' + c.status + ' — ' + c.detail; }).join(' | ');
    el.className = res.body.data.status === 'ok' ? 'ok' : 'bad';
  });

  // Posts
  function loadPosts() {
    var el = $('posts');
    api('/api/posts?per_page=20').then(function (res) {
      el.textContent = '';
      if (!res.body.ok) { el.appendChild(li('Could not load posts: ' + (res.body.error && res.body.error.message), 'bad')); return; }
      $('post-count').textContent = '(' + res.body.data.total + ' total)';
      if (res.body.data.posts.length === 0) { el.appendChild(li('No posts yet.', 'muted')); return; }
      res.body.data.posts.forEach(function (post) {
        var item = document.createElement('li');
        var title = document.createElement('strong'); title.textContent = post.title || '(untitled)';
        var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = post.status + ' · ' + post.type;
        var meta = document.createElement('div'); meta.className = 'muted'; meta.textContent = post.slug + ' · ' + post.date;
        item.appendChild(title); item.appendChild(tag); item.appendChild(meta);
        el.appendChild(item);
      });
    });
  }

  // Terms
  function loadTerms() {
    var tax = $('terms-taxonomy').value;
    var el = $('terms');
    api('/api/terms?taxonomy=' + encodeURIComponent(tax) + '&per_page=50').then(function (res) {
      el.textContent = '';
      if (!res.body.ok) { el.appendChild(li('Could not load terms: ' + (res.body.error && res.body.error.message), 'bad')); return; }
      if (res.body.data.terms.length === 0) { el.appendChild(li('No terms yet.', 'muted')); return; }
      res.body.data.terms.forEach(function (t) {
        var item = document.createElement('li');
        var name = document.createElement('strong'); name.textContent = t.name;
        var meta = document.createElement('span'); meta.className = 'muted'; meta.textContent = '  /' + t.slug + ' · ' + t.count + ' posts';
        item.appendChild(name); item.appendChild(meta);
        el.appendChild(item);
      });
    });
  }
  $('terms-taxonomy').addEventListener('change', loadTerms);
  $('terms-refresh').addEventListener('click', loadTerms);
  $('term-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    fetch('/api/terms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fd.get('name'), slug: fd.get('slug') || undefined, taxonomy: $('terms-taxonomy').value }) })
      .then(function (r) { return r.json(); }).then(function (body) {
        if (!body.ok) { alert('Could not create term: ' + (body.error && body.error.message)); return; }
        ev.target.reset(); loadTerms();
      });
  });

  // Comments
  function loadComments() {
    var status = $('comments-status').value;
    var el = $('comments');
    var url = '/api/comments?per_page=20' + (status ? '&status=' + encodeURIComponent(status) : '');
    api(url).then(function (res) {
      el.textContent = '';
      if (!res.body.ok) { el.appendChild(li('Could not load comments (sign in as an editor/admin): ' + (res.body.error && res.body.error.message), 'bad')); return; }
      if (res.body.data.comments.length === 0) { el.appendChild(li('No comments.', 'muted')); return; }
      res.body.data.comments.forEach(function (c) {
        var item = document.createElement('li');
        var head = document.createElement('div');
        var author = document.createElement('strong'); author.textContent = c.author;
        var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = c.status + ' · post ' + c.postId;
        head.appendChild(author); head.appendChild(tag);
        var body = document.createElement('div'); body.textContent = c.content;
        item.appendChild(head); item.appendChild(body);
        [['Approve', 'approve'], ['Spam', 'spam'], ['Trash', 'trash']].forEach(function (pair) {
          var btn = document.createElement('button'); btn.className = 'small'; btn.textContent = pair[0];
          btn.addEventListener('click', function () {
            fetch('/api/comments/' + c.id + '/' + pair[1], { method: 'POST', credentials: 'same-origin' })
              .then(function () { loadComments(); });
          });
          item.appendChild(btn);
        });
        el.appendChild(item);
      });
    });
  }
  $('comments-status').addEventListener('change', loadComments);
  $('comments-refresh').addEventListener('click', loadComments);

  // Menus
  function loadMenus() {
    var el = $('menus');
    api('/api/menus').then(function (res) {
      el.textContent = '';
      if (!res.body.ok) { el.appendChild(li('Could not load menus (sign in first): ' + (res.body.error && res.body.error.message), 'bad')); return; }
      if (res.body.data.length === 0) { el.appendChild(li('No menus yet.', 'muted')); return; }
      res.body.data.forEach(function (m) {
        var item = document.createElement('li');
        var name = document.createElement('strong'); name.textContent = m.name;
        var btn = document.createElement('button'); btn.className = 'small'; btn.textContent = 'Show items';
        btn.addEventListener('click', function () { loadMenuItems(m.id, m.name); });
        item.appendChild(name); item.appendChild(btn);
        el.appendChild(item);
      });
    });
  }
  function loadMenuItems(menuId, menuName) {
    var detail = $('menu-detail');
    api('/api/menus/' + menuId + '/items').then(function (res) {
      detail.textContent = '';
      var h = document.createElement('h3'); h.textContent = 'Items in "' + menuName + '"'; detail.appendChild(h);
      if (!res.body.ok) { detail.appendChild(li('Could not load items: ' + (res.body.error && res.body.error.message), 'bad')); return; }
      var list = document.createElement('ul');
      var flat = [];
      (function walk(items) { items.forEach(function (i) { flat.push(i); walk(i.children || []); }); })(res.body.data);
      if (flat.length === 0) { list.appendChild(li('No items yet.', 'muted')); }
      flat.forEach(function (i) {
        var item = document.createElement('li');
        item.textContent = i.title + ' → ' + i.url + ' (' + i.type + ')';
        list.appendChild(item);
      });
      detail.appendChild(list);
      var form = document.createElement('form');
      form.innerHTML = '<input name="title" placeholder="Item title" required> <input name="url" placeholder="https://… (custom only)"> ' +
        '<select name="type"><option value="custom">custom</option><option value="post">post</option><option value="page">page</option><option value="term">term</option></select> ' +
        '<input name="objectId" placeholder="object id (non-custom)" type="number"> <button type="submit">Add item</button>';
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        fetch('/api/menus/' + menuId + '/items', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: fd.get('title'), type: fd.get('type'), url: fd.get('url') || undefined, objectId: fd.get('objectId') ? Number(fd.get('objectId')) : undefined }) })
          .then(function (r) { return r.json(); }).then(function (body) {
            if (!body.ok) { alert('Could not add item: ' + (body.error && body.error.message)); return; }
            loadMenuItems(menuId, menuName);
          });
      });
      detail.appendChild(form);
    });
  }
  $('menu-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    fetch('/api/menus', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fd.get('name') }) })
      .then(function (r) { return r.json(); }).then(function (body) {
        if (!body.ok) { alert('Could not create menu: ' + (body.error && body.error.message)); return; }
        ev.target.reset(); loadMenus();
      });
  });

  // Activity
  function loadActivity() {
    var el = $('activity');
    api('/api/activity?per_page=20').then(function (res) {
      el.textContent = '';
      if (!res.body.ok) { el.appendChild(li('Could not load activity (admin only): ' + (res.body.error && res.body.error.message), 'bad')); return; }
      if (res.body.data.entries.length === 0) { el.appendChild(li('No activity yet.', 'muted')); return; }
      res.body.data.entries.forEach(function (e) {
        var item = document.createElement('li');
        var head = document.createElement('strong'); head.textContent = e.action;
        var meta = document.createElement('span'); meta.className = 'muted';
        meta.textContent = '  ' + (e.objectType || '') + ' ' + (e.objectId || '') + ' · user ' + e.actorId + ' · ' + e.createdAt;
        item.appendChild(head); item.appendChild(meta);
        el.appendChild(item);
      });
    });
  }

  function loadAll() { checkAuth(); loadPosts(); loadTerms(); loadComments(); loadMenus(); loadActivity(); }
  loadAll();
})();
</script>
</body>
</html>`;
}
