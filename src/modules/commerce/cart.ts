/**
 * Server-side cart (Milestone 8).
 *
 * The cart lives in D1 (wl_carts) keyed by the `wordless_cart` cookie
 * token — no account needed, no personal data stored. Items are a JSON
 * array of { productId, quantity }. Carts expire 7 days after their
 * last update and are pruned on read. Stock is checked at add time AND
 * at checkout (stock can change between the two).
 */
import { execRun, nowIso, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { requireInt } from "../../kernel/validate";
import { getProduct } from "./products";
import type { Cart, CartItem, CartLine } from "./types";

export const CART_COOKIE = "wordless_cart";
export const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function parseCartCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === "") return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CART_COOKIE) {
      const value = rest.join("=").trim();
      return /^[A-Za-z0-9-]{10,80}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function cartCookieHeader(token: string): string {
  return `${CART_COOKIE}=${token}; Path=/; Max-Age=${CART_TTL_MS / 1000}; SameSite=Lax`;
}

function parseItems(raw: string): CartItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is CartItem =>
          typeof item === "object" &&
          item !== null &&
          Number.isInteger((item as { productId?: unknown }).productId) &&
          Number.isInteger((item as { quantity?: unknown }).quantity),
      )
      .map((item) => ({ productId: item.productId, quantity: item.quantity }));
  } catch {
    return [];
  }
}

interface CartRow {
  id: string;
  items: string;
  created_at: string;
  updated_at: string;
}

function isExpired(updatedAt: string): boolean {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > CART_TTL_MS;
}

async function loadCartRow(db: Db, token: string): Promise<CartRow | null> {
  const row = await queryOne<CartRow>(db, "SELECT * FROM wl_carts WHERE id = ? LIMIT 1", [token]);
  if (row === null) return null;
  if (isExpired(row.updated_at)) {
    await execRun(db, "DELETE FROM wl_carts WHERE id = ?", [token]);
    return null;
  }
  return row;
}

async function saveCart(db: Db, token: string, items: CartItem[]): Promise<void> {
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_carts (id, items, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
    [token, JSON.stringify(items), now, now],
  );
}

/** The cart for a token, enriched with product data. Missing or draft products are dropped. */
export async function getCart(db: Db, token: string): Promise<Cart> {
  const row = await loadCartRow(db, token);
  const items = row === null ? [] : parseItems(row.items);
  const lines: CartLine[] = [];
  let dropped = false;
  for (const item of items) {
    const product = await getProduct(db, item.productId);
    if (product === null || product.status !== "published") {
      dropped = true;
      continue;
    }
    lines.push({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      priceMinor: product.priceMinor,
      currency: product.currency,
      quantity: item.quantity,
      lineTotalMinor: product.priceMinor * item.quantity,
    });
  }
  if (dropped && row !== null) {
    // Persist the cleaned cart so a deleted product stops reappearing.
    await saveCart(
      db,
      token,
      lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    );
  }
  const currency = lines.length > 0 ? (lines[0]?.currency ?? "NGN") : "NGN";
  const mixed = lines.some((l) => l.currency !== currency);
  return {
    token,
    lines,
    totalMinor: lines.reduce((sum, l) => sum + l.lineTotalMinor, 0),
    currency,
    currencyNote: mixed
      ? "This cart mixes currencies; the total uses the first item's currency. Check out one currency at a time."
      : null,
  };
}

/** Create a fresh cart token (the caller sets the cookie). */
export function newCartToken(): string {
  return crypto.randomUUID();
}

function checkStock(product: { stock: number; name: string }, quantity: number): void {
  if (product.stock >= 0 && quantity > product.stock) {
    throw badRequest(`Only ${product.stock} of "${product.name}" is in stock.`);
  }
}

export async function addToCart(db: Db, token: string, productId: number, quantity: number): Promise<Cart> {
  const qty = requireInt(quantity, "quantity", 1, 99);
  const product = await getProduct(db, productId);
  if (product === null) throw notFound(`Product ${productId} not found.`);
  if (product.status !== "published") throw badRequest(`"${product.name}" is not available for sale.`);
  const row = await loadCartRow(db, token);
  const items = row === null ? [] : parseItems(row.items);
  const existing = items.find((i) => i.productId === productId);
  const nextQty = (existing?.quantity ?? 0) + qty;
  checkStock(product, nextQty);
  if (existing) existing.quantity = nextQty;
  else items.push({ productId, quantity: qty });
  await saveCart(db, token, items);
  return getCart(db, token);
}

export async function setCartQuantity(db: Db, token: string, productId: number, quantity: number): Promise<Cart> {
  const qty = requireInt(quantity, "quantity", 0, 99);
  const row = await loadCartRow(db, token);
  const items = row === null ? [] : parseItems(row.items);
  const index = items.findIndex((i) => i.productId === productId);
  if (index === -1) throw notFound(`Product ${productId} is not in the cart.`);
  if (qty === 0) {
    items.splice(index, 1);
  } else {
    const product = await getProduct(db, productId);
    if (product === null) throw notFound(`Product ${productId} not found.`);
    checkStock(product, qty);
    (items[index] as CartItem).quantity = qty;
  }
  await saveCart(db, token, items);
  return getCart(db, token);
}

export async function clearCart(db: Db, token: string): Promise<void> {
  await execRun(db, "DELETE FROM wl_carts WHERE id = ?", [token]);
}
