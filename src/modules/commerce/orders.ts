/**
 * Orders (Milestone 8).
 *
 * An order is created from a cart (pending), becomes paid through a
 * verified payment webhook or an admin transition, then fulfilled, or
 * cancelled. Stock is decremented exactly once when an order becomes
 * paid (`stock_applied` guards replays and double clicks) and restored
 * when a paid order is cancelled. Unlimited-stock products (stock -1)
 * never change. Order items snapshot the product name and price at
 * purchase time, so later product edits never rewrite history.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { requireEmail, requireString } from "../../kernel/validate";
import { getCart, clearCart } from "./cart";
import { getProduct } from "./products";
import type { Order, OrderItem, OrderList, OrderStatus } from "./types";

interface OrderRow {
  id: string;
  customer_name: string;
  customer_email: string;
  total_minor: number;
  currency: string;
  status: string;
  payment_provider: string;
  payment_reference: string;
  stock_applied: number;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  id: number;
  order_id: string;
  product_id: number;
  name: string;
  price_minor: number;
  quantity: number;
}

async function orderItems(db: Db, orderId: string): Promise<OrderItem[]> {
  const rows = await queryAll<OrderItemRow>(
    db,
    "SELECT * FROM wl_order_items WHERE order_id = ? ORDER BY id ASC",
    [orderId],
  );
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    productId: r.product_id,
    name: r.name,
    priceMinor: r.price_minor,
    quantity: r.quantity,
  }));
}

function rowToOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    totalMinor: row.total_minor,
    currency: row.currency,
    status: row.status as OrderStatus,
    paymentProvider: row.payment_provider,
    paymentReference: row.payment_reference,
    stockApplied: row.stock_applied === 1,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrder(db: Db, id: string): Promise<Order | null> {
  const row = await queryOne<OrderRow>(db, "SELECT * FROM wl_orders WHERE id = ? LIMIT 1", [id]);
  if (row === null) return null;
  return rowToOrder(row, await orderItems(db, id));
}

/** Find an order by its payment reference, or by its own id (Paystack/Flutterwave use the order id as the reference). */
export async function getOrderByReference(db: Db, reference: string): Promise<Order | null> {
  // An empty reference must never match: orders created by a checkout
  // that failed before a payment reference was assigned carry an empty
  // payment_reference, and a webhook carrying an empty reference must
  // not be able to pay one of them.
  if (reference === "") return null;
  const row = await queryOne<OrderRow>(
    db,
    "SELECT * FROM wl_orders WHERE payment_reference = ? OR id = ? LIMIT 1",
    [reference, reference],
  );
  if (row === null) return null;
  return rowToOrder(row, await orderItems(db, row.id));
}

export async function createOrderFromCart(
  db: Db,
  cartToken: string,
  input: { customerName: unknown; customerEmail: unknown },
): Promise<Order> {
  const customerName = requireString(input.customerName, "customerName", { max: 200 });
  const customerEmail = requireEmail(input.customerEmail, "customerEmail");
  const cart = await getCart(db, cartToken);
  if (cart.lines.length === 0) throw badRequest("The cart is empty.");
  if (cart.currencyNote !== null) throw badRequest(cart.currencyNote);
  // Re-check stock at checkout time: stock can change after add-to-cart.
  for (const line of cart.lines) {
    const product = await getProduct(db, line.productId);
    if (product === null) throw badRequest(`"${line.name}" is no longer available.`);
    if (product.status !== "published") throw badRequest(`"${line.name}" is no longer available for sale.`);
    if (product.stock >= 0 && line.quantity > product.stock) {
      throw badRequest(`Only ${product.stock} of "${line.name}" is in stock.`);
    }
    if (product.priceMinor !== line.priceMinor || product.currency !== line.currency) {
      throw badRequest(`The price of "${line.name}" changed. Please review the cart and try again.`);
    }
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_orders (id, customer_name, customer_email, total_minor, currency, status, payment_provider, payment_reference, stock_applied, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', '', '', 0, ?, ?)`,
    [id, customerName, customerEmail, cart.totalMinor, cart.currency, now, now],
  );
  for (const line of cart.lines) {
    await execRun(
      db,
      `INSERT INTO wl_order_items (order_id, product_id, name, price_minor, quantity, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, line.productId, line.name, line.priceMinor, line.quantity, now],
    );
  }
  const order = await getOrder(db, id);
  if (order === null) throw new Error("Order was not created.");
  // The cart is consumed by the order — it must not survive to be
  // checked out a second time.
  await clearCart(db, cartToken);
  return order;
}

/** Record which provider + reference an order will be paid through. */
export async function setOrderPayment(db: Db, orderId: string, provider: string, reference: string): Promise<Order> {
  const order = await getOrder(db, orderId);
  if (order === null) throw notFound(`Order ${orderId} not found.`);
  if (order.status !== "pending") {
    throw badRequest(`Order ${orderId} is ${order.status} and can no longer be sent to a payment provider.`);
  }
  await execRun(db, "UPDATE wl_orders SET payment_provider = ?, payment_reference = ?, updated_at = ? WHERE id = ?", [
    provider,
    reference,
    nowIso(),
    orderId,
  ]);
  const updated = await getOrder(db, orderId);
  if (updated === null) throw new Error("Order was not updated.");
  return updated;
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

async function applyStock(db: Db, order: Order): Promise<void> {
  if (order.stockApplied) return;
  for (const item of order.items) {
    const product = await getProduct(db, item.productId);
    if (product === null || product.stock < 0) continue;
    if (product.stock < item.quantity) {
      throw badRequest(
        `Not enough stock for "${item.name}" (${product.stock} left, order needs ${item.quantity}). Do not mark this order paid.`,
      );
    }
    await execRun(db, "UPDATE wl_products SET stock = stock - ?, updated_at = ? WHERE id = ?", [
      item.quantity,
      nowIso(),
      item.productId,
    ]);
  }
  await execRun(db, "UPDATE wl_orders SET stock_applied = 1, updated_at = ? WHERE id = ?", [nowIso(), order.id]);
}

async function restoreStock(db: Db, order: Order): Promise<void> {
  if (!order.stockApplied) return;
  for (const item of order.items) {
    const product = await getProduct(db, item.productId);
    if (product === null || product.stock < 0) continue;
    await execRun(db, "UPDATE wl_products SET stock = stock + ?, updated_at = ? WHERE id = ?", [
      item.quantity,
      nowIso(),
      item.productId,
    ]);
  }
  await execRun(db, "UPDATE wl_orders SET stock_applied = 0, updated_at = ? WHERE id = ?", [nowIso(), order.id]);
}

/**
 * Move an order to a new status. Stock decrements exactly once on the
 * pending → paid transition and is restored when a paid order is
 * cancelled. Anything else is refused with a 400.
 */
export async function transitionOrder(db: Db, orderId: string, to: OrderStatus): Promise<Order> {
  const order = await getOrder(db, orderId);
  if (order === null) throw notFound(`Order ${orderId} not found.`);
  if (!(ALLOWED_TRANSITIONS[order.status] as OrderStatus[]).includes(to)) {
    throw badRequest(`Order cannot move from ${order.status} to ${to}.`);
  }
  if (to === "paid") await applyStock(db, order);
  if (to === "cancelled" && order.status === "paid") await restoreStock(db, order);
  await execRun(db, "UPDATE wl_orders SET status = ?, updated_at = ? WHERE id = ?", [to, nowIso(), orderId]);
  const updated = await getOrder(db, orderId);
  if (updated === null) throw new Error("Order was not updated.");
  return updated;
}

export async function listOrders(
  db: Db,
  opts: { status?: OrderStatus; page?: number; perPage?: number } = {},
): Promise<OrderList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const where = opts.status !== undefined ? "WHERE status = ?" : "";
  const params: unknown[] = opts.status !== undefined ? [opts.status] : [];
  const totalRow = await queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM wl_orders ${where}`, params);
  const rows = await queryAll<OrderRow>(
    db,
    `SELECT * FROM wl_orders ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );
  const orders: Order[] = [];
  for (const row of rows) orders.push(rowToOrder(row, await orderItems(db, row.id)));
  const total = totalRow?.n ?? 0;
  return { orders, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}
