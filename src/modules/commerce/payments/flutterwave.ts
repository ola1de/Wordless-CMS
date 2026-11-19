/**
 * Flutterwave provider (Milestone 8).
 *
 * Implemented from Flutterwave's public API documentation:
 * - Create payment: POST https://api.flutterwave.com/v3/payments
 *   { tx_ref, amount (major units), currency, redirect_url, customer,
 *   customizations } with `Authorization: Bearer <secret key>` →
 *   data.link.
 * - Verify: GET /v3/transactions/verify_by_reference?tx_ref=<tx_ref>
 *   → data.status "successful".
 * - Webhook: Flutterwave sends the secret hash you set in the
 *   dashboard as the `verif-hash` header — verification is comparing
 *   that header to the configured FLUTTERWAVE_SECRET_HASH (this is the
 *   scheme in Flutterwave's webhook documentation; it is not an HMAC).
 *   Event "charge.completed" with data.status "successful" means paid.
 *
 * NOT verified live (no Flutterwave keys connected) — the webhook
 * comparison is unit-tested, but a live Flutterwave transaction has
 * never been run through this code. Amounts sent to Flutterwave are
 * major units (Flutterwave takes 1250.00, not 125000); amounts stored
 * in Wordless stay in minor units.
 */
import type { Env } from "../../../env";
import type { Db } from "../../../db";
import { timingSafeEqual } from "./hmac";
import { toMajorUnits } from "../money";
import type { PaymentCheckout, PaymentCheckoutInput, PaymentProvider, PaymentVerification, WebhookResult } from "./types";
import { paymentNotConfigured } from "./types";

const API_BASE = "https://api.flutterwave.com";

function requireKey(env: Env): string {
  if (env.FLUTTERWAVE_SECRET_KEY === undefined || env.FLUTTERWAVE_SECRET_KEY === "") {
    throw paymentNotConfigured("Flutterwave is not configured: set the FLUTTERWAVE_SECRET_KEY secret (wrangler secret put).");
  }
  return env.FLUTTERWAVE_SECRET_KEY;
}

interface FlutterwaveResponse {
  status?: string;
  message?: string;
  data?: Record<string, unknown>;
}

async function flutterwaveFetch(env: Env, path: string, init?: RequestInit): Promise<FlutterwaveResponse> {
  const key = requireKey(env);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => ({}))) as FlutterwaveResponse;
  if (!res.ok || body.status !== "success") {
    throw new Error(`Flutterwave request failed (HTTP ${res.status}): ${body.message ?? "unknown error"}.`);
  }
  return body;
}

function parseBody(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const flutterwaveProvider: PaymentProvider = {
  id: "flutterwave",
  name: "Flutterwave",
  description: "Flutterwave — cards, bank transfer and mobile money across Africa. Needs FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_SECRET_HASH.",
  requiresKey: true,

  isConfigured(env: Env): boolean {
    return env.FLUTTERWAVE_SECRET_KEY !== undefined && env.FLUTTERWAVE_SECRET_KEY !== "";
  },

  configuredDetail(env: Env): string {
    return this.isConfigured(env)
      ? "Secret key is set (wrangler secret). Webhooks are verified against the FLUTTERWAVE_SECRET_HASH you set in the Flutterwave dashboard."
      : "Not configured: set FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_SECRET_HASH with `wrangler secret put`.";
  },

  async createCheckout(env: Env, input: PaymentCheckoutInput): Promise<PaymentCheckout> {
    const body = await flutterwaveFetch(env, "/v3/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.order.id,
        amount: toMajorUnits(input.order.totalMinor),
        currency: input.order.currency,
        redirect_url: input.successUrl,
        customer: { email: input.order.customerEmail, name: input.order.customerName },
        customizations: { title: "Wordless store" },
      }),
    });
    const data = body.data ?? {};
    const url = typeof data.link === "string" ? data.link : "";
    const reference = typeof data.tx_ref === "string" ? data.tx_ref : input.order.id;
    if (url === "") throw new Error("Flutterwave did not return a payment link.");
    return { checkoutUrl: url, reference };
  },

  async verifyPayment(_db: Db, env: Env, reference: string): Promise<PaymentVerification> {
    const body = await flutterwaveFetch(
      env,
      `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    const data = body.data ?? {};
    const status = typeof data.status === "string" ? data.status : "";
    if (status === "successful") return { status: "paid", rawStatus: status };
    if (status === "failed") return { status: "failed", rawStatus: status };
    return { status: "pending", rawStatus: status === "" ? "unknown" : status };
  },

  async verifyWebhook(env: Env, rawBody: string, headers: Headers): Promise<WebhookResult> {
    const hash = env.FLUTTERWAVE_SECRET_HASH;
    if (hash === undefined || hash === "") {
      return {
        valid: false,
        event: "",
        reference: null,
        paid: false,
        detail: "Flutterwave webhook hash is not configured (set FLUTTERWAVE_SECRET_HASH — the same hash set in the Flutterwave dashboard).",
      };
    }
    const sent = headers.get("verif-hash") ?? "";
    if (sent === "" || !timingSafeEqual(sent, hash)) {
      return { valid: false, event: "", reference: null, paid: false, detail: "Flutterwave verif-hash does not match the configured secret hash." };
    }
    const body = parseBody(rawBody);
    const event = typeof body.event === "string" ? body.event : "";
    const data = typeof body.data === "object" && body.data !== null ? (body.data as Record<string, unknown>) : {};
    const reference = typeof data.tx_ref === "string" ? data.tx_ref : null;
    const paid = event === "charge.completed" && data.status === "successful" && reference !== null;
    return {
      valid: true,
      event,
      reference,
      paid,
      detail: paid ? "Flutterwave charge completed successfully." : `Flutterwave event "${event}" (status ${String(data.status ?? "?")}) is not a successful charge.`,
    };
  },
};
