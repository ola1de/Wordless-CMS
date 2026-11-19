/**
 * Commerce assistant (Milestone 8) — now available.
 *
 * Reads the store's own data only: products, orders by status,
 * revenue (paid + fulfilled orders, in minor units), and low-stock
 * warnings. Every number is computed from wl_products / wl_orders —
 * nothing is invented, and the report says so. Drafts and proposals
 * are not part of this agent: it reports, it does not change the store.
 */
import type { AgentDefinition } from "../types";
import { listOrders } from "../../modules/commerce/orders";
import { listProducts } from "../../modules/commerce/products";
import { formatMoney } from "../../modules/commerce/money";

const LOW_STOCK_AT_OR_BELOW = 5;

export const commerceAssistant: AgentDefinition = {
  id: "commerce-assistant",
  name: "Commerce Assistant",
  description:
    "Reports on the store from its own data: products, orders by status, revenue from paid orders, and low-stock warnings. It reports only — it never changes products or orders.",
  capabilities: ["Product and order reports", "Revenue totals (paid orders only)", "Low-stock warnings"],
  risk: "low",
  requiresProvider: false,
  async run(ctx) {
    const { products } = await listProducts(ctx.db, { perPage: 100 });
    const { orders } = await listOrders(ctx.db, { perPage: 100 });
    const byStatus: Record<string, number> = { pending: 0, paid: 0, fulfilled: 0, cancelled: 0 };
    let revenueMinor = 0;
    let revenueCurrency = "NGN";
    for (const order of orders) {
      byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
      if (order.status === "paid" || order.status === "fulfilled") {
        revenueMinor += order.totalMinor;
        revenueCurrency = order.currency;
      }
    }
    const published = products.filter((p) => p.status === "published");
    const lowStock = products
      .filter((p) => p.stock >= 0 && p.stock <= LOW_STOCK_AT_OR_BELOW)
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, stock: p.stock }));
    const lines = [
      `${products.length} product(s) (${published.length} published).`,
      `${orders.length} order(s): ${byStatus.pending} pending, ${byStatus.paid} paid, ${byStatus.fulfilled} fulfilled, ${byStatus.cancelled} cancelled.`,
      `Revenue from paid + fulfilled orders: ${formatMoney(revenueMinor, revenueCurrency)}.`,
      lowStock.length > 0
        ? `Low stock (≤ ${LOW_STOCK_AT_OR_BELOW}): ${lowStock.map((p) => `${p.name} (${p.stock})`).join(", ")}.`
        : "No products are low on stock.",
    ];
    return {
      summary: lines.join(" "),
      data: {
        products: products.length,
        published: published.length,
        orders: orders.length,
        ordersByStatus: byStatus,
        revenueMinor,
        revenueCurrency,
        revenueFormatted: formatMoney(revenueMinor, revenueCurrency),
        lowStock,
      },
    };
  },
};
