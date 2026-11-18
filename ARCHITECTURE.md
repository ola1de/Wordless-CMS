# WORDLESS — Architecture (Milestone 1 summary)

The full design lives in `../docs/02-architecture.md` (system diagram,
technology choices with reasons, D1 schema v1, kernel, module boundaries,
public rendering, conversion engine, AI operating system, limits-driven
design rules and the decisions log). That document is the authority; this
file is a one-page pointer plus the Milestone 1 module map.

## Stack

- **Runtime:** Cloudflare Workers (TypeScript, no PHP anywhere in production)
- **Database:** Cloudflare D1 (SQLite) — 12 WordPress-shaped `wp_*` tables + `wl_*` tables
- **Storage:** Cloudflare R2 (media objects — interface only in M1, see below)
- **Config:** Cloudflare KV (rare reads; never secrets)
- **Admin:** static shell in M1 (`src/admin-shell.ts`); React admin arrives in Phase 3
- **Tests:** Vitest + Node 24 `node:sqlite` (D1 is SQLite, so schema + SQL tests run locally)

## Milestone 1 module map

```
src/index.ts            Worker entry: fetch handler, route table, session resolution
src/env.ts              Env bindings (DB / MEDIA / CONFIG) — no secrets
src/db.ts               D1 wrapper (bound params only) + adaptD1()
src/kernel/
  hooks.ts              Typed action/filter system (WP plugin.php semantics, sync)
  router.ts             Method+pattern router, role guards, { ok, data, error } envelope
  errors.ts             WordlessError(code, status); stubs throw 501
  validate.ts           requireString / slug / int range / email helpers
src/modules/
  posts/                create/get/list/update/trash/restore/delete; slug generation
  users/                create/get, PBKDF2 passwords, roles + capability map
  options/              get/set/add/delete (JSON values, not PHP-serialized)
  media/                attachment records in wp_posts; R2 is a STUB interface
  auth/                 opaque sessions in wl_sessions (SHA-256 token hash)
src/compat/
  wordpress.ts          25-function WP registry (full/partial/stub, honestly tagged)
src/test/test-db.ts     In-memory SQLite + migration runner (tests only)
migrations/0001_init.sql  D1 schema v1 (12 wp_* + 6 wl_* tables)
scripts/
  install.mjs           Interactive installer wizard (Node built-ins only)
  deploy.mjs            Production deploy guard (--confirm + whoami required)
```

## Key decisions (see `../docs/02-architecture.md` §10 for the log)

- D1 over KV/Durable Objects for relational data; sessions in D1, not JWT-only.
- Passwords: PBKDF2 via WebCrypto. WordPress phpass hashes are NOT portable —
  imported users get a forced password reset.
- Options/meta values are JSON, not PHP-serialized strings.
- Every stub throws a `STUB` 501 and is listed in README.md — nothing is faked.
