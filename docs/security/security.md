# Wordless security (Milestone 9)

The security model is defence in depth on a zero-trust edge: every
response is hardened, every login is counted, privileged accounts can
require a second factor, and sessions expire when idle. Nothing here
is a veneer — each check reports what it measured, and anything not
verified says so.

![Admin Security page](../screenshots/admin-security.png)
*The admin Security page — headers, lockout, two-factor authentication.*

## Security headers

Every response — API, public pages, admin SPA assets, cached copies,
error responses — passes through `withSecurityHeaders` in
`src/index.ts` (`src/modules/security/headers.ts`):

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Vary` | `Accept-Encoding` |

The `unsafe-inline` in the CSP is deliberate, not an oversight:

- The M2 page layout inlines a `<style>` block.
- Public pages inline JSON-LD (`<script type="application/ld+json">`).
- The analytics snippet (GA4/Plausible) is an inline script, injected
  only when configured.

A nonce-based CSP is a later step (it needs the renderer to emit a
per-request nonce and thread it through every inline block). The
`frame-ancestors 'none'` / `X-Frame-Options: DENY` pair means the
admin SPA cannot be framed, and `object-src 'none'` blocks plugin
content. Tests assert the headers are present on public, admin and
API responses.

## Login lockout

`src/modules/security/lockout.ts`, backed by D1 `wl_login_attempts`:

- Counted per **login name** (`login:<name>`) and per **IP hash**
  (`ip:<sha256 of the connecting IP>`) — IP addresses are never
  stored in clear text.
- Defaults: **5 failed attempts in 15 minutes** locks for **15
  minutes**. Consecutive lockouts double the duration (15 → 30 → 60
  minutes), capped at 60.
- A **successful login deletes both counters** for that login name
  and IP.
- Thresholds are options, readable/writable by an administrator:
  `wl_security_max_attempts` (default 5),
  `wl_security_window_minutes` (default 15),
  `wl_security_lockout_minutes` (default 15).

The login route (`loginWithSecurity`) checks the lockout *before*
the password, and returns `429 locked_out` with a `retryAfterSeconds`
hint. A failed login always returns the same generic 401, whether
the password was wrong, the account does not exist, or the account
needs a password reset — nothing leaks which.

## Two-factor authentication (TOTP)

`src/modules/security/totp.ts` is a pure RFC 6238 implementation:
HMAC-SHA1, 30-second steps, 6 digits, ±1 step of skew, base32
secrets. It was verified against the RFC vector (secret
`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`, T = 59 s → code `287082`).

Endpoints (`POST /api/auth/2fa/*`, all `requireAuth`):

- **setup** — generates a fresh 20-byte secret, stores it as
  `wl_2fa_pending_secret` in usermeta, and returns it **once** as an
  `otpauth://` URL plus the manual code, for the QR/manual entry in
  the admin Security page. The secret is *pending*, not active.
- **confirm** — the user enters a code from their authenticator app.
  A valid code promotes the pending secret to `wl_2fa_secret` and
  returns **8 one-time recovery codes** (`XXXXX-XXXXX`). Only
  SHA-256 hashes of the codes are stored
  (`wl_2fa_recovery_hashes`); the codes themselves are never stored
  and are shown exactly once. An invalid code leaves the pending
  secret in place.
- **disable** — requires the account password (a stolen session
  alone cannot turn 2FA off) and **revokes every session**, including
  the caller's — the caller gets a cleared cookie and must log in
  again.

Login accepts an optional `totp` field. The flow in
`loginWithSecurity` is: lockout → password → forced-reset check →
TOTP (missing code → `401 totp_required`; wrong code → generic 401
and **counted as a failed login**; a valid recovery code is consumed
and logs the user in). The admin login page prompts for the code
when the server says it is required.

### Storage boundary

TOTP secrets live in D1 usermeta. That means **whoever can read D1
can read the secrets** — the trust boundary is the D1 database
itself (Cloudflare account access), not the Wordless application.
This is documented in `src/modules/security/service.ts` and is the
same boundary as the password hashes. If a deployment needs a
stronger boundary, the secrets should move to a KMS-backed store;
that is out of scope for M9.

## Sessions

Sessions already stored only SHA-256 hashes of the token in D1
(`wl_sessions`); M9 adds:

- **Idle timeout** — option `wl_session_idle_hours`, default 24 h.
  A session idle longer than that is revoked on its next use. The
  `last_seen_at` column is refreshed at most once every 5 minutes,
  so a request does not write on every hit.
- **Session list** — `GET /api/auth/sessions` returns the caller's
  sessions (id, created, last seen, current flag). Token values are
  never returned.
- **Revoke all** — `POST /api/auth/sessions/revoke-all` revokes
  every session for the caller, including the current one; the
  response clears the cookie.

## Upload hardening

Uploads keep the M3 allowlist (jpeg/png/gif/webp/avif/svg/pdf,
50 MB) and add **magic-byte sniffing** on the first bytes of every
upload (`src/modules/security/magic.ts`, wired into `uploadMedia`
so the compat `media_handle_upload` path gets it too):

- JPEG, PNG, GIF, WebP, AVIF and PDF are checked against their
  known signatures; a file whose magic bytes contradict its
  extension/MIME is rejected.
- SVG must start with `<svg` and is rejected if it contains
  `<script`, a `javascript:` URL or an inline event handler
  (`on*=...`).
- A PHP file renamed to `.jpg` is rejected — the signature check
  catches it before the file ever reaches R2.

## Admin Security page

`#/security` (admin, `manage_options`) shows, all from measured
state:

- the header policy in force,
- the lockout configuration and any currently locked keys,
- 2FA status per administrator (enabled / pending / off) with the
  setup/confirm/disable flow,
- active sessions with revoke-all,
- recent failed logins from the audit log,
- a warning when a user with the default login name `admin` exists
  (login name only — passwords are never tested).

## What is NOT claimed

- No external penetration test or security audit has been run on
  Wordless. The lockout, TOTP and header checks are implemented and
  tested; that is not the same as an audit.
- The CSP still allows `unsafe-inline` (see above) — a nonce-based
  policy is a later step.
- TOTP secrets are stored in D1 (see the storage boundary above).
- The security-scanner agent reports only what it measured; if a
  check cannot run, it says "not run" — it never reports a pass it
  did not perform.
