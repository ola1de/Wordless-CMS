#!/usr/bin/env node
/**
 * WORDLESS production deploy guard (Milestone 10).
 *
 * Usage:
 *   npm run deploy -- --confirm [--env staging|production]
 *   npm run deploy:staging      (same as above with --env staging)
 *   npm run deploy:production   (same as above with --env production)
 *
 * Deliberately refuses to deploy without BOTH:
 *   1. the --confirm flag (a plain `npm run deploy` never deploys), and
 *   2. a successful `npx wrangler whoami` (proves a Cloudflare login exists).
 *
 * Before touching Cloudflare it runs the pre-deploy checks: the full
 * test suite, the build (worker + admin SPA) and `npm run setup
 * -- --check-only`. Any failure stops the deploy.
 *
 * Environments: --env staging deploys the `wordless-staging` Worker with
 * the wordless-staging D1 database and wordless-media-staging R2 bucket;
 * --env production deploys `wordless-prod` with the wordless-prod
 * database and wordless-media-prod bucket. Without --env it deploys the
 * default (top-level) configuration. Production never shares the dev
 * database or bucket names (see wrangler.toml).
 *
 * Then: remote D1 migrations for that environment → `wrangler deploy
 * --env <name>` → verify /api/health on the deployed URL and print it.
 * No credentials are read, stored or printed.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARGS = process.argv.slice(2);
const KNOWN_ENVS = new Set(["staging", "production"]);

function fail(msg) {
  console.error(`\n  ✗ ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function log(msg = "") {
  console.log(msg);
}

/** Quote one argument for a Windows shell command line (MSVC rules). */
function quoteArg(arg) {
  if (arg === "") return '""';
  if (!/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") { backslashes++; continue; }
    if (ch === '"') { out += "\\".repeat(backslashes * 2 + 1) + '"'; backslashes = 0; continue; }
    out += "\\".repeat(backslashes) + ch;
    backslashes = 0;
  }
  out += "\\".repeat(backslashes * 2) + '"';
  return out;
}

function run(cmd, args, { stdio = "pipe" } = {}) {
  // On Windows, npm/npx are .cmd shims and Node cannot spawn them without
  // a shell (ENOENT for `npm`, EINVAL for `npm.cmd` — confirmed on a real
  // Windows install). Run through cmd.exe on Windows, quoting arguments
  // first: with shell:true Node concatenates args unescaped (see DEP0190),
  // so values with spaces (e.g. Windows paths) need quoting to survive.
  const useShell = process.platform === "win32";
  const finalArgs = useShell ? args.map(quoteArg) : args;
  const result = spawnSync(cmd, finalArgs, { cwd: ROOT, stdio, encoding: "utf8", shell: useShell });
  return { ok: result.status === 0, code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Read a --flag value (or null when absent). */
function flag(name) {
  const i = ARGS.indexOf(name);
  return i >= 0 && i + 1 < ARGS.length ? ARGS[i + 1] : null;
}

async function main() {
  if (ARGS.includes("--help") || ARGS.includes("-h")) {
    log("Usage: npm run deploy -- --confirm [--env staging|production]");
    log("  npm run deploy:staging     deploy to staging");
    log("  npm run deploy:production  deploy to production");
    log("  Pre-deploy checks (tests + build + setup check) run first.");
    log("  Requires a Cloudflare login (`npx wrangler login`) first.");
    return;
  }
  if (!ARGS.includes("--confirm")) {
    fail(
      "Refusing to deploy: re-run with --confirm\n" +
        "  npm run deploy -- --confirm [--env staging|production]\n" +
        "  (A plain `npm run deploy` never deploys.)",
    );
  }
  const env = flag("--env");
  if (env !== null && !KNOWN_ENVS.has(env)) {
    fail(`Unknown environment "${env}". Use --env staging or --env production (or omit --env for the default configuration).`);
  }
  const envLabel = env ?? "default";
  const envArgs = env !== null ? ["--env", env] : [];

  log(`  Deploying to environment: ${envLabel}`);

  log("\n  0. Pre-deploy checks (tests + build + setup check)");
  let r = run("npm", ["test"], { stdio: "inherit" });
  if (!r.ok) fail("`npm test` failed. Fix the failing tests before deploying.");
  ok("Tests pass");
  r = run("npm", ["run", "build"], { stdio: "inherit" });
  if (!r.ok) fail("`npm run build` failed (worker typecheck and/or admin build). Fix the errors and retry.");
  ok("Build passed (worker + admin SPA)");
  r = run("npm", ["run", "setup", "--", "--check-only"], { stdio: "inherit" });
  if (!r.ok) fail("`npm run setup -- --check-only` failed. Fix the configuration and retry.");
  ok("Setup check passed");

  log("\n  1. Cloudflare login check");
  const whoami = run("npx", ["wrangler", "whoami"]);
  if (!whoami.ok) {
    fail("Not logged in to Cloudflare (`wrangler whoami` failed). Run `npx wrangler login` first — see DEPLOYMENT.md.");
  }
  ok(`Logged in to Cloudflare:\n${whoami.stdout.trim().split("\n").map((l) => `     ${l}`).join("\n")}`);

  log(`\n  2. Remote D1 migrations (${envLabel})`);
  r = run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", ...envArgs], { stdio: "inherit" });
  if (!r.ok) fail("Remote D1 migrations failed. See TROUBLESHOOTING.md.");
  ok("Remote D1 migrations applied");

  log(`\n  3. Deploy (${envLabel})`);
  r = run("npx", ["wrangler", "deploy", ...envArgs]);
  if (!r.ok) fail("`wrangler deploy` failed. Check the output above and TROUBLESHOOTING.md.");
  const urlMatch = (r.stdout + r.stderr).match(/https:\/\/[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.workers\.dev/);
  const url = urlMatch ? urlMatch[0] : null;
  if (!url) {
    fail("Deploy reported success but no workers.dev URL was found in the output. Run `npx wrangler deploy` and check the printed URL.");
  }
  ok(`Deployed to ${url}`);

  log("\n  4. Verify");
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15000) });
    const body = await res.json();
    if (res.ok && body.ok) {
      ok(`Live check passed: ${url}/api/health returned ok (version ${body.data?.version ?? "?"})`);
    } else {
      fail(`Deployed, but /api/health returned HTTP ${res.status}. Check the Worker logs with \`npx wrangler tail\`.`);
    }
  } catch (err) {
    fail(`Deployed, but /api/health could not be reached (${err.message}). Check the URL and Worker logs.`);
  }

  log(`\n  ✓ Wordless is live (${envLabel}) at ${url}`);
  if (env === "production") {
    log("  First login: seed the administrator with `npm run seed-admin -- --remote`.");
  }
}

main().catch((err) => {
  console.error(`\n  ✗ Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
