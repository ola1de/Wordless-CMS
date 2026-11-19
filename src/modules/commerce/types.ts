/**
 * Commerce types (Milestone 8).
 *
 * Stock: -1 means unlimited (digital goods / services). Any other value
 * is an integer count; an order can only take stock that exists.
 * Order status flow: pending → paid → fulfilled, or pending/paid →
 * cancelled. `stockApplied` records whether this order has already
 * decremented stock, so a replayed webhook or a double admin click can
 * never apply stock twice.
 */
export type ProductStatus = "draft" | "published";
export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled";

export interface Product {
  id: number;
  name: string;
  slug: string;
  description: string;
  priceMinor: number;
  currency: string;
  /** -1 = unlimited stock. */
  stock: number;
  status: ProductStatus;
  imageId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  priceMinor?: unknown;
  currency?: unknown;
  stock?: unknown;
  status?: unknown;
  imageId?: unknown;
}

export interface ProductList {
  products: Product[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface OrderItem {
  id: number;
  orderId: string;
  productId: number;
  name: string;
  priceMinor: number;
  quantity: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  totalMinor: number;
  currency: string;
  status: OrderStatus;
  paymentProvider: string;
  paymentReference: string;
  stockApplied: boolean;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderList {
  orders: Order[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface CartItem {
  productId: number;
  quantity: number;
}

export interface CartLine {
  productId: number;
  name: string;
  slug: string;
  priceMinor: number;
  currency: string;
  quantity: number;
  lineTotalMinor: number;
}

export interface Cart {
  token: string;
  lines: CartLine[];
  totalMinor: number;
  currency: string;
  /** False when the cart mixes currencies (only one currency is kept — the first line's). */
  currencyNote: string | null;
}
