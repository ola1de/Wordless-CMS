/**
 * Payment webhooks (Milestone 8).
 *
 * POST /api/commerce/webhooks/:provider — no session auth; the
 * provider signature IS the auth. Every attempt is logged in
 * wl_webhook_log (provider, event, reference, result) — never the
 * secret, never the raw body. A valid "paid" event transitions the
 * order pending → paid exactly once: a replayed webhook finds the
 * order already paid and is logged as a duplicate, never re-applied.
 * Unknown references and cancelled orders are answered 200 (so the
 * provider stops retrying) with a body that says what happened.
 * The order-confirmation email is best-effort — a mail failure never
 * fails a webhook.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import type { Env } from "../../env";
import { badRequest } from "../../kernel/errors";
import { siteUrl } from "../feeds/service";
import { sendMail } from "../integrations/email";
import { getOrderByReference, transitionOrder } from "./orders";
import { formatMoney } from "./money";
import { getPaymentProvider } from "./payments/index";
import { isPaymentProviderId } from "./payments/types";

async function logWebhook(
  db: Db,
  provider: string,
  event: string,
  reference: string | null,
  result: "accepted" | "rejected" | "duplicate" | "ignored" | "error",
  detail: string,
): Promise<void> {
  try {
    await execRun(
      db,
      "INSERT INTO wl_webhook_log (provider, event, reference, result, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [provider, event, reference ?? "", result, detail.slice(0, 500), nowIso()],
    );
  } catch {
    // Webhook logging must never break the webhook response.
  }
}

export interface WebhookOutcome {
  httpStatus: number;
  received: boolean;
  order?: "paid" | "duplicate" | "not_found" | "cancelled" | "not_paid_event";
  detail: string;
}

export interface WebhookLogEntry {
  id: number;
  provider: string;
  event: string;
  reference: string;
  result: string;
  detail: string;
  createdAt: string;
}

/** Recent webhook attempts (admin only) — provider, event, reference, result. Never a secret. */
export async function listWebhookLog(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<{ entries: WebhookLogEntry[]; total: number; page: number; perPage: number; totalPages: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const totalRow = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_webhook_log");
  const rows = await queryAll<{
    id: number;
    provider: string;
    event: string;
    reference: string;
    result: string;
    detail: string;
    created_at: string;
  }>(db, "SELECT * FROM wl_webhook_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [perPage, offset]);
  const total = totalRow?.n ?? 0;
  return {
    entries: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      event: r.event,
      reference: r.reference,
      result: r.result,
      detail: r.detail,
      createdAt: r.created_at,
    })),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function handlePaymentWebhook(
  db: Db,
  env: Env,
  providerId: string,
  request: Request,
): Promise<WebhookOutcome> {
  if (!isPaymentProviderId(providerId)) {
    throw badRequest(`Unknown payment provider "${providerId}".`);
  }
  const provider = getPaymentProvider(providerId);
  const rawBody = await request.text();
  const result = await provider.verifyWebhook(env, rawBody, request.headers);
  if (!result.valid) {
    await logWebhook(db, providerId, result.event, result.reference, "rejected", result.detail);
    return { httpStatus: 401, received: false, detail: result.detail };
  }
  if (!result.paid) {
    await logWebhook(db, providerId, result.event, result.reference, "ignored", result.detail);
    return { httpStatus: 200, received: true, order: "not_paid_event", detail: result.detail };
  }
  if (result.reference === null || result.reference === "") {
    await logWebhook(db, providerId, result.event, null, "error", "Verified webhook carried no reference.");
    return { httpStatus: 200, received: true, order: "not_found", detail: "Verified webhook carried no reference." };
  }
  const order = await getOrderByReference(db, result.reference);
  if (order === null) {
    await logWebhook(db, providerId, result.event, result.reference, "error", `No order matches reference "${result.reference}".`);
    return { httpStatus: 200, received: true, order: "not_found", detail: `No order matches reference "${result.reference}".` };
  }
  if (order.status === "paid" || order.status === "fulfilled") {
    await logWebhook(db, providerId, result.event, result.reference, "duplicate", `Order ${order.id} is already ${order.status}; replay ignored.`);
    return { httpStatus: 200, received: true, order: "duplicate", detail: `Order ${order.id} is already ${order.status}.` };
  }
  if (order.status === "cancelled") {
    await logWebhook(db, providerId, result.event, result.reference, "ignored", `Order ${order.id} is cancelled; payment not applied.`);
    return { httpStatus: 200, received: true, order: "cancelled", detail: `Order ${order.id} is cancelled.` };
  }
  try {
    const paid = await transitionOrder(db, order.id, "paid");
    await logWebhook(db, providerId, result.event, result.reference, "accepted", `Order ${order.id} marked paid.`);
    // Order confirmation email (best-effort — never fails the webhook).
    try {
      const base = await siteUrl(db);
      const lines = paid.items
        .map((item) => `  - ${item.name} × ${item.quantity} — ${formatMoney(item.priceMinor * item.quantity, paid.currency)}`)
        .join("\n");
      await sendMail(db, env, {
        to: paid.customerEmail,
        subject: `Your order ${paid.id} is confirmed`,
        text:
          `Hi ${paid.customerName},\n\nThank you — your order ${paid.id} is confirmed and paid.\n\n${lines}\n\nTotal: ${formatMoney(paid.totalMinor, paid.currency)}\n\nYou can view your order at ${base}/shop/checkout/success?order=${paid.id}\n`,
      });
    } catch {
      // Mail failures are recorded in wl_mail_log by sendMail; ignore here.
    }
    return { httpStatus: 200, received: true, order: "paid", detail: `Order ${order.id} marked paid.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not mark the order paid.";
    await logWebhook(db, providerId, result.event, result.reference, "error", message);
    return { httpStatus: 200, received: true, order: "not_found", detail: message };
  }
}
