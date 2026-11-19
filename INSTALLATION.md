# INSTALLATION.md — Installing Wordless from GitHub

Wordless is distributed through GitHub. You clone the repository, run the
installer, and develop locally with **no Cloudflare account and no global
Wrangler install**. Wrangler is a project devDependency — `npx` runs the
local copy.

## Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| Node.js | 20+ | Check with `node --version` |
| npm | ships with Node | Check with `npm --version` |
| Git | any recent | For cloning |
| Cloudflare account | — | Only for production (see DEPLOYMENT.md) |

No PHP, no MySQL, no Apache/Nginx, no VPS. Wordless never runs PHP in
production.

## Steps

```bash
git clone https://github.com/ola1de/Wordless-CMS.git
cd Wordless-CMS
npm install
npm run setup
```

### What the wizard does

1. **Environment checks** — Node >= 20, npm present. Fails with a
   clear message if anything is missing.
2. **Configuration validation** — `wrangler.toml` must exist and declare the
   `DB` (D1), `MEDIA` (R2) and `CONFIG` (KV) bindings plus the
   `[env.staging]` / `[env.production]` sections. Placeholder ids
   (`REPLACE-ME`) are expected and fine for local work.
3. **Dependencies** — runs `npm install` if `node_modules/` is missing.
4. **Wrangler** — the project-managed Wrangler runs (`npx wrangler
   --version`); no global install is needed or used.
5. **Local database** — applies all migrations to Wrangler's
   local D1 (a SQLite file under `.wrangler/state/`). No account, no
   network call to Cloudflare.
6. **Admin SPA** — builds the React admin (`npm run build:admin`).
7. **First administrator (offered)** — the wizard offers to run
   `npm run seed-admin` so you can sign in at `/admin`. It refuses
   when an administrator already exists.
8. **Choice** — local development (prints/offers `npm run dev`) or
   production Cloudflare deploy (only with your explicit choice and
   confirmation at every remote step; provisions the `wordless-prod`
   D1 database, `wordless-media-prod` R2 bucket and `CONFIG-prod` KV
   namespace into the `[env.production]` blocks).

### Shortcuts

```bash
npm run setup -- --check-only   # checks + validation only; nothing installed
npm run setup -- --local        # non-interactive local path (no prompts,
                                # no dev server auto-start)
./install.sh                     # macOS/Linux wrapper (npm install + setup)
.\install.ps1                    # Windows PowerShell wrapper
```

## Running locally

```bash
npm run dev
```

Open http://localhost:8787/ for the public site,
http://localhost:8787/admin for the React admin and
http://localhost:8787/api/health for the API health check. `wrangler dev`
serves the Worker with local D1/R2/KV emulation.

## Environment variables

None are required for local development. `.env.example` documents the
optional variables (Cloudflare account id for production, AI/email/
payment provider keys). Copy it to `.env` only if you need one —
`.env` is git-ignored, `.env.example` is safe to commit. Secrets for a
deployed Worker are set with `wrangler secret put <NAME>`, never in a
file.

## First administrator

The admin UI cannot create the first administrator (creating users
requires an admin), so seed one after setup:

```bash
npm run seed-admin
```

Interactive prompts (password hidden) or flags:
`npm run seed-admin -- --login admin --email you@example.com`.
It refuses when an administrator already exists. For a deployed site:
`npm run seed-admin -- --remote` (needs `wrangler whoami` first).

## Verifying your install

```bash
npm test        # 416 tests, in-memory SQLite (never a live D1)
npm run build   # admin SPA build + tsc --noEmit, strict mode
```

## Updating

```bash
git pull
npm install
npm run setup -- --local   # re-applies local migrations
```

## Uninstalling

Delete the cloned directory. Local D1 state lives inside it under
`.wrangler/`; nothing is installed globally and no system files are touched.
