# Release procedure — Wordless

Wordless 1.0.0 is the first tagged release. Releases are cut from `main`
on GitHub (`ola1de/Wordless-CMS`). This repo is pushed via the snapshot
procedure (no git metadata in the dev VM), so tagging happens on GitHub
after the push — the steps below assume the milestone commit is already
on `main` and verified by read-back.

## Cutting a release

1. **Verify first.** The milestone must already be green locally before
   it is pushed: `npm test`, `npm run build`,
   `npm run setup -- --check-only`, and the milestone's `wrangler dev`
   smoke test all passing, with the local D1 cleaned afterwards. Never
   push a milestone the parent has not independently re-verified.
2. **Bump the version.** `package.json` (`"version"`) and the `VERSION`
   constant in `src/index.ts` must match. Patch for fixes, minor for a
   milestone, major for a breaking change (1.0.0 is the first major).
3. **Update CHANGELOG.md.** One section per release: what shipped, the
   final test count, and the commit SHA (filled in after the push — write
   "*pending push*" before it, never invent a SHA).
4. **Push** via the snapshot procedure and verify by reading the commit
   back from GitHub.
5. **Tag the release** (on GitHub web UI or a local clone):
   ```bash
   git clone https://github.com/ola1de/Wordless-CMS.git
   cd Wordless-CMS
   git tag -a v1.0.0 -m "Wordless 1.0.0 — production readiness (M10)"
   git push origin v1.0.0
   ```
   Then create the GitHub Release from the tag, pasting the CHANGELOG
   section as the release notes.
6. **Announce the honest limits.** The release notes must carry the
   "What is NOT verified / NOT done" list from the README — a release
   never claims a live deployment, live Workers AI calls, live payment
   verification, or universal plugin compatibility that was not
   demonstrated.

## Release checklist (before tagging)

- [ ] `npm test` green with all previous milestones' tests intact
      (417 passed / 4 skipped at 1.0.0 — the count must not drop).
- [ ] `npm run build` green (admin Vite + worker tsc + admin tsc).
- [ ] `npm run setup -- --check-only` green.
- [ ] Smoke test for the milestone green, local D1 clean, port free.
- [ ] `CHANGELOG.md` updated; version bumped in both places.
- [ ] README "Status" line names the new version and milestone.
- [ ] No hardcoded secrets in code, fixtures, or docs (grep before push).
- [ ] Compat lists re-checked against implemented behaviour.

## Environments and promotion

| Environment | Worker name | D1 database | R2 bucket | Deploy |
|---|---|---|---|---|
| Local dev | `wordless` (local) | Wrangler local D1 | local R2 emulation | `npm run dev` |
| Staging | `wordless-staging` | `wordless-staging` | `wordless-media-staging` | `npm run deploy:staging` |
| Production | `wordless-prod` | `wordless-prod` | `wordless-media-prod` | `npm run deploy:production` |

Promotion path: **dev → staging → production**. Deploy a milestone to
staging first, verify `/api/health` and the admin there, then deploy the
same commit to production. Production never shares the dev database or
bucket names. Every deploy runs the pre-deploy checks (tests + build +
setup check) and refuses without `--confirm`.

## Rolling back a bad deploy

Migrations are additive only (`CREATE TABLE IF NOT EXISTS`, new nullable
columns), so a rollback never needs a down-migration. Two supported
paths:

**1. `wrangler rollback` (fastest — restores the previous deployment):**
```bash
npx wrangler rollback --env production   # or --env staging
curl https://<your-worker>.workers.dev/api/health   # verify version
```

**2. Redeploy the previous good commit:**
```bash
git log --oneline -5        # find the last good commit
git checkout <commit>
npm run deploy:production   # tests + build + checks run again
git checkout main
```

After any rollback, verify `/api/health` reports the expected version
and spot-check the admin (`/admin`) and one public page. If the bad
deploy wrote bad *data* (not just code), restore from a backup instead:
admin Backup page → verify the backup → restore with the typed
`RESTORE` confirmation (see `docs/security/security.md` / the backup
docs). Never hand-edit the production database.
