/**
 * Stripe provider (Milestone 8).
 *
 * Implemented from Stripe's public API documentation:
 * - Checkout Session: POST https://api.stripe.com/v1/checkout/sessions
 *   (form-encoded, Basic auth with the secret key) with mode=payment,
 *   one line item (price_data in minor units), success_url and
 *   cancel_url → url + id. The session id is the order's reference.
 * - Verify: GET /v1/checkout/sessions/:id → payment_status "paid".
 * - Webhook: the `stripe-signature` header carries `t=<timestamp>,
 *   v1=<hmac>`; the signature is HMAC-SHA256 of `${t}.${rawBody}` with
 *   the webhook secret, and the timestamp must be within 300 seconds
 *   of now (replay protection). Event "checkout.session.completed"
 *   with payment_status "paid" means paid.
 *
 * NOT verified live (no Stripe keys connected) — the webhook
 * verification is unit-tested with computed signatures, but a live
 * Stripe transaction has never been run through this code.
 */
import type { Env } from "../../../env";
import type { Db } from "../../../db";
import { base64Encode, hmacHex, timingSafeEqual } from "./hmac";
import type { PaymentCheckout, PaymentCheckoutInput, PaymentProvider, PaymentVerification, WebhookResult } from "./types";
import { paymentNotConfigured } from "./types";

const API_BASE = "https://api.stripe.com";
const SIGNATURE_TOLERANCE_SECONDS = 300;

function requireKey(env: Env): string {
  if (env.STRIPE_SECRET_KEY === undefined || env.STRIPE_SECRET_KEY === "") {
    throw paymentNotConfigured("Stripe is not configured: set the STRIPE_SECRET_KEY secret (wrangler secret put).");
  }
  return env.STRIPE_SECRET_KEY;
}

interface StripeResponse {
  id?: string;
  url?: string;
  payment_status?: string;
  error?: { message?: string };
}

async function stripeFetch(env: Env, path: string, init?: RequestInit): Promise<StripeResponse> {
  const key = requireKey(env);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${base64Encode(`${key}:`)}`, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => ({}))) as StripeResponse;
  if (!res.ok) {
    throw new Error(`Stripe request failed (HTTP ${res.status}): ${body.error?.message ?? "unknown error"}.`);
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

export const stripeProvider: PaymentProvider = {
  id: "stripe",
  name: "Stripe",
  description: "Stripe — cards and wallets worldwide. Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
  requiresKey: true,

  isConfigured(env: Env): boolean {
    return env.STRIPE_SECRET_KEY !== undefined && env.STRIPE_SECRET_KEY !== "";
  },

  configuredDetail(env: Env): string {
    return this.isConfigured(env)
      ? "Secret key is set (wrangler secret). Webhooks are verified with HMAC-SHA256 against STRIPE_WEBHOOK_SECRET (300 s tolerance)."
      : "Not configured: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET with `wrangler secret put`.";
  },

  async createCheckout(env: Env, input: PaymentCheckoutInput): Promise<PaymentCheckout> {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", input.successUrl);
    form.set("cancel_url", input.cancelUrl);
    form.set("client_reference_id", input.order.id);
    form.set("line_items[0][price_data][currency]", input.order.currency.toLowerCase());
    form.set("line_items[0][price_data][product_data][name]", `Order ${input.order.id}`);
    form.set("line_items[0][price_data][unit_amount]", String(input.order.totalMinor));
    form.set("line_items[0][quantity]", "1");
    const body = await stripeFetch(env, "/v1/checkout/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (body.url === undefined || body.url === "" || body.id === undefined || body.id === "") {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return { checkoutUrl: body.url, reference: body.id };
  },

  async verifyPayment(_db: Db, env: Env, reference: string): Promise<PaymentVerification> {
    const body = await stripeFetch(env, `/v1/checkout/sessions/${encodeURIComponent(reference)}`);
    if (body.payment_status === "paid") return { status: "paid", rawStatus: "paid" };
    if (body.payment_status === "unpaid") return { status: "pending", rawStatus: "unpaid" };
    return { status: "unknown", rawStatus: body.payment_status ?? "unknown" };
  },

  async verifyWebhook(env: Env, rawBody: string, headers: Headers): Promise<WebhookResult> {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (secret === undefined || secret === "") {
      return { valid: false, event: "", reference: null, paid: false, detail: "Stripe webhook secret is not configured (set STRIPE_WEBHOOK_SECRET)." };
    }
    const header = headers.get("stripe-signature") ?? "";
    const parts = new Map(header.split(",").map((kv) => {
      const [k, ...rest] = kv.split("=");
      return [k ?? "", rest.join("=")] as [string, string];
    }));
    const timestamp = parts.get("t") ?? "";
    const signature = parts.get("v1") ?? "";
    if (timestamp === "" || signature === "") {
      return { valid: false, event: "", reference: null, paid: false, detail: "Stripe signature header is missing its timestamp or v1 signature." };
    }
    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
      return { valid: false, event: "", reference: null, paid: false, detail: "Stripe webhook timestamp is outside the 300-second tolerance (possible replay)." };
    }
    const expected = await hmacHex("SHA-256", secret, `${timestamp}.${rawBody}`);
    if (!timingSafeEqual(signature, expected)) {
      return { valid: false, event: "", reference: null, paid: false, detail: "Stripe webhook signature does not match." };
    }
    const body = parseBody(rawBody);
    const event = typeof body.type === "string" ? body.type : "";
    const data = typeof body.data === "object" && body.data !== null ? (body.data as Record<string, unknown>) : {};
    const object = typeof data.object === "object" && data.object !== null ? (data.object as Record<string, unknown>) : {};
    const reference = typeof object.id === "string" ? object.id : null;
    const paid = event === "checkout.session.completed" && object.payment_status === "paid" && reference !== null;
    return {
      valid: true,
      event,
      reference,
      paid,
      detail: paid ? "Stripe checkout session paid." : `Stripe event "${event}" (payment_status ${String(object.payment_status ?? "?")}) is not a completed payment.`,
    };
  },
};
