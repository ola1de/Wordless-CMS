# WORDLESS — Architecture (Milestone 6 summary)

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

## Milestone 4 module map

```
src/index.ts            Worker entry: fetch handler, route table, session resolution,
                        public permalink fallback, Cache API for anonymous GETs,
                        /admin served from Static Assets (ASSETS binding);
                        conversion + extension routes (M4, install_plugins)
src/env.ts              Env bindings (DB / MEDIA / CONFIG / ASSETS) — no secrets
src/db.ts               D1 wrapper (bound params only) + adaptD1()
src/kernel/
  hooks.ts              Typed action/filter system (WP plugin.php semantics, sync)
  router.ts             Method+pattern router, role guards, { ok, data, error } envelope
  errors.ts             WordlessError(code, status); stubs throw 501
  validate.ts           requireString / slug / int range / email helpers
src/conversion/         (M4) PHP → TypeScript engine — static only, never executes PHP
  lexer.ts              Tokenizer: open/close tags, strings + interpolation,
                        heredoc/nowdoc, comments, backticks, namespaced names
  parser.ts             Recursive-descent parser; every node carries source
                        position; unsupported constructs become `unsupported`
                        nodes with a reason, never silently dropped
  ast.ts                Node types + childNodes / walkAst / countAstNodes
  emitter.ts            AST → Wordless extension module (functions, hooks,
                        echo buffer, WP mappings, __unmapped_* helpers,
                        static-var hoisting, ABSPATH-guard transform)
  safety.ts             Token-based sandbox scan: eval/exec/shell/unserialize/
                        backticks/dynamic include are rejected, job fails
  analyze.ts            Per-file static analysis + verdicts + markdown report
  index.ts              convertPhp() pipeline (safety → parse → emit)
src/modules/
  conversion/           (M4) wl_jobs rows (kind=conversion); create/list/get +
                        runConversionJob(db, jobId) — callable from a request
                        (local dev) or a Queue/Workflow consumer (production)
  extensions/           (M4) wl_extensions rows + bundled-extension registry
                        (examples/hello-dolly); install/get/list/status
  themes/               (M5) wl_themes rows; theme.json engine (v1–3),
                        template hierarchy + block-template renderer,
                        fflate ZIP import, classic-theme analysis (M4
                        analyser), variations in options, 30-min preview
                        tokens; default theme ships in-code (default-theme.ts)
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
  wordpress.ts          41-function WP registry (full/partial/stub, honestly tagged);
                        M4 adds get_user_locale, get_locale, __, _e, esc_html,
                        esc_attr, wptexturize (partial)
src/test/
  test-db.ts            In-memory SQLite + migration runner (tests only)
  fake-storage.ts       In-memory MediaStorage (tests only)
examples/
  hello-dolly/          (M4) The converter's own output for the bundled Hello
                        Dolly plugin: generated index.ts + extension.json +
                        README + runtime test (NOT hand-written; a test
                        asserts it matches a fresh conversion)
docs/conversion/
  hello-dolly-report.md (M4) The Hello Dolly conversion report
  akismet-analysis.md  (M4) Static analysis of the bundled Akismet plugin
                        (29 files, 9 convertible / 16 partial / 4 blocked)
admin/
  vite.config.ts        Vite build: root admin/, base /admin/, outDir dist/admin
  index.html            SPA entry point
  src/main.tsx          React entry point
  src/App.tsx           hash routing + sidebar layout + auth gate
  src/styles.css        the one plain stylesheet (no framework)
  src/lib/              API client (envelope), types, date/permalink helpers
  src/editor/           Gutenberg block parser/serializer + round-trip tests
  src/pages/            Dashboard, Posts, Editor, Media, Terms, Comments,
                        Menus, Users, Settings, Site Health, Activity, Login,
                        Conversion (M4)
migrations/
  0001_init.sql         D1 schema v1 (12 wp_* + 6 wl_* tables)
  0002_m2.sql           wl_redirects + M2 indexes
                        (No 0003: M3 needed no schema change.
                         No 0004: M4 stores job reports in wl_jobs.result.)
scripts/
  install.mjs           Interactive installer wizard (Node built-ins only)
  deploy.mjs            Production deploy guard (--confirm + whoami required)
```

## Conversion pipeline (M4)

```
PHP source (upload ≤1 MB, or the hello-dolly fixture fetched from a pinned
upstream URL at job time — no PHP is ever copied into the repo)
        │
        ▼
safety.ts — token-based scan (blocked words inside strings/comments do NOT
        trip it). A violation fails the job with a reason; nothing is
        executed, ever.
        │
        ▼
lexer.ts ──▶ parser.ts ──▶ AST (every node has a source position)
        │                    unsupported constructs are `unsupported` nodes
        │                    with a reason — never dropped or guessed
        ▼
emitter.ts ──▶ TypeScript extension module + ConversionReport
        │      (functions, hooks in activate(), echo → __out buffer,
        │       WP mappings, __unmapped_* throwing helpers, static-var
        │       hoisting, ABSPATH-guard transform)
        ▼
wl_jobs row (kind=conversion) — status pending → running → done/failed,
progress %, report JSON in `result`. A bundled extension (hello-dolly)
is installed in wl_extensions and activated on success.
```

### Sandbox rules

- **No PHP execution, ever.** There is no PHP runtime in Wordless; the
  converter only *translates* source text into a TypeScript build
  artifact. Nothing in the pipeline shells out, evals, or loads code.
- **Blocked constructs fail the job**: `eval`, `exec`, `shell_exec`,
  `system`, `passthru`, `popen`, `proc_open`, `create_function`,
  `unserialize`, `parse_str`/`mb_parse_str`, `assert`, backtick execution,
  dynamic `include`/`require` of a non-literal path.
- **Converted code runs only through the Wordless extension API**, with
  the same capability checks as any extension. It cannot load code
  dynamically, run shell commands, or touch PHP. Converted extensions are
  reviewed before enabling — the generated module says so in its header.
- **No universal compatibility is claimed.** The engine converts the
  procedural PHP subset well and records everything else honestly in the
  job report. A plugin converts only when its own report says so.

### Async-job design (local vs production)

- **Local dev (M4):** the route runs `runConversionJob(db, jobId)`
  synchronously inside the request. A single plugin file converts in
  ~10 ms, far under the Worker's 10 ms CPU budget for a small file — but
  a 1 MB file could exceed it, which is why the job row exists.
- **Production (later):** the same `runConversionJob(db, jobId)` is
  invoked by a Queue/Workflow consumer instead of the request handler.
  The module takes an injected `resolveFixture` (fetch the pinned
  upstream source) and an injected `onSuccess` (install + activate a
  bundled extension), so the queue consumer needs no route code. Queues
  and Workflows are NOT built in M4.
- **Job rows are the source of truth:** the admin polls
  `GET /api/conversion/jobs/:id` for status/progress; the report is
  stored as JSON in `wl_jobs.result`, so no new table was needed.

### Extension activation (M4, honest limit)

The kernel hook registry is a module-level singleton, so calling a
bundled extension's `activate(wp)` in the conversion request registers
its hooks for the running isolate — the smoke test proves the lyric
returns. A **cold start does not re-activate extensions**: loading the
active bundled extensions at Worker startup is a later milestone. The
marketplace (installing/activating arbitrary extensions from uploads) is
Phase 8.

## Theme system (M5)

```
themes/wordless-default/          original block theme (repo source of truth)
  style.css · theme.json v3 · templates/*.html · parts/*.html
        │  scripts/generate-default-theme.mjs
        ▼
src/modules/themes/default-theme.ts   in-code bundle (drift-tested)
        │
src/modules/themes/
  themejson.ts   parse/validate v1–3 · generateThemeCss · mergeThemeSettings
  templates.ts   template hierarchy · block-template tree parser + renderer
  zip.ts         fflate ZIP extraction (≤5 MB, traversal rejected)
  classic.ts     style.css header parse · M4 analyser per PHP file · report
  service.ts     wl_themes CRUD · import/activate/delete · variations · preview
        │
  D1 wl_themes (migrations/0005_m5.sql) ── metadata, theme.json, stylesheet, hash, report
  R2 themes/<slug>/ (MEDIA binding) ─────── template + asset files
        │
  public render (src/modules/render/service.ts)
    loadActiveTheme → template hierarchy → renderTemplateFile → layout()
    /theme.css?v=<hash> (generated CSS + style.css, variation merged when saved)
```

- **Storage.** A theme is NOT an extension: it has its own `wl_themes`
  table (slug, name, version, author, kind block|classic, status,
  theme_json, stylesheet, stylesheet_hash, source, report_json). Files
  live in R2 under `themes/<slug>/` through the same `MediaStorage`
  interface the media module uses (R2 in production, in-memory fake in
  tests). The built-in default theme's files ship in code
  (`default-theme.ts`) and are used when R2 has no copy — a fresh DB
  renders correctly before any import.
- **Rendering pipeline.** `renderHome`/`renderSingle`/`renderPage`/
  `renderTermArchive`/`renderDateArchive`/`renderNotFound` resolve their
  page context, then `finishPage` tries the active theme first:
  `resolveTemplateName` picks the template by hierarchy, `renderTemplateFile`
  parses the template into a block tree (stack-based parser — the
  tokenizer is a single regex that must match hyphenated block names
  like `template-part` and `post-title`) and renders it through the M2
  block renderer, with template parts resolved from `parts/`. If no theme
  is active, the M2 built-in layout renders instead.
- **Stylesheet.** `/theme.css` serves the generated theme.json CSS plus
  the theme's `style.css` (classic themes: the imported `style.css`
  alone). The URL is versioned with the stylesheet hash
  (`?v=<hash>`) so activation busts the Cache API entry; the CSS is
  cached like other public assets.
- **Variations.** Saved in options as `wl_theme_variation_<slug>` (name +
  settings). On render, the variation's settings are merged over the
  theme's theme.json settings (preset arrays merge by slug) and the CSS is
  regenerated. Variations apply to block themes only.
- **Preview.** `POST /api/themes/preview` stores unsaved settings under a
  32-hex-char token in the `wl_theme_preview` option (30-minute TTL).
  `/?wl_preview=<token>` (and `/theme.css?wl_preview=<token>`) render
  with those overrides server-side. Preview requests are never cached and
  nothing is injected into the page with JavaScript.
- **Classic themes.** Import parses the `style.css` header, stores the
  stylesheet, and runs each `.php` file through the M4 analyser for a
  per-file convertible/partial/blocked report. No PHP is executed; no
  template is converted in v1.
- **Limits.** `fflate` is a bundled dependency (unzipSync/zipSync) and
  fits the Workers limits; ZIPs are capped at 5 MB and extracted in
  memory in the request (local dev). A production-scale import of a very
  large theme would belong in an async job — same pattern as M4
  conversion jobs.

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

## AI system (M6)

```
Admin #/ai (CommandCentre.tsx)
   │  providers / mode / agents / tasks / approvals / memory
   ▼
src/index.ts  /api/ai/*  (all manage_options)
   ├── providers ──▶ src/ai/providers/ (registry: workers-ai / openai / mock)
   ├── tasks ──────▶ src/ai/orchestrator.ts  createAiTask → runAiTask(db, jobId)
   │                    │  wl_jobs kind='ai_task' (result JSON: output,
   │                    │  proposals, approvals, applied, usage)
   │                    ├─▶ src/ai/agents/*  (15 agents; run(ctx) → AgentResult)
   │                    ├─▶ src/ai/memory.ts  (buildMemoryContext → prompt)
   │                    └─▶ src/modules/ai/  mode + approvals + applier
   └── memory ────▶ wl_ai_memory (facts re-ingested; admin notes)
```

- **Provider abstraction.** `src/ai/providers/types.ts` defines the
  `Provider` interface (`id`, `name`, `isConfigured(env)`,
  `configuredDetail(env)`, `complete(env, prompt, opts)`,
  optional `embed`, `test(env)`). **Workers AI is the default and only
  required provider** (model `@cf/meta/llama-3-8b-instruct`, via the `AI`
  binding; the `[ai]` block in `wrangler.toml` is commented out until
  deploy time, and the code reports "not configured" — never a crash —
  when the binding is absent). The OpenAI-compatible provider is an
  optional fallback (key only from the `OPENAI_API_KEY` secret, 30 s
  timeout, error mapping to `ai_upstream_error`). The mock provider is
  deterministic (FNV-1a hash of the prompt) for tests and local dev.
  Selection lives in the `wl_ai_provider` option (default
  `workers-ai`); `GET /api/ai/providers` reports live configured state.
  Live Workers AI calls are **not verified** in this environment (no
  Cloudflare account) — only the mock path is exercised by tests and the
  local smoke test.
- **Orchestrator.** Tasks are `wl_jobs` rows, exactly like conversion
  jobs (M4): `createAiTask` validates the agent exists and is available,
  then `runAiTask(db, jobId, { env, userId })` runs the agent and stores
  the structured result. It runs synchronously in-request in local dev
  and is structured for a Queue/Workflow consumer later (same pattern as
  `runConversionJob`). A provider-based agent whose provider is not
  configured fails the task with `ai_not_configured` — the task row says
  `failed` and the error is shown, never hidden.
- **Operating modes** (`wl_ai_mode`, default `supervised`). `manual`:
  proposals are recorded only. `supervised`: every proposal becomes a
  pending `wl_ai_approvals` row. `autonomous`: low-risk proposals apply
  immediately via the applier; medium/high-risk still become approvals.
  The orchestrator enforces the mode in `processProposals` — the mode
  is a site setting, not a UI hint, and it is tested.
- **Agents.** `src/ai/agents/registry.ts` holds the 15-agent roster
  (`AGENTS`, `getAgent`, `listAgents(providerConfigured)`). Each agent
  declares `capabilities`, a `risk` level, and `requiresProvider`.
  Provider-based agents (content-writer, research-assistant,
  support-responder, email-composer, social-composer) call the provider
  and label output as AI draft; deterministic agents (seo-auditor,
  security-scanner, performance-analyst, accessibility-checker,
  analytics-reporter, backup-advisor, migration-assistant,
  code-reviewer, design-advisor) read only measured site data. An agent
  that depends on a later milestone returns an honest `unavailable`
  result: **commerce-assistant** (needs the M8 commerce system) — the
  orchestrator rejects its tasks with a 400 and the command centre shows
  it unavailable.
- **Approvals + applier.** `src/modules/ai/service.ts` owns the mode and
  the `wl_ai_approvals` table; `src/modules/ai/apply.ts` applies
  proposals through the existing services only (posts, options,
  terms, themes) — never raw SQL writes to content tables. Approving
  applies FIRST and only marks the row approved on success, so a failed
  apply leaves the approval pending. The applier's `update_option`
  allow-list is exactly `blogname`, `blogdescription`, `posts_per_page`
  (1–100), `default_comment_status` (open|closed); `create_post` always
  creates a draft; there is no delete action in M6.
- **Website memory.** `src/ai/memory.ts` owns `wl_ai_memory` (kind
  fact|note, unique key). `rebuildMemory` ingests site title/tagline,
  active theme, published post/page titles (cap 100) and extensions, and
  deletes stale facts — never admin notes. `addNote` (max 2000 chars)
  refuses secret-like text by regex. Agents receive
  `buildMemoryContext` (site facts + up to 20 post titles + up to 10
  notes) in their prompt; when memory is empty the context says so
  plainly.
- **Command centre.** `admin/src/pages/CommandCentre.tsx` (`#/ai`):
  provider card (select/test, recommended badge, honest not-configured
  messaging), mode selector, agents grid, task composer, task list,
  approvals queue, memory notes editor. All on the real API.
- **Compat.** The AI HTTP surface is recorded in `AI_COMPAT` in
  `src/compat/wordpress.ts` — a separate list from `WORDPRESS_COMPAT`,
  because these are Wordless-native endpoints, not WordPress functions.
- **Schema.** Migration `0006_m6.sql` (additive only) adds
  `wl_ai_approvals` and `wl_ai_memory`. `REQUIRED_TABLES` in the health
  service and `src/test/test-db.ts` cover both.

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
- M5: the theme engine is built (theme.json v1–3, block-theme rendering,
  ZIP import, classic analysis, customizer + preview + variations). The
  M2 built-in rendering remains as the fallback when no theme is active.
- M5: `/?wl_preview=<token>` and `/theme.css?wl_preview=<token>` are
  never cached; theme activation busts the CSS cache via `?v=<hash>`.
- M2: public GETs without a session cookie are cached in the Cache API
  (`Cache-Control: public, max-age=60`); `/api/*` and `/admin` are never cached.
- M4: the converter never executes PHP — it only translates source text.
  Blocked constructs fail the job; unsupported constructs are recorded,
  never dropped or guessed.
- M4: conversion jobs live in the existing `wl_jobs` table (report JSON in
  `result`); no new table. `runConversionJob(db, jobId)` is callable from
  a request (local dev) or a Queue/Workflow consumer (production).
- M4: fixture sources are fetched from pinned upstream URLs at job time;
  no GPL PHP is copied into the repo. The generated extension is the
  converter's own output, checked in as a fixture and asserted to match a
  fresh conversion.
- M4: `get_locale`/`get_user_locale` are synchronous reads of the
  request's `site_locale` option, so a locale call inside an action
  callback does not force the whole function async (the hook system is
  synchronous).
- M4: a successful job activates a bundled extension in the running
  isolate's hook registry; cold-start extension loading is a later
  milestone.
- M6: **Workers AI is the default and only required AI provider** (user
  decision 2026-11-19); OpenAI-compatible is an optional fallback only.
  The mock provider backs tests and local dev; live Workers AI calls
  cannot be verified without a Cloudflare account and are documented,
  not claimed.
- M6: the orchestrator enforces the operating mode in code (manual /
  supervised / autonomous); approvals are the human gate and applying
  goes through the existing services, never raw SQL.
- M6: an agent that depends on a later milestone reports itself
  unavailable (commerce-assistant → M8) instead of faking a result.
- M6: website memory never contains secrets; notes refuse secret-like
  text, and facts are re-ingested from the site, never invented.
