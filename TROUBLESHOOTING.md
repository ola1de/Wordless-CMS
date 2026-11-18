# TROUBLESHOOTING.md — Common failures and fixes

## Node too old

**Symptom:** the installer fails with `Node.js 20 or newer is required`, or
`node:sqlite` / `crypto` errors during tests.

**Fix:** install Node.js 20 or newer from https://nodejs.org/ (LTS
recommended), then check `node --version` and re-run `npm run setup`.
Wordless uses Node 24's built-in SQLite for tests and the global WebCrypto
APIs — older Node versions cannot run them.

## `npm install` fails

**Symptom:** network errors, `ERESOLVE` peer-dependency conflicts, or
permission errors.

**Fixes:**
- Check your network connection and try again (`npm install` is retry-safe).
- Do **not** use `--force` or `--legacy-peer-deps` as a habit: the pinned
  versions in `package.json` resolve cleanly. If you see an `ERESOLVE`
  conflict, report it — it means a dependency range drifted (this happened
  once during M1: Wrangler 4.165 requires `@cloudflare/workers-types` v5).
- Permission errors on macOS/Linux: never `sudo npm install`. Fix npm's
  directory permissions (`npm config get prefix`) or use a Node version
  manager (nvm, fnm, Volta).
- Corporate proxy: set `npm config set proxy` / `https-proxy` as your
  network requires; the installer itself makes no network calls beyond npm.

## `wrangler login` issues

**Symptom:** the browser does not open, login times out, or `wrangler
whoami` fails afterwards.

**Fixes:**
- The installer uses the official `wrangler login` browser OAuth flow.
  If no browser opens, copy the URL Wrangler prints into a browser manually.
- In headless/SSH environments the browser flow cannot complete — run the
  login step from a machine with a browser, or set up a Cloudflare API token
  (see Cloudflare docs) and re-run the deploy guard.
- **Never** paste a Cloudflare password or API token into the installer,
  chat, or any file in this repo. The installer never asks for one.
- After a successful login, verify with `npx wrangler whoami` before
  deploying.

## Local D1 errors

**Symptom:** `wrangler d1 migrations apply DB --local` fails, or
`npm run dev` reports a D1 binding error.

**Fixes:**
- Check `wrangler.toml` contains the `[[d1_databases]]` block with
  `binding = "DB"` and `migrations_dir = "migrations"`. Run
  `npm run setup -- --check-only` to validate it.
- The `database_id = "REPLACE-ME"` placeholder is **expected** for local
  work — local D1 does not need a real id. Do not replace it by hand for
  local development; the installer fills it in during production setup.
- Corrupt local state: stop the dev server and delete `.wrangler/state/`,
  then re-run `npm run setup -- --local` to re-apply migrations.
- `database is locked` errors: another `wrangler dev` is still running —
  stop it and retry.

## Port in use

**Symptom:** `npm run dev` fails with `EADDRINUSE` or "address already in
use" (default port 8787).

**Fixes:**
- Stop the other dev server, or run on a different port:
  `npx wrangler dev --port 8788`
- Find the process: `lsof -i :8787` (macOS/Linux) or
  `netstat -ano | findstr :8787` (Windows), then stop it.

## Tests fail

**Symptom:** `npm test` reports failures.

**Fixes:**
- Run `npm install` first — a stale `node_modules` is the usual cause.
- Tests use Node's built-in `node:sqlite` and need Node 20+ (see above).
- Tests never touch a live D1 or the network. If a failure mentions
  Cloudflare, D1, or a remote host, something is misconfigured — report it
  rather than working around it.

## `npx wrangler` is slow or hangs

**Symptom:** the first `npx wrangler` invocation takes a long time.

**Fix:** the first run downloads Wrangler's binary bits; later runs are fast.
If it hangs for more than a few minutes, check your network and retry. Do
not install Wrangler globally — the project-managed version is the supported
one.

## Still stuck?

Run `npm run setup -- --check-only` and copy its full output, plus the exact
command and error message, into a GitHub issue. Do not paste secrets,
tokens, or `.env` contents.
