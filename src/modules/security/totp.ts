/**
 * TOTP two-factor authentication (Milestone 9) — RFC 6238 over HMAC-SHA1,
 * 30-second steps, 6-digit codes, ±1 step of clock skew accepted.
 *
 * Secrets are 20 random bytes (160 bits), base32-encoded per RFC 4648.
 * Recovery codes are 10-character codes (displayed XXXXX-XXXXX); only
 * their SHA-256 hashes are stored, and each code works once.
 *
 * All time-dependent functions take an optional `nowMs` so tests can
 * run against a fixed clock — production always uses Date.now().
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  while (out.length % 8 !== 0) out += "=";
  return out;
}

export function base32Decode(input: string): Uint8Array | null {
  const clean = input.trim().replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Generate a fresh 20-byte TOTP secret (base32). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The otpauth:// URL an authenticator app scans (also shown as manual code). */
export function totpSetupUrl(secret: string, account: string, issuer = "Wordless"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message as BufferSource);
  return new Uint8Array(sig);
}

/** HOTP code for one counter value (RFC 4226 dynamic truncation). */
export async function hotpCode(secret: string, counter: number): Promise<string | null> {
  const key = base32Decode(secret);
  if (key === null) return null;
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const digest = await hmacSha1(key, msg);
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** The TOTP code for a moment in time (30 s steps). */
export async function totpCode(secret: string, nowMs = Date.now()): Promise<string | null> {
  return hotpCode(secret, Math.floor(nowMs / 30000));
}

/**
 * Verify a 6-digit code against a secret, accepting ±1 step of clock
 * skew. Returns false for malformed codes and malformed secrets.
 */
export async function verifyTotp(secret: string, code: string, nowMs = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(nowMs / 30000);
  for (const offset of [-1, 0, 1]) {
    const expected = await hotpCode(secret, step + offset);
    if (expected !== null && expected === code) return true;
  }
  return false;
}

const RECOVERY_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate 8 recovery codes (displayed once, at setup). */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let raw = "";
    for (const b of bytes) raw += RECOVERY_CHARS[b % RECOVERY_CHARS.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** Normalise a recovery code as typed (case-insensitive, dash optional). */
export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/-/g, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash a recovery code for storage (only hashes are stored). */
export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256Hex(normalizeRecoveryCode(code));
}
