# WORDLESS — Changelog

All releases are built and verified locally first (`npm test`, `npm run
build`, `npm run setup -- --check-only`, `wrangler dev` smoke test) and
then pushed to `ola1de/Wordless-CMS` via the snapshot procedure (see
`docs/release.md`). Commit SHAs below are the pushed commits on `main`,
verified by read-back. Nothing is listed here that the tests do not
cover; the honest limits for each milestone live in `README.md` and
`docs/IMPLEMENTATION_STATUS.md`.

## 1.1.0 — Milestone 11: bigger uploads, plugin compatibility, auto-convert, Elementor rendering, file manager

**Tests: 465 passed, 4 skipped (469 total, 48 files).** Smoke test: 48/48 (`smoke-m11.sh`, port 8796).

- **Raised upload limits (Part A):** theme ZIPs 200 files / 5 MB → 10,000 files / 50 MB; marketplace ZIPs
  100 files / 2 MB → 10,000 files / 50 MB; media uploads 10 MB → 50 MB; WXR/SQL imports 10 MB → 50 MB.
  The duplicated theme-ZIP byte cap (`service.ts` vs `zip.ts`) is consolidated to a single definition in
  `zip.ts` (re-exported from `service.ts`). Honest limit: 50 MB is the configured cap; uploads near the cap can
  still be slow or fail on the Cloudflare free tier (128 MB Worker memory, request buffering) — chunked/resumable
  upload is a future improvement, not this milestone.
- **Plugin compatibility analyser (Part B):** every marketplace install runs the M4 PHP analyser over its PHP
  files and stores a per-plugin report (`wl_extensions.report_json`, migration `0010_m11.sql`): files analysed,
  convertible / partial / blocked / unparsed counts, top blocking reasons with file paths, per-file verdicts
  (capped at 500, partial/blocked first). Exposed at `GET /api/marketplace/:slug/report` and shown on the
  Commerce → Marketplace tab. A plugin is never labelled as working while its report shows partial/blocked files.
  Installed code is never executed.
- **Auto-convert on upload (M11 addition):** theme imports (block + classic) and marketplace installs now also
  run the M4 engine (`convertPhp`) over every PHP file (max 500 files, 1 MB per file) and store the generated
  TypeScript in R2 under `<prefix>/converted/<path>.ts` — stored, never executed. Literal `get_option()`
  defaults are carried over as Wordless options (existing options are never overwritten) and a theme's
  `theme.json` settings are reported as applied (CSS presets) or skipped with a reason. Every upload produces a
  per-file conversion record (converted / partial / blocked + reason) and a settings-migration report, stored
  with the theme/plugin and shown in admin. "Exact, nothing lost" conversion of arbitrary PHP is not possible —
  dynamic behaviour, hooks/filters with no Wordless equivalent, AJAX handlers and class-heavy code cannot all
  convert — so the record is transparent instead of silent. Twenty Twenty-Five core files verified in the M11
  smoke test (see `docs/IMPLEMENTATION_STATUS.md` for the actual numbers).
- **Elementor content renderer (Part C):** pages carrying `_elementor_data` postmeta render their Elementor
  layout on the public site (sections → columns → widgets) for heading, text-editor, image, button, spacer,
  divider, video, icon-list, image-box and google-maps. Unknown widgets render nothing and are listed as
  unsupported; icon glyphs are not rendered (no icon font is bundled). This renders Elementor *content* — the
  Elementor drag-and-drop editor itself is NOT included; pages are edited in Wordless's own block editor (the
  editor shows a notice on Elementor posts). All text is escaped, URLs must be http(s) or site-relative.
- **File manager (Part D):** new admin Files page (`#/files`) listing the R2 bucket with folder navigation by
  prefix (name, size, type, modified), upload (≤50 MB, media MIME allowlist + magic-byte sniffing), download,
  rename and delete. All routes need `manage_options`. No shell access, no in-place editing; `extensions/`,
  `themes/`, `backups/` and `imports/` are read-only here (owned by their own pages). Path traversal is
  rejected. Deleting a media attachment removes its library record too; renaming one updates its record.

## Unreleased — UI redesign (post-1.0.0)

**Tests: 420 passed, 4 skipped (424 total, 44 files).** Smoke test: 27/27.

- **Modern admin + public theme:** full visual redesign (CSS/markup/icons
  only — no API, route or data changes, no new dependencies, no
  network-fetched assets). Deep-teal design system (design tokens,
  spacing scale, 12px radii, soft shadows, focus rings), a custom
  45-icon inline-SVG set, grouped sidebar navigation with a mobile
  drawer, a modern login card, stat cards with icon chips, and the
  public default theme rebranded (post/product cards, sticky blurred
  header, pill buttons). Verified visually from retaken screenshots.
- **Built-in theme upgrades:** default theme bumped to 0.6.0.
  `ensureDefaultTheme` now refreshes the built-in row when the bundled
  theme is newer, so an existing install picks up theme updates instead
  of keeping the old stylesheet forever. Imported/custom themes are
  never touched, a row newer than the bundle is never downgraded, and
  customizer variations (stored as options, not in the theme row) are
  untouched. Covered by 3 new tests.
- **Windows installer fix:** `scripts/install.mjs`, `deploy.mjs` and
  `seed-admin.mjs` spawned `npm`/`npx` with `shell: false`, which fails
  on Windows because npm/npx are `.cmd` shims — setup wrongly reported
  "npm was not found" on a machine where npm works. First fix (resolve
  to `npm.cmd`) did NOT work: a diagnostic on the real Windows machine
  showed `npm` → ENOENT, `npm.cmd` → EINVAL, `npm` with a shell → works.
  The `run()` helper in all three scripts now runs through `cmd.exe`
  (`shell: true`) on Windows only, with arguments quoted (MSVC rules)
  because Node concatenates them unescaped with a shell (DEP0190).
  Found and proven from a real Windows install attempt (Node 24.16.0).
- **Remote seed fix:** `npm run seed-admin -- --remote` ran
  `wrangler d1 execute DB --remote` without `--env`, so it hit the
  top-level D1 binding whose `database_id` is still the REPLACE-ME
  placeholder — Wrangler failed with "Invalid uuid" (code 7400) and
  the live database never got an administrator, which is why the
  first production sign-in failed with "Invalid login or password".
  The seed script now passes `--env production` by default for
  remote seeds (`--env staging` for staging) and validates the name,
  matching what `deploy.mjs` already does. Found from a real
  production deploy attempt (Node 24.16.0, Wrangler 4.165.0).

## 1.0.0 — 2026-11-19 (Milestone 10: Production readiness)

**Tests: 417 passed, 4 skipped (421 total, 44 files).** Commit: `c1f1a16`
(pushed 2026-11-19).

- **First-administrator seed** (`npm run seed-admin`): interactive prompts
  or `--login/--email/--password/--confirm` flags; refuses when an
  administrator already exists; local D1 by default, `--remote` only
  after a successful `wrangler whoami` plus confirmation. Creates exactly
  the rows the users service creates (PBKDF2 `pbkdf2$100000$…` hash +
  `wp_capabilities` JSON). Closes the open M1–M9 gap: production login
  is now usable end-to-end. The installer offers to run it after local
  setup.
- **Block-pattern rendering (M5 gap closed):** `wp:pattern` blocks now
  render from the theme's `patterns/<name>.php` files. A new allowlisted
  evaluator (`src/modules/themes/pattern-php.ts`) handles the twelve
  i18n/escaping calls Twenty Twenty-Five actually uses (`__`, `_x`,
  `_e`, `esc_html__/_x/_e`, `esc_attr__/_x/_e`, `esc_url`,
  `get_template_directory_uri`, `printf` `%s`, `wp_kses_post`) with
  string literals only — no variables, no includes, no `eval`, nothing
  executed. Anything else refuses the pattern with a warning. Verified
  against the real Twenty Twenty-Five theme (see below).
- **Twenty Twenty-Five renders:** the theme's `home.html` (header/footer
  parts + `template-query-loop` pattern) now renders post titles and
  excerpts on the home page — in M5 it rendered nearly empty. One honest
  remainder: `get_template_directory_uri()` returns an empty string
  (theme-asset serving does not exist yet), so image `src` attributes
  built from it are empty and the renderer records one warning per page.
- **Installer wizard audit:** the Wrangler check now runs *after*
  dependency install (it previously ran first, so `npx` could download
  Wrangler from the network on a fresh clone); `--check-only` no longer
  triggers a download when `node_modules` is missing; the production
  path provisions the *production* environment (`wordless-prod` D1,
  `wordless-media-prod` R2, `CONFIG-prod` KV) into the `[env.production]`
  blocks and deploys with `--env production`; the wizard validates the
  staging/production sections in `wrangler.toml`.
- **Deploy scripts (dev/staging/prod):** `wrangler.toml` gains
  `[env.staging]` (`wordless-staging` / `wordless-media-staging`) and
  `[env.production]` (`wordless-prod` / `wordless-media-prod`) — production
  never shares the dev database or bucket names. `npm run deploy:staging`
  and `npm run deploy:production` run the pre-deploy checks (tests +
  build + setup check) and refuse without `--confirm`. Fixed a real bug
  in `scripts/deploy.mjs`: step 2 assigned to an undeclared `r`, which
  would have crashed every deploy in strict-mode ESM.
- **Guided install scripts refreshed:** `install.sh` / `install.ps1` now
  check for Node 20+ (not just presence) and pass arguments through to
  the wizard (`./install.sh --local`).
- **Release management:** this changelog, `docs/release.md` (tagging,
  release checklist, rollback via `wrangler rollback` / redeploying the
  previous commit), and the 1.0.0 version bump (`package.json` +
  `VERSION` in `src/index.ts`).
- **Final audit:** full regression green (all M1–M9 tests intact); the
  M9 smoke script re-run still passes 45/45; no hardcoded secrets
  anywhere in code, fixtures or docs; every compat list re-checked
  (WORDPRESS_COMPAT 45, AI_COMPAT 6, SEO_COMPAT 10, COMMERCE_COMPAT 8,
  INTEGRATIONS_COMPAT 6, SECURITY_COMPAT 7, PERFORMANCE_COMPAT 3,
  BACKUP_COMPAT 3, IMPORT_COMPAT 3) with three stale notes corrected
  (derivatives, cron runner, purge-on-publish import exception).
- **Screenshots:** 15 real screenshots at 1440×900 in
  `docs/screenshots/` (2.4 MB total), captured with headless Chromium
  against seeded demo content and linked from the README and the
  security/import/AI/SEO/commerce/theme docs. **The PNGs are binary and
  cannot travel with the snapshot push (UTF-8 text only) — they must be
  uploaded to the repo separately.**
- **Shop list description fix (found by the screenshots):** the shop
  list escaped the raw product description, so Gutenberg block comments
  showed as visible text. A new `plainTextExcerpt` helper renders the
  blocks first and strips the tags; the single product page already
  rendered blocks correctly. Covered by a new unit test and a shop-list
  regression test, and verified live in the M10 smoke test.

## 0.9.0 — 2026-11-19 (Milestone 9: Security + optimisation)

**Tests: 375 passed, 4 skipped (379 total, 41 files).**
Commit: `6f3f96ad14c173ea079738395f9cc867070ba137` (251 files).

- Security headers on every response (CSP, nosniff, X-Frame-Options DENY,
  Referrer-Policy, Permissions-Policy), including 401s.
- Login lockout (5 failed attempts in 15 min → 429), TOTP 2FA for admins
  (RFC 6238, 8 hashed recovery codes), session idle timeout (24 h),
  revoke-all-my-sessions, upload magic-byte sniffing.
- Security-scanner + performance-analyst agents wired to real checks.
- Edge-cache rules + purge on publish (API post create/update only);
  image derivatives via the Cloudflare Images binding when bound, honest
  "unavailable" when unbound; performance section in Site Health.
- Backup create/verify/restore: ZIP bundles in R2 with per-file SHA-256
  checksums, verification before a restore is allowed, typed `RESTORE`
  confirmation, retention of the 10 most recent.
- WordPress importer: WXR (real XML parser, authors/posts/comments/
  attachments with per-item report) + SQL dump (12 `wp_*` tables, safe
  PHP unserialize, phpass → forced password reset), proven against a
  synthetic fixture generated from the reference WordPress 7.1.5 source.

## 0.8.0 — 2026-11-19 (Milestone 8: Integrations + commerce)

**Tests: 326 passed, 4 skipped (330 total, 36 files).**
Commit: `c064be2845e99c2ab59ffa1229cc983c86a4fd44` (224 files).

- Integrations framework (8 integrations) with live configured/
  not-configured detection; secret-looking config rejected with a 400.
- Email: mock provider (logs, never claims delivery) + generic HTTP
  provider; wired into order confirmations, comment notifications,
  password resets.
- Payments: Paystack (HMAC-SHA512), Flutterwave (`verif-hash`), Stripe
  (HMAC-SHA256, 300 s tolerance) with real webhook verification + a
  deterministic test-mode mock; paid webhooks move orders pending → paid
  exactly once.
- E-commerce core: integer minor-unit prices (NGN default), server-side
  cart, checkout (503 with no provider — never a fake success), orders
  pending → paid → fulfilled / cancelled with exact-once stock movement.
- Public storefront (`/shop`, product, cart, test checkout), social share
  links, analytics config, marketplace skeleton (local-ZIP install).
- Commerce-assistant activated, reporting real store data.

## 0.7.0 — 2026-11-19 (Milestone 7: Content studio + SEO)

**Tests: 262 passed, 4 skipped (266 total, 33 files).**
Commit: `29ed33ce226bd628874bdc320b122e694a9aec82` (196 files).

- Per-post SEO fields (title ≤70, description ≤160, focus keyword,
  canonical, noindex, OG/Twitter) stored as `wp_postmeta`.
- Head rendering: title/meta/canonical/robots/OG/Twitter/JSON-LD
  (WebSite + Article + BreadcrumbList).
- Deterministic SEO analysis (9 checks without a keyword, 12 with one);
  the seo-auditor agent uses the same engine.
- Sitemap with changefreq/priority, image entries, index + pagination
  above 1,000 URLs; configurable robots.txt (blocking `/admin` or `/api`
  is rejected); redirect manager + 404 log (query strings stripped,
  capped at 500 paths).
- Content studio: editorial calendar, AI content ideas via the real
  content-writer task API, 3 content templates creating real drafts.
- Yoast / Rank Math metadata import (max 500 rows, per-row skip reasons).

## 0.6.0 — 2026-11-19 (Milestone 6: AI operating system)

**Tests: 236 passed, 4 skipped (240 total, 32 files).**
Commit: `e55d072354bc610df4bae1e78af1b333d8f74c73` (181 files).

- Provider abstraction: **Workers AI is the default and only required
  provider** (no extra key); OpenAI-compatible optional fallback;
  deterministic mock for tests/local dev; unconfigured providers report
  honestly.
- Orchestrator with three enforced modes (manual / supervised default /
  autonomous), approvals that apply through the existing services first,
  website memory (facts + notes, notes refuse secret-like text).
- 15 specialist agents (5 provider-based drafts-only, 9 deterministic
  measurement agents; commerce-assistant honestly unavailable until M8).
- AI command centre (`#/ai`) in the admin SPA.

## 0.5.0 — 2026-11-19 (Milestone 5: Themes + visual editor)

**Tests: 209 passed, 4 skipped (213 total, 30 files).**
Commit: `d0385de54c98132586182650484bd99d415ed6e9` (161 files).

- theme.json engine v1–v3 (v3 full; documented v2/v1 gaps), real CSS
  generation (preset vars, fluid `clamp()`).
- Theme registry + ZIP import (≤5 MB, traversal rejected), original
  Wordless default block theme, block-theme rendering with template
  hierarchy, customizer v1 (preview token + saved variations).
- Classic-theme conversion = M4 analyser report + CSS import.
- Twenty Twenty-Five verdict: imports cleanly, CSS generates, but pages
  rendered nearly empty — `wp:pattern` blocks were recorded, not
  rendered (closed in 1.0.0).

## 0.4.0 — 2026-11-19 (Milestone 4: Conversion engine spike)

**Tests: 176 passed, 4 skipped (180 total, 29 files).**
Commit: `f4c2c59fa23a10014a455d479bd1a2219bd9ce2d` (133 files).

- PHP lexer/parser/AST + TypeScript emitter with a safety checker
  (blocked constructs fail the job; no PHP is ever executed).
- Async conversion jobs; Hello Dolly converted end-to-end (3/3 functions,
  2/2 hooks, 0 unconverted, 0 warnings); generated extension checked in
  at `examples/hello-dolly/`.
- Akismet static analysis (29 files, 9 convertible / 16 partial /
  4 blocked) — report only, not converted.
- Compat registry grows to 41 functions.

## 0.3.0 — 2026-11-19 (Milestone 3: Admin + editor)

**Tests: 102 passed, 4 skipped (106 total).**
Commit: `412633967d1eb0f61b382bd931b14ddb51b6ad3f` (107 files).

- React admin SPA (Vite + React 18, hash routing, 12 pages on real APIs)
  served at `/admin` via Workers Static Assets.
- Block editor with lossless parse → serialize, including
  unknown-block preservation.
- Media library with real R2 uploads (10 MB cap, MIME allowlist),
  settings + users APIs/UI.

## 0.2.0 — 2026-11-19 (Milestone 2: Core CMS)

**Tests: 78 passed (78 total, 15 files).**
Commit: `59f1e0d01c18bfab618c403ea3e6987c6344dcd2` (77 files).

- Revisions/autosaves + restore, categories/tags, moderated comments,
  menus, LIKE-based search (not full-text), permalinks with 301 history.
- Public rendering with block support + sanitisation, RSS/sitemap/robots,
  Site Health, activity log. Public site at `/`, admin at `/admin`.

## 0.1.0 — 2026-11-19 (Milestone 1: Foundations)

**Tests: 29 passed (29 total, 5 files).**
Commit: `5edeb947381e13827dd2fd32c87bca72b7908735` (43 files).

- TypeScript-strict scaffold; kernel (typed hooks, router, errors,
  validation); D1 schema (12 `wp_*` + 6 `wl_*` tables); auth (PBKDF2,
  D1 sessions, 5 WordPress roles + capability map); posts/users/options
  APIs; installer wizard + deploy guard; compat registry stub
  (25 functions).
