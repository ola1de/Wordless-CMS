/**
 * Products (Milestone 8).
 *
 * Stored in wl_products. Prices are integer minor units (see money.ts);
 * stock is an integer count (-1 = unlimited). Slugs are unique; a clash
 * appends -2, -3, … like posts do. Deleting a product that appears in
 * any order is refused — order items keep their own name/price snapshot,
 * but the product row is the audit trail for what was sold.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { requireInt, requireSlug, requireString } from "../../kernel/validate";
import { slugify } from "../posts/service";
import { requireCurrency, requireMinorUnits } from "./money";
import type { Product, ProductInput, ProductList, ProductStatus } from "./types";

interface ProductRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  price_minor: number;
  currency: string;
  stock: number;
  status: string;
  image_id: number;
  created_at: string;
  updated_at: string;
}

function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    priceMinor: row.price_minor,
    currency: row.currency,
    stock: row.stock,
    status: row.status as ProductStatus,
    imageId: row.image_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireProductStatus(value: unknown): ProductStatus {
  if (value === undefined || value === null) return "draft";
  if (value === "draft" || value === "published") return value;
  throw badRequest('Field "status" must be "draft" or "published".');
}

async function ensureUniqueSlug(db: Db, base: string, excludeId?: number): Promise<string> {
  let candidate = base;
  let n = 2;
  for (;;) {
    const row = await queryOne<{ id: number }>(db, "SELECT id FROM wl_products WHERE slug = ? LIMIT 1", [candidate]);
    if (row === null || (excludeId !== undefined && row.id === excludeId)) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

export async function createProduct(db: Db, input: ProductInput): Promise<Product> {
  const name = requireString(input.name, "name", { max: 200 });
  const slugBase =
    input.slug !== undefined && input.slug !== null && String(input.slug) !== ""
      ? requireSlug(input.slug, "slug")
      : slugify(name);
  const slug = await ensureUniqueSlug(db, slugBase);
  const description = typeof input.description === "string" ? input.description : "";
  if (description.length > 100000) throw badRequest('Field "description" is too long (max 100,000 characters).');
  const priceMinor = input.priceMinor === undefined ? 0 : requireMinorUnits(input.priceMinor, "priceMinor", 0);
  const currency = input.currency === undefined ? "NGN" : requireCurrency(input.currency);
  const stock = input.stock === undefined ? -1 : requireInt(input.stock, "stock", -1);
  const status = requireProductStatus(input.status);
  const imageId = input.imageId === undefined ? 0 : requireInt(input.imageId, "imageId", 0);
  const now = nowIso();
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wl_products (name, slug, description, price_minor, currency, stock, status, image_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, slug, description, priceMinor, currency, stock, status, imageId, now, now],
  );
  const created = await getProduct(db, lastRowId ?? 0);
  if (created === null) throw new Error("Product was not created.");
  return created;
}

export async function getProduct(db: Db, id: number): Promise<Product | null> {
  const row = await queryOne<ProductRow>(db, "SELECT * FROM wl_products WHERE id = ? LIMIT 1", [id]);
  return row === null ? null : rowToProduct(row);
}

export async function getProductBySlug(db: Db, slug: string): Promise<Product | null> {
  const row = await queryOne<ProductRow>(db, "SELECT * FROM wl_products WHERE slug = ? LIMIT 1", [slug]);
  return row === null ? null : rowToProduct(row);
}

export async function updateProduct(db: Db, id: number, input: ProductInput): Promise<Product> {
  const existing = await getProduct(db, id);
  if (existing === null) throw notFound(`Product ${id} not found.`);
  const name = input.name === undefined ? existing.name : requireString(input.name, "name", { max: 200 });
  const slug =
    input.slug === undefined
      ? existing.slug
      : await ensureUniqueSlug(db, requireSlug(input.slug, "slug"), id);
  const description =
    input.description === undefined ? existing.description : typeof input.description === "string" ? input.description : "";
  if (description.length > 100000) throw badRequest('Field "description" is too long (max 100,000 characters).');
  const priceMinor = input.priceMinor === undefined ? existing.priceMinor : requireMinorUnits(input.priceMinor, "priceMinor", 0);
  const currency = input.currency === undefined ? existing.currency : requireCurrency(input.currency);
  const stock = input.stock === undefined ? existing.stock : requireInt(input.stock, "stock", -1);
  const status = input.status === undefined ? existing.status : requireProductStatus(input.status);
  const imageId = input.imageId === undefined ? existing.imageId : requireInt(input.imageId, "imageId", 0);
  await execRun(
    db,
    `UPDATE wl_products SET name = ?, slug = ?, description = ?, price_minor = ?, currency = ?, stock = ?, status = ?, image_id = ?, updated_at = ? WHERE id = ?`,
    [name, slug, description, priceMinor, currency, stock, status, imageId, nowIso(), id],
  );
  const updated = await getProduct(db, id);
  if (updated === null) throw new Error("Product was not updated.");
  return updated;
}

export async function deleteProduct(db: Db, id: number): Promise<boolean> {
  const existing = await getProduct(db, id);
  if (existing === null) throw notFound(`Product ${id} not found.`);
  const used = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_order_items WHERE product_id = ?", [id]);
  if ((used?.n ?? 0) > 0) {
    throw badRequest(`Product ${id} appears in ${used?.n} order item(s) and cannot be deleted. Unpublish it instead.`);
  }
  const { changes } = await execRun(db, "DELETE FROM wl_products WHERE id = ?", [id]);
  return changes > 0;
}

export async function listProducts(
  db: Db,
  opts: { status?: ProductStatus; page?: number; perPage?: number } = {},
): Promise<ProductList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const where = opts.status !== undefined ? "WHERE status = ?" : "";
  const params: unknown[] = opts.status !== undefined ? [opts.status] : [];
  const totalRow = await queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM wl_products ${where}`, params);
  const rows = await queryAll<ProductRow>(
    db,
    `SELECT * FROM wl_products ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );
  const total = totalRow?.n ?? 0;
  return { products: rows.map(rowToProduct), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}
