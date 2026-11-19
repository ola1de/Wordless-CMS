/**
 * Mock payment provider (Milestone 8) — test mode only.
 *
 * Deterministic, no network, no money. createCheckout returns a
 * test-mode page on this same site (/shop/checkout/test) — never a
 * fake external checkout URL. The webhook is verified with HMAC-SHA256
 * against MOCK_PAYMENT_WEBHOOK_SECRET (set it in .dev.vars for local
 * dev, or in wrangler secrets; when unset, every mock webhook is
 * rejected — there is no signature bypass anywhere).
 *
 * The mock is NEVER presented as a real payment provider: the admin
 * shows it as "Mock (test mode only — no money moves)".
 */
import { queryOne } from "../../../db";
import type { Db } from "../../../db";
import type { Env } from "../../../env";
import { hmacHex, timingSafeEqual } from "./hmac";
import type { PaymentCheckout, PaymentCheckoutInput, PaymentProvider, PaymentVerification, WebhookResult } from "./types";

function parseBody(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const mockPaymentProvider: PaymentProvider = {
  id: "mock",
  name: "Mock (test mode only)",
  description:
    "Local development and tests only — no money moves. Checkout opens a test page on this site; the webhook is HMAC-verified with MOCK_PAYMENT_WEBHOOK_SECRET.",
  requiresKey: false,

  isConfigured(_env: Env): boolean {
    return true;
  },

  configuredDetail(_env: Env): string {
    return "Always available in local development and tests. No real payment is ever processed.";
  },

  async createCheckout(_env: Env, input: PaymentCheckoutInput): Promise<PaymentCheckout> {
    const reference = `mock_${input.order.id}`;
    const checkoutUrl = `${input.siteUrl}/shop/checkout/test?reference=${encodeURIComponent(reference)}&order=${encodeURIComponent(input.order.id)}`;
    return { checkoutUrl, reference };
  },

  async verifyPayment(db: Db, _env: Env, reference: string): Promise<PaymentVerification> {
    // The mock's source of truth is the webhook log: paid only when a
    // verified mock webhook for this reference was accepted.
    const row = await queryOne<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM wl_webhook_log WHERE provider = 'mock' AND reference = ? AND result = 'accepted'",
      [reference],
    );
    return { status: (row?.n ?? 0) > 0 ? "paid" : "pending", rawStatus: (row?.n ?? 0) > 0 ? "accepted" : "no-webhook-yet" };
  },

  async verifyWebhook(env: Env, rawBody: string, headers: Headers): Promise<WebhookResult> {
    const secret = env.MOCK_PAYMENT_WEBHOOK_SECRET;
    if (secret === undefined || secret === "") {
      return {
        valid: false,
        event: "",
        reference: null,
        paid: false,
        detail: "Mock webhook secret is not configured (set MOCK_PAYMENT_WEBHOOK_SECRET). No mock webhook is accepted without it.",
      };
    }
    const signature = headers.get("x-mock-signature") ?? "";
    const expected = await hmacHex("SHA-256", secret, rawBody);
    if (signature === "" || !timingSafeEqual(signature, expected)) {
      return { valid: false, event: "", reference: null, paid: false, detail: "Mock webhook signature does not match." };
    }
    const body = parseBody(rawBody);
    const event = typeof body.event === "string" ? body.event : "";
    const reference = typeof body.reference === "string" ? body.reference : null;
    const paid = event === "payment.paid" && reference !== null;
    return {
      valid: true,
      event,
      reference,
      paid,
      detail: paid ? "Mock test payment confirmed." : `Mock webhook event "${event}" is not a payment confirmation.`,
    };
  },
};
