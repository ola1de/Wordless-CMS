# WORDLESS

**The autonomous website operating system.**

Wordless is an independent, PHP-independent, WordPress-compatible content
management system and website operating system. It rebuilds the core of
WordPress — posts, pages, users, roles, options, media, hooks, REST-style
APIs — in TypeScript on Cloudflare Workers, D1 and R2, and adds an
autonomous AI command layer on top (later milestones).

One platform. One intelligent command centre. Complete website management.

> **Status: Milestone 5 — Themes + visual editor v1 (in development).** The kernel, D1
> schema, auth, posts/users/options/media APIs, revisions, terms, comments,
> menus, search, permalinks, public rendering, feeds, sitemap, site health,
> activity log, compat registry, the React admin SPA with a Gutenberg
> block editor, the PHP→TypeScript conversion engine (lexer, parser,
> emitter, safety sandbox, async conversion jobs, Hello Dolly end-to-end,
> Akismet static analysis), and the theme system (theme.json engine,
> block-theme rendering, ZIP import, classic-theme analysis, customizer
> with preview + variations) are built and tested. The AI agents,
> commerce and integrations are **not built yet** — see
> [What M5 is not](#what-milestone-5-is-not) below. Nothing unfinished is
> presented as done.

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
npm run dev     # local dev server → http://localhost:8787/ (builds the admin first)
npm test        # Vitest suite (in-memory SQLite, never a live D1)
npm run build   # admin SPA build (Vite) + typecheck of worker and admin
npm run build:admin  # admin SPA build only (Vite → admin/dist/admin/)
```

## Two paths

| | Local development | Production |
|---|---|---|
| Cloudflare account | Not needed | Required (free tier works) |
| Database | Wrangler local D1 (SQLite file under `.wrangler/`) | Cloudflare D1 `wordless` |
| Media | R2 `wordless-media` via miniflare emulation (uploads work; no image derivatives yet — Phase 7) | R2 `wordless-media` |
| Command | `npm run dev` | `npm run deploy -- --confirm` |
| Details | [INSTALLATION.md](INSTALLATION.md) | [DEPLOYMENT.md](DEPLOYMENT.md) |

## Project layout

```
src/
  index.ts            Worker entry: fetch handler + route table
  env.ts              Env bindings (DB / MEDIA / CONFIG / ASSETS) — no secrets
  db.ts               D1 wrapper (bound params only)
  kernel/             hooks · router · errors · validation
  modules/
    posts/            posts/pages CRUD, slug generation, statuses, auto-revisions
    users/            users, PBKDF2 passwords, roles + capabilities
    options/          get/set/add/delete (JSON values)
    settings/         site settings object + validation (M3)
    media/            uploads to R2, attachment records + postmeta (M3)
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
    conversion/       conversion jobs in wl_jobs + runConversionJob (M4)
    extensions/       wl_extensions rows + bundled-extension registry (M4)
    themes/           theme.json engine, templates, ZIP import, classic
                      analysis, variations, preview (M5); wl_themes rows
  conversion/         PHP → TypeScript engine: lexer, parser, AST, emitter,
                      safety sandbox, static analysis (M4)
  compat/
    wordpress.ts      45-function WP registry, honestly tagged
  test/
    test-db.ts        in-memory SQLite test helper (tests only)
    fake-storage.ts   in-memory MediaStorage for tests (tests only)
themes/
  wordless-default/   the built-in default block theme (original work, M5):
                      style.css, theme.json v3, templates/, parts/
examples/
  hello-dolly/        converter output for the bundled Hello Dolly plugin (M4)
docs/conversion/
  hello-dolly-report.md   the Hello Dolly conversion report (M4)
  akismet-analysis.md     static analysis of the bundled Akismet plugin (M4)
docs/themes/
  theme-support.md        theme.json v1/v2/v3 matrix + import guide (M5)
  classic-conversion.md   classic-theme conversion report (M5)
admin/
  vite.config.ts      Vite build → admin/dist/admin/ (base /admin/)
  index.html          SPA entry point
  src/
    main.tsx          React entry point
    App.tsx           hash routing + sidebar layout + auth gate
    styles.css        the one plain stylesheet (no framework)
    lib/              API client, types, date/permalink helpers
    editor/           Gutenberg block parser/serializer + tests
    pages/            Dashboard, Posts, Editor, Media, Terms, Comments,
                      Menus, Users, Settings, Site Health, Activity, Login,
                      Conversion (M4), ThemeEditor (M5)
migrations/
  0001_init.sql       D1 schema v1: 12 wp_* tables + 6 wl_* tables
  0002_m2.sql         wl_redirects + M2 indexes
  0005_m5.sql         wl_themes (M5)
scripts/
  install.mjs         installer wizard (Node built-ins only)
  deploy.mjs          production deploy guard
  generate-default-theme.mjs   regenerates src/modules/themes/default-theme.ts
                      from themes/wordless-default/ (M5; tested for drift)
```

## API (Milestone 5)

All responses use the envelope `{ ok, data, error }`. The public site is
served from `/` (home), `/{slug}` (posts/pages), `/category/{slug}`,
`/tag/{slug}`, `/search?q=…` — the React admin SPA lives at `/admin`
(the server-rendered admin shell was replaced in M3).

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
| `GET /api/auth/me` | logged in | Current user |
| `GET /api/settings` | logged in | Site settings object |
| `PUT /api/settings` | `manage_options` | Update + validate settings |
| `GET /api/users` | `edit_users` | List users, paginated |
| `POST /api/users` | `edit_users` | Create a user (role validated) |
| `PUT /api/users/:id/role` | `edit_users` | Change a user's role |
| `DELETE /api/users/:id` | `edit_users` | Delete; refused (400) when the user owns posts |
| `POST /api/users/:id/reset-password` | `edit_users` | Temporary password, returned once |
| `GET /api/media` | `upload_files` | List media (`?mime=&page=&per_page=`) |
| `POST /api/media` | `upload_files` | Multipart upload (10 MB cap, MIME allowlist) |
| `GET /api/media/:id` | `upload_files` | Get one media item |
| `PUT /api/media/:id` | `upload_files` | Update alt text |
| `DELETE /api/media/:id` | `upload_files` | Delete R2 object + post + meta |
| `GET /media/:key` | — | Serve a stored file from R2 (long cache) |
| `GET /api/options/:key` | logged in | Read one option |
| `POST /api/conversion/jobs` | `install_plugins` | Start a conversion job (multipart `.php` ≤1 MB, or JSON `{ fixture: "hello-dolly" }`); runs synchronously in local dev, returns the finished job |
| `GET /api/conversion/jobs` | `install_plugins` | List conversion jobs, paginated |
| `GET /api/conversion/jobs/:id` | `install_plugins` | One job: status, progress, report or error |
| `GET /api/extensions` | `install_plugins` | Installed extensions (`wl_extensions`) |
| `GET /api/themes` | `edit_theme_options` | List themes (`wl_themes`) |
| `GET /api/themes/active` | — | Active theme + saved variation (if any) |
| `POST /api/themes/import` | `edit_theme_options` | Import a block theme ZIP (≤5 MB; `style.css` + `theme.json`) |
| `POST /api/themes/import-classic` | `edit_theme_options` | Import a classic theme ZIP: stylesheet + per-file analysis report |
| `GET /api/themes/:slug` | `edit_theme_options` | Theme detail: theme.json, stylesheet, files, report |
| `POST /api/themes/:slug/activate` | `edit_theme_options` | Activate (busts the theme CSS cache via the hash) |
| `POST /api/themes/:slug/delete` | `edit_theme_options` | Delete; refused for the active theme / built-in default |
| `GET /api/themes/:slug/variation` | `edit_theme_options` | Saved customizer variation (or null) |
| `PUT /api/themes/:slug/variation` | `edit_theme_options` | Save a customizer variation (block themes only) |
| `DELETE /api/themes/:slug/variation` | `edit_theme_options` | Reset to theme defaults |
| `POST /api/themes/preview` | `edit_theme_options` | Create a 30-minute preview token for unsaved settings |
| `GET /theme.css` | — | Active theme stylesheet (`?v=<hash>`; `?wl_preview=<token>` applies preview overrides) |
| `GET /feed` | — | RSS 2.0, latest 20 published posts |
| `GET /sitemap.xml` | — | Posts + pages + terms with content |
| `GET /robots.txt` | — | Allow all + sitemap line |
| `GET /admin` | — | React admin SPA (Static Assets; calls the real API, no fake data) |

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

## What Milestone 4 is

- **PHP lexer + parser** (`src/conversion/`). A TypeScript tokenizer and
  recursive-descent parser for the PHP subset real plugins use: `<?php`
  tags, functions, `add_action`/`add_filter`, `echo`/`print`, strings
  (single/double, `.` concat, interpolation, heredoc), arrays (`array()`
  and `[]`), variables, `if/else`/`elseif` chains, `foreach`/`for`/`while`/
  `do…while`, `switch`, `try/catch`, `return`, comments, `require/include`
  of literal paths, classes with methods (analysed, not converted), casts
  (`(int)`, `(string)`…), the spaceship operator (`<=>`), nullable/union
  parameter types, namespaced names (`WP_CLI\Utils\…`), function-local
  `static` variables, and the template alternative syntax
  (`if (…): … endif;`, `foreach (…): … endforeach;` — common in views).
  Every AST node carries source position; unsupported constructs are
  recorded as `unsupported` nodes with a reason, never silently dropped.
  Known gaps: `match` expressions and `fn` arrow functions are not parsed
  yet (parse error, honestly reported — neither appears in Akismet).
- **AST → TypeScript emitter** (`src/conversion/emitter.ts`). PHP functions
  become TS functions taking the WordPress API (`wp`) as the first
  parameter; `add_action`/`add_filter` become hook registrations in
  `activate(wp)`; `echo`/`printf` output is collected into a returned
  string; WP functions map through the compat registry where a mapping
  exists and are flagged `unmapped` otherwise (emitted as a throwing
  `__unmapped_<name>` helper, listed in the report). Function-local
  `static` variables are hoisted to module-level `let`s so they persist
  across calls exactly as PHP statics do. The emitter's output typechecks
  (tested with `tsc` on the generated Hello Dolly module).
- **Async conversion jobs** (`src/modules/conversion/`, `wl_jobs` rows of
  kind `conversion`). `POST /api/conversion/jobs` accepts a multipart PHP
  file (≤1 MB, `.php` only) or the `hello-dolly` fixture; the job moves
  `pending` → `running` → `done`/`failed` with a progress percentage and
  a report (files processed, AST node counts, converted/unconverted counts
  with reasons, warnings, generated output). Processing runs synchronously
  inside the request in local dev (a single file converts in ~10 ms);
  the same `runConversionJob(db, jobId)` is structured to be invoked by a
  Queue/Workflow consumer later (production path — see ARCHITECTURE.md,
  no Queues built in M4). A blocked construct fails the job with a clear
  error, never a partial silent success.
- **Hello Dolly end-to-end.** The bundled plugin converts cleanly: 3/3
  functions, 2/2 hooks, 0 unconverted, 0 warnings (one transformation —
  the ABSPATH guard, removed with a note). The generated extension lives
  at `examples/hello-dolly/` (generated `index.ts` + `extension.json` +
  README) and is registered in the extension registry, so a successful
  fixture job installs it (`wl_extensions`, status `active`) and activates
  it. Runtime-tested: the hooks register through the kernel and return a
  lyric line. Full report: `docs/conversion/hello-dolly-report.md`.
- **Sandbox + safety** (`src/conversion/safety.ts`). The converter REJECTS
  (job fails with a reason) any source containing `eval`, `exec`,
  `shell_exec`, `system`, `passthru`, `popen`, `proc_open`,
  `create_function`, `unserialize`, `parse_str`/`mb_parse_str`, `assert`,
  backtick execution, or a dynamic `include`/`require` of a non-literal
  path. The scan is token-based, so blocked words inside strings or
  comments do not trip it. **No PHP is ever executed** — there is no PHP
  runtime in Wordless at all — and converted code runs only through the
  Wordless extension API with the same capability checks as any extension.
  No dynamic code loading, no shelling out.
- **Akismet analysis (NOT a conversion).** The bundled Akismet plugin was
  run through the parser file by file: 29 files, 7,707 lines, 9
  convertible / 16 partial / 4 blocked, with per-file features, WordPress
  APIs, hooks, options and HTTP calls, and an honest effort estimate.
  `docs/conversion/akismet-analysis.md`. Akismet is NOT converted in M4:
  its value is an external API and a spam database, not the PHP around
  them — that is an integration (Phase 8), not a conversion.
- **Admin Conversion page** (`#/conversion`). Upload a PHP file or pick
  the Hello Dolly fixture, start a job, watch status/progress, read the
  report (converted/unconverted/warnings), view the generated code, and
  see installed extensions. All on the real API.
- **Compat registry:** 41 function names now — M4 adds `get_user_locale`,
  `get_locale`, `__`, `_e`, `esc_html`, `esc_attr` and `wptexturize`
  (all partial; the locale ones read the request's `site_locale` option
  synchronously, on purpose, so a locale call inside an action callback
  does not force the whole function async).
- **No schema change was needed for M4** — job reports live as JSON in
  the existing `wl_jobs.result` column, so there is no
  `migrations/0004_m4.sql`.
- 176 tests, all passing; `tsc --noEmit` clean for the worker and the
  admin under `strict`.

## What Milestone 4 is not

- **Not universal plugin compatibility.** Hello Dolly converts; Akismet
  does not (classes, external API, `$wpdb`). The converter handles the
  procedural PHP subset well and records everything else honestly — never
  claim a plugin converts until its own report says so.
- **Not a class runtime.** Classes are analysed (methods, properties,
  inheritance) but not converted; building a class runtime is a later
  milestone, and it is the main blocker for real-world plugins.
- **Not a marketplace.** Installing/activating arbitrary extensions from
  uploads is Phase 8; M4 only registers the converter's own bundled
  output (hello-dolly).
- **Not per-request extension loading.** A successful job activates the
  bundled extension in the running isolate's hook registry; a cold start
  does not re-activate it. Loading active extensions at Worker startup is
  a later milestone.
- **No Queues/Workflows yet.** The job module is structured for a
  Queue/Workflow consumer, but production conversion still runs inside
  the request in M4.
- **No AI agents.** Provider abstraction, orchestration and the command
  centre are Phase 6.
- **No image derivatives.** Uploads store the original file only; resizing
  and WebP conversion are Phase 7.
- **No user reassignment on delete.** Deleting a user who owns posts is
  refused; reassignment is a later milestone.

## What Milestone 5 is

- **theme.json engine** (`src/modules/themes/themejson.ts`). Parses and
  validates theme.json v1–3 (v3 fully; v2 with documented gaps —
  `settings.typography.writingMode` and per-block `elements` are recorded
  as unsupported, not applied; v1 partial — no `customTemplates` /
  `templateParts` / `settings.custom`). Invalid theme.json fails import
  with the offending paths listed. Generates a real stylesheet: CSS
  custom properties (`--wp--preset--color--*`, `--wp--preset--font-size--*`,
  …), fluid `clamp()` font sizes, global + per-block styles, preset-var
  resolution (`var:preset|color|x` → `var(--wp--preset--color--x)`),
  layout widths, and a deterministic cyrb53 stylesheet hash.
- **Theme registry + storage** (`migrations/0005_m5.sql`, `wl_themes`).
  `GET /api/themes`, `GET /api/themes/:slug`, `POST /api/themes/import`
  (multipart ZIP ≤5 MB, extracted with `fflate`, validated: `style.css`
  header + `theme.json`; path traversal rejected), `POST
  /api/themes/import-classic`, `POST /api/themes/:slug/activate`, `POST
  /api/themes/:slug/delete` (refuses the active theme and the built-in
  default), `GET /api/themes/active`. Theme files live in R2 under
  `themes/<slug>/` via the media storage interface; metadata in D1.
- **Wordless default theme** (`themes/wordless-default/`). An original
  block theme authored for this project — `style.css` with a proper
  header, `theme.json` v3, templates (`index`, `home`, `single`, `page`,
  `archive`, `search`, `404`), parts (`header`, `footer`). It is seeded
  lazily on a fresh install and is the active theme until another is
  activated. The in-code bundle (`src/modules/themes/default-theme.ts`,
  regenerated by `scripts/generate-default-theme.mjs`) is tested to match
  the repo files byte for byte.
- **Block-theme rendering.** The M2 render module now uses the active
  theme: template hierarchy (home → index, single → single/singular/index,
  page → page/singular/index, archive, search, 404, index fallback),
  template parts, and template blocks rendered through the existing block
  renderer (query/post-template/post-title/post-content/post-excerpt/
  post-date/post-terms/query-title/query-pagination/search/group/columns/
  navigation/site-title/site-tagline). The theme stylesheet is served at
  `/theme.css?v=<hash>` and linked on every public page; activation busts
  the cache. The M2 built-in rendering remains as the fallback when no
  theme is active.
- **Classic-theme conversion (report + partial import).** The M4 PHP
  analyser runs over a classic theme's files and produces a per-file
  report (convertible / partial / blocked with reasons); the stylesheet is
  imported and used, the PHP is analysed, never executed. A synthetic
  fixture authored for the tests (`src/modules/themes/fixtures/
  classic-sample/`) analyses 3/3 convertible. Full report:
  `docs/themes/classic-conversion.md`.
- **Visual editor v1** (admin `#/themes`, `ThemeEditor.tsx`). Themes list
  (import, activate, delete) and a customizer for the active block theme:
  colour palette, font sizes, font families, spacing scale, content/wide
  widths. Preview uses a short-lived server-side token (30 min,
  `?wl_preview=<token>`, never cached, no JS injection); saving stores a
  variation in options (`wl_theme_variation_<slug>`, merged over the
  theme's theme.json); reset removes it. Full site-template editing is out
  of scope for v1 and the UI says so.
- **Compat registry:** 45 functions — M5 adds `get_theme_root`,
  `wp_get_theme`, `get_stylesheet`, `get_template` (all partial, honest
  levels; see `docs/themes/theme-support.md`).
- 209 tests, all passing (4 skipped — the M4 emitter skips); `tsc --noEmit`
  clean for the worker and the admin under `strict`.

## What Milestone 5 is not

- **Not full theme.json fidelity.** v1/v2 gaps are documented in
  `docs/themes/theme-support.md`; `patterns` are recorded, never executed;
  `post-featured-image` renders nothing (no featured images yet).
- **Not a classic-theme converter.** Classic themes get their stylesheet
  plus an analysis report — no PHP template is converted to a block
  template in v1, and no classic theme is claimed compatible.
- **Not a site editor.** Template editing, template-part editing and
  pattern creation are later milestones; v1 customizes settings only.
- **Not image handling.** Theme assets are stored as-is; image derivatives
  and WebP are Phase 7.
- **Not a marketplace.** Theme installation from uploads is local/admin
  only; a public marketplace with an SDK is Phase 8.
- **No parent/child themes.** `get_template()` returns the same theme as
  `get_stylesheet()` in v1.

## What Milestone 3 is

- **React admin SPA** at `/admin` (Vite + React + TypeScript, plain CSS in
  one stylesheet, no Tailwind). Hash routing, dark sidebar / light content,
  responsive. Pages: Dashboard, Posts, Pages, block editor, Media library,
  Categories & Tags, Comments moderation, Menus, Users, Settings, Site
  Health, Activity log, Login. Every page calls the real APIs — no fake
  data anywhere; empty states say empty.
- **Serving.** Vite builds to `admin/dist/admin/`; `wrangler.toml` declares
  `assets = { directory = "./admin/dist" }` and the Worker serves the SPA
  through the `ASSETS` binding (`/admin` and `/admin/*`, index.html
  fallback for client routes). API and public-site routes keep priority.
  `npm run build:admin` builds the SPA, `npm run build` builds it and
  typechecks worker + admin, and `predev` builds it before `wrangler dev`
  so `/admin` never 404s on a fresh clone. The installer builds it too
  (step 5). The old server-rendered `src/admin-shell.ts` is removed.
- **Block editor** (`admin/src/editor/`). Parses Gutenberg block HTML into
  a block list (paragraph, heading h2/h3, list, quote, image by attachment
  id, code, separator), edits text inline, adds/moves/deletes blocks, sets
  heading levels, and serializes back to block-comment HTML. Round-trip is
  lossless for supported blocks (tested). Unsupported blocks and uncommented
  HTML are preserved as raw HTML blocks — editable as source, never dropped.
  Save Draft / Publish go through the posts API (each save creates a
  revision); autosave fires 20 s after the last edit; Preview opens the
  public post URL once published. The media picker inserts image blocks.
- **Media uploads.** `POST /api/media` (multipart, 10 MB cap, MIME
  allowlist jpeg/png/gif/webp/avif/svg/pdf — anything else is a 400) stores
  the file in R2 via the `MEDIA` binding, creates the attachment post and
  postmeta (filename, size, alt); list/get/alt-update/delete endpoints and
  `GET /media/:key` serving from R2 with a long cache. Tests use a fake
  in-memory R2 bucket, never a live one. **Gap:** image derivatives / WebP
  conversion are NOT in M3 — they need the Cloudflare Images binding or a
  WASM pipeline (Phase 7).
- **Settings.** `GET/PUT /api/settings` with validation (site title/tagline
  non-empty, posts_per_page 1–100, permalink structure one of the four M2
  values, default comment status, max-links 0–10, IANA timezone). The admin
  Settings page edits these; `posts_per_page` now drives the public
  listings and new posts inherit the default comment status. Changing the
  permalink structure does not break existing URLs — M2's 301 redirects
  already cover that.
- **Users.** `GET /api/users` (admin only, paginated), create, role change,
  delete, and `POST /api/users/:id/reset-password` (temporary password
  returned ONCE, never logged or stored in plaintext). Delete is refused
  with 400 when the user owns posts — reassignment is a later milestone.
- **Compat registry:** 34 function names now — M3 adds `get_media_items`,
  `wp_get_attachment_url` and `media_handle_upload` (partial; the upload
  one needs a `MediaStorage` in the `WpContext` and throws a stub error
  without one).
- **No schema change was needed for M3** — media, settings and users all
  use existing tables, so there is no `migrations/0003_m3.sql`.
- 102 tests, all passing; `tsc --noEmit` clean for the worker and the
  admin under `strict`.

## What Milestone 3 is not

- **Not a full theme engine.** The built-in default theme renders the
  site; custom themes are M5.
- **Not a plugin/theme conversion.** The PHP→TypeScript conversion engine
  is Milestone 4 — see [What Milestone 4 is](#what-milestone-4-is); the
  compat registry was the foundation for it, not the engine.
- **No AI agents.** Provider abstraction, orchestration and the command
  centre are Phase 6.
- **No image derivatives.** Uploads store the original file only; resizing
  and WebP conversion are Phase 7.
- **No user reassignment on delete.** Deleting a user who owns posts is
  refused; reassignment is a later milestone.
- **No commerce, email, payments, analytics or social integrations.**
  Those are Phase 8.
- **No production deployment verified yet.** Local D1 + `wrangler dev` are
  verified; the production path is implemented but untested (no Cloudflare
  account connected — deployment happens when the user installs with their
  own account).

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

Milestone 3 is a working core CMS with a real admin and editor, not a
finished product. See the roadmap in `../docs/` (phases 1–10). Do not mark
unfinished features as complete, do not commit secrets, and keep every stub
labelled `STUB` until it is real.
