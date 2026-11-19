#!/usr/bin/env node
/**
 * WORDLESS installer wizard — interactive setup for a GitHub clone.
 *
 * Node built-ins only (no new dependencies). Usage:
 *   npm run setup                  Interactive wizard (local or production)
 *   npm run setup -- --local       Non-interactive local path (no prompts)
 *   npm run setup -- --check-only  Checks + validation only, no installs
 *
 * Local path needs NO Cloudflare account: dependencies install from npm,
 * D1 migrations apply against Wrangler's local SQLite emulation.
 *
 * Production path runs ONLY when the user explicitly chooses it, and every
 * remote step asks for confirmation first. Cloudflare auth uses the official
 * `wrangler login` browser OAuth flow — this script NEVER asks for, stores,
 * or prints passwords, API tokens or secrets.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARGS = new Set(process.argv.slice(2));
const CHECK_ONLY = ARGS.has("--check-only");
const LOCAL_ONLY = ARGS.has("--local");

const BANNER = `
 __        __   ___   ____   ____   _     _____ ____  ____
 \\ \\      / /  / _ \\ |  _ \\ |  _ \\ | |   | ____/ ___|/ ___|
  \\ \\ /\\ / /  | | | | |_) | | | | | |   |  _| \\___ \\\\___ \\
   \\ V  V /   | |_| |  _ <  | |_| | |___| |___ ___) |___) |
    \\_/\\_/     \\___/ |_| \\_\\ |____/|_____|_____|____/|____/

  The autonomous website operating system — Version 1.0.0
`;

function log(msg = "") {
  console.log(msg);
}
function info(msg) {
  console.log(`  ${msg}`);
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg) {
  console.log(`  ! ${msg}`);
}
function fail(msg) {
  console.error(`\n  ✗ ${msg}`);
  process.exit(1);
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

/** Run a command. Returns { ok, code, stdout, stderr }. */
function run(cmd, args, { stdio = "pipe" } = {}) {
  // On Windows, npm/npx are .cmd shims and Node cannot spawn them without
  // a shell (ENOENT for `npm`, EINVAL for `npm.cmd` — confirmed on a real
  // Windows install). Run through cmd.exe on Windows, quoting arguments
  // first: with shell:true Node concatenates args unescaped (see DEP0190),
  // so values with spaces (e.g. Windows paths) need quoting to survive.
  const useShell = process.platform === "win32";
  const finalArgs = useShell ? args.map(quoteArg) : args;
  const result = spawnSync(cmd, finalArgs, { cwd: ROOT, stdio, encoding: "utf8", shell: useShell });
  return {
    ok: result.status === 0,
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question) {
  const answer = await ask(`${question} [y/N] `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

// ---------------------------------------------------------------- checks

function checkNode() {
  const [majorStr] = process.versions.node.split(".");
  const major = Number(majorStr);
  if (!Number.isInteger(major) || major < 20) {
    fail(`Node.js 20 or newer is required (found ${process.versions.node}). Install it from https://nodejs.org/ and re-run npm run setup.`);
  }
  ok(`Node.js ${process.versions.node} (>= 20)`);
}

function checkNpm() {
  const r = run("npm", ["--version"]);
  if (!r.ok) fail("npm was not found. Install Node.js 20+ (npm ships with it) and re-run npm run setup.");
  ok(`npm ${r.stdout.trim()}`);
}

function checkWrangler() {
  // --check-only must not download anything: without node_modules the
  // project-managed Wrangler is not present yet, so report that instead
  // of letting npx fetch it from the network.
  if (CHECK_ONLY && !existsSync(join(ROOT, "node_modules", "wrangler"))) {
    warn("Wrangler not installed yet (node_modules missing — run `npm install` first).");
    return;
  }
  const r = run("npx", ["wrangler", "--version"]);
  if (!r.ok) {
    fail("Wrangler (project devDependency) could not run. Try `npm install` again; see TROUBLESHOOTING.md.");
  }
  ok(`Wrangler ${r.stdout.trim()} (project-managed, no global install needed)`);
}

function validateWranglerToml() {
  const path = join(ROOT, "wrangler.toml");
  if (!existsSync(path)) fail("wrangler.toml is missing from the project root. Re-clone the repository.");
  const text = readFileSync(path, "utf8");
  const required = [
    ['name = "wordless"', "worker name"],
    ['main = "src/index.ts"', "entry point"],
    ['compatibility_date = "2026-11-18"', "compatibility date"],
    ['binding = "DB"', "D1 binding DB"],
    ['binding = "MEDIA"', "R2 binding MEDIA"],
    ['binding = "CONFIG"', "KV binding CONFIG"],
    ['binding = "ASSETS"', "Static Assets binding ASSETS (required — without it /admin deep links 503)"],
    ['directory = "./admin/dist"', "Static Assets directory for the admin SPA"],
    ['[env.staging]', "staging environment (M10)"],
    ['[env.production]', "production environment (M10)"],
    ['database_name = "wordless-staging"', "staging D1 database name"],
    ['database_name = "wordless-prod"', "production D1 database name"],
  ];
  for (const [marker, label] of required) {
    if (!text.includes(marker)) fail(`wrangler.toml is missing ${label} (${marker}).`);
  }
  ok("wrangler.toml exists and declares DB / MEDIA / CONFIG bindings + admin Static Assets + staging/production environments");
  if (!existsSync(join(ROOT, "admin", "vite.config.ts"))) {
    fail("admin/vite.config.ts is missing — the React admin build is not configured. Re-clone the repository.");
  }
  ok("Admin SPA build configured (admin/vite.config.ts)");
  if (!existsSync(join(ROOT, "admin", "dist", "admin", "index.html"))) {
    warn("Admin SPA is not built yet (admin/dist/admin/index.html missing).");
    info("     It is built automatically by `npm run dev` (predev) and by this installer (step 5).");
  }
  const hasPlaceholders = text.includes("REPLACE-ME");
  if (hasPlaceholders) {
    warn("wrangler.toml still has REPLACE-ME placeholder ids — fine for local development,");
    info("     production deploy will provision real resources (with your confirmation).");
  }
  return { hasPlaceholders };
}

function ensureDeps() {
  if (existsSync(join(ROOT, "node_modules"))) {
    ok("Dependencies already installed (node_modules present)");
    return;
  }
  if (CHECK_ONLY) {
    warn("node_modules is missing (would run `npm install` outside --check-only)");
    return;
  }
  log("\n  Installing dependencies (npm install)…");
  const r = run("npm", ["install"], { stdio: "inherit" });
  if (!r.ok) fail("`npm install` failed. Check your network connection and see TROUBLESHOOTING.md.");
  ok("Dependencies installed");
}

function applyLocalMigrations() {
  log("\n  Applying D1 migrations locally (no Cloudflare account needed)…");
  const r = run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], { stdio: "inherit" });
  if (!r.ok) {
    fail("Local D1 migrations failed. See TROUBLESHOOTING.md (section: local D1 errors).");
  }
  ok("Local D1 schema applied (migrations/0001_init.sql)");
}

function buildAdmin() {
  log("\n  Building the React admin SPA (Vite → admin/dist/admin/)…");
  const r = run("npm", ["run", "build:admin"], { stdio: "inherit" });
  if (!r.ok) {
    fail("Admin build failed (`npm run build:admin`). Fix the errors and re-run the installer.");
  }
  ok("Admin SPA built (served at /admin)");
}

// ------------------------------------------------------------- production

function updateTomlValue(sectionHeader, key, newValue) {
  const path = join(ROOT, "wrangler.toml");
  const lines = readFileSync(path, "utf8").split("\n");
  let inSection = false;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("[[")) inSection = line.trim() === sectionHeader;
    if (inSection && line.trim().startsWith(`${key} =`)) {
      lines[i] = `${key} = "${newValue}"`;
      replaced = true;
      break;
    }
  }
  if (!replaced) fail(`Could not update ${key} under ${sectionHeader} in wrangler.toml.`);
  writeFileSync(path, `${lines.join("\n")}`);
}

/** True when a key inside a named [[…]] block still holds REPLACE-ME. */
function envBlockHasPlaceholder(toml, blockHeader, key) {
  const lines = toml.split("\n");
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[[")) inBlock = trimmed === blockHeader;
    else if (trimmed.startsWith("[") && trimmed.endsWith("]")) inBlock = false;
    if (inBlock && trimmed.startsWith(`${key} = "REPLACE-ME"`)) return true;
  }
  return false;
}

async function productionPath() {
  log("\n  ── Production deploy (Cloudflare) ─────────────────────────────");
  log("  This provisions the PRODUCTION environment: D1 `wordless-prod`,");
  log("  R2 `wordless-media-prod` and KV `CONFIG-prod` — separate from the");
  log("  local/dev resources. Nothing runs without your explicit");
  log("  confirmation at each step.\n");

  if (!(await confirm("Open a browser to sign in to Cloudflare (official `wrangler login` OAuth flow)?"))) {
    log("\n  Production setup cancelled. Your local setup is unaffected.");
    return;
  }
  let r = run("npx", ["wrangler", "login"], { stdio: "inherit" });
  if (!r.ok) fail("`wrangler login` did not complete. See TROUBLESHOOTING.md (wrangler login issues).");

  r = run("npx", ["wrangler", "whoami"]);
  if (!r.ok) fail("`wrangler whoami` failed — you are not logged in to Cloudflare.");
  ok(`Logged in to Cloudflare:\n${r.stdout.trim().split("\n").map((l) => `     ${l}`).join("\n")}`);

  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");

  if (envBlockHasPlaceholder(toml, "[[env.production.d1_databases]]", "database_id")) {
    if (await confirm("Create the production D1 database `wordless-prod`?")) {
      r = run("npx", ["wrangler", "d1", "create", "wordless-prod"]);
      if (!r.ok) fail("`wrangler d1 create wordless-prod` failed. Check the output above.");
      const match = r.stdout.match(/database_id\s*=\s*"([^"]+)"/) ?? r.stdout.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/);
      if (!match) fail("Could not read the new D1 database_id from wrangler output.");
      updateTomlValue("[[env.production.d1_databases]]", "database_id", match[1]);
      ok(`D1 database created (id saved to wrangler.toml [env.production])`);
    } else {
      warn("Skipping D1 creation — remote migrations and deploy cannot run without it.");
    }
  } else {
    ok("Production D1 database already configured in wrangler.toml");
  }

  if (await confirm("Create the R2 bucket `wordless-media-prod` (skipped automatically if it already exists)?")) {
    r = run("npx", ["wrangler", "r2", "bucket", "create", "wordless-media-prod"]);
    if (r.ok) ok("R2 bucket `wordless-media-prod` created");
    else if (/already exists/i.test(r.stdout + r.stderr)) warn("R2 bucket `wordless-media-prod` already exists — continuing");
    else fail("`wrangler r2 bucket create wordless-media-prod` failed. Check the output above.");
  }

  if (envBlockHasPlaceholder(toml, "[[env.production.kv_namespaces]]", "id")) {
    if (await confirm("Create the KV namespace `CONFIG-prod`?")) {
      r = run("npx", ["wrangler", "kv", "namespace", "create", "CONFIG-prod"]);
      if (!r.ok) fail("`wrangler kv namespace create CONFIG-prod` failed. Check the output above.");
      const match = r.stdout.match(/id\s*=\s*"([^"]+)"/) ?? r.stdout.match(/"([a-f0-9]{32})"/);
      if (!match) fail("Could not read the new KV namespace id from wrangler output.");
      updateTomlValue("[[env.production.kv_namespaces]]", "id", match[1]);
      ok("KV namespace created (id saved to wrangler.toml [env.production])");
    }
  }

  if (await confirm("Apply D1 migrations to the REMOTE production database?")) {
    r = run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--env", "production"], { stdio: "inherit" });
    if (!r.ok) fail("Remote D1 migrations failed. See TROUBLESHOOTING.md.");
    ok("Remote D1 migrations applied");
  } else {
    fail("Remote migrations declined — deploy cannot proceed without the schema.");
  }

  if (!(await confirm("Deploy the Worker to production (`wrangler deploy --env production`)?"))) {
    log("\n  Deploy cancelled. Remote database is ready; run `npm run deploy:production` later.");
    return;
  }
  r = run("npx", ["wrangler", "deploy", "--env", "production"]);
  if (!r.ok) fail("`wrangler deploy` failed. Check the output above and TROUBLESHOOTING.md.");
  const urlMatch = (r.stdout + r.stderr).match(/https:\/\/[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.workers\.dev/);
  const url = urlMatch ? urlMatch[0] : null;
  if (!url) {
    warn("Deploy reported success but no workers.dev URL was found in the output.");
    info("Run `npx wrangler deploy --env production` again and check the printed URL, then verify /api/health manually.");
    return;
  }
  ok(`Deployed to ${url}`);

  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15000) });
    const body = await res.json();
    if (res.ok && body.ok) {
      ok(`Verified live: ${url}/api/health returned ok (version ${body.data?.version ?? "?"})`);
    } else {
      warn(`Deployed, but /api/health returned HTTP ${res.status}. Check the Worker logs.`);
    }
  } catch (err) {
    warn(`Deployed, but /api/health could not be reached (${err.message}). Check the URL and Worker logs.`);
  }
  log(`\n  Your site is live at ${url}`);
  log("  First login: seed the administrator with `npm run seed-admin -- --remote`.");
}

// ------------------------------------------------------------------ main

async function main() {
  console.log(BANNER);
  if (CHECK_ONLY) log("  Mode: --check-only (checks + validation only; nothing installed or changed)\n");
  else if (LOCAL_ONLY) log("  Mode: --local (non-interactive local setup)\n");

  log("  1. Environment checks");
  checkNode();
  checkNpm();

  log("\n  2. Configuration");
  validateWranglerToml();

  log("\n  3. Dependencies");
  ensureDeps();

  log("\n  4. Wrangler (project-managed)");
  checkWrangler();

  if (CHECK_ONLY) {
    log("\n  ✓ All checks passed. Nothing was installed or changed.");
    log("  Run `npm run setup` (interactive) or `npm run setup -- --local` to set up local development.");
    return;
  }

  log("\n  5. Local database");
  applyLocalMigrations();

  log("\n  6. Admin SPA");
  buildAdmin();

  log("\n  ✓ Local setup complete.");
  log("  Start development with:");
  log("      npm run dev");
  log("  Then open http://localhost:8787/ (public site),");
  log("  http://localhost:8787/admin (React admin) and");
  log("  http://localhost:8787/api/health (API health check).\n");

  if (LOCAL_ONLY) return;

  if (await confirm("Create the first administrator now (so you can sign in at /admin)?")) {
    log("\n  Running `npm run seed-admin` (local D1)…\n");
    const seed = run("npm", ["run", "seed-admin"], { stdio: "inherit" });
    if (!seed.ok) {
      warn("Seeding the administrator did not complete — run `npm run seed-admin` later (it refuses when an admin already exists).");
    }
  }

  const choice = await ask("  Choose next step:\n    [1] Local development — start `npm run dev` now\n    [2] Production Cloudflare deploy\n    [Enter] Done for now\n  Your choice: ");
  if (choice === "1") {
    const start = await confirm("Start the dev server now?");
    if (start) {
      log("\n  Starting `npm run dev` (Ctrl+C to stop)…\n");
      const r = run("npm", ["run", "dev"], { stdio: "inherit" });
      if (!r.ok) fail("`npm run dev` exited with an error. See TROUBLESHOOTING.md (port in use).");
    } else {
      log("  Run `npm run dev` whenever you are ready.");
    }
  } else if (choice === "2") {
    await productionPath();
  } else {
    log("  Done. Run `npm run dev` for local development or `npm run setup` again for production.");
  }
}

main().catch((err) => {
  console.error(`\n  ✗ Installer failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
