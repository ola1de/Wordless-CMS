/**
 * Payment provider abstraction (Milestone 8).
 *
 * Every provider implements the same three operations:
 * - createCheckout: start a payment for a pending order → a URL the
 *   customer is sent to + a reference stored on the order.
 * - verifyPayment: ask the provider what happened to a reference.
 * - verifyWebhook: prove a webhook really came from the provider.
 *   The signature IS the auth for webhooks — there is no session.
 *
 * Honesty rules: a provider with no secret key reports configured:
 * false and createCheckout refuses; nothing here ever marks an order
 * paid without a verified signal. The mock provider is test-mode only
 * and says so in every message.
 */
import type { Db } from "../../../db";
import type { Env } from "../../../env";
import { WordlessError } from "../../../kernel/errors";
import type { Order } from "../types";

export type PaymentProviderId = "paystack" | "flutterwave" | "stripe" | "mock";

export const PAYMENT_PROVIDER_IDS: PaymentProviderId[] = ["paystack", "flutterwave", "stripe", "mock"];

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return typeof value === "string" && (PAYMENT_PROVIDER_IDS as string[]).includes(value);
}

export interface PaymentCheckoutInput {
  order: Order;
  siteUrl: string;
  /** Where the provider sends the customer after a successful payment. */
  successUrl: string;
  /** Where the provider sends the customer when they abandon payment. */
  cancelUrl: string;
}

export interface PaymentCheckout {
  /** URL the customer is redirected to. */
  checkoutUrl: string;
  /** Provider reference stored on the order (used by webhooks + verify). */
  reference: string;
}

export interface PaymentVerification {
  status: "paid" | "pending" | "failed" | "unknown";
  /** Provider's own status string, for the webhook log. */
  rawStatus?: string;
}

export interface WebhookResult {
  /** The signature checked out. */
  valid: boolean;
  /** Provider event name ("" when the body is not parseable). */
  event: string;
  /** Order/payment reference from the payload, if any. */
  reference: string | null;
  /** True only when the provider says the payment succeeded. */
  paid: boolean;
  /** Plain-language explanation for the webhook log. */
  detail: string;
}

export interface PaymentProvider {
  id: PaymentProviderId;
  name: string;
  description: string;
  /** True when the provider needs a secret key from env/secrets. */
  requiresKey: boolean;
  /** True only when a checkout call could succeed right now. */
  isConfigured(env: Env): boolean;
  configuredDetail(env: Env): string;
  createCheckout(env: Env, input: PaymentCheckoutInput): Promise<PaymentCheckout>;
  verifyPayment(db: Db, env: Env, reference: string): Promise<PaymentVerification>;
  verifyWebhook(env: Env, rawBody: string, headers: Headers): Promise<WebhookResult>;
}

/** Error type for "no payment provider is configured" (checkout → 503, never a fake success). */
export function paymentNotConfigured(message: string): WordlessError {
  return new WordlessError("payment_not_configured", 503, message);
}
