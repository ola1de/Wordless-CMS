# WORDLESS

**The autonomous website operating system.**

Wordless is an independent, PHP-independent, WordPress-compatible content
management system and website operating system. It rebuilds the core of
WordPress — posts, pages, users, roles, options, media, hooks, REST-style
APIs — in TypeScript on Cloudflare Workers, D1 and R2, and adds an
autonomous AI command layer on top (later milestones).

One platform. One intelligent command centre. Complete website management.

> **Status: Milestone 2 — Core CMS (in development).** The kernel, D1
> schema, auth, posts/users/options/media APIs, revisions, terms, comments,
> menus, search, permalinks, public rendering, feeds, sitemap, site health,
> activity log, compat registry and admin shell are built and tested. The
> conversion engine, AI agents, visual editor, commerce and integrations are
> **not built yet** — see [What M2 is not](#what-milestone-2-is-not) below.
> Nothing unfinished is presented as done.

## Requirements

- **Node.js 20+** and **npm** (ships with Node). No global Wrangler, no
  Cloudflare account needed for local development.
- Git, for cloning.
- A Cloudflare account is needed **only** for production deployment, and
  only when you explicitly choose that path in the installer.

## Quick start

```bash
git clone https://github.com/ola1de/Wordless-CMS.git
cd Wordless-CMS
npm install
npm run setup
```

`npm run setup` is an interactive wizard (Node built-ins only, no extra
dependencies). It checks your environment, validates the configuration,
applies the local database schema, then asks you to choose:

1. **Local development** — prints (and can start) `npm run dev`. Works with
   **no Cloudflare account**: Wrangler emulates D1 locally.
2. **Production Cloudflare deploy** — only if you choose it: official
   `wrangler login` browser OAuth, `whoami` verification, D1/R2/KV
   provisioning, remote migrations, deploy, and a live `/api/health` check.
   Every remote step asks for confirmation first.

Non-interactive options:

```bash
npm run setup -- --check-only   # checks + validation only, no installs, no prompts
npm run setup -- --local        # local path, no prompts, no dev server auto-start
```

One-line wrappers (same thing, plus dependency install):

```bash
./install.sh        # macOS / Linux
.\install.ps1       # Windows PowerShell
```

Then:

```bash
npm run dev     # local dev server → http://localhost:8787/
npm test        # Vitest suite (in-memory SQLite, never a live D1)
npm run build   # typecheck (tsc --noEmit)
```

## Two paths

| | Local development | Production |
|---|---|---|
| Cloudflare account | Not needed | Required (free tier works) |
| Database | Wrangler local D1 (SQLite file under `.wrangler/`) | Cloudflare D1 `wordless` |
| Media | Stub (records only, no uploads yet) | R2 `wordless-media` (not wired yet — later milestone) |
| Command | `npm run dev` | `npm run deploy -- --confirm` |
| Details | [INSTALLATION.md](INSTALLATION.md) | [DEPLOYMENT.md](DEPLOYMENT.md) |

## Project layout

```
src/
  index.ts            Worker entry: fetch handler + route table
  env.ts              Env bindings (DB / MEDIA / CONFIG) — no secrets
  db.ts               D1 wrapper (bound params only)
  admin-shell.ts      Admin shell (Posts, Terms, Comments, Menus, Activity tabs)
  kernel/             hooks · router · errors · validation
  modules/
    posts/            posts/pages CRUD, slug generation, statuses, auto-revisions
    users/            users, PBKDF2 passwords, roles + capabilities
    options/          get/set/add/delete (JSON values)
    media/            attachment records; R2 behind a STUB interface
    auth/             opaque sessions in D1 (revocable, expiring)
    revisions/        revision snapshots, autosave, restore, line diff
    terms/            categories (hierarchical) + tags (flat), counts
    comments/         moderation, honeypot + link-count spam guard, count sync
    menus/            nav menus + items, locations in options
    search/           LIKE-based search, title-ranked (NOT full-text)
    permalinks/       structures, URL builders, resolver, 301 redirect history
    render/           public pages + built-in default theme, Gutenberg blocks
    feeds/            RSS 2.0, sitemap, robots.txt
    health/           site health checks (real, per-check pass/fail)
    activity/         wl_audit_log writes + admin list
  compat/
    wordpress.ts      31-function WP registry, honestly tagged
  test/
    test-db.ts        in-memory SQLite test helper (tests only)
migrations/
  0001_init.sql       D1 schema v1: 12 wp_* tables + 6 wl_* tables
  0002_m2.sql         wl_redirects + M2 indexes
scripts/
  install.mjs         installer wizard (Node built-ins only)
  deploy.mjs          production deploy guard
```

## API (Milestone 2)

All responses use the envelope `{ ok, data, error }`. The public site is
served from `/` (home), `/{slug}` (posts/pages), `/category/{slug}`,
`/tag/{slug}`, `/search?q=…` — the admin shell moved to `/admin` in M2
(M1 breaking change).

| Route | Auth | Description |
|---|---|---|
| `GET /api/health` | — | `{ status: "ok", version, time }` |
| `GET /api/site-health` | — | Real checks: DB, tables, bindings, content counts |
| `GET /api/activity` | `manage_options` | Audit log, paginated |
| `GET /api/posts` | — | List posts (`?status=&type=&page=&per_page=`, max 100) |
| `POST /api/posts` | `edit_posts` | Create a post |
| `PUT /api/posts/:id` | `edit_posts` | Update (auto-saves a revision) |
| `POST /api/posts/:id/trash` | `delete_posts` | Trash |
| `POST /api/posts/:id/restore` | `edit_posts` | Restore from trash |
| `DELETE /api/posts/:id` | `delete_posts` | Hard delete |
| `GET /api/posts/:slug` | —* | Get one post by slug |
| `GET /api/posts/:id/revisions` | logged in | List revisions |
| `POST /api/posts/:id/autosave` | `edit_posts` | Create/update the autosave |
| `GET /api/revisions/:id` | logged in | Get one revision |
| `GET /api/revisions/:from/diff/:to` | logged in | Line diff summary |
| `POST /api/revisions/:id/restore` | `edit_posts` | Restore a revision |
| `GET /api/terms` | — | List terms (`?taxonomy=category|tag`) |
| `POST /api/terms` | `manage_categories` | Create a term |
| `GET /api/terms/:id` | — | Get one term |
| `PUT /api/terms/:id` | `manage_categories` | Update a term |
| `DELETE /api/terms/:id` | `manage_categories` | Delete a term (children reparented) |
| `GET /api/posts/:id/terms` | — | Terms assigned to a post |
| `POST /api/posts/:id/terms` | `edit_posts` | Replace a post's terms for a taxonomy |
| `DELETE /api/posts/:id/terms/:termId` | `edit_posts` | Remove one term from a post |
| `GET /api/comments` | `moderate_comments` | List comments (`?postId=&status=`) |
| `GET /api/posts/:slug/comments` | — | Approved comments, threaded |
| `POST /api/posts/:slug/comments` | — | Create a comment (honeypot + link guard) |
| `POST /api/comments/:id/approve\|spam\|trash` | `moderate_comments` | Moderate |
| `DELETE /api/comments/:id` | `moderate_comments` | Hard delete |
| `GET /api/menus` | logged in | List menus |
| `POST /api/menus` | `edit_theme_options` | Create a menu |
| `DELETE /api/menus/:id` | `edit_theme_options` | Delete a menu |
| `GET /api/menus/:id/items` | logged in | Menu items (nested) |
| `POST /api/menus/:id/items` | `edit_theme_options` | Add an item |
| `PUT /api/menus/:id/items/:itemId` | `edit_theme_options` | Update an item |
| `DELETE /api/menus/:id/items/:itemId` | `edit_theme_options` | Remove an item |
| `GET /api/menus/locations` | logged in | Location → menu map |
| `POST /api/menus/locations` | `edit_theme_options` | Assign a location |
| `GET /api/menus/location/:location` | — | Resolve a menu by location |
| `GET /api/search?q=…` | — | LIKE-based search, title-ranked (not full-text) |
| `GET /api/permalinks` | — | Current permalink structure |
| `PUT /api/permalinks` | `manage_options` | Set structure |
| `POST /api/auth/login` | — | `{ login, password }` → session cookie |
| `POST /api/auth/logout` | — | Revoke the session |
| `GET /api/options/:key` | logged in | Read one option |
| `GET /feed` | — | RSS 2.0, latest 20 published posts |
| `GET /sitemap.xml` | — | Posts + pages + terms with content |
| `GET /robots.txt` | — | Allow all + sitemap line |
| `GET /admin` | — | Admin shell (calls the real API, no fake data) |

\* Draft/private posts require a logged-in user; trashed posts are never returned.

## What Milestone 1 is

- Typed hook/filter system with WordPress priority semantics (tested).
- D1 schema v1: all 12 WordPress tables (SQLite types) + `wl_sessions`,
  `wl_extensions`, `wl_jobs`, `wl_audit_log`, `wl_api_keys`, `wl_migrations`.
- Posts CRUD with slug generation, statuses (draft/publish/private/trash),
  pagination and status filtering (tested against in-memory SQLite).
- Users with PBKDF2 password hashing (WebCrypto) and the 5 WordPress roles
  with a capability map mirroring WP.
- Opaque, revocable, expiring sessions stored in D1 (token hash only).
- Options API storing JSON (not PHP-serialized strings).
- Media **records** (attachment rows + metadata).
- Installer wizard + deploy guard; no global Wrangler, no Cloudflare
  account for local work.
- 29 tests, all passing; `tsc --noEmit` clean under `strict`.

## What Milestone 2 is

- **Revisions + autosaves.** Every post update snapshots the pre-update
  content as a `revision` row; one autosave per post+author; restore
  snapshots the pre-restore content first; a line-based diff (LCS up to
  1000 lines, set-based above that) reports added/removed lines.
- **Terms.** Hierarchical categories and flat tags with per-taxonomy slug
  uniqueness, counts maintained on assign/remove/delete, children
  reparented on category delete.
- **Comments.** Pending by default (auto-approved only for moderators),
  honeypot field + configurable max-links guard (default 2 → pending),
  threaded replies, `comment_count` on posts counts approved only.
- **Menus.** `nav_menu` terms + `nav_menu_item` posts with order/parent;
  locations stored in the `nav_menu_locations` option; resolve by location.
- **Search.** `GET /api/search` — LIKE-based, case-insensitive, title
  matches ranked first, published posts/pages only. **This is NOT
  full-text search;** FTS5 is a later optimisation.
- **Permalinks.** Structures `plain | postname | day-name | month-name`,
  URL builders, a resolver (redirect → home → term → date archive →
  dated post → plain slug → trailing-slug redirect → 404) and 301 redirect
  history in `wl_redirects` on slug change of published posts.
- **Public rendering.** Server-rendered home, single post, page,
  term/date archives and search page through a small built-in default
  theme (semantic HTML + minimal inline CSS). Gutenberg block comments
  are rendered for paragraph, heading, list, quote, image, code,
  separator and spacer; unknown blocks render their inner HTML unchanged.
  All user content is escaped. Public pages send
  `Cache-Control: public, max-age=60` and are stored in the Cache API
  only for anonymous GETs.
- **Feeds + sitemap.** RSS 2.0 (latest 20), sitemap (posts/pages/terms
  with content, `lastmod` from `post_modified_gmt`), robots.txt.
- **Site Health.** `GET /api/site-health` runs real checks (database,
  tables, bindings, content counts, runtime) and reports per-check
  pass/fail — no fake "all good".
- **Activity log.** `wl_audit_log` writes for post/term/comment/menu/auth
  actions; `GET /api/activity` is admin-only and paginated.
- **Compat registry:** 31 core function names, each tagged
  `full` / `partial` / `stub` — 6 full (hooks), 24 partial, 1 stub
  (`register_rest_route`, recorded but not mounted).
- **Admin shell** at `/admin` with Posts, Terms, Comments, Menus and
  Activity tabs plus a login form; the public site is at `/`.
- 78 tests, all passing; `tsc --noEmit` clean under `strict`.

## What Milestone 2 is not

- **Not a full theme engine.** The built-in default theme renders the
  site; custom themes are M5.
- **Not a visual editor.** Content is written as HTML with optional
  Gutenberg block comments; the block editor is a later milestone.
- **No media uploads.** The R2 storage interface exists but throws a `STUB`
  501 — there is deliberately no upload endpoint and no fake upload.
- **No plugin/theme conversion.** The PHP→TypeScript conversion engine is
  Phase 4; the compat registry is the foundation for it, not the engine.
- **No AI agents.** Provider abstraction, orchestration and the command
  centre are Phase 6.
- **No commerce, email, payments, analytics or social integrations.**
  Those are Phase 8.
- **No production deployment verified yet.** Local D1 + `wrangler dev` are
  verified; the production path is implemented but untested (no Cloudflare
  account connected — deployment happens when the user installs with their
  own account).
- **No user-creation UI/CLI yet.** The first admin user is created via the
  user service (seed tooling is a Phase 3 task).

## Documentation

- [INSTALLATION.md](INSTALLATION.md) — installing from GitHub, local setup
- [DEPLOYMENT.md](DEPLOYMENT.md) — production deployment on Cloudflare
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — common failures and fixes
- [ARCHITECTURE.md](ARCHITECTURE.md) — module map + pointer to the full design
- `../docs/01-discovery-assessment.md` — WordPress 7.1.5 source assessment
- `../docs/02-architecture.md` — full architecture and decisions log

## Licensing and attribution

Wordless's own code is MIT licensed (see [LICENSE](LICENSE)). WordPress is
GPL-licensed software by Automattic and the WordPress community; Wordless is
a clean-room re-implementation in TypeScript — **no WordPress PHP code is
included or copied into this repository**, and the reference copy of
WordPress used for analysis is kept out of git. Wordless is not affiliated
with, endorsed by, or sponsored by WordPress or Automattic, and makes no
claim to the WordPress trademark.

## Contributing

Milestone 2 is a working core CMS, not a finished product. See the roadmap in
`../docs/` (phases 1–10). Do not mark unfinished features as complete, do
not commit secrets, and keep every stub labelled `STUB` until it is real.
