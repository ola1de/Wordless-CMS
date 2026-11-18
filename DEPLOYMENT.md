# DEPLOYMENT.md — Deploying Wordless to Cloudflare (production)

Production deployment is a deliberate, confirmed action — never automatic.
There are two supported routes, both guarded:

| Route | Command | Guard |
|---|---|---|
| Installer production path | `npm run setup`, choose **2** | Choice + per-step confirmation |
| Deploy script | `npm run deploy -- --confirm` | `--confirm` flag **and** `wrangler whoami` |

A plain `npm run deploy` (no `--confirm`) **refuses to deploy**.

## Prerequisites

- A Cloudflare account (free tier is enough for Milestone 1).
- No API token needed for the interactive flow: `wrangler login` uses the
  official browser OAuth flow. This project **never** asks for or stores
  Cloudflare passwords or API tokens. (CI-style token deploys are a later
  addition; see `.env.example` for the optional `CLOUDFLARE_ACCOUNT_ID`.)

## What deployment does

1. **Login check** — `npx wrangler login`, then `npx wrangler whoami` must
   succeed.
2. **Provisioning** (only if the ids in `wrangler.toml` are still the
   `REPLACE-ME` placeholders, and only with your confirmation):
   - `wrangler d1 create wordless` → id written into `wrangler.toml`
   - `wrangler r2 bucket create wordless-media`
   - `wrangler kv namespace create CONFIG` → id written into `wrangler.toml`
3. **Remote migrations** — `wrangler d1 migrations apply DB --remote`
   (applies `migrations/0001_init.sql` to the real D1 database).
4. **Deploy** — `wrangler deploy` (bundles `src/index.ts`).
5. **Verify** — fetches `<deployed-url>/api/health` and reports the URL.
   Deployment is only reported as successful if the health check returns ok.

## After deployment

- Your site lives at the printed `https://wordless.<subdomain>.workers.dev`
  URL (or your custom domain once configured — a later milestone).
- Check logs: `npx wrangler tail`
- Check D1: `npx wrangler d1 execute DB --remote --command "SELECT count(*) FROM wp_posts;"`
- **Known gap (M1):** there is no admin-user seed command yet. Creating the
  first administrator is a Phase 3 task; until then, production login is
  not usable end-to-end. Do not hand-edit the production database to work
  around this — wait for the seed tooling.

## Environments

| Environment | Database | Command |
|---|---|---|
| Local dev | Wrangler local D1 (`.wrangler/state/`) | `npm run dev` |
| Production | Cloudflare D1 `wordless` | `npm run deploy -- --confirm` |

Staging is a later milestone (same commands, separate Worker name/DB).

## Costs (verify at deploy time)

Milestone 1 runs inside Cloudflare's free tier on paper (Workers 100k
req/day, D1 5M rows read/day, R2 10 GB storage). Nothing in this document
promises "free" or "unlimited" — re-check
https://developers.cloudflare.com/ before relying on a limit, and expect a
paid plan ($5/mo Workers Paid) to be the documented escape hatch if CPU or
usage grows (see `../docs/02-architecture.md` §9).

## Rollback

M1 has no automated rollback. To roll back a bad deploy, redeploy the
previous good commit:

```bash
git log --oneline -5        # find the last good commit
git checkout <commit>
npm run deploy -- --confirm
git checkout main
```

Database migrations are additive in M1 (`CREATE TABLE IF NOT EXISTS`);
there is no down-migration yet.
