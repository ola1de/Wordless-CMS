/**
 * 404 log (Milestone 7).
 *
 * Public 404s are recorded per path (query strings and fragments are
 * stripped before storage — a 404 URL must never smuggle a token or
 * password into the log). One row per path, with a hit counter and
 * first/last seen timestamps. The table is capped at 500 paths: after
 * an insert, the oldest rows beyond 500 (by last_seen) are pruned.
 * Asset and admin paths are not logged (favicon, theme CSS, /api/*,
 * /admin*): those are not content 404s.
 */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { nowIso } from "../../db";
import type { NotFoundEntry, NotFoundList } from "./types";

export const MAX_404_PATHS = 500;

const SKIP_PREFIXES = ["/api/", "/admin", "/media/", "/theme.css", "/feed", "/sitemap", "/robots.txt"];
const SKIP_EXACT = ["/favicon.ico", "/api", "/admin", "/sitemap.xml", "/robots.txt", "/feed"];

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

/**
 * Normalise a request path for the log: strip query string + fragment,
 * decode, collapse duplicate slashes, keep a leading slash, drop a
 * trailing slash (except the root). Returns null when the path should
 * not be logged at all.
 */
export function normalize404Path(rawPath: string): string | null {
  const withoutQuery = rawPath.split(/[?#]/)[0] ?? "";
  let path = withoutQuery.trim();
  if (path === "") path = "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    // Undecodable paths are logged as-is (still without a query string).
  }
  path = path.replace(/\/{2,}/g, "/");
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (SKIP_EXACT.includes(path)) return null;
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return null;
  return path;
}

/** Record one public 404 (fire-and-forget safe: never throws). */
export async function logNotFound(db: Db, rawPath: string, referrer = ""): Promise<void> {
  try {
    const path = normalize404Path(rawPath);
    if (path === null) return;
    const now = nowIso();
    const existing = await queryOne<{ count: unknown }>(db, "SELECT count FROM wl_404_log WHERE path = ? LIMIT 1", [path]);
    if (existing) {
      // A repeat hit keeps the first referrer unless a new one is given.
      await execRun(
        db,
        "UPDATE wl_404_log SET count = count + 1, last_seen = ?, referrer = CASE WHEN ? = '' THEN referrer ELSE ? END WHERE path = ?",
        [now, referrer.slice(0, 500), referrer.slice(0, 500), path],
      );
    } else {
      await execRun(
        db,
        "INSERT INTO wl_404_log (path, count, referrer, first_seen, last_seen) VALUES (?, 1, ?, ?, ?)",
        [path, referrer.slice(0, 500), now, now],
      );
      // Prune to the 500 most recently seen paths.
      await execRun(
        db,
        `DELETE FROM wl_404_log WHERE path NOT IN
           (SELECT path FROM wl_404_log ORDER BY last_seen DESC, count DESC LIMIT ?)`,
        [MAX_404_PATHS],
      );
    }
  } catch {
    // 404 logging must never break the response it records.
  }
}

export async function listNotFound(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<NotFoundList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const totalRow = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_404_log");
  const total = totalRow?.n ?? 0;
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM wl_404_log ORDER BY count DESC, last_seen DESC LIMIT ? OFFSET ?",
    [perPage, (page - 1) * perPage],
  );
  return {
    entries: rows.map((row) => ({
      path: asText(row.path),
      count: asInt(row.count),
      referrer: asText(row.referrer),
      firstSeen: asText(row.first_seen),
      lastSeen: asText(row.last_seen),
    })),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function deleteNotFound(db: Db, rawPath: string): Promise<boolean> {
  const path = normalize404Path(rawPath);
  if (path === null) return false;
  const { changes } = await execRun(db, "DELETE FROM wl_404_log WHERE path = ?", [path]);
  return changes > 0;
}
