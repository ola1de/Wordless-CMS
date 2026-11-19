# Integrations (Milestone 8)

Wordless talks to the outside world through integrations — but only
through ones that are honestly configured. Every integration reports
its live status (configured / not configured, with the reason), and
nothing is ever presented as working when it is not.

## The registry

`src/modules/integrations/registry.ts` — 8 definitions:

| Id | Kind | What it is |
|---|---|---|
| `email` | email | Transactional email (order confirmations, comment notifications, password resets) |
| `paystack` | payment | Payments — cards, bank transfer, mobile money |
| `flutterwave` | payment | Payments — cards, bank transfer, mobile money across Africa |
| `stripe` | payment | Payments — cards and wallets worldwide |
| `analytics` | analytics | GA4 / Plausible snippet (config only — no traffic numbers) |
| `social` | social | Share links on public pages (no API, no counts) |
| `cloudflare` | platform | Read-only binding status for this environment |
| `marketplace` | marketplace | Local-ZIP extension install (skeleton, no remote directory) |

`GET /api/integrations` (`manage_options`) returns each definition
with `configured`, `configuredDetail` and its stored non-secret
`config`. The admin Integrations page (`#/integrations`) shows the
same list, so the UI and the API can never disagree about status.

## Configuration (non-secret only)

`GET/PUT /api/integrations/:id/config` (`manage_options`). Config is
stored in `wp_options` as `wl_integration_<id>` (JSON). The endpoint
**rejects any secret-looking field** with a 400:

> `Field "apiKey" looks like a secret. Secrets must be set with wrangler secret put (or .dev.vars for local development), never in integration config.`

Fields rejected by name: anything matching `secret`, `key`, `token`,
`password`, `passwd`, `private`, `credential`, `auth`, `bearer`,
`session`, `cookie`, `signature` (case-insensitive, substring match).

Per-integration allowed fields and validation:

| Integration | Fields | Validation |
|---|---|---|
| email | `apiUrl`, `fromName`, `fromEmail` | `apiUrl` must be http(s) when set; `fromEmail` must be a valid email when set |
| analytics | `provider` (`none`/`ga4`/`plausible`), `measurementId` | measurement id ≤ 100 chars |
| paystack / flutterwave / stripe | (none — provider id + mode are in the Commerce → Payments tab) | — |
| social / cloudflare / marketplace | (none) | — |

Secrets are set only with `wrangler secret put <NAME>` on the deployed
Worker (or `.dev.vars` for local dev). Never in this file, never in
code, never in D1.

## Email

`src/modules/integrations/email.ts` — `sendMail(db, env, { to, subject, text })`.

Two providers:

- **Mock** (default, test mode). Records the message in D1
  `wl_mail_log` with status `logged` — it never claims delivery. The
  body is stored (capped at 10,000 chars) so the admin can see exactly
  what would have been sent.
- **Generic HTTP** (Resend/SendGrid-shaped). Used when the `email`
  integration has an `apiUrl` configured **and** `EMAIL_API_KEY` is set
  in env/secrets. POSTs `{ from, to, subject, text }` (Resend-shaped
  body) with `Authorization: Bearer <key>` and a 10-second timeout.
  A 2xx response is `sent`; anything else (non-2xx, network error,
  timeout) is `failed` with the error recorded in the log.

`sendMail` **never throws** for a mail failure — callers are
best-effort:

| Caller | What happens on mail failure |
|---|---|
| Order confirmation (webhook) | The webhook still answers; the order is still paid |
| Comment notification | The comment is still saved |
| Password reset | The API response still returns the temporary password, with `emailed: false` |

`GET /api/integrations/email/log` (`manage_options`) lists the log
(provider, to, subject, status `logged`/`sent`/`failed`, when). The
admin Integrations page shows it with the plain-language note:
"logged means recorded in test mode, not delivered".

### Setup

1. In the admin Integrations page, set the email API URL (e.g.
   `https://api.resend.com/emails`) and the sender name/email.
2. `wrangler secret put EMAIL_API_KEY` (or `.dev.vars` locally).
3. Send a test mail (e.g. post a comment with `admin_email` set) and
   check the mail log: status should be `sent`.

### What is NOT live

Real delivery has **not been verified** in this environment — no mail
key is connected. The HTTP provider is implemented and the mock path
is tested end to end; until a key is set and a message lands in a real
inbox, the integration is "implemented, not verified".

## Analytics

`src/modules/integrations/analytics.ts` — configuration only, no
numbers. The admin sets a provider (`ga4` or `plausible`) and a
measurement id (GA4) or domain (Plausible) on the Integrations page.

- `GET /api/integrations/analytics/status` (`manage_options`) reports
  `configured`, the provider, and the exact snippet that will be
  injected (or `null`).
- `buildAnalyticsSnippet` returns the documented snippet for the
  provider — GA4 `gtag.js` or the Plausible script tag — or `null`
  when unconfigured.
- `finishPage` in the render service appends the snippet to the
  `<head>` of every public page (themed and fallback render paths),
  **only when configured**. With no configuration, public pages carry
  no tracking pixel at all.

Wordless never fabricates traffic: there is no visitor count, no
page-view number, no dashboard chart. The analytics-reporter AI agent
still reports stored counts only (posts, comments, users, media).

## Social

`src/modules/integrations/social.ts` — `shareLinks(url, title)` returns
plain share URLs for X, Facebook, WhatsApp and Telegram. They are
rendered on public post pages and product pages as ordinary links.
No API calls, no share counts, no publishing. The M6 social-composer
agent stays draft-only; the command centre says so.

## Cloudflare (read-only)

`src/modules/integrations/cloudflare.ts` — `cloudflareBindingStatus(env)`
reads the real env object and reports which bindings exist: DB (D1),
MEDIA (R2), CONFIG (KV), ASSETS (Static Assets), AI (Workers AI).
`GET /api/integrations/cloudflare` (`manage_options`) and the
Integrations page show it. Nothing is invented: a binding is listed
only when the env object has it. This is the honest answer to "is
Cloudflare connected?" — in local dev the AI binding is absent until
the user deploys with their own account.

## Marketplace (skeleton)

`src/modules/integrations/marketplace.ts` — install extensions from a
ZIP upload; no remote directory yet.

- `GET /api/marketplace` (`install_plugins`) — installed extensions.
- `POST /api/marketplace/install` (`install_plugins`, multipart
  `file`) — validates the ZIP (≤ 50 MB, ≤ 10,000 files, no path traversal,
  single top-level folder stripped) and requires a `wordless.json`
  manifest with `slug`, `name`, `version` (`x.y.z`) and `kind`
  (`plugin` | `theme`). Files go to R2 `extensions/<slug>/`; a row is
  created in `wl_extensions` via the existing `installExtension`
  (status `inactive`). **Installed code is never executed by the
  install itself.**
- `POST /api/marketplace/:slug/activate|deactivate`
  (`install_plugins`) — flips the `wl_extensions` status.

The admin Commerce → Marketplace tab uploads the ZIP and lists
extensions with activate/deactivate. A remote directory, dependency
checks and per-request loading of converted extensions are later
milestones.

## What integrations are not

- Not verified live: no payment, email or analytics provider call has
  been observed in this environment. Each is "implemented from public
  documentation, mock path exercised".
- Not social publishing: share links only.
- Not visitor analytics: configuration + snippet only, no numbers.
- Not a remote marketplace: local ZIP install only.
