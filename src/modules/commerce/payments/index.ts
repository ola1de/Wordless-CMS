/**
 * Payment provider registry + selection (Milestone 8).
 *
 * The selected provider and mode (test/live) are non-secret config in
 * wp_options (`wl_payment_provider`, `wl_payment_mode`); the keys
 * themselves live only in env/secrets. Mode is recorded for display
 * and for the admin's own checks — it does not change provider
 * behaviour: test-mode keys only ever talk to test endpoints because
 * that is what the key itself is. There is no "pretend to be live".
 */
import { getOption, setOption } from "../../options/service";
import type { Db } from "../../../db";
import type { Env } from "../../../env";
import { badRequest } from "../../../kernel/errors";
import { flutterwaveProvider } from "./flutterwave";
import { mockPaymentProvider } from "./mock";
import { paystackProvider } from "./paystack";
import { stripeProvider } from "./stripe";
import type { PaymentProvider, PaymentProviderId } from "./types";
import { isPaymentProviderId, paymentNotConfigured } from "./types";

export const PAYMENT_PROVIDER_OPTION = "wl_payment_provider";
export const PAYMENT_MODE_OPTION = "wl_payment_mode";

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  paystackProvider,
  flutterwaveProvider,
  stripeProvider,
  mockPaymentProvider,
];

export function getPaymentProvider(id: PaymentProviderId): PaymentProvider {
  const provider = PAYMENT_PROVIDERS.find((p) => p.id === id);
  if (provider === undefined) throw badRequest(`Unknown payment provider "${id}".`);
  return provider;
}

export function listPaymentProviders(env: Env): Array<{
  id: PaymentProviderId;
  name: string;
  description: string;
  requiresKey: boolean;
  configured: boolean;
  configuredDetail: string;
}> {
  return PAYMENT_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    requiresKey: p.requiresKey,
    configured: p.isConfigured(env),
    configuredDetail: p.configuredDetail(env),
  }));
}

export async function getSelectedPaymentProviderId(db: Db): Promise<PaymentProviderId | null> {
  const selected = await getOption<string | null>(db, PAYMENT_PROVIDER_OPTION, null);
  return selected !== null && isPaymentProviderId(selected) ? selected : null;
}

export async function setSelectedPaymentProviderId(db: Db, value: unknown): Promise<PaymentProviderId | null> {
  if (value === null || value === undefined || value === "") {
    await setOption(db, PAYMENT_PROVIDER_OPTION, null);
    return null;
  }
  if (!isPaymentProviderId(value)) {
    throw badRequest('Field "provider" must be one of: paystack, flutterwave, stripe, mock (or empty to clear).');
  }
  await setOption(db, PAYMENT_PROVIDER_OPTION, value);
  return value;
}

export async function getPaymentMode(db: Db): Promise<"test" | "live"> {
  const mode = await getOption<string>(db, PAYMENT_MODE_OPTION, "test");
  return mode === "live" ? "live" : "test";
}

export async function setPaymentMode(db: Db, value: unknown): Promise<"test" | "live"> {
  if (value !== "test" && value !== "live") {
    throw badRequest('Field "mode" must be "test" or "live".');
  }
  await setOption(db, PAYMENT_MODE_OPTION, value);
  return value;
}

/** The selected provider, or a 503 that says plainly none is selected. */
export async function resolvePaymentProvider(
  db: Db,
  env: Env,
): Promise<{ provider: PaymentProvider; mode: "test" | "live" }> {
  const selected = await getSelectedPaymentProviderId(db);
  if (selected === null) {
    throw paymentNotConfigured(
      "No payment provider is selected. Choose one in Commerce → Payments (a test-mode provider works for local development; no order is ever marked paid without a configured provider).",
    );
  }
  const provider = getPaymentProvider(selected);
  if (!provider.isConfigured(env)) {
    throw paymentNotConfigured(
      `${provider.name} is selected but not configured: ${provider.configuredDetail(env)}`,
    );
  }
  return { provider, mode: await getPaymentMode(db) };
}
