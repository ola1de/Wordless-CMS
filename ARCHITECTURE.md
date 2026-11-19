# WORDLESS — Architecture (Milestone 3 summary)

The full design lives in `../docs/02-architecture.md` (system diagram,
technology choices with reasons, D1 schema v1, kernel, module boundaries,
public rendering, conversion engine, AI operating system, limits-driven
design rules and the decisions log). That document is the authority; this
file is a one-page pointer plus the Milestone 3 module map.

## Stack

- **Runtime:** Cloudflare Workers (TypeScript, no PHP anywhere in production)
- **Database:** Cloudflare D1 (SQLite) — 12 WordPress-shaped `wp_*` tables + `wl_*` tables
- **Storage:** Cloudflare R2 (media objects — real uploads in M3; no image derivatives yet, Phase 7)
- **Config:** Cloudflare KV (rare reads; never secrets)
- **Admin:** React SPA (Vite → Static Assets, `admin/dist/admin/`, served at `/admin`); the M2 server-rendered shell (`src/admin-shell.ts`) was removed in M3
- **Tests:** Vitest + Node 24 `node:sqlite` (D1 is SQLite, so schema + SQL tests run locally)

## Milestone 3 module map

```
src/index.ts            Worker entry: fetch handler, route table, session resolution,
                        public permalink fallback, Cache API for anonymous GETs,
                        /admin served from Static Assets (ASSETS binding)
src/env.ts              Env bindings (DB / MEDIA / CONFIG / ASSETS) — no secrets
src/db.ts               D1 wrapper (bound params only) + adaptD1()
src/kernel/
  hooks.ts              Typed action/filter system (WP plugin.php semantics, sync)
  router.ts             Method+pattern router, role guards, { ok, data, error } envelope
  errors.ts             WordlessError(code, status); stubs throw 501
  validate.ts           requireString / slug / int range / email helpers
src/modules/
  posts/                create/get/list/update/trash/restore/delete; slug generation;
                        updates auto-save a revision; slug changes record redirects;
                        new posts inherit the default comment status (M3)
  users/                create/get/list, PBKDF2 passwords, roles + capability map;
                        role change, delete-refusal when owning posts, temp passwords (M3)
  options/              get/set/add/delete (JSON values, not PHP-serialized)
  settings/             site settings object + validation (M3)
  media/                uploads to R2 (10 MB cap, MIME allowlist), attachment
                        records in wp_posts + postmeta; fake in-memory storage for tests
  auth/                 opaque sessions in wl_sessions (SHA-256 token hash)
  revisions/            revision rows in wp_posts, autosave, restore, line diff
  terms/                categories (hierarchical) + tags (flat), counts
  comments/             moderation, honeypot + link-count spam guard, count sync
  menus/                nav_menu terms + nav_menu_item posts, locations option
  search/               LIKE-based search, title-ranked (NOT full-text)
  permalinks/           structures, URL builders, resolver, wl_redirects (301)
  render/               public pages + built-in default theme + Gutenberg blocks;
                        listings use the posts_per_page setting (M3)
  feeds/                RSS 2.0, sitemap.xml, robots.txt
  health/               site-health checks (real, per-check pass/fail)
  activity/             wl_audit_log writes + admin-only list
src/compat/
  wordpress.ts          34-function WP registry (full/partial/stub, honestly tagged)
src/test/
  test-db.ts            In-memory SQLite + migration runner (tests only)
  fake-storage.ts       In-memory MediaStorage (tests only)
admin/
  vite.config.ts        Vite build: root admin/, base /admin/, outDir dist/admin
  index.html            SPA entry point
  src/main.tsx          React entry point
  src/App.tsx           hash routing + sidebar layout + auth gate
  src/styles.css        the one plain stylesheet (no framework)
  src/lib/              API client (envelope), types, date/permalink helpers
  src/editor/           Gutenberg block parser/serializer + round-trip tests
  src/pages/            Dashboard, Posts, Editor, Media, Terms, Comments,
                        Menus, Users, Settings, Site Health, Activity, Login
migrations/
  0001_init.sql         D1 schema v1 (12 wp_* + 6 wl_* tables)
  0002_m2.sql           wl_redirects + M2 indexes
                        (No 0003: M3 needed no schema change.)
scripts/
  install.mjs           Interactive installer wizard (Node built-ins only)
  deploy.mjs            Production deploy guard (--confirm + whoami required)
```

## Admin architecture (M3)

```
Vite (admin/) ──build──▶ admin/dist/admin/ (index.html + assets/*.js/css)
                              │
wrangler.toml [assets] directory = "./admin/dist"
                              │
Worker src/index.ts ── /admin, /admin/* ──▶ env.ASSETS.fetch()
   │  (index.html fallback for client routes; /admin/assets/* 404s stay 404)
   ├── /api/* ──▶ kernel router (unchanged)
   └── /* ──▶ public permalink fallback (unchanged)
```

- Routing is client-side **hash routing** (`#/posts`, `#/posts/12/edit`):
  the Worker only ever serves one HTML file, so deep links work without
  server-side route config, and the public site's `/{slug}` URLs are never
  shadowed by admin routes.
- `npm run build:admin` builds the SPA; `npm run build` builds it and
  typechecks worker + admin; `predev` builds it before `wrangler dev`.
- The `ASSETS` binding exists only when `[assets]` is configured; when it
  is missing the Worker answers `/admin` with a 503 telling the operator
  to run `npm run build:admin`.
- The admin never invents data: every page calls the real APIs, and empty
  states say empty.

## Key decisions (see `../docs/02-architecture.md` §10 for the log)

- D1 over KV/Durable Objects for relational data; sessions in D1, not JWT-only.
- Passwords: PBKDF2 via WebCrypto. WordPress phpass hashes are NOT portable —
  imported users get a forced password reset.
- Options/meta values are JSON, not PHP-serialized strings.
- Every stub throws a `STUB` 501 and is listed in README.md — nothing is faked.
- M2: the public site lives at `/` and the admin at `/admin`
  (M1 breaking change — the shell used to be at `/`). M3 replaced the
  server-rendered shell with the React SPA at the same `/admin` path.
- M2: search is LIKE-based v1; FTS5 is a later optimisation, not claimed here.
- M2: the built-in default theme renders the site; a full theme engine is M5.
- M2: public GETs without a session cookie are cached in the Cache API
  (`Cache-Control: public, max-age=60`); `/api/*` and `/admin` are never cached.
