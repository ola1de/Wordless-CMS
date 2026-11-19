/**
 * Payment webhook verification tests (Milestone 8).
 *
 * The HMAC implementation is checked against Node's crypto (an
 * independent implementation) and each provider's signature scheme is
 * exercised with computed signatures: a correct signature verifies,
 * a wrong one is rejected, and Stripe's timestamp tolerance rejects
 * stale replays. No live provider call is made anywhere in this file.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import type { Env } from "../../env";
import { hmacHex, timingSafeEqual } from "./payments/hmac";
import { paystackProvider } from "./payments/paystack";
import { flutterwaveProvider } from "./payments/flutterwave";
import { stripeProvider } from "./payments/stripe";
import { mockPaymentProvider } from "./payments/mock";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("hmac helpers", () => {
  it("matches Node's crypto for SHA-256 and SHA-512", async () => {
    const key = "test-key";
    const data = "the quick brown fox";
    expect(await hmacHex("SHA-256", key, data)).toBe(createHmac("sha256", key).update(data).digest("hex"));
    expect(await hmacHex("SHA-512", key, data)).toBe(createHmac("sha512", key).update(data).digest("hex"));
  });

  it("compares in constant time (equal strings only)", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("Paystack webhook", () => {
  const env = { PAYSTACK_SECRET_KEY: "sk_test_paystack_secret" } as unknown as Env;
  const body = JSON.stringify({
    event: "charge.success",
    data: { reference: "order-1", status: "success", amount: 125000 },
  });

  it("verifies a correctly computed HMAC-SHA512 signature", async () => {
    const signature = createHmac("sha512", "sk_test_paystack_secret").update(body).digest("hex");
    const result = await paystackProvider.verifyWebhook(
      env,
      body,
      new Headers({ "x-paystack-signature": signature }),
    );
    expect(result).toMatchObject({ valid: true, event: "charge.success", reference: "order-1", paid: true });
  });

  it("rejects a wrong signature", async () => {
    const result = await paystackProvider.verifyWebhook(env, body, new Headers({ "x-paystack-signature": "deadbeef" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an unsigned webhook", async () => {
    const result = await paystackProvider.verifyWebhook(env, body, new Headers());
    expect(result.valid).toBe(false);
  });

  it("accepts the signature but does not mark a failed charge paid", async () => {
    const failed = JSON.stringify({
      event: "charge.success",
      data: { reference: "order-1", status: "failed", amount: 125000 },
    });
    const signature = createHmac("sha512", "sk_test_paystack_secret").update(failed).digest("hex");
    const result = await paystackProvider.verifyWebhook(
      env,
      failed,
      new Headers({ "x-paystack-signature": signature }),
    );
    expect(result.valid).toBe(true);
    expect(result.paid).toBe(false);
  });

  it("reports not configured without a secret key", async () => {
    const result = await paystackProvider.verifyWebhook({} as unknown as Env, body, new Headers());
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/not configured/);
    expect(paystackProvider.isConfigured({} as unknown as Env)).toBe(false);
  });
});

describe("Flutterwave webhook", () => {
  const env = {
    FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-xxx",
    FLUTTERWAVE_SECRET_HASH: "flw-secret-hash",
  } as unknown as Env;
  const body = JSON.stringify({
    event: "charge.completed",
    data: { tx_ref: "order-2", status: "successful", amount: 1250 },
  });

  it("verifies when verif-hash matches the configured secret hash", async () => {
    const result = await flutterwaveProvider.verifyWebhook(env, body, new Headers({ "verif-hash": "flw-secret-hash" }));
    expect(result).toMatchObject({ valid: true, event: "charge.completed", reference: "order-2", paid: true });
  });

  it("rejects a mismatched verif-hash", async () => {
    const result = await flutterwaveProvider.verifyWebhook(env, body, new Headers({ "verif-hash": "someone-else" }));
    expect(result.valid).toBe(false);
  });

  it("does not mark an unsuccessful charge paid", async () => {
    const failed = JSON.stringify({
      event: "charge.completed",
      data: { tx_ref: "order-2", status: "failed", amount: 1250 },
    });
    const result = await flutterwaveProvider.verifyWebhook(env, failed, new Headers({ "verif-hash": "flw-secret-hash" }));
    expect(result.valid).toBe(true);
    expect(result.paid).toBe(false);
  });
});

describe("Stripe webhook", () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_stripe", STRIPE_WEBHOOK_SECRET: "whsec_test" } as unknown as Env;
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_123", payment_status: "paid" } },
  });

  function signedHeaders(rawBody: string, timestamp: number): Headers {
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${rawBody}`).digest("hex");
    return new Headers({ "stripe-signature": `t=${timestamp},v1=${signature}` });
  }

  it("verifies a correctly signed, fresh webhook", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = await stripeProvider.verifyWebhook(env, body, signedHeaders(body, ts));
    expect(result).toMatchObject({ valid: true, event: "checkout.session.completed", reference: "cs_test_123", paid: true });
  });

  it("rejects a tampered signature", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = await stripeProvider.verifyWebhook(
      env,
      body,
      new Headers({ "stripe-signature": `t=${ts},v1=deadbeef` }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const ts = Math.floor(Date.now() / 1000) - 3600;
    const result = await stripeProvider.verifyWebhook(env, body, signedHeaders(body, ts));
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/300-second/);
  });

  it("does not mark an unpaid session paid", async () => {
    const unpaid = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", payment_status: "unpaid" } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const result = await stripeProvider.verifyWebhook(env, unpaid, signedHeaders(unpaid, ts));
    expect(result.valid).toBe(true);
    expect(result.paid).toBe(false);
  });
});

describe("mock provider webhook", () => {
  it("accepts a correctly signed test webhook", async () => {
    const env = { MOCK_PAYMENT_WEBHOOK_SECRET: "s3cret" } as unknown as Env;
    const body = JSON.stringify({ event: "payment.paid", reference: "mock_order-1" });
    const signature = await hmacHex("SHA-256", "s3cret", body);
    const result = await mockPaymentProvider.verifyWebhook(env, body, new Headers({ "x-mock-signature": signature }));
    expect(result).toMatchObject({ valid: true, event: "payment.paid", reference: "mock_order-1", paid: true });
  });

  it("rejects when no mock secret is configured", async () => {
    const body = JSON.stringify({ event: "payment.paid", reference: "mock_order-1" });
    const result = await mockPaymentProvider.verifyWebhook({} as unknown as Env, body, new Headers());
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/not configured/);
  });
});

describe("provider configured state", () => {
  it("reports each provider honestly from env", () => {
    expect(mockPaymentProvider.isConfigured({} as unknown as Env)).toBe(true);
    expect(stripeProvider.isConfigured({} as unknown as Env)).toBe(false);
    expect(stripeProvider.isConfigured({ STRIPE_SECRET_KEY: "sk_test_x" } as unknown as Env)).toBe(true);
    expect(flutterwaveProvider.isConfigured({ FLUTTERWAVE_SECRET_KEY: "x" } as unknown as Env)).toBe(true);
    expect(paystackProvider.isConfigured({ PAYSTACK_SECRET_KEY: "x" } as unknown as Env)).toBe(true);
  });
});
