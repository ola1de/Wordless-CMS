/**
 * Paystack provider (Milestone 8).
 *
 * Implemented from Paystack's public API documentation:
 * - Initialise: POST https://api.paystack.co/transaction/initialize
 *   { email, amount (kobo), reference, callback_url } with
 *   `Authorization: Bearer <secret key>` → data.authorization_url.
 * - Verify: GET /transaction/verify/:reference → data.status "success".
 * - Webhook: HMAC-SHA512 of the raw request body with the secret key,
 *   sent as the `x-paystack-signature` header; event "charge.success"
 *   with data.status "success" means paid.
 *
 * NOT verified live (no Cloudflare account, no Paystack keys connected)
 * — the webhook verification is unit-tested with computed signatures,
 * but a live Paystack transaction has never been run through this code.
 * Amounts are kobo (minor units) throughout.
 */
import type { Env } from "../../../env";
import type { Db } from "../../../db";
import { hmacHex, timingSafeEqual } from "./hmac";
import type { PaymentCheckout, PaymentCheckoutInput, PaymentProvider, PaymentVerification, WebhookResult } from "./types";
import { paymentNotConfigured } from "./types";

const API_BASE = "https://api.paystack.co";

function requireKey(env: Env): string {
  if (env.PAYSTACK_SECRET_KEY === undefined || env.PAYSTACK_SECRET_KEY === "") {
    throw paymentNotConfigured("Paystack is not configured: set the PAYSTACK_SECRET_KEY secret (wrangler secret put).");
  }
  return env.PAYSTACK_SECRET_KEY;
}

interface PaystackResponse {
  status?: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

async function paystackFetch(env: Env, path: string, init?: RequestInit): Promise<PaystackResponse> {
  const key = requireKey(env);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => ({}))) as PaystackResponse;
  if (!res.ok || body.status !== true) {
    throw new Error(`Paystack request failed (HTTP ${res.status}): ${body.message ?? "unknown error"}.`);
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

export const paystackProvider: PaymentProvider = {
  id: "paystack",
  name: "Paystack",
  description: "Paystack — cards, bank transfer and mobile money (NGN and more). Needs PAYSTACK_SECRET_KEY.",
  requiresKey: true,

  isConfigured(env: Env): boolean {
    return env.PAYSTACK_SECRET_KEY !== undefined && env.PAYSTACK_SECRET_KEY !== "";
  },

  configuredDetail(env: Env): string {
    return this.isConfigured(env)
      ? "Secret key is set (wrangler secret). Webhooks are verified with HMAC-SHA512."
      : "Not configured: set PAYSTACK_SECRET_KEY with `wrangler secret put PAYSTACK_SECRET_KEY`.";
  },

  async createCheckout(env: Env, input: PaymentCheckoutInput): Promise<PaymentCheckout> {
    const body = await paystackFetch(env, "/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.order.customerEmail,
        amount: input.order.totalMinor,
        reference: input.order.id,
        callback_url: input.successUrl,
      }),
    });
    const data = body.data ?? {};
    const url = typeof data.authorization_url === "string" ? data.authorization_url : "";
    const reference = typeof data.reference === "string" ? data.reference : input.order.id;
    if (url === "") throw new Error("Paystack did not return a checkout URL.");
    return { checkoutUrl: url, reference };
  },

  async verifyPayment(_db: Db, env: Env, reference: string): Promise<PaymentVerification> {
    const body = await paystackFetch(env, `/transaction/verify/${encodeURIComponent(reference)}`);
    const data = body.data ?? {};
    const status = typeof data.status === "string" ? data.status : "";
    if (status === "success") return { status: "paid", rawStatus: status };
    if (status === "failed" || status === "abandoned") return { status: "failed", rawStatus: status };
    return { status: "pending", rawStatus: status === "" ? "unknown" : status };
  },

  async verifyWebhook(env: Env, rawBody: string, headers: Headers): Promise<WebhookResult> {
    const key = env.PAYSTACK_SECRET_KEY;
    if (key === undefined || key === "") {
      return { valid: false, event: "", reference: null, paid: false, detail: "Paystack is not configured (no secret key)." };
    }
    const signature = headers.get("x-paystack-signature") ?? "";
    const expected = await hmacHex("SHA-512", key, rawBody);
    if (signature === "" || !timingSafeEqual(signature, expected)) {
      return { valid: false, event: "", reference: null, paid: false, detail: "Paystack webhook signature does not match." };
    }
    const body = parseBody(rawBody);
    const event = typeof body.event === "string" ? body.event : "";
    const data = typeof body.data === "object" && body.data !== null ? (body.data as Record<string, unknown>) : {};
    const reference = typeof data.reference === "string" ? data.reference : null;
    const paid = event === "charge.success" && data.status === "success" && reference !== null;
    return {
      valid: true,
      event,
      reference,
      paid,
      detail: paid ? "Paystack charge succeeded." : `Paystack event "${event}" (status ${String(data.status ?? "?")}) is not a successful charge.`,
    };
  },
};
