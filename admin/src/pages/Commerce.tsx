/**
 * Commerce admin (Milestone 8) — tabs: Products / Orders / Payments /
 * Marketplace.
 *
 * Prices are integer minor units (kobo/cents) everywhere. The new-product
 * form takes a major-unit price (e.g. 2500.00) and converts it to minor
 * units, rejecting values that are not a whole number of minor units.
 * Payment providers are shown with their honest configured state; secrets
 * are never entered here — they go in `wrangler secret put`.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type {
  MarketplaceExtension,
  Order,
  OrderList,
  PaymentProviderInfo,
  Product,
  ProductList,
  SelectedPayment,
  WebhookLogList,
} from "../lib/types";
import { EmptyState, ErrorBox, Pagination, Spinner } from "../components/ui";

/** Major units = minor / 100 for NGN/USD-style currencies (M8 limitation: zero-decimal currencies are not handled). */
export function fmtMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

type Tab = "products" | "orders" | "payments" | "marketplace";

const NEXT_STATUS: Record<Order["status"], Array<{ to: "paid" | "fulfilled" | "cancelled"; label: string }>> = {
  pending: [
    { to: "paid", label: "Mark paid" },
    { to: "cancelled", label: "Cancel" },
  ],
  paid: [
    { to: "fulfilled", label: "Mark fulfilled" },
    { to: "cancelled", label: "Cancel (restores stock)" },
  ],
  fulfilled: [],
  cancelled: [],
};

export function CommercePage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("products");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductList | null>(null);
  const [productPage, setProductPage] = useState(1);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [stock, setStock] = useState("10");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [savingProduct, setSavingProduct] = useState(false);

  const [orders, setOrders] = useState<OrderList | null>(null);
  const [orderPage, setOrderPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [providers, setProviders] = useState<PaymentProviderInfo[]>([]);
  const [selected, setSelected] = useState<SelectedPayment | null>(null);
  const [providerPick, setProviderPick] = useState("");
  const [modePick, setModePick] = useState<"test" | "live">("test");
  const [webhooks, setWebhooks] = useState<WebhookLogList | null>(null);
  const [webhookPage, setWebhookPage] = useState(1);

  const [extensions, setExtensions] = useState<MarketplaceExtension[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [installing, setInstalling] = useState(false);

  const fail = (err: unknown): void => {
    setError(err instanceof Error ? err.message : "Something went wrong.");
  };

  const loadProducts = useCallback(async (page: number) => {
    try {
      setProducts(await api.listProducts(page));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products.");
    }
  }, []);

  const loadOrders = useCallback(async (page: number) => {
    try {
      setOrders(await api.listOrders(page));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders.");
    }
  }, []);

  const loadPayments = useCallback(async () => {
    try {
      const list = await api.listPaymentProviders();
      setProviders(list);
      const sel = await api.getSelectedPayment();
      setSelected(sel);
      setProviderPick(sel.provider);
      setModePick(sel.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment providers.");
    }
  }, []);

  const loadWebhooks = useCallback(async (page: number) => {
    try {
      setWebhooks(await api.listWebhookLog(page));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the webhook log.");
    }
  }, []);

  const loadMarketplace = useCallback(async () => {
    try {
      setExtensions(await api.listMarketplace());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace extensions.");
    }
  }, []);

  useEffect(() => {
    void loadProducts(productPage);
  }, [productPage, loadProducts]);
  useEffect(() => {
    void loadOrders(orderPage);
  }, [orderPage, loadOrders]);
  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);
  useEffect(() => {
    void loadWebhooks(webhookPage);
  }, [webhookPage, loadWebhooks]);
  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  const createProduct = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const major = Number(price);
    if (!Number.isFinite(major) || major < 0) {
      setError("Enter a valid price (0 or more).");
      return;
    }
    const priceMinor = Math.round(major * 100);
    if (Math.abs(major * 100 - priceMinor) > 1e-9) {
      setError("The price must be a whole number of minor units (kobo/cents) — no fractions of a kobo.");
      return;
    }
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < -1) {
      setError("Stock must be a whole number (-1 = unlimited).");
      return;
    }
    setSavingProduct(true);
    try {
      const created = await api.createProduct({
        name: name.trim(),
        priceMinor,
        currency: currency.trim().toUpperCase() || "NGN",
        stock: stockNum,
        status,
      });
      setNotice(`Product created: ${created.name} (${fmtMoney(created.priceMinor, created.currency)}).`);
      setName("");
      setPrice("");
      setStock("10");
      setStatus("draft");
      await loadProducts(productPage);
    } catch (err) {
      fail(err);
    } finally {
      setSavingProduct(false);
    }
  };

  const deleteProduct = async (id: number, productName: string): Promise<void> => {
    if (!window.confirm(`Delete product "${productName}"? Products that appear in an order cannot be deleted.`)) return;
    setError(null);
    try {
      await api.deleteProduct(id);
      setNotice(`Product "${productName}" deleted.`);
      await loadProducts(productPage);
    } catch (err) {
      fail(err);
    }
  };

  const toggleProductStatus = async (product: Product): Promise<void> => {
    setError(null);
    try {
      await api.updateProduct(product.id, { status: product.status === "published" ? "draft" : "published" });
      await loadProducts(productPage);
    } catch (err) {
      fail(err);
    }
  };

  const viewOrder = async (id: string): Promise<void> => {
    setError(null);
    try {
      setSelectedOrder(await api.getOrder(id));
    } catch (err) {
      fail(err);
    }
  };

  const transitionOrder = async (id: string, to: "paid" | "fulfilled" | "cancelled"): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const updated = await api.transitionOrder(id, to);
      setSelectedOrder(updated);
      setNotice(`Order ${id} is now ${updated.status}.`);
      await loadOrders(orderPage);
    } catch (err) {
      fail(err);
    }
  };

  const savePaymentSelection = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const sel = await api.selectPayment(providerPick, modePick);
      setSelected(sel);
      setNotice(`Payment provider set to ${sel.provider || "none"} (${sel.mode}).`);
      await loadPayments();
    } catch (err) {
      fail(err);
    }
  };

  const installZip = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (zipFile === null) {
      setError("Choose a .zip file first.");
      return;
    }
    setError(null);
    setNotice(null);
    setInstalling(true);
    try {
      const installed = await api.installMarketplaceZip(zipFile);
      setNotice(`Installed ${installed.name} v${installed.version} (inactive). Activate it to enable it.`);
      setZipFile(null);
      await loadMarketplace();
    } catch (err) {
      fail(err);
    } finally {
      setInstalling(false);
    }
  };

  const setExtensionStatus = async (slug: string, action: "activate" | "deactivate"): Promise<void> => {
    setError(null);
    try {
      await api.setMarketplaceStatus(slug, action);
      await loadMarketplace();
    } catch (err) {
      fail(err);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "products", label: "Products" },
    { id: "orders", label: "Orders" },
    { id: "payments", label: "Payments" },
    { id: "marketplace", label: "Marketplace" },
  ];

  return (
    <div>
      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={tab === t.id ? "btn-primary" : ""}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error !== null && <ErrorBox message={error} onDismiss={() => setError(null)} />}
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {tab === "products" && (
        <section>
          <h3>Products</h3>
          <p className="muted">
            Prices are stored in integer minor units (kobo/cents) — never floats. Published products appear at{" "}
            <a href="/shop" target="_blank" rel="noreferrer">
              /shop
            </a>
            .
          </p>
          {products === null ? (
            <Spinner />
          ) : products.products.length === 0 ? (
            <EmptyState>No products yet. Create your first product below.</EmptyState>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <a href={`/shop/${p.slug}`} target="_blank" rel="noreferrer">
                          {p.name}
                        </a>
                      </td>
                      <td>{fmtMoney(p.priceMinor, p.currency)}</td>
                      <td>{p.stock < 0 ? "Unlimited" : p.stock}</td>
                      <td>{p.status}</td>
                      <td>
                        <button type="button" onClick={() => void toggleProductStatus(p)}>
                          {p.status === "published" ? "Unpublish" : "Publish"}
                        </button>{" "}
                        <button type="button" onClick={() => void deleteProduct(p.id, p.name)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={products.page} totalPages={products.totalPages} total={products.total} onPage={setProductPage} />
            </>
          )}
          <h4>New product</h4>
          <form onSubmit={(e) => void createProduct(e)} className="form-grid">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
            </label>
            <label>
              Price (major units, e.g. 2500.00)
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                inputMode="decimal"
                placeholder="0.00"
              />
            </label>
            <label>
              Currency
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
            </label>
            <label>
              Stock (-1 = unlimited)
              <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "published")}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </label>
            <button type="submit" className="btn-primary" disabled={savingProduct}>
              {savingProduct ? "Creating…" : "Create product"}
            </button>
          </form>
        </section>
      )}

      {tab === "orders" && (
        <section>
          <h3>Orders</h3>
          <p className="muted">
            Stock decrements exactly once when an order becomes paid, and is restored when a paid order is cancelled.
          </p>
          {orders === null ? (
            <Spinner />
          ) : orders.orders.length === 0 ? (
            <EmptyState>No orders yet. Orders appear here once a customer checks out.</EmptyState>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.orders.map((o) => (
                    <tr key={o.id}>
                      <td>{o.id.slice(0, 13)}…</td>
                      <td>
                        {o.customerName}
                        <br />
                        <span className="muted">{o.customerEmail}</span>
                      </td>
                      <td>{fmtMoney(o.totalMinor, o.currency)}</td>
                      <td>{o.status}</td>
                      <td>{o.paymentProvider || "—"}</td>
                      <td>
                        <button type="button" onClick={() => void viewOrder(o.id)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={orders.page} totalPages={orders.totalPages} total={orders.total} onPage={setOrderPage} />
            </>
          )}
          {selectedOrder !== null && (
            <div className="card" style={{ marginTop: 16 }}>
              <h4>Order {selectedOrder.id}</h4>
              <p>
                {selectedOrder.customerName} — {selectedOrder.customerEmail}
                <br />
                Status: <strong>{selectedOrder.status}</strong> · Total:{" "}
                {fmtMoney(selectedOrder.totalMinor, selectedOrder.currency)} · Provider:{" "}
                {selectedOrder.paymentProvider || "—"} · Reference: {selectedOrder.paymentReference || "—"}
              </p>
              <ul>
                {selectedOrder.items.map((item) => (
                  <li key={item.id}>
                    {item.name} × {item.quantity} — {fmtMoney(item.priceMinor * item.quantity, selectedOrder.currency)}
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: 8 }}>
                {NEXT_STATUS[selectedOrder.status].map((n) => (
                  <button
                    key={n.to}
                    type="button"
                    onClick={() => void transitionOrder(selectedOrder.id, n.to)}
                  >
                    {n.label}
                  </button>
                ))}
                <button type="button" onClick={() => setSelectedOrder(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "payments" && (
        <section>
          <h3>Payments</h3>
          <p className="muted">
            Selected provider: <strong>{selected?.provider || "none"}</strong> ({selected?.mode ?? "test"}). With no
            provider selected, checkout refuses with a 503 — it never fakes a successful payment. Secrets are set with{" "}
            <code>wrangler secret put</code>, never in this UI.
          </p>
          <form onSubmit={(e) => void savePaymentSelection(e)} className="form-grid">
            <label>
              Provider
              <select value={providerPick} onChange={(e) => setProviderPick(e.target.value)}>
                <option value="">None (checkout disabled)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === "mock" ? " — test mode only" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mode
              <select value={modePick} onChange={(e) => setModePick(e.target.value as "test" | "live")}>
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </label>
            <button type="submit" className="btn-primary">
              Save provider
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Configured</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.configured ? "Yes" : "No"}</td>
                  <td>{p.configuredDetail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Webhook log</h4>
          <p className="muted">Every webhook attempt, accepted or rejected. Secrets are never logged.</p>
          {webhooks === null ? (
            <Spinner />
          ) : webhooks.entries.length === 0 ? (
            <EmptyState>No webhooks received yet.</EmptyState>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Event</th>
                    <th>Reference</th>
                    <th>Result</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.entries.map((w) => (
                    <tr key={w.id}>
                      <td>{w.provider}</td>
                      <td>{w.event}</td>
                      <td>{w.reference}</td>
                      <td>{w.result}</td>
                      <td>{w.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={webhooks.page} totalPages={webhooks.totalPages} total={webhooks.total} onPage={setWebhookPage} />
            </>
          )}
        </section>
      )}

      {tab === "marketplace" && (
        <section>
          <h3>Marketplace</h3>
          <p className="muted">
            Skeleton: install extensions from a ZIP with a <code>wordless.json</code> manifest (≤2 MB, ≤100 files). No
            remote directory yet, and installed code is never executed by the install itself.
          </p>
          <form onSubmit={(e) => void installZip(e)} className="form-grid">
            <label>
              Extension ZIP
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={installing || zipFile === null}>
              {installing ? "Installing…" : "Install from ZIP"}
            </button>
          </form>
          {extensions.length === 0 ? (
            <EmptyState>No marketplace extensions installed.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {extensions.map((x) => (
                  <tr key={x.slug}>
                    <td>{x.name}</td>
                    <td>{x.version}</td>
                    <td>{x.kind}</td>
                    <td>{x.status}</td>
                    <td>
                      {x.status === "active" ? (
                        <button type="button" onClick={() => void setExtensionStatus(x.slug, "deactivate")}>
                          Deactivate
                        </button>
                      ) : (
                        <button type="button" onClick={() => void setExtensionStatus(x.slug, "activate")}>
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
