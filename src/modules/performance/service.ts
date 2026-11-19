/**
 * Performance section for Site Health (Milestone 9) — measured numbers
 * only. Row counts come from D1, the R2 object count from a bounded
 * list() (cap 1,000 — the count is reported as "at least N" when the
 * cap is hit, never as an exact figure it is not), cache config from
 * the module constants, derivative status from D1 + the binding.
 */
import { queryOne } from "../../db";
import type { Db } from "../../db";
import type { Env } from "../../env";
import { PUBLIC_CACHE_MAX_AGE, PUBLIC_CACHE_STALE_WHILE_REVALIDATE } from "./cache";
import { derivativeStatus } from "./derivatives";

const COUNTED_TABLES = [
  "wp_posts",
  "wp_users",
  "wp_comments",
  "wp_terms",
  "wp_options",
  "wl_products",
  "wl_orders",
  "wl_carts",
  "wl_media_derivatives",
  "wl_backups",
] as const;

export interface PerformanceHealth {
  tables: Record<string, number>;
  mediaObjects: { counted: number; capped: boolean };
  cache: { maxAgeSeconds: number; staleWhileRevalidateSeconds: number; anonymousGetsCached: boolean };
  derivatives: { bound: boolean; stored: number; widths: number[] };
  compression: {
    note: string;
  };
}

export async function getPerformanceHealth(db: Db, env: Env): Promise<PerformanceHealth> {
  const tables: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const row = await queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table}`);
    tables[table] = row?.n ?? 0;
  }
  let mediaCounted = 0;
  let capped = false;
  // MEDIA may be a stub in unit tests (an object without list()) — only
  // call list() when it is actually a function.
  if (env.MEDIA !== undefined && env.MEDIA !== null && typeof env.MEDIA.list === "function") {
    const list = await env.MEDIA.list({ limit: 1000 });
    mediaCounted = list.objects.length;
    capped = list.truncated === true;
  }
  const derivatives = await derivativeStatus(db, env.IMAGES !== undefined && env.IMAGES !== null);
  return {
    tables,
    mediaObjects: { counted: mediaCounted, capped },
    cache: {
      maxAgeSeconds: PUBLIC_CACHE_MAX_AGE,
      staleWhileRevalidateSeconds: PUBLIC_CACHE_STALE_WHILE_REVALIDATE,
      anonymousGetsCached: true,
    },
    derivatives,
    compression: {
      note: "Compression is applied by the Cloudflare edge (gzip/brotli) in production; the Worker does not compress responses itself. The Vary: Accept-Encoding header is set on every response so caches vary correctly.",
    },
  };
}
