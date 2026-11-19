/**
 * Integration config (Milestone 8) — non-secret settings only.
 *
 * Stored as wp_options `wl_integration_<id>` (JSON). Secrets are NEVER
 * stored here: any key that looks like a secret (secret, key, token,
 * password, private) is rejected with a 400 that tells the admin to use
 * `wrangler secret put` instead. This is enforced in code, not just in
 * the docs — a config write carrying a secret can never land in D1.
 */
import { getOption, setOption } from "../options/service";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { INTEGRATIONS } from "./registry";

export const SECRET_FIELD_RE = /(secret|api[-_]?key|token|password|private|passwd)/i;

/** Fields each integration is allowed to store (everything else is rejected). */
const ALLOWED_FIELDS: Record<string, string[]> = {
  email: ["from", "apiUrl"],
  paystack: ["mode", "currency"],
  flutterwave: ["mode", "currency"],
  stripe: ["mode", "currency"],
  analytics: ["provider", "measurementId"],
  social: [],
  cloudflare: [],
  marketplace: [],
};

export function integrationOptionKey(id: string): string {
  return `wl_integration_${id}`;
}

export async function getIntegrationConfig(db: Db, id: string): Promise<Record<string, unknown>> {
  const def = INTEGRATIONS.find((d) => d.id === id);
  if (def === undefined) throw notFound(`Integration "${id}" does not exist.`);
  return getOption<Record<string, unknown>>(db, integrationOptionKey(id), {});
}

export async function setIntegrationConfig(
  db: Db,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const def = INTEGRATIONS.find((d) => d.id === id);
  if (def === undefined) throw notFound(`Integration "${id}" does not exist.`);
  const allowed = ALLOWED_FIELDS[id] ?? [];
  for (const key of Object.keys(patch)) {
    if (SECRET_FIELD_RE.test(key)) {
      throw badRequest(
        `Field "${key}" looks like a secret. Secrets are never stored in the database — set them with \`wrangler secret put\` (see docs/integrations/integrations.md).`,
      );
    }
    if (!allowed.includes(key)) {
      throw badRequest(`Field "${key}" is not a setting for the ${def.name} integration. Allowed: ${allowed.length > 0 ? allowed.join(", ") : "(none)"}.`);
    }
  }
  // Per-integration value validation.
  if (patch.mode !== undefined && patch.mode !== "test" && patch.mode !== "live") {
    throw badRequest('Field "mode" must be "test" or "live".');
  }
  if (patch.currency !== undefined && (typeof patch.currency !== "string" || !/^[A-Za-z]{3}$/.test(patch.currency))) {
    throw badRequest('Field "currency" must be a 3-letter currency code.');
  }
  if (patch.provider !== undefined && patch.provider !== "none" && patch.provider !== "ga4" && patch.provider !== "plausible") {
    throw badRequest('Field "provider" must be "none", "ga4" or "plausible".');
  }
  if (patch.measurementId !== undefined && typeof patch.measurementId !== "string") {
    throw badRequest('Field "measurementId" must be a string.');
  }
  if (patch.from !== undefined && typeof patch.from !== "string") {
    throw badRequest('Field "from" must be a string.');
  }
  if (patch.apiUrl !== undefined) {
    if (typeof patch.apiUrl !== "string") throw badRequest('Field "apiUrl" must be a string.');
    const trimmed = patch.apiUrl.trim();
    if (trimmed !== "") {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw badRequest('Field "apiUrl" must be a valid absolute http(s) URL or empty.');
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw badRequest('Field "apiUrl" must be a valid absolute http(s) URL or empty.');
      }
    }
  }
  const current = await getIntegrationConfig(db, id);
  const merged = { ...current, ...patch };
  await setOption(db, integrationOptionKey(id), merged);
  return merged;
}
