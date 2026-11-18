# WORDLESS

**The autonomous website operating system.**

Wordless is an independent, PHP-independent, WordPress-compatible content
management system and website operating system. It rebuilds the core of
WordPress — posts, pages, users, roles, options, media, hooks, REST-style
APIs — in TypeScript on Cloudflare Workers, D1 and R2, and adds an
autonomous AI command layer on top (later milestones).

One platform. One intelligent command centre. Complete website management.

> **Status: Milestone 1 — Foundations (in development).** The kernel, D1
> schema, auth, posts/users/options/media APIs, compat registry and admin
> shell are built and tested. The conversion engine, AI agents, visual
> editor, commerce and integrations are **not built yet** — see
> [What M1 is not](#what-milestone-1-is-not) below. Nothing unfinished is
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
npm run dev     # local dev server → http://localhost:8787/
npm test        # Vitest suite (in-memory SQLite, never a live D1)
npm run build   # typecheck (tsc --noEmit)
```

## Two paths

| | Local development | Production |
|---|---|---|
| Cloudflare account | Not needed | Required (free tier works) |
| Database | Wrangler local D1 (SQLite file under `.wrangler/`) | Cloudflare D1 `wordless` |
| Media | Stub in M1 (records only, no uploads yet) | R2 `wordless-media` (wired in M2) |
| Command | `npm run dev` | `npm run deploy -- --confirm` |
| Details | [INSTALLATION.md](INSTALLATION.md) | [DEPLOYMENT.md](DEPLOYMENT.md) |

## Project layout

```
src/
  index.ts            Worker entry: fetch handler + route table
  env.ts              Env bindings (DB / MEDIA / CONFIG) — no secrets
  db.ts               D1 wrapper (bound params only)
  admin-shell.ts      Admin shell (calls the real /api/* endpoints)
  kernel/             hooks · router · errors · validation
  modules/
    posts/            posts/pages CRUD, slug generation, statuses
    users/            users, PBKDF2 passwords, roles + capabilities
    options/          get/set/add/delete (JSON values)
    media/            attachment records; R2 behind a STUB interface
    auth/             opaque sessions in D1 (revocable, expiring)
  compat/
    wordpress.ts      25-function WP registry, honestly tagged
  test/
    test-db.ts        in-memory SQLite test helper (tests only)
migrations/
  0001_init.sql       D1 schema v1: 12 wp_* tables + 6 wl_* tables
scripts/
  install.mjs         installer wizard (Node built-ins only)
  deploy.mjs          production deploy guard
```

## API (Milestone 1)

All responses use the envelope `{ ok, data, error }`.

| Route | Auth | Description |
|---|---|---|
| `GET /api/health` | — | `{ status: "ok", version, time }` |
| `GET /api/posts` | — | List posts (`?status=&type=&page=&per_page=`, max 100) |
| `POST /api/posts` | `edit_posts` | Create a post |
| `GET /api/posts/:slug` | —* | Get one post by slug |
| `POST /api/auth/login` | — | `{ login, password }` → session cookie |
| `POST /api/auth/logout` | — | Revoke the session |
| `GET /api/options/:key` | logged in | Read one option |
| `GET /` | — | Admin shell (calls the real API, no fake data) |

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
- WordPress compat registry: 25 core function names, each tagged
  `full` / `partial` / `stub` — 6 full (hooks), 18 partial, 1 stub
  (`register_rest_route`, recorded but not mounted).
- Admin shell that calls the real API.
- Installer wizard + deploy guard; no global Wrangler, no Cloudflare
  account for local work.
- 29 tests, all passing; `tsc --noEmit` clean under `strict`.

## What Milestone 1 is not

- **Not a full CMS yet.** No visual editor, no themes, no menus, no comments
  UI, no revisions, no import/export, no search UI.
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

Milestone 1 is a foundation, not a finished product. See the roadmap in
`../docs/` (phases 1–10). Do not mark unfinished features as complete, do
not commit secrets, and keep every stub labelled `STUB` until it is real.
