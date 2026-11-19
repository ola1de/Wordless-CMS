/**
 * HMAC helpers (Milestone 8) — WebCrypto, so they work in Workers and
 * in Node tests. Used by every payment provider's webhook verification.
 * Signatures are compared in constant time: a mismatch must not leak
 * how much of the signature was right.
 */
export async function hmacHex(algorithm: "SHA-256" | "SHA-512", key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (same length required, no early exit on content). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  return diff === 0;
}

/** Base64url-encode a UTF-8 string (used for Stripe's Basic auth). */
export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
