/**
 * Commerce tests (Milestone 8): money (integer minor units only),
 * products, cart stock checks, order flow + stock transitions,
 * checkout provider resolution (503 with no provider, mock success),
 * webhook HMAC verification + replay idempotency, and the
 * commerce-assistant report matching direct queries.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import type { Env } from "../../env";
import { formatMoney, requireMinorUnits, toMajorUnits, toMinorUnits } from "./money";
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "./products";
import { addToCart, clearCart, getCart, newCartToken, setCartQuantity } from "./cart";
import { createOrderFromCart, getOrder, getOrderByReference, listOrders, setOrderPayment, transitionOrder } from "./orders";
import { handlePaymentWebhook } from "./webhooks";
import { hmacHex } from "./payments/hmac";
import { mockPaymentProvider } from "./payments/mock";
import { resolvePaymentProvider, setSelectedPaymentProviderId } from "./payments/index";
import { commerceAssistant } from "../../ai/agents/commerce";
import { mockProvider } from "../../ai/providers/mock";

const MOCK_SECRET = "test-only-mock-webhook-secret";
const mockEnv = { MOCK_PAYMENT_WEBHOOK_SECRET: MOCK_SECRET } as unknown as Env;
const emptyEnv = {} as unknown as Env;

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

async function makeProduct(overrides: Record<string, unknown> = {}) {
  return createProduct(tdb.db, {
    name: "Pack Hoodie",
    priceMinor: 125000,
    currency: "NGN",
    stock: 5,
    status: "published",
    ...overrides,
  });
}

async function makePaidOrder(): Promise<{ orderId: string; productId: number; reference: string }> {
  const product = await makeProduct();
  const token = newCartToken();
  await addToCart(tdb.db, token, product.id, 2);
  const order = await createOrderFromCart(tdb.db, token, { customerName: "Ada", customerEmail: "ada@example.test" });
  const checkout = await mockPaymentProvider.createCheckout(mockEnv, {
    order,
    siteUrl: "http://localhost:8787",
    successUrl: "http://localhost:8787/shop/checkout/success",
    cancelUrl: "http://localhost:8787/shop/checkout/cancelled",
  });
  await setOrderPayment(tdb.db, order.id, "mock", checkout.reference);
  return { orderId: order.id, productId: product.id, reference: checkout.reference };
}

async function postMockWebhook(reference: string, secret = MOCK_SECRET): Promise<Response> {
  const body = JSON.stringify({ event: "payment.paid", reference });
  const signature = await hmacHex("SHA-256", secret, body);
  const request = new Request("http://localhost/api/commerce/webhooks/mock", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mock-signature": signature },
    body,
  });
  const outcome = await handlePaymentWebhook(tdb.db, mockEnv, "mock", request);
  return new Response(JSON.stringify(outcome), { status: outcome.httpStatus });
}

describe("money", () => {
  it("formats minor units with the right symbol and grouping", () => {
    expect(formatMoney(125000, "NGN")).toBe("₦1,250.00");
    expect(formatMoney(999, "USD")).toBe("$9.99");
    expect(formatMoney(0, "EUR")).toBe("€0.00");
    expect(formatMoney(100, "XXX")).toBe("XXX 1.00");
  });

  it("rejects fractional prices", () => {
    expect(() => requireMinorUnits(12.5, "priceMinor")).toThrow(/integer/);
    expect(() => requireMinorUnits("1250", "priceMinor")).toThrow(/integer/);
    expect(requireMinorUnits(1250, "priceMinor")).toBe(1250);
  });

  it("converts minor/major units without float drift", () => {
    expect(toMinorUnits(1250)).toBe(125000);
    expect(toMajorUnits(125000)).toBe(1250);
  });
});

describe("products", () => {
  it("creates, reads, updates and lists products", async () => {
    const created = await makeProduct();
    expect(created.slug).toBe("pack-hoodie");
    expect(created.priceMinor).toBe(125000);
    const updated = await updateProduct(tdb.db, created.id, { priceMinor: 150000, stock: 3 });
    expect(updated.priceMinor).toBe(150000);
    expect(updated.stock).toBe(3);
    const list = await listProducts(tdb.db, { status: "published" });
    expect(list.total).toBe(1);
    expect(await getProduct(tdb.db, created.id)).toMatchObject({ name: "Pack Hoodie" });
  });

  it("makes slugs unique with a numeric suffix", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    expect(a.slug).toBe("pack-hoodie");
    expect(b.slug).toBe("pack-hoodie-2");
  });

  it("rejects fractional prices and bad currency", async () => {
    await expect(createProduct(tdb.db, { name: "Bad", priceMinor: 10.5 })).rejects.toThrow(/integer/);
    await expect(createProduct(tdb.db, { name: "Bad", currency: "Naira" })).rejects.toThrow(/currency/);
  });

  it("refuses to delete a product that appears in an order", async () => {
    const { productId } = await makePaidOrder();
    await expect(deleteProduct(tdb.db, productId)).rejects.toThrow(/cannot be deleted/);
    const spare = await makeProduct({ name: "Spare" });
    expect(await deleteProduct(tdb.db, spare.id)).toBe(true);
  });
});

describe("cart", () => {
  it("adds items, enforces stock, and totals in minor units", async () => {
    const product = await makeProduct();
    const token = newCartToken();
    const cart = await addToCart(tdb.db, token, product.id, 2);
    expect(cart.totalMinor).toBe(250000);
    expect(cart.lines[0]?.quantity).toBe(2);
    await expect(addToCart(tdb.db, token, product.id, 4)).rejects.toThrow(/Only 5 .* in stock/);
    const reduced = await setCartQuantity(tdb.db, token, product.id, 1);
    expect(reduced.totalMinor).toBe(125000);
    await clearCart(tdb.db, token);
    expect((await getCart(tdb.db, token)).lines).toHaveLength(0);
  });

  it("refuses draft products", async () => {
    const product = await makeProduct({ status: "draft" });
    await expect(addToCart(tdb.db, newCartToken(), product.id, 1)).rejects.toThrow(/not available/);
  });

  it("allows unlimited stock (-1) without a cap", async () => {
    const product = await makeProduct({ stock: -1 });
    const cart = await addToCart(tdb.db, newCartToken(), product.id, 99);
    expect(cart.lines[0]?.quantity).toBe(99);
  });
});

describe("orders + stock", () => {
  it("creates a pending order from the cart and snapshots prices", async () => {
    const product = await makeProduct();
    const token = newCartToken();
    await addToCart(tdb.db, token, product.id, 2);
    const order = await createOrderFromCart(tdb.db, token, { customerName: "Ada", customerEmail: "ada@example.test" });
    expect(order.status).toBe("pending");
    expect(order.totalMinor).toBe(250000);
    expect(order.items[0]).toMatchObject({ productId: product.id, name: "Pack Hoodie", priceMinor: 125000, quantity: 2 });
    expect((await getCart(tdb.db, token)).lines).toHaveLength(0); // the cart is consumed by the order
  });

  it("refuses an empty cart and bad customer details", async () => {
    await expect(
      createOrderFromCart(tdb.db, newCartToken(), { customerName: "Ada", customerEmail: "ada@example.test" }),
    ).rejects.toThrow(/cart is empty/);
    const product = await makeProduct();
    const token = newCartToken();
    await addToCart(tdb.db, token, product.id, 1);
    await expect(createOrderFromCart(tdb.db, token, { customerName: "Ada", customerEmail: "not-an-email" })).rejects.toThrow(
      /valid email/,
    );
  });

  it("decrements stock exactly once when paid, and restores it on cancel", async () => {
    const { orderId, productId } = await makePaidOrder();
    const paid = await transitionOrder(tdb.db, orderId, "paid");
    expect(paid.status).toBe("paid");
    expect(paid.stockApplied).toBe(true);
    expect((await getProduct(tdb.db, productId))?.stock).toBe(3); // 5 - 2
    // A second "paid" transition is refused — stock can never apply twice.
    await expect(transitionOrder(tdb.db, orderId, "paid")).rejects.toThrow(/cannot move/);
    expect((await getProduct(tdb.db, productId))?.stock).toBe(3);
    const cancelled = await transitionOrder(tdb.db, orderId, "cancelled");
    expect(cancelled.status).toBe("cancelled");
    expect((await getProduct(tdb.db, productId))?.stock).toBe(5);
  });

  it("refuses illegal transitions", async () => {
    const product = await makeProduct();
    const token = newCartToken();
    await addToCart(tdb.db, token, product.id, 1);
    const order = await createOrderFromCart(tdb.db, token, { customerName: "Ada", customerEmail: "ada@example.test" });
    await expect(transitionOrder(tdb.db, order.id, "fulfilled")).rejects.toThrow(/cannot move from pending to fulfilled/);
  });

  it("lists orders with their items", async () => {
    await makePaidOrder();
    const list = await listOrders(tdb.db, {});
    expect(list.total).toBe(1);
    expect(list.orders[0]?.items).toHaveLength(1);
    expect(await getOrderByReference(tdb.db, list.orders[0]?.id ?? "")).not.toBeNull();
  });
});

describe("checkout provider resolution", () => {
  it("refuses checkout with no provider selected (503, never a fake success)", async () => {
    await expect(resolvePaymentProvider(tdb.db, emptyEnv)).rejects.toMatchObject({
      code: "payment_not_configured",
      status: 503,
    });
  });

  it("resolves the mock provider when selected", async () => {
    await setSelectedPaymentProviderId(tdb.db, "mock");
    const { provider, mode } = await resolvePaymentProvider(tdb.db, mockEnv);
    expect(provider.id).toBe("mock");
    expect(mode).toBe("test");
  });

  it("refuses an unconfigured real provider", async () => {
    await setSelectedPaymentProviderId(tdb.db, "paystack");
    await expect(resolvePaymentProvider(tdb.db, emptyEnv)).rejects.toThrow(/not configured/);
  });
});

describe("mock webhook end-to-end", () => {
  it("marks the order paid with a valid signature and logs the confirmation mail", async () => {
    const { orderId, reference } = await makePaidOrder();
    const res = await postMockWebhook(reference);
    expect(res.status).toBe(200);
    const order = await getOrder(tdb.db, orderId);
    expect(order?.status).toBe("paid");
    expect(order?.stockApplied).toBe(true);
    // The order-confirmation email was logged (mock provider: logged, not delivered).
    const mail = await tdb.db
      .prepare("SELECT * FROM wl_mail_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
      .bind("ada@example.test")
      .first<{ status: string; subject: string }>();
    expect(mail?.status).toBe("logged");
    expect(mail?.subject).toContain(orderId);
  });

  it("rejects a bad signature with 401 and leaves the order pending", async () => {
    const { orderId, reference } = await makePaidOrder();
    const res = await postMockWebhook(reference, "wrong-secret");
    expect(res.status).toBe(401);
    expect((await getOrder(tdb.db, orderId))?.status).toBe("pending");
  });

  it("rejects a webhook when the mock secret is not configured at all", async () => {
    const { orderId, reference } = await makePaidOrder();
    const body = JSON.stringify({ event: "payment.paid", reference });
    const signature = await hmacHex("SHA-256", MOCK_SECRET, body);
    const request = new Request("http://localhost/api/commerce/webhooks/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-signature": signature },
      body,
    });
    const outcome = await handlePaymentWebhook(tdb.db, emptyEnv, "mock", request);
    expect(outcome.httpStatus).toBe(401);
    expect((await getOrder(tdb.db, orderId))?.status).toBe("pending");
  });

  it("a replayed webhook does not double-pay or double-decrement stock", async () => {
    const { orderId, productId, reference } = await makePaidOrder();
    expect((await postMockWebhook(reference)).status).toBe(200);
    expect((await postMockWebhook(reference)).status).toBe(200);
    expect((await getOrder(tdb.db, orderId))?.status).toBe("paid");
    expect((await getProduct(tdb.db, productId))?.stock).toBe(3); // 5 - 2, once
    const log = await tdb.db
      .prepare("SELECT COUNT(*) AS n FROM wl_webhook_log WHERE provider = 'mock' AND result = 'duplicate'")
      .first<{ n: number }>();
    expect(log?.n).toBe(1);
  });

  it("answers 200 for an unknown reference (providers stop retrying)", async () => {
    const res = await postMockWebhook("mock_does-not-exist");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: string };
    expect(body.order).toBe("not_found");
  });

  it("an empty-reference webhook cannot pay an order whose reference was never assigned", async () => {
    // A checkout that fails before setOrderPayment (e.g. no provider
    // configured) leaves a pending order with an empty payment_reference.
    const product = await makeProduct();
    const token = newCartToken();
    await addToCart(tdb.db, token, product.id, 1);
    const pending = await createOrderFromCart(tdb.db, token, {
      customerName: "No Provider",
      customerEmail: "np@example.test",
    });
    expect(pending.paymentReference).toBe("");
    expect(await getOrderByReference(tdb.db, "")).toBeNull();
    const res = await postMockWebhook("");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: string };
    expect(body.order).toBe("not_found");
    expect((await getOrder(tdb.db, pending.id))?.status).toBe("pending");
    expect((await getProduct(tdb.db, product.id))?.stock).toBe(5);
  });
});

describe("commerce-assistant", () => {
  it("reports products, orders, revenue and low stock from stored rows", async () => {
    const { orderId } = await makePaidOrder();
    await transitionOrder(tdb.db, orderId, "paid");
    await makeProduct({ name: "Almost Gone", stock: 2, priceMinor: 5000 });
    const result = await commerceAssistant.run({
      db: tdb.db,
      env: mockEnv,
      provider: mockProvider,
      providerConfigured: true,
      input: "How is the store doing?",
      memoryText: "",
      userId: 0,
    });
    expect(result.data?.products).toBe(2);
    expect(result.data?.ordersByStatus).toMatchObject({ paid: 1 });
    expect(result.data?.revenueMinor).toBe(250000);
    expect(result.data?.revenueFormatted).toBe("₦2,500.00");
    expect(result.data?.lowStock).toEqual([
      { id: 2, name: "Almost Gone", slug: "almost-gone", stock: 2 },
      { id: 1, name: "Pack Hoodie", slug: "pack-hoodie", stock: 3 },
    ]);
    expect(result.summary).toContain("₦2,500.00");
  });
});
