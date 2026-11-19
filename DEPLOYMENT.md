# DEPLOYMENT.md — Deploying Wordless to Cloudflare (production)

Production deployment is a deliberate, confirmed action — never automatic.
There are two supported routes, both guarded:

| Route | Command | Guard |
|---|---|---|
| Installer production path | `npm run setup`, choose **2** | Choice + per-step confirmation |
| Deploy script (production) | `npm run deploy:production` | `--confirm` flag **and** `wrangler whoami` + pre-deploy checks (tests + build + setup check) |
| Deploy script (staging) | `npm run deploy:staging` | Same guards, `--env staging` |
| Deploy script (default env) | `npm run deploy -- --confirm` | Same guards, no `--env` |

A plain `npm run deploy` (no `--confirm`) **refuses to deploy**.

## Prerequisites

- A Cloudflare account (free tier is enough for Milestone 1).
- No API token needed for the interactive flow: `wrangler login` uses the
  official browser OAuth flow. This project **never** asks for or stores
  Cloudflare passwords or API tokens. (CI-style token deploys are a later
  addition; see `.env.example` for the optional `CLOUDFLARE_ACCOUNT_ID`.)

## What deployment does

1. **Pre-deploy checks** (deploy script only) — `npm test`, `npm run
   build`, `npm run setup -- --check-only`. Any failure stops the deploy.
2. **Login check** — `npx wrangler login`, then `npx wrangler whoami` must
   succeed.
3. **Provisioning** (only if the ids in the `[env.production]` blocks of
   `wrangler.toml` are still the `REPLACE-ME` placeholders, and only with
   your confirmation):
   - `wrangler d1 create wordless-prod` → id written into `[env.production]`
   - `wrangler r2 bucket create wordless-media-prod`
   - `wrangler kv namespace create CONFIG-prod` → id written into `[env.production]`
4. **Build** — `npm run build` (admin SPA + worker typecheck).
5. **Remote migrations** — `wrangler d1 migrations apply DB --remote --env production`
   (applies all migrations in `migrations/` to the real D1 database).
6. **Deploy** — `wrangler deploy --env production` (bundles `src/index.ts` + Static Assets).
7. **Verify** — fetches `<deployed-url>/api/health` and reports the URL.
   Deployment is only reported as successful if the health check returns ok.
8. **First administrator** — seed one on the deployed site:
   `npm run seed-admin -- --remote` (refuses when an admin already exists).

## After deployment

- Your site lives at the printed `https://wordless-prod.<subdomain>.workers.dev`
  URL (or your custom domain once configured — a later milestone).
- Check logs: `npx wrangler tail`
- Check D1: `npx wrangler d1 execute DB --remote --env production --command "SELECT count(*) FROM wp_posts;"`
- Sign in at `/admin` with the seeded administrator.

## Environments

| Environment | Worker | Database | R2 bucket | Command |
|---|---|---|---|---|
| Local dev | `wordless` (local) | Wrangler local D1 (`.wrangler/state/`) | local R2 emulation | `npm run dev` |
| Staging | `wordless-staging` | Cloudflare D1 `wordless-staging` | `wordless-media-staging` | `npm run deploy:staging` |
| Production | `wordless-prod` | Cloudflare D1 `wordless-prod` | `wordless-media-prod` | `npm run deploy:production` |

Promotion path: **dev → staging → production**. Deploy a release to
staging first, verify `/api/health` and the admin there, then deploy the
same commit to production. Production never shares the dev database or
bucket names.

## Costs (verify at deploy time)

Milestone 1 runs inside Cloudflare's free tier on paper (Workers 100k
req/day, D1 5M rows read/day, R2 10 GB storage). Nothing in this document
promises "free" or "unlimited" — re-check
https://developers.cloudflare.com/ before relying on a limit, and expect a
paid plan ($5/mo Workers Paid) to be the documented escape hatch if CPU or
usage grows (see `../docs/02-architecture.md` §9).

## Rollback

Migrations are additive (`CREATE TABLE IF NOT EXISTS`, new nullable
columns), so a rollback never needs a down-migration. Two supported
paths — full procedure in [docs/release.md](docs/release.md):

```bash
# Fastest: restore the previous deployment
npx wrangler rollback --env production

# Or redeploy the previous good commit
git log --oneline -5        # find the last good commit
git checkout <commit>
npm run deploy:production
git checkout main
```

After any rollback, verify `/api/health` reports the expected version.
If the bad deploy wrote bad *data* (not just code), restore from a
backup instead (admin Backup page → verify → restore with the typed
`RESTORE` confirmation). Never hand-edit the production database.
