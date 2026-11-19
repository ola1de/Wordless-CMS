/** Worker environment bindings (see wrangler.toml). No secrets here. */
import type { D1Database, Fetcher, KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import type { AiBinding } from "./ai/providers/types";
import type { User } from "./modules/users/types";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONFIG: KVNamespace;
  /** Static Assets binding (admin SPA). Present when assets are configured. */
  ASSETS: Fetcher;
  /**
   * Workers AI binding (Milestone 6, the DEFAULT provider). OPTIONAL:
   * it only exists when the `[ai]` block in wrangler.toml is uncommented
   * and the Worker is deployed to Cloudflare. The provider layer treats
   * a missing binding as "not configured", never as a crash.
   */
  AI?: AiBinding;
  /** OpenAI-compatible fallback only (optional secret, `wrangler secret put`). */
  OPENAI_API_KEY?: string;
  /** OpenAI-compatible base URL (optional; default https://api.openai.com/v1). */
  OPENAI_BASE_URL?: string;
  /** OpenAI-compatible model (optional; default gpt-4o-mini). */
  OPENAI_MODEL?: string;
}

/** A request-scoped, authenticated user (null = anonymous visitor). */
export type AuthUser = User;
