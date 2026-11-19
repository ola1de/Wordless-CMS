/**
 * Integration registry (Milestone 8).
 *
 * One definition per integration: what it is, what kind it is, what
 * it needs, and how to tell whether it is configured — computed live
 * from env + stored config, never hardcoded. The admin Integrations
 * page and GET /api/integrations both read this list, so they can
 * never disagree about status.
 */
import type { Db } from "../../db";
import type { Env } from "../../env";
import { getIntegrationConfig } from "./config";
import { getPaymentProvider } from "../commerce/payments/index";
import type { PaymentProviderId } from "../commerce/payments/types";

export type IntegrationKind = "email" | "payment" | "analytics" | "social" | "platform" | "marketplace";

export interface IntegrationDefinition {
  id: string;
  name: string;
  kind: IntegrationKind;
  description: string;
  /** What the admin must do to make it work (plain language). */
  setupHint: string;
  configured(db: Db, env: Env): Promise<{ configured: boolean; detail: string }>;
}

async function paymentConfigured(db: Db, env: Env, id: PaymentProviderId): Promise<{ configured: boolean; detail: string }> {
  const provider = getPaymentProvider(id);
  return { configured: provider.isConfigured(env), detail: provider.configuredDetail(env) };
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "email",
    name: "Email",
    kind: "email",
    description: "Transactional email (order confirmations, comment notifications, password resets).",
    setupHint: "Set EMAIL_API_URL in the config below and EMAIL_API_KEY with `wrangler secret put EMAIL_API_KEY`. Until then, messages are logged locally (test mode) and never delivered.",
    async configured(db, env) {
      const config = await getIntegrationConfig(db, "email");
      const apiUrl = typeof config.apiUrl === "string" ? config.apiUrl.trim() : "";
      const key = env.EMAIL_API_KEY;
      if (apiUrl !== "" && key !== undefined && key !== "") {
        return { configured: true, detail: `HTTP email provider configured (${apiUrl}). Messages are delivered and logged.` };
      }
      return {
        configured: false,
        detail: "No email provider is configured — messages are recorded in the mail log (test mode), not delivered.",
      };
    },
  },
  {
    id: "paystack",
    name: "Paystack",
    kind: "payment",
    description: "Payments — cards, bank transfer, mobile money (NGN and more).",
    setupHint: "Set PAYSTACK_SECRET_KEY with `wrangler secret put PAYSTACK_SECRET_KEY`, then select Paystack in Commerce → Payments.",
    configured: (db, env) => paymentConfigured(db, env, "paystack"),
  },
  {
    id: "flutterwave",
    name: "Flutterwave",
    kind: "payment",
    description: "Payments — cards, bank transfer, mobile money across Africa.",
    setupHint: "Set FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_SECRET_HASH with `wrangler secret put`, then select Flutterwave in Commerce → Payments.",
    configured: (db, env) => paymentConfigured(db, env, "flutterwave"),
  },
  {
    id: "stripe",
    name: "Stripe",
    kind: "payment",
    description: "Payments — cards and wallets worldwide.",
    setupHint: "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET with `wrangler secret put`, then select Stripe in Commerce → Payments.",
    configured: (db, env) => paymentConfigured(db, env, "stripe"),
  },
  {
    id: "analytics",
    name: "Analytics",
    kind: "analytics",
    description: "Page-view analytics (Google Analytics 4 or Plausible). Counts live in the provider's dashboard, never in Wordless.",
    setupHint: "Choose a provider and enter its measurement ID (GA4) or domain (Plausible) in the config below. No snippet is injected until then.",
    async configured(db) {
      const config = await getIntegrationConfig(db, "analytics");
      const provider = config.provider === "ga4" || config.provider === "plausible" ? config.provider : "none";
      const id = typeof config.measurementId === "string" ? config.measurementId.trim() : "";
      if (provider === "none" || id === "") {
        return { configured: false, detail: "No analytics provider is configured — public pages carry no tracking snippet." };
      }
      return { configured: true, detail: `${provider === "ga4" ? "Google Analytics 4" : "Plausible"} is configured (${id}).` };
    },
  },
  {
    id: "social",
    name: "Social sharing",
    kind: "social",
    description: "Share links on posts and products (X, Facebook, WhatsApp, Telegram). Plain links — no API, no share counts.",
    setupHint: "No setup needed. Share links are always available.",
    async configured() {
      return { configured: true, detail: "Share links need no setup — they are plain links on posts and products." };
    },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    kind: "platform",
    description: "Worker bindings in this environment (D1, R2, KV, Static Assets, Workers AI). Read-only status.",
    setupHint: "Bindings come from wrangler.toml and your Cloudflare account. The AI binding appears after deploying with your own account.",
    async configured(_db, env) {
      const ai = env.AI !== undefined && env.AI !== null;
      return {
        configured: true,
        detail: ai
          ? "All bindings present, including Workers AI."
          : "D1, R2, KV and Static Assets are bound. Workers AI is not bound yet (local dev uses the mock AI provider).",
      };
    },
  },
  {
    id: "marketplace",
    name: "Marketplace",
    kind: "marketplace",
    description: "Extension marketplace (skeleton): install extensions from a ZIP upload, activate/deactivate them. No remote directory yet.",
    setupHint: "Upload an extension ZIP (with a wordless.json manifest) in Commerce → Marketplace. A remote directory is a later milestone.",
    async configured() {
      return { configured: true, detail: "Skeleton: local ZIP install only. No remote marketplace directory yet." };
    },
  },
];

/** The full integration list with live configured state + stored config (non-secret fields only). */
export async function listIntegrations(
  db: Db,
  env: Env,
): Promise<
  Array<{
    id: string;
    name: string;
    kind: IntegrationKind;
    description: string;
    setupHint: string;
    configured: boolean;
    configuredDetail: string;
    config: Record<string, unknown>;
  }>
> {
  const out = [];
  for (const def of INTEGRATIONS) {
    const state = await def.configured(db, env);
    out.push({
      id: def.id,
      name: def.name,
      kind: def.kind,
      description: def.description,
      setupHint: def.setupHint,
      configured: state.configured,
      configuredDetail: state.detail,
      config: await getIntegrationConfig(db, def.id),
    });
  }
  return out;
}
