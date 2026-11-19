#!/usr/bin/env node
/**
 * WORDLESS production deploy guard.
 *
 * Usage:
 *   npm run deploy -- --confirm
 *
 * Deliberately refuses to deploy without BOTH:
 *   1. the --confirm flag (a plain `npm run deploy` never deploys), and
 *   2. a successful `npx wrangler whoami` (proves a Cloudflare login exists).
 *
 * Then: remote D1 migrations → `wrangler deploy` → verify /api/health on
 * the deployed URL and print it. No credentials are read, stored or printed.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARGS = new Set(process.argv.slice(2));

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

function run(cmd, args, { stdio = "pipe" } = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio, encoding: "utf8", shell: false });
  return { ok: result.status === 0, code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function main() {
  if (ARGS.has("--help") || ARGS.has("-h")) {
    log("Usage: npm run deploy -- --confirm");
    log("  Applies remote D1 migrations, deploys the Worker, verifies /api/health.");
    log("  Requires a Cloudflare login (`npx wrangler login`) first.");
    return;
  }
  if (!ARGS.has("--confirm")) {
    fail("Refusing to deploy: re-run with --confirm\n  npm run deploy -- --confirm\n  (A plain `npm run deploy` never deploys.)");
  }

  log("  1. Cloudflare login check");
  const whoami = run("npx", ["wrangler", "whoami"]);
  if (!whoami.ok) {
    fail("Not logged in to Cloudflare (`wrangler whoami` failed). Run `npx wrangler login` first — see DEPLOYMENT.md.");
  }
  ok(`Logged in to Cloudflare:\n${whoami.stdout.trim().split("\n").map((l) => `     ${l}`).join("\n")}`);

  log("\n  2. Build (worker + admin SPA)");
  r = run("npm", ["run", "build"], { stdio: "inherit" });
  if (!r.ok) fail("`npm run build` failed (worker typecheck and/or admin build). Fix the errors and retry.");
  ok("Build passed (worker + admin SPA)");

  log("\n  3. Remote D1 migrations");
  let r = run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote"], { stdio: "inherit" });
  if (!r.ok) fail("Remote D1 migrations failed. See TROUBLESHOOTING.md.");
  ok("Remote D1 migrations applied");

  log("\n  4. Deploy");
  r = run("npx", ["wrangler", "deploy"]);
  if (!r.ok) fail("`wrangler deploy` failed. Check the output above and TROUBLESHOOTING.md.");
  const urlMatch = (r.stdout + r.stderr).match(/https:\/\/[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.workers\.dev/);
  const url = urlMatch ? urlMatch[0] : null;
  if (!url) {
    fail("Deploy reported success but no workers.dev URL was found in the output. Run `npx wrangler deploy` and check the printed URL.");
  }
  ok(`Deployed to ${url}`);

  log("\n  5. Verify");
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

  log(`\n  ✓ Wordless is live at ${url}`);
}

main().catch((err) => {
  console.error(`\n  ✗ Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
