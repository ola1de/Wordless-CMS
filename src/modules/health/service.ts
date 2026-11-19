/**
 * Site Health — real checks, no fake "all good".
 * Every check runs a live query or binding test and reports pass/fail
 * with a detail string. A failed check is reported, never hidden.
 */
import { queryOne } from "../../db";
import type { Db } from "../../db";
import type { Env } from "../../env";

export interface HealthCheck {
  name: string;
  status: "pass" | "fail";
  detail: string;
}

export interface SiteHealth {
  status: "ok" | "degraded";
  version: string;
  checks: HealthCheck[];
}

const REQUIRED_TABLES = [
  "wp_posts",
  "wp_postmeta",
  "wp_users",
  "wp_usermeta",
  "wp_terms",
  "wp_term_taxonomy",
  "wp_term_relationships",
  "wp_comments",
  "wp_commentmeta",
  "wp_options",
  "wp_termmeta",
  "wl_sessions",
  "wl_audit_log",
  "wl_redirects",
  "wl_themes",
  "wl_ai_approvals",
  "wl_ai_memory",
  "wl_404_log",
  "wl_products",
  "wl_orders",
  "wl_order_items",
  "wl_carts",
  "wl_mail_log",
  "wl_webhook_log",
];

export async function siteHealth(db: Db, env: Env, version: string): Promise<SiteHealth> {
  const checks: HealthCheck[] = [];

  // 1. Database reachable.
  try {
    await queryOne<{ one: unknown }>(db, "SELECT 1 AS one");
    checks.push({ name: "database", status: "pass", detail: "D1 responded to SELECT 1." });
  } catch (err) {
    checks.push({
      name: "database",
      status: "fail",
      detail: `D1 query failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 2. Required tables present (migrations applied).
  try {
    const missing: string[] = [];
    for (const table of REQUIRED_TABLES) {
      const row = await queryOne<{ name: unknown }>(
        db,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        [table],
      );
      if (!row) missing.push(table);
    }
    checks.push(
      missing.length === 0
        ? { name: "tables", status: "pass", detail: `${REQUIRED_TABLES.length} required tables present.` }
        : { name: "tables", status: "fail", detail: `Missing tables: ${missing.join(", ")}` },
    );
  } catch (err) {
    checks.push({
      name: "tables",
      status: "fail",
      detail: `Table check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 3. Bindings present (DB / MEDIA / CONFIG declared in wrangler.toml).
  const bindings: { name: string; present: boolean }[] = [
    { name: "DB", present: env.DB !== undefined && env.DB !== null },
    { name: "MEDIA", present: env.MEDIA !== undefined && env.MEDIA !== null },
    { name: "CONFIG", present: env.CONFIG !== undefined && env.CONFIG !== null },
  ];
  const missingBindings = bindings.filter((b) => !b.present).map((b) => b.name);
  checks.push(
    missingBindings.length === 0
      ? { name: "bindings", status: "pass", detail: "DB, MEDIA and CONFIG bindings are present." }
      : { name: "bindings", status: "fail", detail: `Missing bindings: ${missingBindings.join(", ")}` },
  );

  // 4. Content counts (real numbers, not placeholders).
  try {
    const posts = await queryOne<{ total: unknown }>(
      db,
      "SELECT COUNT(*) AS total FROM wp_posts WHERE post_type IN ('post', 'page') AND post_status != 'trash'",
    );
    const users = await queryOne<{ total: unknown }>(db, "SELECT COUNT(*) AS total FROM wp_users");
    const comments = await queryOne<{ total: unknown }>(
      db,
      "SELECT COUNT(*) AS total FROM wp_comments WHERE comment_approved = '1'",
    );
    checks.push({
      name: "content",
      status: "pass",
      detail: `${Number(posts?.total ?? 0)} posts/pages, ${Number(users?.total ?? 0)} users, ${Number(comments?.total ?? 0)} approved comments.`,
    });
  } catch (err) {
    checks.push({
      name: "content",
      status: "fail",
      detail: `Count queries failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 5. Runtime version (informational; always passes when reached).
  checks.push({
    name: "runtime",
    status: "pass",
    detail: `Wordless ${version}; D1/SQLite backend.`,
  });

  return { status: checks.some((c) => c.status === "fail") ? "degraded" : "ok", version, checks };
}
