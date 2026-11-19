# Commerce (Milestone 8)

Wordless has a small, honest store: products, a server-side cart, checkout
through a real payment provider, and orders. Every price is an integer
number of minor units (kobo/cents) — never a float. Every number the
store reports comes from its own stored rows. Nothing is faked.

## What is built

| Piece | Where | Notes |
|---|---|---|
| Products | `src/modules/commerce/products.ts`, `wl_products` | name, slug, block-HTML description, price (minor units), currency (NGN default), stock (-1 = unlimited), draft/published, featured image attachment id |
| Public storefront | `/shop`, `/shop/:slug`, `/shop/cart` | Server-rendered through the theme system; add-to-cart forms, share links |
| Cart | `src/modules/commerce/cart.ts`, `wl_carts` | Server-side in D1, keyed by the `wordless_cart` cookie, 7-day expiry, pruned on read; stock-checked at add time |
| Checkout | `POST /api/commerce/checkout`, `POST /shop/checkout` | Creates a pending order, then starts the provider checkout |
| Orders | `src/modules/commerce/orders.ts`, `wl_orders` + `wl_order_items` | pending → paid → fulfilled / cancelled (validated transitions) |
| Payments | `src/modules/commerce/payments/` | Paystack, Flutterwave, Stripe + mock (test mode only) |
| Webhooks | `POST /api/commerce/webhooks/:provider` | Signature IS the auth; every attempt logged in `wl_webhook_log` |
| Commerce assistant | `src/ai/agents/commerce.ts` | Live since M8: reports real products, orders, low stock, revenue |

## Money

Prices are stored as **integer minor units**: 250000 kobo = ₦2,500.00,
199 cents = $1.99. `src/modules/commerce/money.ts`:

- `formatMoney(minor, currency)` — display only.
- `requireMinorUnits(value)` — throws a 400 on non-integers and floats.
- `toMinorUnits(major)` / `toMajorUnits(minor)` — conversion helpers.

The admin new-product form takes a major-unit price and rejects values
that are not a whole number of minor units (no fractions of a kobo).
Known limitation: formatting assumes 100 minor units per major unit —
zero-decimal currencies (JPY) are not handled yet.

## Products

- `GET /api/commerce/products` — public, published only. Admins may pass
  `?status=draft` or `?status=all` (requires `manage_options`).
- `POST /api/commerce/products` (`manage_options`) — name is required;
  slug is generated from the name and suffixed `-2`, `-3`, … on
  collision; price must be an integer number of minor units; currency
  is a 3-letter code (default NGN); stock is an integer, -1 = unlimited.
- `GET /api/commerce/products/:id` — a draft returns 404 to non-admins.
- `PUT /api/commerce/products/:id` (`manage_options`) — same validation.
- `DELETE /api/commerce/products/:id` (`manage_options`) — refused with
  a 400 when the product appears in any order (the order history must
  keep its line items).

## Cart

`GET/POST/PUT/DELETE /api/commerce/cart` (public). The cart is stored in
D1 (`wl_carts`: token, JSON items, timestamps) and keyed by the
`wordless_cart` cookie (`HttpOnly`, `SameSite=Lax`, 7-day expiry). The
cookie is set on the response when a cart is first created. Expired
carts are pruned on read.

- Add: `{ productId, quantity }` — the product must exist, be
  published, and have enough stock (unlimited stock never blocks).
  Adding more than the stock allows is a 400 naming the stock left.
- Set quantity: `{ productId, quantity }` — 0 removes the line.
- Read: missing or draft products are dropped from the cart silently.
- Mixed currencies: a cart with more than one currency reports a
  `currencyNote` ("Prices are shown in more than one currency…") and
  checkout is refused until the cart is single-currency. In practice
  this only happens if the store's currency is changed mid-cart.

The public cart page (`/shop/cart`) is server-rendered forms: quantity
updates and removals POST to `/shop/cart/quantity` and
`/shop/cart/remove`, then redirect back to the cart.

## Checkout

`POST /api/commerce/checkout` (JSON `{ customerName, customerEmail }`)
or the form `POST /shop/checkout` (same fields from the cart page).
Both:

1. Read the cart from the cookie. An empty or missing cart is a 400.
2. Re-check stock and price at checkout time (the cart's snapshot is
   not trusted).
3. Create a **pending** order (id `ord_<24 hex chars>`) and clear the
   cart — the order consumes it.
4. Resolve the selected payment provider. **With no provider
   configured, this is a 503 (`payment_not_configured`)** — the order
   stays pending and no payment is ever faked.
5. `createCheckout` on the provider returns a checkout URL + reference;
   the order stores `payment_provider` + `payment_reference`.

The API returns `{ order, checkoutUrl, reference }` (201). The form
route 303-redirects: to the provider's checkout URL for real providers,
or to `/shop/checkout/test?order=…&reference=…` for the mock.

## Orders

`GET /api/commerce/orders` (`manage_options`, `?status=` filter) and
`GET /api/commerce/orders/:id` (with items).
`POST /api/commerce/orders/:id/transition` (`manage_options`,
`{ status: "paid" | "fulfilled" | "cancelled" }`) — allowed transitions
only:

| From | To |
|---|---|
| pending | paid, cancelled |
| paid | fulfilled, cancelled |
| fulfilled, cancelled | (terminal) |

- **Stock decrements exactly once** when an order becomes paid
  (`stockApplied` flag on the order; a second transition to paid is
  refused as an invalid transition anyway).
- **Cancelling a paid order restores stock exactly once** (same flag).
- Cancelling a pending order does not touch stock (it was never
  decremented).
- Admin-set "paid" (manual transition) is for recording an offline
  payment; it decrements stock the same way.

## Payments

`src/modules/commerce/payments/` — one provider object per provider
(`id`, `name`, `description`, `requiresKey`, `isConfigured`,
`configuredDetail`, `createCheckout`, `verifyPayment`,
`verifyWebhook`). Selection is stored in options
(`wl_payment_provider`, `wl_payment_mode` test/live, default test).
`GET /api/commerce/payments/providers` (with live configured state),
`GET /api/commerce/payments/selected`,
`POST /api/commerce/payments/select` (`manage_options`).

### Provider setup

Secrets come **only** from env/secrets bindings — never D1, never code,
never this doc. Set them on the deployed Worker with
`wrangler secret put <NAME>` (or `.dev.vars` for local dev):

| Provider | Secrets | Webhook URL (set in the provider dashboard) |
|---|---|---|
| Paystack | `PAYSTACK_SECRET_KEY` | `https://<your-site>/api/commerce/webhooks/paystack` |
| Flutterwave | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH` | `https://<your-site>/api/commerce/webhooks/flutterwave` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `https://<your-site>/api/commerce/webhooks/stripe` |
| Mock (test mode only) | `MOCK_PAYMENT_WEBHOOK_SECRET` | `https://<your-site>/api/commerce/webhooks/mock` |

### What each provider does

- **Paystack** — `POST /transaction/initialize` (amount in kobo) and
  `GET /transaction/verify/:reference`; webhook HMAC-SHA512 of the raw
  body against `x-paystack-signature`; event `charge.success` pays.
- **Flutterwave** — `POST /v3/payments` (amount in **major** units) and
  `GET /v3/transactions/verify_by_reference?tx_ref=`; webhook
  `verif-hash` header compared to `FLUTTERWAVE_SECRET_HASH` (a
  comparison, not an HMAC — that is Flutterwave's documented scheme);
  event `charge.completed` with status `successful` pays.
- **Stripe** — Checkout Sessions via form-encoded POST (Basic auth);
  `GET /v1/checkout/sessions/:id` (`payment_status: "paid"`); webhook
  `stripe-signature` `t=…,v1=…`, HMAC-SHA256 of
  `${timestamp}.${rawBody}` with a 300-second tolerance.
- **Mock** — deterministic, no network, no money. Checkout opens the
  test page on this site. Webhook HMAC-SHA256 against
  `MOCK_PAYMENT_WEBHOOK_SECRET`; **unset means every mock webhook is
  rejected** — there is no signature bypass. `verifyPayment` treats
  the webhook log as the source of truth (paid only after a verified
  mock webhook was accepted).

### Webhooks

`POST /api/commerce/webhooks/:provider` — no session auth; **the
provider signature IS the auth**. A bad or missing signature is a 401
and is logged. Every attempt is logged in `wl_webhook_log` (provider,
event, reference, result, detail — never the secret); the admin
Commerce → Payments tab lists it (`GET /api/commerce/webhooks/log`).

Outcomes, all answered 200 except the 401 above:

- `paid` — the order moved pending → paid (stock decremented once).
- `duplicate` — the order was already paid; nothing re-applied.
- `not_found` — no order matches the reference (logged, 200 so the
  provider stops retrying).
- `cancelled` — the order was already cancelled.
- `not_paid_event` — a verified webhook for a non-payment event.

### What is NOT live

No live provider call has been verified in this environment — no keys
are connected. The real providers are implemented from their public
API documentation; the mock is the only path exercised end to end.
Before taking real money: set the secret, select the provider in
test mode, run a test transaction, watch the webhook log, then switch
to live mode.

### Test checkout

With the mock provider selected, checkout redirects to
`/shop/checkout/test`, which explains that no money moves and offers a
"Simulate successful payment (test only)" button. That button POSTs to
`/shop/checkout/test`, which signs a mock webhook with
`MOCK_PAYMENT_WEBHOOK_SECRET` and runs it through the real
`handlePaymentWebhook` — the same verification and the same
pending→paid transition as a real provider. If the secret is unset,
the page says so instead of simulating anything.

## Commerce assistant

The M6 commerce-assistant is live since M8 (`src/ai/agents/commerce.ts`).
It reads real data and reports only — it never changes the store:

- product count, order counts by status, low-stock warnings (stock ≤ 5),
- revenue = sum of `total_minor` over paid + fulfilled orders.

Tested: the agent's report matches direct queries against the same
tables. See `docs/ai/agents.md`.

## What commerce is not

- No variable products, coupons, taxes, shipping, or refunds.
- No WooCommerce API compatibility beyond the `COMMERCE_COMPAT` list
  in `src/compat/wordpress.ts`.
- No remote marketplace directory — the marketplace is a local-ZIP
  skeleton (see `docs/integrations/integrations.md`).
- Money formatting assumes 100 minor units per major unit.
