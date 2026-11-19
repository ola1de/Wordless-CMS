/**
 * Security headers (Milestone 9).
 *
 * Applied to EVERY response the Worker returns (API, public pages, admin
 * assets) in src/index.ts fetch(). The policy is deliberately honest
 * about its limits, documented in docs/security/security.md:
 *
 * - `script-src 'unsafe-inline'` is required because the M2 fallback
 *   layout inlines a <style> block, pages inline JSON-LD, and the
 *   analytics snippet (GA4) is an inline <script>. A nonce-based policy
 *   (no 'unsafe-inline') is a later hardening step, not claimed here.
 * - External script hosts are the analytics providers only (Google
 *   Tag Manager / Google Analytics, Plausible) — they only load when
 *   analytics is configured (M8).
 * - `frame-ancestors 'none'` (+ X-Frame-Options: DENY) — Wordless is
 *   never framed, including by its own admin.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://plausible.io; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https://www.google-analytics.com https://plausible.io; " +
  "media-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'";

/** The full set of security headers, as name/value pairs. */
export function securityHeaders(): Array<[string, string]> {
  return [
    ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    // Compression is applied by the Cloudflare edge in production, not
    // by the Worker; Vary tells caches the response depends on it.
    ["Vary", "Accept-Encoding"],
  ];
}

/**
 * Return a copy of `response` with the security headers set. The body
 * is untouched (a clone is used so a cached copy keeps the headers).
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of securityHeaders()) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
