/** Worker environment bindings (see wrangler.toml). No secrets here. */
import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import type { User } from "./modules/users/types";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONFIG: KVNamespace;
}

/** A request-scoped, authenticated user (null = anonymous visitor). */
export type AuthUser = User;
