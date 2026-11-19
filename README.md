# WORDLESS

**The autonomous website operating system.**

Wordless is an independent, PHP-independent, WordPress-compatible content
management system and website operating system. It rebuilds the core of
WordPress — posts, pages, users, roles, options, media, hooks, REST-style
APIs — in TypeScript on Cloudflare Workers, D1 and R2, and adds an
autonomous AI command layer on top (later milestones).

One platform. One intelligent command centre. Complete website management.

> **Status: Version 1.0.0 — production readiness (Milestone 10, built and
> verified locally, 417 tests passing).** The kernel, D1
> schema, auth, posts/users/options/media APIs, revisions, terms, comments,
> menus, search, permalinks, public rendering, feeds, sitemap, site health,
> activity log, compat registry, the React admin SPA with a Gutenberg
> block editor, the PHP→TypeScript conversion engine (lexer, parser,
> emitter, safety sandbox, async conversion jobs, Hello Dolly end-to-end,
> Akismet static analysis), the theme system (theme.json engine,
> block-theme rendering, ZIP import, classic-theme analysis, customizer
> with preview + variations, and — since 1.0.0 — block-pattern rendering
> from `patterns/*.php` files, verified against the real Twenty
> Twenty-Five theme), the AI operating system (provider
> abstraction with **Workers AI as the default provider**, orchestrator
> with three enforced operating modes, 15 specialist agents, human
> approvals, website memory, and the AI command centre), the content
> studio + SEO engine (per-post SEO fields, head tags with JSON-LD,
> deterministic SEO analysis, sitemap with images + pagination,
> configurable robots.txt, redirect manager, 404 log, editorial calendar,
> content templates, Yoast/Rank Math metadata import), integrations +
> commerce (integration registry, transactional email,
> Paystack / Flutterwave / Stripe with real HMAC webhook verification
> plus a test-mode mock, products / cart / checkout / orders with
> integer minor-unit money, the commerce-assistant wired to real store
> data, social share links, analytics config, and the marketplace
> skeleton), security hardening + performance (security headers
> on every response, login lockout, TOTP two-factor, session idle
> timeout, magic-byte upload sniffing, public-page cache rules with
> purge-on-publish, Cloudflare Images derivatives when bound, a
> performance section in Site Health), real backup/restore (ZIP bundles
> with per-file SHA-256 checksums, verification, typed-confirmation
> restore) and the WordPress importer (WXR + mysqldump, safe PHP
> unserializing, forced password reset for imported users) are built
> and tested, and production readiness is now built too: the
> first-administrator seed command, staging/production environments
> with separate D1 databases and R2 buckets, deploy scripts with
> pre-deploy checks, and release management (CHANGELOG + tagging and
> rollback procedures). What is still NOT verified or NOT done is listed
> in [What Milestone 10 is not](#what-milestone-10-is-not) below.
> Nothing unfinished is presented as done.

## Screenshots

Real screenshots of the running app (local dev, seeded demo content —
see `~/workspace/wordless/shots-m10.sh` for how they were taken). All
captured at 1440×900.

**Public site**

![Public home page](docs/screenshots/public-home.png)
*The public home page — two published posts under the Wordless default theme.*

![Single post page](docs/screenshots/public-post.png)
*One post: heading, paragraph and image blocks, rendered from stored
block content.*

![Shop page](docs/screenshots/public-shop.png)
*The shop — products with real minor-unit prices and plain-text
descriptions.*

![Single product page](docs/screenshots/public-product.png)
*One product — price, description and add-to-cart, rendered from the
store data.*

**Admin (`/admin`)**

![Admin login](docs/screenshots/admin-login.png)
*Admin sign-in.*

![Admin dashboard](docs/screenshots/admin-dashboard.png)
*Dashboard — post/comment counts, recent posts and recent activity.*

![Posts list](docs/screenshots/admin-posts.png)
*Posts — published and draft posts with status and modified date.*

![Block editor](docs/screenshots/admin-editor.png)
*The block editor — heading, paragraph and image blocks for a post.*

![Media library](docs/screenshots/admin-media.png)
*Media library with the uploaded image (derivatives unavailable until
the Cloudflare Images binding is configured).*

![AI command centre](docs/screenshots/admin-ai.png)
*The AI command centre — providers, operating mode, agents, approvals.
Workers AI reports "not configured" until the `[ai]` binding exists.*

![Content studio](docs/screenshots/admin-studio.png)
*Content studio — editorial calendar, templates, AI ideas.*

![SEO page](docs/screenshots/admin-seo.png)
*SEO — sitemap/robots, redirects, 404 log.*

![Security page](docs/screenshots/admin-security.png)
*Security — headers, login lockout, two-factor authentication.*

![Commerce page](docs/screenshots/admin-commerce.png)
*Commerce — products, orders, payments, marketplace.*

![Import page](docs/screenshots/admin-import.png)
*WordPress importer — WXR and SQL-dump import.*

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
npm run seed-admin  # first administrator, so you can sign in at /admin (refuses if one exists)
npm test        # Vitest suite (in-memory SQLite, never a live D1)
npm run build   # admin SPA build (Vite) + typecheck of worker and admin
npm run build:admin  # admin SPA build only (Vite → admin/dist/admin/)
```

## Two paths

| | Local development | Production |
|---|---|---|
| Cloudflare account | Not needed | Required (free tier works) |
| Database | Wrangler local D1 (SQLite file under `.wrangler/`) | Cloudflare D1 `wordless-prod` (staging: `wordless-staging`) |
| Media | R2 `wordless-media` via miniflare emulation (uploads work; image derivatives via the Images binding when bound — Milestone 9) | R2 `wordless-media-prod` |
| Command | `npm run dev` | `npm run deploy:production` (staging: `npm run deploy:staging`) |
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
    seo/              per-post SEO fields, analysis, head tags, sitemap,
                      robots, redirects, 404 log, templates, calendar,
                      Yoast/Rank Math import (M7); wl_404_log rows
    ai/               AI orchestrator: tasks, approvals, memory (M6)
    integrations/     integration registry, email, analytics, social,
                      marketplace skeleton (M8)
    commerce/         products, cart, checkout, orders, payments with real
                      webhook HMAC verification (M8)
    security/         headers, login lockout, TOTP 2FA, sessions, upload
                      magic-byte checks (M9)
    performance/      cache rules + purge on publish, image derivatives (M9)
    backup/           backup create/verify/restore with checksums (M9)
    importer/         WXR + SQL-dump WordPress importer, safe PHP
                      unserialize (M9)
  ai/                 provider abstraction (Workers AI default), 15 agents,
                      orchestrator (M6)
  conversion/         PHP → TypeScript engine: lexer, parser, AST, emitter,
                      safety sandbox, static analysis (M4)
  compat/
    wordpress.ts      45-function WP registry + AI/SEO/commerce/integrations/
                      security/performance/backup/import lists, honestly tagged
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
docs/seo/
  seo.md                  SEO fields, scoring formula, sitemap/robots, what is NOT done (M7)
docs/commerce/
  commerce.md             products, cart, checkout, orders, payments, webhooks, test mode (M8)
docs/integrations/
  integrations.md         registry, email, analytics, social, Cloudflare, marketplace (M8)
docs/ai/
  agents.md               the 15-agent roster + what each agent measures (M6; commerce-assistant live since M8)
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
                      Conversion (M4), ThemeEditor (M5), CommandCentre (M6),
                      Seo + Studio (M7), Commerce + Integrations (M8),
                      Security + Backup + Import (M9)
migrations/
  0001_init.sql       D1 schema v1: 12 wp_* tables + 6 wl_* tables
  0002_m2.sql         wl_redirects + M2 indexes
  0005_m5.sql         wl_themes (M5)
  0006_m6.sql         wl_ai_approvals + wl_ai_memory (M6)
  0007_m7.sql         wl_404_log (M7)
  0008_m8.sql         products/orders/carts/mail/webhook tables (M8)
  0009_m9.sql         login attempts, backups, media derivatives (M9)
scripts/
  install.mjs         installer wizard (Node built-ins only)
  deploy.mjs          deploy guard: pre-deploy checks + --confirm + whoami,
                      --env staging|production (M10)
  seed-admin.mjs      first-administrator seed (M10)
  generate-default-theme.mjs   regenerates src/modules/themes/default-theme.ts
                      from themes/wordless-default/ (M5; tested for drift)
  generate-wp-fixture.mjs      generates test/fixtures/wordpress/ from the
                      WordPress 7.1.5 schema (M9)
CHANGELOG.md          release history, M1–M10 with test counts + commit SHAs
docs/release.md       release procedure: tagging, checklist, rollback (M10)
```

## API (Version 1.1.0)

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
| `GET /api/posts/:slug` | —* | Get one post by slug; the detail payload includes its `seo` fields |
| `GET /api/posts/:id/seo` | `edit_posts` | Per-post SEO fields |
| `PUT /api/posts/:id/seo` | `edit_posts` | Set SEO fields (validated: title ≤70, description ≤160, keyword ≤100, canonical http(s)) |
| `GET /api/posts/:id/seo/analysis` | `edit_posts` | Deterministic 0–100 SEO analysis from stored content (see `docs/seo/seo.md`) |
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
| `POST /api/media` | `upload_files` | Multipart upload (50 MB cap, MIME allowlist) |
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
| `POST /api/themes/import` | `edit_theme_options` | Import a block theme ZIP (≤50 MB, ≤10,000 files; `style.css` + `theme.json`) |
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
| `GET /sitemap.xml` | — | Posts + pages + terms; changefreq/priority from recency, `<lastmod>`, image entries for existing attachments; index + `?page=` above 1,000 URLs |
| `GET /robots.txt` | — | Configured robots.txt (admin-set) or the default allow-all + sitemap line |
| `GET /api/seo/robots` | `manage_options` | Current robots.txt |
| `PUT /api/seo/robots` | `manage_options` | Set robots.txt (rejects rules blocking `/admin` or `/api`) |
| `GET /api/seo/templates` | `edit_posts` | Content templates (announcement, how-to, news update) |
| `POST /api/seo/templates/:slug/create` | `edit_posts` | Create a real draft post from a template |
| `GET /api/seo/calendar` | logged in | Posts grouped by date for the next 30 days (`?days=` 1–90) |
| `POST /api/seo/import` | `manage_options` | Yoast/Rank Math metadata import, max 500 posts; returns applied/skipped |
| `GET /api/seo/redirects` | `manage_options` | Redirects, paginated |
| `POST /api/seo/redirects` | `manage_options` | Create a redirect (`oldPath` must start with `/`, `newPath` a path or http(s) URL) |
| `PUT /api/seo/redirects/:id` | `manage_options` | Change the redirect target |
| `DELETE /api/seo/redirects/:id` | `manage_options` | Delete a redirect |
| `GET /api/seo/404s` | `manage_options` | 404 log, most-hit first, paginated |
| `DELETE /api/seo/404s?path=…` | `manage_options` | Dismiss one 404 path |
| `GET /api/integrations` | `manage_options` | Integration registry with live configured/not-configured status |
| `GET /api/integrations/:id/config` | `manage_options` | Non-secret config for one integration |
| `PUT /api/integrations/:id/config` | `manage_options` | Set non-secret config; secret-looking fields are rejected with 400 |
| `GET /api/integrations/email/log` | `manage_options` | Mail log (mock = logged, not delivered; HTTP = sent/failed) |
| `GET /api/integrations/analytics/status` | `manage_options` | Analytics provider + measurement id, configured/not |
| `GET /api/integrations/cloudflare` | `manage_options` | Bindings actually present in this environment (read-only) |
| `GET /api/marketplace` | `install_plugins` | Marketplace extensions (local-ZIP skeleton) |
| `POST /api/marketplace/install` | `install_plugins` | Install an extension from a ZIP upload (`wordless.json`, ≤50 MB, ≤10,000 files) |
| `GET /api/marketplace/:slug/report` | `install_plugins` | Per-plugin compatibility + auto-conversion report (null = never analysed) |
| `POST /api/marketplace/:slug/activate\|deactivate` | `install_plugins` | Activate / deactivate an installed extension |
| `GET /api/files?prefix=` | `manage_options` | File manager: folders + files under a prefix (≤1,000 entries) |
| `POST /api/files/upload` | `manage_options` | File manager: multipart upload (≤50 MB, media MIME allowlist + magic-byte sniffing) |
| `GET /api/files/download?key=` | `manage_options` | File manager: download one file |
| `POST /api/files/rename` | `manage_options` | File manager: rename (`{key, newName}`); media library records follow |
| `POST /api/files/delete` | `manage_options` | File manager: delete (`{key}`); media library records are removed too |
| `GET /api/commerce/products` | —* | Published products only (admins may pass `?status=draft|all`) |
| `POST /api/commerce/products` | `manage_options` | Create a product (price in integer minor units) |
| `GET /api/commerce/products/:id` | —* | One product (drafts need `manage_options`) |
| `PUT /api/commerce/products/:id` | `manage_options` | Update a product |
| `DELETE /api/commerce/products/:id` | `manage_options` | Delete; refused when the product appears in any order |
| `GET /api/commerce/cart` | — | Server-side cart for the `wordless_cart` cookie (sets it when new) |
| `POST /api/commerce/cart` | — | Add to cart (stock-checked) |
| `PUT /api/commerce/cart` | — | Set a line quantity (0 = remove) |
| `DELETE /api/commerce/cart` | — | Clear the cart |
| `POST /api/commerce/checkout` | — | Create a pending order + provider checkout; 503 when no provider is configured |
| `GET /api/commerce/orders` | `manage_options` | Orders, paginated (`?status=`) |
| `GET /api/commerce/orders/:id` | `manage_options` | One order with items |
| `POST /api/commerce/orders/:id/transition` | `manage_options` | pending → paid → fulfilled / cancelled (validated) |
| `GET /api/commerce/payments/providers` | `manage_options` | Payment providers with live configured state |
| `GET /api/commerce/payments/selected` | `manage_options` | Selected provider + mode (test/live) |
| `POST /api/commerce/payments/select` | `manage_options` | Select a provider + mode |
| `POST /api/commerce/webhooks/:provider` | signature | Provider webhook (signature IS the auth; 401 on bad/missing) |
| `GET /api/commerce/webhooks/log` | `manage_options` | Webhook attempts, paginated |
| `GET /shop` | — | Public storefront (published products) |
| `GET /shop/:slug` | — | Public product page (add-to-cart, share links) |
| `GET /shop/cart` | — | Cart page + checkout form |
| `POST /shop/cart/add\|remove\|quantity` | — | Cart form actions (303 back to the cart) |
| `POST /shop/checkout` | — | Form checkout → provider checkout or the test page (mock) |
| `GET /shop/checkout/test` | — | Mock test-checkout page (no money moves) |
| `POST /shop/checkout/test` | — | Simulate a successful test payment via a signed mock webhook |
| `GET /shop/checkout/success\|cancelled` | — | Checkout result page for an order |
| `GET /admin` | — | React admin SPA (Static Assets; calls the real API, no fake data) |
| `GET /api/ai/providers` | `manage_options` | Providers + configured state; Workers AI is the default |
| `POST /api/ai/providers/select` | `manage_options` | Select a provider (`{ provider }`) |
| `POST /api/ai/providers/:id/test` | `manage_options` | Probe a provider; unconfigured providers report honestly |
| `GET /api/ai/mode` | `manage_options` | Current operating mode |
| `PUT /api/ai/mode` | `manage_options` | Set mode: `manual` / `supervised` / `autonomous` |
| `GET /api/ai/agents` | `manage_options` | 15-agent roster with live availability |
| `POST /api/ai/tasks` | `manage_options` | Create + run an agent task (runs synchronously in-request in local dev) |
| `GET /api/ai/tasks` | `manage_options` | List AI tasks, paginated |
| `GET /api/ai/tasks/:id` | `manage_options` | One task with its result or error |
| `GET /api/ai/approvals?status=` | `manage_options` | List approvals, paginated |
| `POST /api/ai/approvals/:id/approve` | `manage_options` | Approve: applies the proposal through the existing services |
| `POST /api/ai/approvals/:id/reject` | `manage_options` | Reject with a reason |
| `GET /api/ai/memory` | `manage_options` | Website facts + admin notes |
| `POST /api/ai/memory/notes` | `manage_options` | Add a note (refuses secret-like text) |
| `DELETE /api/ai/memory/notes/:id` | `manage_options` | Delete a note (facts cannot be deleted this way) |
| `POST /api/ai/memory/rebuild` | `manage_options` | Re-ingest facts from the site |
| `POST /api/auth/2fa/setup` | logged in | Start TOTP setup (otpauth URL + manual code, secret pending) |
| `POST /api/auth/2fa/confirm` | logged in | Confirm TOTP setup with a code (returns 8 recovery codes) |
| `GET /api/auth/2fa/status` | logged in | Whether TOTP is enabled for the current user |
| `POST /api/auth/2fa/disable` | logged in | Disable TOTP (needs password) |
| `GET /api/auth/sessions` | logged in | Active sessions (no token values shown) |
| `POST /api/auth/sessions/revoke-all` | logged in | Revoke all of the current user's sessions |
| `GET /api/security/overview` | `manage_options` | Measured security posture (headers, lockout, 2FA, sessions) |
| `POST /api/backup/create` | `manage_options` | Create a backup ZIP in R2 (wl_jobs job) |
| `GET /api/backup` | `manage_options` | List backups (size, checksum, verified flag) |
| `GET /api/backup/:id/download` | `manage_options` | Download the backup ZIP |
| `POST /api/backup/:id/verify` | `manage_options` | Re-read the bundle and recompute checksums |
| `POST /api/backup/:id/restore` | `manage_options` | Restore (typed confirmation `RESTORE`, verified backup only) |
| `POST /api/import/wxr` | `manage_options` | Import a WXR export (multipart ≤50 MB, wl_jobs job) |
| `POST /api/import/sql` | `manage_options` | Import a mysqldump (≤50 MB, 12 wp_* tables only) |
| `GET /api/import/jobs/:id` | `manage_options` | One import job with its per-item report |

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
- **No AI agents in M3.** Provider abstraction, orchestration and the
  command centre are Milestone 6 (built — see
  [What Milestone 6 is](#what-milestone-6-is)).
- **No image derivatives.** Uploads store the original file only; resizing
  and WebP conversion are Milestone 9 (Cloudflare Images binding when
  bound, originals served otherwise).
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
  (multipart ZIP ≤50 MB, ≤10,000 files, extracted with `fflate`, validated: `style.css`
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
  `docs/themes/theme-support.md`; `post-featured-image` renders nothing
  (no featured images yet). `wp:pattern` blocks render from the theme's
  `patterns/*.php` files since 1.0.0 (M10) via the allowlisted inline-PHP
  evaluator — see [What Milestone 10 is](#what-milestone-10-is).
- **Not a classic-theme converter.** Classic themes get their stylesheet
  plus an analysis report — no PHP template is converted to a block
  template in v1, and no classic theme is claimed compatible.
- **Not a site editor.** Template editing, template-part editing and
  pattern creation are later milestones; v1 customizes settings only.
- **Not image handling.** Theme assets are stored as-is; image derivatives
  are Milestone 9 (Cloudflare Images binding when bound, originals served
  otherwise). Theme-asset URLs (`get_template_directory_uri()`) are still
  not served as files — pattern images built from them render with an
  empty `src` (see M10).
- **Not a marketplace.** Theme installation from uploads is local/admin
  only; a public marketplace with an SDK is Phase 8.
- **No parent/child themes.** `get_template()` returns the same theme as
  `get_stylesheet()` in v1.

## What Milestone 6 is

- **Provider abstraction** (`src/ai/providers/`). Three providers behind
  one interface: **Workers AI** (`@cf/meta/llama-3-8b-instruct` via the
  `AI` binding — the **default and only required provider**, no extra
  key), an **OpenAI-compatible** provider (key from the
  `OPENAI_API_KEY` secret only, optional fallback, 30 s timeout), and a
  deterministic **mock** provider for tests and local development.
  Providers report honestly: when the Workers AI binding is absent the
  API says "not configured" and never pretends a call succeeded. No keys
  or secrets exist anywhere in the code. The `[ai]` binding in
  `wrangler.toml` is commented out (no Cloudflare account is connected);
  uncomment it at deploy time. **Live Workers AI calls have not been
  verified in this environment** — only the mock path is exercised by
  tests and the local smoke test.
- **Orchestrator** (`src/ai/orchestrator.ts` + `src/modules/ai/`). AI
  tasks are `wl_jobs` rows (`kind = 'ai_task'`). `runAiTask(db, jobId)`
  routes to the agent, calls the provider, stores the result + token
  usage in the job result JSON, and creates approval records for proposed
  changes. It runs synchronously in-request in local dev and is
  structured for a Queue/Workflow consumer later. Every task is listed
  with its status and result.
- **Operating modes** — `manual` (drafts only, nothing applied),
  `supervised` (default; every proposal becomes a pending approval),
  `autonomous` (low-risk actions apply automatically; medium/high-risk
  still need approval). The orchestrator **enforces** the mode: tested
  that a supervised task applies nothing until approved, manual never
  applies, and autonomous still gates publishing behind an approval.
- **15 specialist agents** (`src/ai/agents/`, see
  `docs/ai/agents.md`). Content-writer and research-assistant draft via
  the provider and propose draft posts; email/social composers draft
  only; SEO, security, performance, accessibility, analytics, backup,
  migration, code-review and design agents measure real site data and
  report only what they measured. **commerce-assistant is honestly
  unavailable** — it needs the commerce system from Milestone 8, the
  command centre shows it as unavailable, and the API rejects its tasks
  with a 400. No agent fabricates data; drafting agents label output as
  an AI draft.
- **Approvals** (`wl_ai_approvals`, migration `0006_m6.sql`). Approving
  applies the proposal **first** through the existing services (a draft
  post is created via the posts service; an option update goes through
  the options service with an allow-list) and only then marks the row
  approved — a failed apply leaves the approval pending. Rejecting
  records the reason; deciding twice is an error. Only
  `create_post` (always a draft), `update_post`, `publish_post`,
  `update_option` (allow-listed keys only), `create_term` and
  `update_theme_variation` exist as proposal types — there is no delete
  action in M6.
- **Website memory** (`wl_ai_memory`, migration `0006_m6.sql`). Facts
  re-ingested from the site (title, tagline, theme, post/page titles,
  extensions) plus admin notes. Agents receive the memory as prompt
  context (tested: a stored note appears in an agent's context). Notes
  refuse secret-like text; memory never contains secrets.
- **Command centre** (admin `#/ai`). Provider status with the honest
  not-configured message, mode selector, agent list with availability +
  risk, task composer, task list with results, approvals queue, and the
  memory notes editor — all on the real API, empty states say empty.
- **Compat registry:** a separate `AI_COMPAT` list (6 entries) for the
  Wordless-native AI API surface — deliberately not in
  `WORDPRESS_COMPAT`, because these are not WordPress functions.
- **Migration `0006_m6.sql` was needed** (additive only): `wl_ai_approvals`
  + `wl_ai_memory`. Existing local D1 databases need
  `npx wrangler d1 migrations apply DB --local` before the AI routes work.
- 236 tests, all passing (4 skipped — the M4 emitter skips); `tsc --noEmit`
  clean for the worker and the admin under `strict`.

## What Milestone 6 is not

- **Not a live AI deployment.** Workers AI calls are only verified
  through the mock provider in tests and local dev; a real Workers AI
  response has never been observed in this environment (no Cloudflare
  account connected). The code handles the missing binding by reporting
  "not configured".
- **Not a queue.** AI tasks run synchronously inside the request in
  local dev. On production this risks the 10 ms free-tier CPU limit for
  long provider calls — Queues/Workflows are the planned production
  path (the worker function is structured for it).
- **Not commerce.** The commerce-assistant agent is unavailable until
  Milestone 8; email/social agents draft only — sending and publishing
  are M8.
- **Not a full AI content studio.** The content-writer drafts a post;
  the editorial calendar, SEO engine and Yoast/Rank Math import are
  Milestone 7 — built; see [What Milestone 7 is](#what-milestone-7-is).
- **Not a backup system.** The backup-advisor only advises on cadence
  from measured data; real backup/restore is Milestone 9.
- **Not a WordPress importer.** The migration-assistant only reports
  content counts and conversion history; WXR import is Milestone 9.

## What Milestone 7 is

- **Per-post SEO fields** (`src/modules/seo/meta.ts`). SEO title, meta
  description, focus keyword, canonical URL, noindex flag, Open Graph
  title/description/image (image = an attachment id from the media
  library, verified to exist), and Twitter card type — stored as
  `wp_postmeta` keys (`_wl_seo_*`) through the posts service, validated
  (title ≤ 70, description ≤ 160, keyword ≤ 100, canonical must be an
  http(s) URL or empty). `GET/PUT /api/posts/:id/seo` (`edit_posts`);
  the post detail payload includes the fields. The block editor has an
  SEO panel with live character counts and a Google-style snippet
  preview, labelled as a preview — never claimed as a real ranking.
- **Head rendering** (`src/modules/seo/head.ts`). Every public page
  emits a real `<title>`, meta description, canonical link, robots meta
  (noindex when set), Open Graph + Twitter Card tags, and JSON-LD
  (WebSite + Article for single posts + BreadcrumbList), using the SEO
  fields with fallbacks (site title/tagline, excerpt). All values are
  escaped; a hostile title is tested to render as escaped text, not
  markup.
- **SEO analysis engine** (`src/modules/seo/analyze.ts`). A
  deterministic scorer over stored content only: 9 checks when no
  focus keyword is set, 12 when one is (without a keyword the four
  keyword-placement checks collapse into one "no keyword set"
  warning) — title length, description length/presence, focus keyword
  in title / first paragraph / slug / headings, heading structure (an
  H1 in the content fails, skipped levels warn, no headings at all
  passes), image alt coverage, internal links (0 warns, never fails),
  word count, readability estimate (Flesch reading-ease, labelled an
  estimate; too little text warns), canonical present (missing warns).
  Each check is pass/warn/fail and the score is
  `round(100 · (passes + 0.5 · warns) / checks run)` on a 0–100 scale
  (see `docs/seo/seo.md`). `GET /api/posts/:id/seo/analysis`.
  The M6 **seo-auditor agent now uses this engine** — its data output
  is the analysis and its summary names the average score (tested: the
  agent's result matches a direct analysis of the same posts).
- **Sitemap + robots upgrade** (`src/modules/seo/sitemap.ts`,
  `robots.ts`). Per-URL `<changefreq>`/`<priority>` from post type +
  recency (home daily/1.0; post &lt;7d daily/0.9, &lt;30d weekly/0.8,
  &lt;365d monthly/0.6, older yearly/0.5; page monthly/0.7; term
  weekly/0.5), `<lastmod>` from updated dates, image entries for posts
  referencing attachments via `wp:image {"id":N}` blocks — only
  attachments that exist, max 10 per URL. Above 1,000 URLs the sitemap
  becomes an index with pages of 1,000 (`/sitemap.xml?page=N`, 50,000
  URL cap; tested with a synthetic 1,050-post fixture: index with
  pages 1–2, page 1 = 1,000 `<url>`, page 2 = 51). `robots.txt` is
  configurable (`GET/PUT /api/seo/robots`, `manage_options`); rules
  that would block `/admin` or `/api` are rejected, including
  `Disallow: /`.
- **Redirect manager + 404 log** (`src/modules/seo/redirects.ts`,
  `notfound.ts`; admin `#/seo`). Redirects list/create/edit/delete over
  the M2 `wl_redirects` table. Public 404s are logged to `wl_404_log`
  (path + referrer + count + first/last seen, capped at the 500 most
  recently seen paths, pruned on insert); **query strings are stripped
  before logging** so tokens and passwords never land in the log, and
  paths under `/api`, `/admin`, `/media`, `/feed`, `/sitemap*`,
  `/robots.txt` and `/favicon.ico` are not logged. A 404 row has a
  one-click "Create redirect" that prefills the source path.
- **Content studio** (admin `#/studio`). Editorial calendar: stored
  posts grouped by date for the next 30 days (a draft with a future
  date *is* the schedule — Wordless has no "future" status yet).
  Content ideas go through the **real M6 content-writer AI task API**;
  when no provider is configured the page says so and offers the mock
  provider for local dev — ideas are never faked. An approved
  `create_post` proposal opens the new draft directly in the block
  editor ("Open in editor" links from applied task results). Three
  built-in **content templates** (announcement, how-to guide, news
  update) create real draft posts with Gutenberg block-comment HTML.
- **Yoast / Rank Math metadata import** (`src/modules/seo/import.ts`).
  `POST /api/seo/import` accepts Wordless (`_wl_seo_*`), Yoast
  (`_yoast_wpseo_*`, including `meta-robots-noindex` and the Open Graph
  / Twitter fields) and Rank Math (`rank_math_*`, including the `robots`
  array/string) keys, matched by post ID or slug, validated through the
  same validator as the SEO endpoint, max 500 rows. The result reports
  applied vs skipped with a reason per skipped row; unknown keys are
  reported, never silently dropped.
- **Compat registry:** a separate `SEO_COMPAT` list (10 entries) for the
  Wordless-native SEO API surface — deliberately not in
  `WORDPRESS_COMPAT`, because these are not WordPress functions.
- **Migration `0007_m7.sql` was needed** (additive only): `wl_404_log`.
  SEO fields live in `wp_postmeta`; robots.txt lives in `wp_options`
  (`wl_robots_txt`). Existing local D1 databases need
  `npx wrangler d1 migrations apply DB --local` before the SEO routes work.
- 262 tests, all passing (4 skipped — the M4 emitter skips); `tsc --noEmit`
  clean for the worker and the admin under `strict`.

## What Milestone 7 is not

- **Not search-engine submission.** Wordless never pings Google or
  Bing and never claims to; there is no Search Console integration and
  no rank tracking. The sitemap and robots.txt are the only
  search-engine-facing outputs.
- **Not rankings or traffic.** The analysis score is computed from the
  site's own stored content (title, description, keyword, headings,
  alt text, links, word count, readability estimate, canonical). It is
  a content-quality score, not a ranking prediction, and no traffic or
  analytics numbers are invented anywhere.
- **Not full-text search.** Search is still LIKE-based (M2), unchanged
  by this milestone.
- **Not a "future" post status.** The calendar treats a draft with a
  future date as scheduled; a real scheduled-publish status is a
  later milestone.
- **Not commerce.** Email sending, payments, analytics and social
  publishing are Milestone 8; the content studio's AI ideas are
  drafts only.

## What Milestone 8 is

- **Integrations framework** (`src/modules/integrations/registry.ts`,
  `config.ts`). A registry of 8 integrations (email, Paystack,
  Flutterwave, Stripe, analytics, social, Cloudflare, marketplace)
  with live configured/not-configured detection from env + stored
  config. `GET /api/integrations` (list + status),
  `GET/PUT /api/integrations/:id/config` (`manage_options`) — the config
  endpoint stores **non-secret settings only**: any secret-looking
  field (`key`, `token`, `secret`, `password`, `private`…) is rejected
  with a 400 telling the admin to use `wrangler secret put`. Admin
  `#/integrations` shows every integration's status honestly. The
  Cloudflare entry is read-only and reports the bindings actually
  present in this environment (DB/MEDIA/CONFIG/ASSETS/AI) — no IDs are
  ever invented.
- **Email** (`src/modules/integrations/email.ts`). `sendMail` with two
  providers: a **mock** that records the message in D1 `wl_mail_log`
  (status `logged`, never claims delivery) and a **generic HTTP provider**
  (Resend/SendGrid-shaped) that POSTs to a configurable endpoint with
  the key from env secrets, with a timeout and error mapping. Used by
  order confirmations (best-effort, never fails the webhook), comment
  notifications (to the site's `admin_email`, when set) and password
  resets (the temporary password is still returned in the API response,
  with an `emailed` flag). `GET /api/integrations/email/log`
  (`manage_options`). Real delivery is **not verified here** — no mail
  key is connected; the UI says "test mode — messages are logged, not
  delivered" while the mock is active.
- **Payments** (`src/modules/commerce/payments/`). A provider
  abstraction (`createCheckout`, `verifyPayment`, `verifyWebhook`) with
  real HMAC verification per provider's documented scheme: **Paystack**
  HMAC-SHA512 on the raw body (`x-paystack-signature`, event
  `charge.success`), **Flutterwave** `verif-hash` comparison against
  `FLUTTERWAVE_SECRET_HASH` (event `charge.completed` + status
  `successful`), **Stripe** HMAC-SHA256 of `${timestamp}.${rawBody}`
  (`stripe-signature`, 300 s tolerance). Each has a deterministic
  **mock provider** (test mode only; checkout opens the test page on
  this site; webhook HMAC-SHA256 against `MOCK_PAYMENT_WEBHOOK_SECRET`
  — unset means every mock webhook is rejected). Webhook endpoint
  `POST /api/commerce/webhooks/:provider` — the signature IS the auth
  (401 on bad/missing); every attempt is logged in `wl_webhook_log`
  (provider + event + reference + result, never the secret). A paid
  webhook moves the order pending→paid **exactly once** (idempotency
  key = provider reference; a replay is answered "duplicate", 200).
  **No live provider call has been verified here** — no keys are
  connected; the implementations follow the providers' public docs.
- **E-commerce core** (`src/modules/commerce/`). `wl_products`,
  `wl_orders`, `wl_order_items`, `wl_carts`, `wl_mail_log`,
  `wl_webhook_log` (migration `0008_m8.sql`, additive only). Products:
  name, slug, block-HTML description, price in **integer minor units**
  (kobo/cents — floats are rejected), currency (NGN default), stock
  (integer, -1 = unlimited), draft/published, featured image attachment
  id. `GET /api/commerce/products` (public, published only) + CRUD
  (`manage_options`); delete is refused when the product appears in any
  order. Public storefront at `/shop` and `/shop/:slug` (rendered
  through the theme system, with add-to-cart and share links) and
  `/shop/cart`. **Cart** is server-side in D1 (`wl_carts`, 7-day
  expiry, pruned on read), keyed by the `wordless_cart` cookie —
  `GET/POST/PUT/DELETE /api/commerce/cart`, stock-checked at add time.
  **Checkout** (`POST /api/commerce/checkout`, form or API) validates a
  non-empty cart + stock, creates a pending order with the customer's
  name/email, then starts the provider checkout; with **no payment
  provider configured it returns 503** — never a fake success. Orders:
  `GET /api/commerce/orders` + detail + `POST .../transition`
  (`manage_options`), pending → paid → fulfilled / cancelled, validated.
  **Stock decrements exactly once** when an order becomes paid and is
  restored when a paid order is cancelled (both tested). Money is
  formatted from minor units everywhere (`formatMoney`).
- **Commerce-assistant activation.** The M6 commerce-assistant is now
  available: it reads real commerce data — product count, orders by
  status, low-stock warnings (≤5), revenue = sum of paid orders in
  minor units — all computed from stored rows, and reports only (it
  never changes the store). Tested: the agent's report matches direct
  queries. The `AI_COMPAT` entry and `docs/ai/agents.md` now say so.
- **Social + analytics (config-only, honest).** Share links
  (X/Facebook/WhatsApp/Telegram — plain URLs, no API calls, no fake
  counts) on public post and product pages. Analytics config (provider
  id + measurement id, non-secret) with
  `GET /api/integrations/analytics/status`; the GA4/Plausible snippet
  is injected into public pages **only when configured** — otherwise no
  tracking pixel. No analytics, sales or social numbers are ever
  fabricated: every number comes from the site's own stored rows.
  The M6 email-composer and social-composer stay **draft-only**; the
  command centre says sending is via the email integration only when
  configured.
- **Marketplace skeleton** (`src/modules/integrations/marketplace.ts`).
  Install from a ZIP upload (`wordless.json` manifest with slug/name/
  version/kind plugin|theme; ≤50 MB, ≤10,000 files, path traversal
  rejected), files in R2 `extensions/<slug>/`, row in `wl_extensions`
  (inactive), activate/deactivate via the admin Commerce → Marketplace
  tab. No remote directory, and installed code is never executed by the
  install itself.
- **Compat registry:** separate `COMMERCE_COMPAT` (8 entries) and
  `INTEGRATIONS_COMPAT` (6 entries) lists — Wordless-native surfaces,
  deliberately not in `WORDPRESS_COMPAT`.
- **Migration `0008_m8.sql` was needed** (additive only): `wl_products`,
  `wl_orders`, `wl_order_items`, `wl_carts`, `wl_mail_log`,
  `wl_webhook_log`. Existing local D1 databases need
  `npx wrangler d1 migrations apply DB --local` before the commerce
  routes work.
- 321 tests, all passing (4 skipped — the M4 emitter skips); `tsc --noEmit`
  clean for the worker and the admin under `strict`.

## What Milestone 8 is not

- **Not verified live payments.** Paystack, Flutterwave and Stripe are
  implemented from their public documentation with real HMAC webhook
  verification, but no live call has been made and no key is connected.
  Until a key is set and a real test-mode transaction is observed, the
  providers are "implemented, not verified". The mock provider is the
  only path exercised end to end here.
- **Not verified live email.** The HTTP email provider is implemented
  and the mock path is tested, but no message has been delivered to a
  real inbox here. The mail log is the proof of what happened.
- **Not a full store.** No variable products, coupons, taxes, shipping,
  refunds, or WooCommerce's full API. No remote marketplace directory.
  No social publishing (share links only) and no visitor analytics
  (the analytics integration is configuration + snippet only).
- **Not pattern rendering.** Block themes built from `wp:pattern`
  blocks (e.g. Twenty Twenty-Five) still render nearly empty — the
  M5 known gap, unchanged.
- **Not backup or import.** Real backup/restore and the WordPress
  (WXR) importer are Milestone 9; production readiness is Milestone 10.

## What Milestone 9 is

- **Security headers** (`src/modules/security/headers.ts`). Every
  response — API, public pages, admin assets, cached copies, error
  responses — carries Content-Security-Policy, X-Content-Type-Options:
  nosniff, X-Frame-Options: DENY, Referrer-Policy and
  Permissions-Policy, plus `Vary: Accept-Encoding`. The CSP allows the
  inline styles/scripts the admin SPA, JSON-LD and the analytics
  snippet need; the `unsafe-inline` rationale is documented in
  `docs/security/security.md` (a nonce-based policy is a later step).
- **Login lockout** (`src/modules/security/lockout.ts`). Per-login-name
  and per-IP attempt counting in D1 `wl_login_attempts` (IPs stored as
  SHA-256 hashes only). Defaults: 5 failed attempts in 15 minutes locks
  for 15 minutes, doubling on consecutive lockouts (capped at 60). A
  successful login clears the counter. Thresholds are options
  (`wl_security_max_attempts`, `wl_security_window_minutes`,
  `wl_security_lockout_minutes`). A locked login returns 429.
- **TOTP two-factor** (`src/modules/security/totp.ts`,
  `service.ts`). RFC 6238 over HMAC-SHA1, 30-second steps, ±1 step of
  skew, 20-byte base32 secrets. `POST /api/auth/2fa/setup` (secret
  stored as *pending*, returned once as an otpauth:// URL + manual
  code), `/confirm` (stores the secret only after a valid code, returns
  8 one-time **hashed** recovery codes), `/disable` (needs the account
  password, signs the user out everywhere). Login accepts an optional
  `totp` field; a missing code returns `totp_required`, a wrong code a
  generic 401. Admin `#/security` runs the whole flow; the login page
  prompts for the code when required.
- **Session hardening** (`src/modules/auth/service.ts`). Sessions
  already stored only SHA-256 token hashes; M9 adds an idle timeout
  (`wl_session_idle_hours`, default 24 h — a session idle longer is
  revoked on next use; `last_seen_at` refreshes at most once every 5
  minutes), `GET /api/auth/sessions` (no token values ever shown) and
  `POST /api/auth/sessions/revoke-all`.
- **Upload hardening** (`src/modules/security/magic.ts`). The M3
  allowlist (jpeg/png/gif/webp/avif/svg/pdf, 50 MB) plus magic-byte
  sniffing on the first bytes of every upload — a PHP file renamed to
  `.jpg` is rejected, and SVGs are checked for scripts, `javascript:`
  URLs and event handlers. Wired into `uploadMedia`, so the compat
  `media_handle_upload` path gets it too.
- **Admin Security page** (`admin/src/pages/Security.tsx`, `#/security`).
  Header status, lockout config + locked keys, 2FA status per admin,
  active sessions, recent failed logins (from the audit log), and a
  warning when a user with the default login name `admin` exists.
- **Agents wired to real checks** (`src/ai/agents/analysis.ts`). The
  security-scanner now runs the real checks (headers policy, lockout
  state, 2FA per admin, upload allowlist, default `admin` login name)
  and the performance-analyst measures real D1/R2 numbers (post and
  revision counts, media bytes, R2 object count, content sizes, cache
  config, derivative status). Cache hit rates are **not** observable
  from inside the Worker, so neither agent invents one. The
  backup-advisor reports the real backup registry; the
  migration-assistant points at the real importer. Tested: both agents'
  outputs match direct queries.
- **Performance** (`src/modules/performance/`). Anonymous public GETs
  are cached 60 s with `stale-while-revalidate=60`; publishing (or
  changing) a post purges its URL, the home page and its term pages
  from the Cache API (purge failures never fail the publish; tested
  with a fake Cache). Image derivatives via the Cloudflare Images
  binding (`IMAGES`, commented in `wrangler.toml` with setup notes):
  `GET /media/:key?width=&format=` serves a resized/WebP variant and
  stores it in R2 + `wl_media_derivatives` for `srcset`; when the
  binding is absent the endpoint serves the original and says so
  (`X-Wordless-Derivatives: unavailable`) — a resize is never faked.
  The media page reports derivative status honestly. Compression is
  the Cloudflare edge's job (gzip/brotli); the Worker sets `Vary:
  Accept-Encoding` and documents the split. Site Health gains a
  performance section with measured numbers.
- **Backup + restore** (`src/modules/backup/service.ts`). `POST
  /api/backup/create` (admin, `wl_jobs` job) writes a real ZIP
  (`fflate`) to R2 `backups/<id>.zip`: one JSON file per D1 table, a
  media manifest (R2 keys + sizes + etags), and a manifest with a
  SHA-256 checksum per file. `GET /api/backup` (list with size,
  checksum, verified flag), `GET /api/backup/:id/download`, `POST
  /api/backup/:id/verify` (re-reads the bundle, recomputes every
  checksum — only then is a backup marked verified), `POST
  /api/backup/:id/restore` (requires the typed confirmation `RESTORE`,
  refuses a failed verification and a different minor version,
  restores tables in dependency order inside batched transactions, and
  checks the media manifest key-by-key — missing keys are reported,
  never silently skipped). Retention keeps the 10 most recent backups
  (option `wl_backup_retention`). Admin `#/backup` runs the whole flow.
  `wl_backups` and `wl_jobs` are excluded from backups by design.
- **WordPress importer** (`src/modules/importer/`). `POST
  /api/import/wxr` (multipart, ≤50 MB, `wl_jobs` job) parses WXR with
  a real XML parser (`fast-xml-parser` — never regex): authors, categories/tags,
  posts/pages (block content verbatim), comments, attachments (URL
  fetch → R2; failed fetches recorded per item). `POST /api/import/sql`
  parses mysqldump files for the 12 `wp_*` tables only (other tables
  reported as ignored). PHP-serialized values become JSON via a safe
  unserializer that **refuses objects and references** (never `eval`).
  WordPress phpass hashes are not portable: every imported user gets
  an empty password + the forced-reset flag and cannot log in until an
  administrator resets the password. Original IDs are kept when free,
  so relationships survive; revisions are skipped. Every item lands in
  a per-item report (imported / skipped / failed with a reason).
  Synthetic fixtures in `test/fixtures/wordpress/` (WXR + SQL dump,
  generated by `scripts/generate-wp-fixture.mjs` from the WordPress
  7.1.5 schema) prove the round-trip in tests. Admin `#/import` uploads
  either format, shows job progress and the per-item report, and links
  the fixtures. Full docs: `docs/import/wordpress-import.md`.
- **Compat registry:** separate `SECURITY_COMPAT` (7),
  `PERFORMANCE_COMPAT` (3), `BACKUP_COMPAT` (3) and `IMPORT_COMPAT`
  (3) lists — Wordless-native surfaces, deliberately not in
  `WORDPRESS_COMPAT`.
- **Migration `0009_m9.sql` was needed** (additive only):
  `wl_login_attempts`, `wl_backups`, `wl_media_derivatives`, plus a
  nullable `last_seen_at` column on `wl_sessions`. Existing local D1
  databases need `npx wrangler d1 migrations apply DB --local` before
  the M9 routes work. `Db` gained a `batch()` method (atomic where the
  platform supports it — D1 batch, node:sqlite transaction) for the
  restore.
- 375 tests, all passing (4 skipped — the M4 emitter skips); `tsc --noEmit`
  clean for the worker and the admin under `strict`.

## What Milestone 9 is not

- **Not live Cloudflare Images.** The derivatives service is
  implemented against the documented Images binding API, but no live
  call has been made — no account is connected. Until the binding is
  enabled and a real resize is observed, derivatives are "implemented,
  not verified" and the endpoint honestly serves originals.
- **Not real-user performance measurement.** No Core Web Vitals /
  real-user timing is collected; the performance numbers are D1/R2
  counts and configuration, and cache hit rates are not observable
  from inside the Worker.
- **Not a security audit.** The lockout, TOTP and header checks are
  implemented and tested, but no external penetration test or audit
  has been run; the CSP still allows `unsafe-inline` (documented).
- **Not a WordPress migration guarantee.** The importer covers the 12
  core tables and WXR; multisite tables, plugin tables, uploads binary
  blobs and serialized PHP objects are not imported (see
  `docs/import/wordpress-import.md`). Converted plugins still go
  through the M4 conversion engine.

## What Milestone 10 is

- **First-administrator seed** (`npm run seed-admin`,
  `src/modules/auth/seed.ts` + `scripts/seed-admin.mjs`). Interactive
  prompts or `--login/--email/--password/--confirm` flags; refuses when
  an administrator already exists (and prints how to use password reset
  instead); local D1 by default, `--remote` only after a successful
  `wrangler whoami` plus an extra confirmation. It writes exactly the
  rows the users service creates — one `wp_users` row with a PBKDF2
  hash in the repo format and one `wp_usermeta` `wp_capabilities` row
  holding `{"administrator":true}` — so the seeded admin logs in through
  the normal login path. The password is never printed or logged. The
  installer offers to run it after local setup. This closes the open
  M1–M9 gap: production login is now usable end-to-end.
- **Block-pattern rendering (M5 gap closed).**
  `src/modules/themes/patterns.ts` + `pattern-php.ts` + the `pattern`
  case in `templates.ts`. A `wp:pattern` block renders the theme's
  `patterns/<name>.php` file: the leading PHP header comment is stripped
  and the block HTML is rendered through the template renderer (query
  loops, nested patterns, template parts all work). Inline PHP inside
  the pattern is evaluated by a small allowlisted evaluator — the twelve
  i18n/escaping calls Twenty Twenty-Five actually uses (`__`, `_x`,
  `_e`, `esc_html__/_x/_e`, `esc_attr__/_x/_e`, `esc_url`,
  `get_template_directory_uri`, `printf` `%s`, `wp_kses_post`) with
  string literals only. No variables, no includes, no `eval`, no control
  flow, nothing executed: anything outside the allowlist refuses the
  whole pattern with a warning. Nesting is bounded (depth 5, shared with
  template parts) and a self-referencing pattern renders once (cycle
  guard). Verified against the real Twenty Twenty-Five theme: its
  `home.html` (header/footer parts + `template-query-loop` pattern) now
  renders post titles and excerpts where M5 rendered nearly empty.
  One honest remainder: `get_template_directory_uri()` returns an empty
  string — theme files are stored in R2 with no public asset URL yet —
  so image `src` attributes built from it are empty, and the renderer
  records one warning per page render.
- **Installer wizard audit** (`scripts/install.mjs`). The Wrangler check
  now runs *after* dependency install (it previously ran first, so `npx`
  could download Wrangler from the network on a fresh clone);
  `--check-only` no longer triggers a download when `node_modules` is
  missing; the wizard validates the staging/production sections in
  `wrangler.toml`; the production path provisions the *production*
  environment (`wordless-prod` D1, `wordless-media-prod` R2,
  `CONFIG-prod` KV) into the `[env.production]` blocks and deploys with
  `--env production`; the wizard offers the seed-admin step after local
  setup. The banner now says the version (1.0.0), not a milestone.
- **Deploy scripts (dev/staging/prod).** `wrangler.toml` gains
  `[env.staging]` (`wordless-staging` Worker, `wordless-staging` D1,
  `wordless-media-staging` R2) and `[env.production]` (`wordless-prod`,
  `wordless-prod` D1, `wordless-media-prod` R2) — production never shares
  the dev database or bucket names (verified with `wrangler deploy
  --dry-run --env staging|production`). `npm run deploy:staging` and
  `npm run deploy:production` run the pre-deploy checks (full test suite
  + build + setup check) and refuse without `--confirm`. Fixed a real bug
  in `scripts/deploy.mjs`: step 2 assigned to an undeclared `r`, which
  would have crashed every deploy in strict-mode ESM.
- **Guided install scripts refreshed.** `install.sh` / `install.ps1`
  check for Node 20+ (not just presence) and pass arguments through to
  the wizard (`./install.sh --local`).
- **Release management.** `CHANGELOG.md` (M1–M10 with test counts and
  pushed commit SHAs), `docs/release.md` (tagging, release checklist,
  rollback via `wrangler rollback` / redeploying the previous commit),
  and the 1.0.0 version bump (`package.json` + `VERSION`).
- **Final audit.** Full regression green (all M1–M9 tests intact); the M9
  smoke script re-run still passes 45/45; no hardcoded secrets in code,
  fixtures or docs; every compat list re-checked against implemented
  behaviour (WORDPRESS_COMPAT 45, AI_COMPAT 6, SEO_COMPAT 10,
  COMMERCE_COMPAT 8, INTEGRATIONS_COMPAT 6, SECURITY_COMPAT 7,
  PERFORMANCE_COMPAT 3, BACKUP_COMPAT 3, IMPORT_COMPAT 3) with three
  stale notes corrected.
- **No schema change was needed for M10** — the seed uses the existing
  users tables, patterns use the existing theme files in R2, and
  environments are configuration, so there is no `migrations/0010_m10.sql`.
- **Shop list description fix (found while taking screenshots).** The
  shop list escaped the raw product description, so Gutenberg block
  comments (`<!-- wp:paragraph -->`) showed up as visible text and the
  excerpt was wrong. A new `plainTextExcerpt` helper renders the blocks
  first and strips tags; the single product page already rendered blocks
  correctly. Covered by a new unit test and a shop-list regression test.
- 417 tests, all passing (4 skipped — the M4 emitter skips); `tsc --noEmit`
  clean for the worker and the admin under `strict`.

## What Milestone 10 is not

- **Not a live deployment.** No deploy to Cloudflare has ever been
  attempted in this environment — no account is connected, by the user's
  instruction. Staging/production are configured and dry-run-validated,
  but the first real deploy happens when the user runs the installer
  with their own account.
- **Not live Workers AI.** Workers AI calls have never been observed —
  only the mock provider is exercised by tests and local smoke tests.
  A real Workers AI response is the first thing to verify after the
  first deploy.
- **Not live payments or email delivery.** Paystack, Flutterwave,
  Stripe and the HTTP email provider are implemented from the public
  docs with real HMAC verification, but no live call has been made —
  no keys are connected. The mock test mode is the only verified path.
- **Not theme-asset serving.** `get_template_directory_uri()` returns
  an empty string, so images referenced from pattern files via the
  theme URI do not load. A public route serving `themes/<slug>/assets/`
  from R2 is a later milestone.
- **Not full-text search.** Search is still LIKE-based (M2).
- **Not multisite, not WooCommerce, not XML-RPC.** All deferred by design.
- **Not a "future" post status, not user reassignment on delete, not
  per-request extension loading on cold start, not Queues/Workflows for
  conversion and AI tasks.** All documented in their own milestones'
  "is not" sections and unchanged by M10.
- **Not a security audit.** The M9 hardening is implemented and tested,
  but no external penetration test has been run.
- **Not universal plugin compatibility.** The converter handles the
  procedural PHP subset well and records everything else honestly —
  never claim a plugin converts until its own report says so.

## What Milestone 11 is

- **Bigger uploads.** Theme ZIPs 200 files / 5 MB → 10,000 files / 50 MB;
  marketplace ZIPs 100 files / 2 MB → 10,000 files / 50 MB; media uploads
  10 MB → 50 MB; WXR/SQL imports 10 MB → 50 MB. The duplicated theme-ZIP
  byte cap is consolidated to one definition (`src/modules/themes/zip.ts`).
- **Plugin compatibility reports.** Every marketplace install runs the M4
  PHP analyser over its PHP files and stores a per-plugin report: files
  analysed, convertible / partial / blocked / unparsed counts, top
  blocking reasons with file paths, per-file verdicts (capped at 500,
  partial/blocked first). Shown on Commerce → Marketplace and at
  `GET /api/marketplace/:slug/report`. A plugin is never labelled as
  working while its report shows partial or blocked files. Installed
  code is never executed.
- **Auto-convert on upload.** Theme imports (block + classic) and
  marketplace installs automatically run the M4 converter over the PHP
  files (max 500 files, 1 MB per file) and store the generated TypeScript
  in R2 under `<prefix>/converted/<path>.ts` — stored, never executed.
  Literal `get_option()` defaults are carried over as Wordless options
  (existing options are never overwritten), and a theme's `theme.json`
  settings are reported as applied (CSS presets) or skipped with a
  reason. Every upload produces a per-file conversion record
  (converted / partial / blocked + reason) and a settings-migration
  report, stored with the theme/plugin and shown in admin.
- **Elementor content rendering.** Posts carrying `_elementor_data`
  postmeta render their Elementor layout on the public site (sections →
  columns → widgets) for heading, text-editor, image, button, spacer,
  divider, video, icon-list, image-box and google-maps. Unknown widgets
  render nothing and are collected as unsupported; icon glyphs are not
  rendered (no icon font is bundled). The editor shows a notice on
  Elementor posts. This renders Elementor *content* — the Elementor
  drag-and-drop editor itself is NOT included; pages are edited in
  Wordless's own block editor.
- **File manager.** New admin Files page (`#/files`): the R2 bucket with
  folder navigation by prefix (name, size, type, modified), upload
  (≤50 MB, media MIME allowlist + magic-byte sniffing), download, rename
  and delete — all `manage_options`. No shell access, no in-place
  editing; `extensions/`, `themes/`, `backups/` and `imports/` are
  read-only here (owned by their own pages); path traversal is rejected.

## What Milestone 11 is not

- **Not a guarantee that a 50 MB upload will succeed.** 50 MB is the
  configured cap; uploads near the cap can still be slow or fail on the
  Cloudflare free tier (128 MB Worker memory, request buffering).
  Chunked/resumable upload is a future improvement, not this milestone.
- **Not exact, nothing-lost conversion.** Dynamic PHP behaviour,
  WordPress hooks/filters with no Wordless equivalent, AJAX handlers and
  class-heavy code cannot all convert — the per-file record and the
  settings report say exactly what converted, what was partial and what
  was blocked. Never claim a theme or plugin converted exactly when the
  record shows partial/blocked items.
- **Not running converted code.** Auto-converted TypeScript is stored in
  R2 and never executed; a converted plugin does not run until a later
  milestone loads generated extensions.
- **Not the Elementor editor.** Only Elementor *content* renders; the
  drag-and-drop editor is a separate JS application and is not included.
  Do not imply full Elementor compatibility anywhere.
- **Not a shell or code editor.** The file manager cannot edit files
  in place, cannot run commands, and cannot touch the D1 theme blobs
  (the theme editor covers themes).

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
- **Media uploads.** `POST /api/media` (multipart, 50 MB cap, MIME
  allowlist jpeg/png/gif/webp/avif/svg/pdf — anything else is a 400) stores
  the file in R2 via the `MEDIA` binding, creates the attachment post and
  postmeta (filename, size, alt); list/get/alt-update/delete endpoints and
  `GET /media/:key` serving from R2 with a long cache. Tests use a fake
  in-memory R2 bucket, never a live one. **Gap (closed in M9):** image
  derivatives / WebP conversion were NOT in M3 — they arrived in
  Milestone 9 via the Cloudflare Images binding.
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
- **No AI agents in M3.** Provider abstraction, orchestration and the
  command centre are Milestone 6 (built — see
  [What Milestone 6 is](#what-milestone-6-is)).
- **No image derivatives.** Uploads store the original file only; resizing
  and WebP conversion are Milestone 9 (Cloudflare Images binding when
  bound, originals served otherwise).
- **No user reassignment on delete.** Deleting a user who owns posts is
  refused; reassignment is a later milestone.
- **No commerce, email, payments, analytics or social integrations.**
  Those are Phase 8.
- **No production deployment verified yet.** Local D1 + `wrangler dev` are
  verified; the production path is implemented but never attempted (no
  Cloudflare account connected — deployment happens when the user installs
  with their own account).

## Documentation

- [INSTALLATION.md](INSTALLATION.md) — installing from GitHub, local setup
- [DEPLOYMENT.md](DEPLOYMENT.md) — production deployment on Cloudflare
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — common failures and fixes
- [ARCHITECTURE.md](ARCHITECTURE.md) — module map + pointer to the full design
- [CHANGELOG.md](CHANGELOG.md) — release history, M1–M10
- [docs/release.md](docs/release.md) — release procedure: tagging, checklist, rollback
- [docs/security/security.md](docs/security/security.md) — security model (M9)
- [docs/import/wordpress-import.md](docs/import/wordpress-import.md) — WordPress importer (M9)
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

Wordless 1.0.0 is a working platform with a real admin, editor, AI
command centre, commerce, security hardening, backup/restore, a
WordPress importer and production-ready deploy tooling — not a finished
product. See the roadmap in `../docs/` (phases 1–10) and
`CHANGELOG.md` for what each milestone shipped. Do not mark
unfinished features as complete, do not commit secrets, and keep every stub
labelled `STUB` until it is real.
