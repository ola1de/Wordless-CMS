/**
 * Cloudflare bindings status (Milestone 8) — read-only, real.
 *
 * Reports which Worker bindings actually exist in this environment
 * (D1, R2, KV, Static Assets, Workers AI). Nothing is invented: a
 * binding is listed only when the env object has it. This is the
 * honest answer to "is Cloudflare connected?" — the [ai] binding is
 * absent until the user deploys with their own account.
 */
import type { Env } from "../../env";

export interface BindingStatus {
  binding: string;
  present: boolean;
  detail: string;
}

export function cloudflareBindingStatus(env: Env): BindingStatus[] {
  return [
    {
      binding: "DB (D1)",
      present: env.DB !== undefined && env.DB !== null,
      detail: "Relational data (posts, orders, options).",
    },
    {
      binding: "MEDIA (R2)",
      present: env.MEDIA !== undefined && env.MEDIA !== null,
      detail: "Media uploads, theme files, marketplace extension files.",
    },
    {
      binding: "CONFIG (KV)",
      present: env.CONFIG !== undefined && env.CONFIG !== null,
      detail: "Reserved for fast config reads (not used yet).",
    },
    {
      binding: "ASSETS (Static Assets)",
      present: env.ASSETS !== undefined && env.ASSETS !== null,
      detail: "Serves the React admin SPA at /admin.",
    },
    {
      binding: "AI (Workers AI)",
      present: env.AI !== undefined && env.AI !== null,
      detail:
        env.AI !== undefined && env.AI !== null
          ? "Workers AI is bound — the default AI provider can run."
          : "Not bound: uncomment the [ai] block in wrangler.toml when deploying to Cloudflare. Local dev uses the mock provider.",
    },
  ];
}
