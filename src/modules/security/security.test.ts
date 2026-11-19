/**
 * Milestone 9 security tests — headers, lockout, TOTP, magic bytes,
 * session idle timeout, guarded login, security overview.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { execRun, queryOne } from "../../db";
import { createUser } from "../users/service";
import { getUserMeta } from "../users/service";
import { createSession, verifySession } from "../auth/service";
import { securityHeaders, withSecurityHeaders } from "./headers";
import {
  clearFailedLogins,
  getLockoutConfig,
  lockoutUntil,
  recordFailedLogin,
} from "./lockout";
import { totpCode, verifyTotp } from "./totp";
import { verifyUploadBytes } from "./magic";
import {
  confirmTotp,
  disableTotp,
  getSecurityOverview,
  isTotpEnabled,
  listUserSessions,
  loginWithSecurity,
  PASSWORD_RESET_META_KEY,
  setupTotp,
} from "./service";
import { revokeAllSessionsForUser } from "../auth/service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PHP = new TextEncoder().encode("<?php evil(); ?>");
const SVG_CLEAN = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
const SVG_SCRIPT = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("security headers", () => {
  it("includes CSP, nosniff, frame-ancestors none, referrer and permissions policies", () => {
    const headers = new Map(securityHeaders());
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("withSecurityHeaders sets the headers on any response without touching the body", async () => {
    const wrapped = withSecurityHeaders(new Response("hello", { status: 200, headers: { "Content-Type": "text/plain" } }));
    expect(wrapped.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(wrapped.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await wrapped.text()).toBe("hello");
    expect(wrapped.headers.get("Content-Type")).toBe("text/plain");
  });
});

describe("login lockout", () => {
  it("uses the documented defaults (5 attempts, 15-minute window, 15-minute lockout)", async () => {
    expect(await getLockoutConfig(tdb.db)).toEqual({ maxAttempts: 5, windowMinutes: 15, lockoutMinutes: 15 });
  });

  it("locks after 5 failures and clears on success", async () => {
    const key = "login:locky";
    for (let i = 0; i < 4; i++) {
      expect(await recordFailedLogin(tdb.db, key)).toBeNull();
    }
    const locked = await recordFailedLogin(tdb.db, key);
    expect(locked).not.toBeNull();
    expect(await lockoutUntil(tdb.db, key)).toBe(locked);
    await clearFailedLogins(tdb.db, key);
    expect(await lockoutUntil(tdb.db, key)).toBeNull();
  });

  it("doubles consecutive lockouts, capped at 60 minutes", async () => {
    const key = "login:doubler";
    const now = Date.now();
    for (let i = 0; i < 5; i++) await recordFailedLogin(tdb.db, key, undefined, now);
    const first = await lockoutUntil(tdb.db, key, now);
    expect(first).not.toBeNull();
    const firstMinutes = (new Date(first as string).getTime() - now) / 60000;
    expect(firstMinutes).toBeCloseTo(15, 0);
    // Expire the lock, fail 5 more times: the next lockout is 30 minutes.
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(tdb.db, key, undefined, now + 16 * 60 * 1000 + i * 1000);
    }
    const second = await lockoutUntil(tdb.db, key, now + 16 * 60 * 1000 + 5000);
    const secondMinutes = (new Date(second as string).getTime() - (now + 16 * 60 * 1000 + 5000)) / 60000;
    expect(secondMinutes).toBeCloseTo(30, 0);
  });

  it("guarded login locks after 5 bad attempts and lets a good login through afterwards", async () => {
    const user = await createUser(tdb.db, {
      login: "locktest",
      email: "lt@example.test",
      password: "right-password",
      role: "editor",
    });
    expect(user.id).toBeGreaterThan(0);
    const bad = { loginName: "locktest", password: "wrong-password" };
    for (let i = 0; i < 5; i++) {
      expect((await loginWithSecurity(tdb.db, bad)).kind).toBe("invalid");
    }
    expect((await loginWithSecurity(tdb.db, bad)).kind).toBe("locked");
    // Even the right password is refused while locked.
    expect((await loginWithSecurity(tdb.db, { loginName: "locktest", password: "right-password" })).kind).toBe("locked");
    // After the lockout expires, the right password works and clears the counter.
    const later = Date.now() + 16 * 60 * 1000;
    const ok = await loginWithSecurity(tdb.db, { loginName: "locktest", password: "right-password", nowMs: later });
    expect(ok.kind).toBe("ok");
    // Three more failures after the clear do NOT lock (counter was reset).
    for (let i = 0; i < 3; i++) {
      expect((await loginWithSecurity(tdb.db, { ...bad, nowMs: later + 1000 + i })).kind).toBe("invalid");
    }
    expect(await lockoutUntil(tdb.db, "login:locktest", later + 5000)).toBeNull();
  });

  it("a successful login clears the failure counter", async () => {
    await createUser(tdb.db, { login: "clearme", email: "c@example.test", password: "pw-right", role: "author" });
    for (let i = 0; i < 3; i++) {
      await loginWithSecurity(tdb.db, { loginName: "clearme", password: "pw-wrong" });
    }
    const ok = await loginWithSecurity(tdb.db, { loginName: "clearme", password: "pw-right" });
    expect(ok.kind).toBe("ok");
    const row = await queryOne<{ attempts: number }>(tdb.db, "SELECT attempts FROM wl_login_attempts WHERE key = ?", ["login:clearme"]);
    expect(row).toBeNull();
  });
});

describe("TOTP two-factor (RFC 6238)", () => {
  // RFC 6238 test vector: secret "12345678901234567890" (ASCII),
  // base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ, T=59s → 287082.
  const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("matches the RFC 6238 vector and accepts ±1 step of skew", async () => {
    expect(await totpCode(RFC_SECRET, 59 * 1000)).toBe("287082");
    expect(await verifyTotp(RFC_SECRET, "287082", 59 * 1000)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, "287082", 59 * 1000 + 30000)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, "287082", 59 * 1000 - 30000)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, "287082", 59 * 1000 + 90000)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "000000", 59 * 1000)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, "not-a-code", 59 * 1000)).toBe(false);
  });

  it("runs the full setup → confirm → login → recovery-code → disable flow", async () => {
    const admin = await createUser(tdb.db, {
      login: "totp-admin",
      email: "tfa@example.test",
      password: "admin-password",
      role: "administrator",
    });
    const nowMs = 1_800_000_000_000; // fixed clock for the whole flow
    expect(await isTotpEnabled(tdb.db, admin.id)).toBe(false);

    const setup = await setupTotp(tdb.db, admin.id, admin.login);
    expect(setup.url.startsWith("otpauth://totp/")).toBe(true);
    expect(setup.url).toContain(`secret=${setup.secret}`);
    // The secret is pending, not enabled, until confirmed.
    expect(await isTotpEnabled(tdb.db, admin.id)).toBe(false);
    const pending = await getUserMeta<string>(tdb.db, admin.id, "wl_2fa_pending_secret", "");
    expect(pending).toBe(setup.secret);

    // A wrong code does not confirm.
    await expect(confirmTotp(tdb.db, admin.id, "000000", nowMs)).rejects.toThrow();
    expect(await isTotpEnabled(tdb.db, admin.id)).toBe(false);

    const code = await totpCode(setup.secret, nowMs);
    const { recoveryCodes } = await confirmTotp(tdb.db, admin.id, code as string, nowMs);
    expect(recoveryCodes).toHaveLength(8);
    expect(await isTotpEnabled(tdb.db, admin.id)).toBe(true);
    // Recovery codes are stored hashed, never in plaintext.
    const hashes = await getUserMeta<string[]>(tdb.db, admin.id, "wl_2fa_recovery_hashes", []);
    expect(hashes).toHaveLength(8);
    expect(hashes.join(" ")).not.toContain(recoveryCodes[0] as string);

    // Login without a code is refused with totp_required (not "invalid").
    expect(
      (await loginWithSecurity(tdb.db, { loginName: "totp-admin", password: "admin-password", nowMs })).kind,
    ).toBe("totp_required");
    // A wrong code is a plain failure.
    expect(
      (await loginWithSecurity(tdb.db, { loginName: "totp-admin", password: "admin-password", totp: "000000", nowMs })).kind,
    ).toBe("invalid");
    // The right code logs in.
    const ok = await loginWithSecurity(tdb.db, {
      loginName: "totp-admin",
      password: "admin-password",
      totp: code as string,
      nowMs,
    });
    expect(ok.kind).toBe("ok");

    // A recovery code works once.
    const recovery = recoveryCodes[0] as string;
    const viaRecovery = await loginWithSecurity(tdb.db, {
      loginName: "totp-admin",
      password: "admin-password",
      totp: recovery,
      nowMs,
    });
    expect(viaRecovery.kind).toBe("ok");
    expect(
      (await loginWithSecurity(tdb.db, { loginName: "totp-admin", password: "admin-password", totp: recovery, nowMs })).kind,
    ).toBe("invalid");

    // Disable needs the password; a wrong password refuses.
    await expect(disableTotp(tdb.db, admin.id, "wrong-password")).rejects.toThrow();
    expect(await isTotpEnabled(tdb.db, admin.id)).toBe(true);
    expect((await disableTotp(tdb.db, admin.id, "admin-password")).disabled).toBe(true);
    expect(await isTotpEnabled(tdb.db, admin.id)).toBe(false);
    expect((await loginWithSecurity(tdb.db, { loginName: "totp-admin", password: "admin-password", nowMs })).kind).toBe("ok");
  });
});

describe("magic-byte sniffing", () => {
  it("accepts real JPEG/PNG bytes and rejects a PHP file renamed to .jpg", () => {
    expect(() => verifyUploadBytes("photo.jpg", "image/jpeg", JPEG)).not.toThrow();
    expect(() => verifyUploadBytes("photo.png", "image/png", PNG)).not.toThrow();
    expect(() => verifyUploadBytes("evil.jpg", "image/jpeg", PHP)).toThrow(/do not match/);
    expect(() => verifyUploadBytes("evil.png", "image/png", PHP)).toThrow(/do not match/);
  });

  it("rejects an extension/MIME mismatch", () => {
    expect(() => verifyUploadBytes("photo.png", "image/jpeg", JPEG)).toThrow(/does not match/);
    expect(() => verifyUploadBytes("photo.exe", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toThrow(/not allowed/);
  });

  it("checks SVG content: clean SVG passes, scripted SVG fails", () => {
    expect(() => verifyUploadBytes("icon.svg", "image/svg+xml", SVG_CLEAN)).not.toThrow();
    expect(() => verifyUploadBytes("icon.svg", "image/svg+xml", SVG_SCRIPT)).toThrow(/content check/);
    expect(() => verifyUploadBytes("icon.svg", "image/svg+xml", PNG)).toThrow(/content check/);
  });

  it("accepts a real PDF header", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(() => verifyUploadBytes("doc.pdf", "application/pdf", pdf)).not.toThrow();
  });
});

describe("session hardening", () => {
  it("revokes a session idle longer than the timeout (default 24 h)", async () => {
    const user = await createUser(tdb.db, { login: "idle1", email: "i@example.test", password: "password-123", role: "editor" });
    const { token } = await createSession(tdb.db, user.id);
    // Last seen 25 hours ago.
    await execRun(tdb.db, "UPDATE wl_sessions SET last_seen_at = ? WHERE user_id = ?", [
      new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      user.id,
    ]);
    expect(await verifySession(tdb.db, token)).toBeNull();
    const row = await queryOne<{ revoked: number }>(tdb.db, "SELECT revoked FROM wl_sessions WHERE user_id = ?", [user.id]);
    expect(row?.revoked).toBe(1);
  });

  it("keeps a recently-used session and refreshes last_seen_at", async () => {
    const user = await createUser(tdb.db, { login: "idle2", email: "i2@example.test", password: "password-123", role: "editor" });
    const { token } = await createSession(tdb.db, user.id);
    await execRun(tdb.db, "UPDATE wl_sessions SET last_seen_at = ? WHERE user_id = ?", [
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      user.id,
    ]);
    const verified = await verifySession(tdb.db, token);
    expect(verified).not.toBeNull();
    const row = await queryOne<{ last_seen_at: string }>(tdb.db, "SELECT last_seen_at FROM wl_sessions WHERE user_id = ?", [user.id]);
    expect(new Date(row?.last_seen_at ?? "").getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
  });

  it("lists sessions without token values and revokes all of them", async () => {
    const user = await createUser(tdb.db, { login: "sess1", email: "s@example.test", password: "password-123", role: "editor" });
    const first = await createSession(tdb.db, user.id);
    const second = await createSession(tdb.db, user.id);
    const sessions = await listUserSessions(tdb.db, user.id, first.token);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.current)?.id).toBe(first.session.id);
    expect(sessions.find((s) => !s.current)?.id).toBe(second.session.id);
    expect(JSON.stringify(sessions)).not.toContain(first.token);
    expect(await revokeAllSessionsForUser(tdb.db, user.id)).toBe(2);
    expect(await verifySession(tdb.db, first.token)).toBeNull();
    expect(await verifySession(tdb.db, second.token)).toBeNull();
  });
});

describe("forced password reset (imported users)", () => {
  it("refuses login until the flag is cleared", async () => {
    const user = await createUser(tdb.db, { login: "imported1", email: "imp@example.test", password: "temp-pass", role: "author" });
    const { updateUserMeta } = await import("../users/service");
    await updateUserMeta(tdb.db, user.id, PASSWORD_RESET_META_KEY, "1");
    expect((await loginWithSecurity(tdb.db, { loginName: "imported1", password: "temp-pass" })).kind).toBe("reset_required");
    expect(await getUserMeta<string>(tdb.db, user.id, PASSWORD_RESET_META_KEY, "")).toBe("1");
  });
});

describe("security overview", () => {
  it("reports measured posture: lockout config, 2FA per admin, default admin login", async () => {
    const admin = await createUser(tdb.db, { login: "admin", email: "a@example.test", password: "password-123", role: "administrator" });
    const overview = await getSecurityOverview(tdb.db);
    expect(overview.lockout.config.maxAttempts).toBe(5);
    expect(overview.lockout.lockedKeys).toEqual([]);
    expect(overview.twoFactor).toHaveLength(1);
    expect(overview.twoFactor[0]?.login).toBe("admin");
    expect(overview.twoFactor[0]?.enabled).toBe(false);
    expect(overview.defaultAdminLoginExists).toBe(true);
    expect(overview.headers.policy).toContain("frame-ancestors 'none'");
    expect(overview.sessions.active).toBe(0);

    // After a lockout and a 2FA setup, the overview reflects both.
    await recordFailedLogin(tdb.db, "login:someone");
    await recordFailedLogin(tdb.db, "login:someone");
    await recordFailedLogin(tdb.db, "login:someone");
    await recordFailedLogin(tdb.db, "login:someone");
    await recordFailedLogin(tdb.db, "login:someone");
    const nowMs = 1_800_000_000_000;
    const setup = await setupTotp(tdb.db, admin.id, admin.login);
    const code = await totpCode(setup.secret, nowMs);
    await confirmTotp(tdb.db, admin.id, code as string, nowMs);
    const after = await getSecurityOverview(tdb.db);
    expect(after.lockout.lockedKeys).toHaveLength(1);
    expect(after.twoFactor[0]?.enabled).toBe(true);
  });
});
