/**
 * Security service (Milestone 9) — guarded login, TOTP two-factor,
 * session management, and the admin security overview.
 *
 * Usermeta keys (all JSON in wp_usermeta):
 * - wl_2fa_secret: the enabled TOTP secret (base32).
 * - wl_2fa_pending_secret: a setup secret awaiting confirmation.
 * - wl_2fa_recovery_hashes: JSON array of SHA-256 hashes of recovery
 *   codes (plaintext codes are shown once, at setup, never stored).
 * - wl_password_reset_required: "1" while an imported user must reset
 *   their password (WordPress phpass hashes are not portable).
 *
 * The TOTP secret is stored in usermeta the way WordPress 2FA plugins
 * store it — anyone with D1 read access can read it, so D1 access
 * itself is the trust boundary (documented in docs/security/security.md).
 */
import { queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import { createSession, revokeAllSessionsForUser } from "../auth/service";
import { logActivity } from "../activity/service";
import {
  checkUserPassword,
  deleteUserMeta,
  getUserById,
  getUserMeta,
  listUsers,
  updateUserMeta,
} from "../users/service";
import type { User } from "../users/types";
import { CONTENT_SECURITY_POLICY } from "./headers";
import {
  clearFailedLogins,
  getLockoutConfig,
  listLockedKeys,
  lockoutUntil,
  recordFailedLogin,
  type LockoutConfig,
} from "./lockout";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  sha256Hex,
  totpSetupUrl,
  verifyTotp,
} from "./totp";

export const PASSWORD_RESET_META_KEY = "wl_password_reset_required";
const TOTP_SECRET_KEY = "wl_2fa_secret";
const TOTP_PENDING_KEY = "wl_2fa_pending_secret";
const TOTP_RECOVERY_KEY = "wl_2fa_recovery_hashes";

/** SHA-256 hex of an IP address (raw IPs are never stored). */
export async function hashIp(ip: string): Promise<string> {
  return sha256Hex(ip);
}

export type LoginOutcome =
  | { kind: "ok"; user: User; token: string }
  | { kind: "totp_required" }
  | { kind: "reset_required" }
  | { kind: "invalid" }
  | { kind: "locked"; lockedUntil: string };

export interface LoginWithSecurityInput {
  loginName: string;
  password: string;
  totp?: string;
  ipHash?: string;
  userAgent?: string;
  nowMs?: number;
}

/**
 * Full login guard: lockout → password → forced-reset → TOTP.
 * A wrong TOTP counts as a failed login (it IS a failed authentication);
 * a missing TOTP does not (the password was right, the second factor
 * simply was not offered yet). Nothing here reveals whether the login
 * name exists or whether the password was right.
 */
export async function loginWithSecurity(db: Db, input: LoginWithSecurityInput): Promise<LoginOutcome> {
  const config: LockoutConfig = await getLockoutConfig(db);
  const nowMs = input.nowMs ?? Date.now();
  const loginKey = `login:${input.loginName}`;
  const ipKey = input.ipHash !== undefined && input.ipHash !== "" ? `ip:${input.ipHash}` : null;

  const loginLocked = await lockoutUntil(db, loginKey, nowMs);
  if (loginLocked !== null) return { kind: "locked", lockedUntil: loginLocked };
  if (ipKey !== null) {
    const ipLocked = await lockoutUntil(db, ipKey, nowMs);
    if (ipLocked !== null) return { kind: "locked", lockedUntil: ipLocked };
  }

  const fail = async (): Promise<LoginOutcome> => {
    await recordFailedLogin(db, loginKey, config, nowMs);
    if (ipKey !== null) await recordFailedLogin(db, ipKey, config, nowMs);
    try {
      await logActivity(db, {
        actorId: 0,
        action: "auth.login_failed",
        objectType: "user",
        objectId: 0,
        details: `Failed login for "${input.loginName}"`,
        ipHash: input.ipHash,
      });
    } catch {
      // Audit logging must never break the login response.
    }
    return { kind: "invalid" };
  };

  const user = await checkUserPassword(db, input.loginName, input.password);
  if (user === null) return fail();

  const resetRequired = await getUserMeta<string>(db, user.id, PASSWORD_RESET_META_KEY, "");
  if (resetRequired === "1") return { kind: "reset_required" };

  const secret = await getUserMeta<string>(db, user.id, TOTP_SECRET_KEY, "");
  if (secret !== "") {
    if (input.totp === undefined || input.totp === "") return { kind: "totp_required" };
    const code = input.totp.trim();
    if (await verifyTotp(secret, code, nowMs)) {
      // Correct TOTP — proceed to a session below.
    } else if (await consumeRecoveryCode(db, user.id, code)) {
      // A recovery code was used — proceed to a session below.
    } else {
      return fail();
    }
  }

  await clearFailedLogins(db, loginKey);
  if (ipKey !== null) await clearFailedLogins(db, ipKey);
  const { token } = await createSession(db, user.id, { userAgent: input.userAgent, ipHash: input.ipHash });
  return { kind: "ok", user, token };
}

/** Consume a recovery code (one-time). Returns true when the code matched. */
export async function consumeRecoveryCode(db: Db, userId: number, code: string): Promise<boolean> {
  const hashes = await getUserMeta<string[]>(db, userId, TOTP_RECOVERY_KEY, []);
  const hash = await hashRecoveryCode(code);
  const idx = hashes.indexOf(hash);
  if (idx === -1) return false;
  hashes.splice(idx, 1);
  await updateUserMeta(db, userId, TOTP_RECOVERY_KEY, hashes);
  return true;
}

export async function isTotpEnabled(db: Db, userId: number): Promise<boolean> {
  const secret = await getUserMeta<string>(db, userId, TOTP_SECRET_KEY, "");
  return secret !== "";
}

export interface TotpSetup {
  secret: string;
  url: string;
}

/** Start 2FA setup: generate a secret, store it as pending, return the otpauth URL. */
export async function setupTotp(db: Db, userId: number, accountLabel: string): Promise<TotpSetup> {
  const user = await getUserById(db, userId);
  if (user === null) throw badRequest("User not found.");
  const secret = generateTotpSecret();
  await updateUserMeta(db, userId, TOTP_PENDING_KEY, secret);
  return { secret, url: totpSetupUrl(secret, accountLabel) };
}

/** Confirm setup with a code from the authenticator app. Returns the recovery codes (shown once). */
export async function confirmTotp(
  db: Db,
  userId: number,
  code: string,
  nowMs = Date.now(),
): Promise<{ recoveryCodes: string[] }> {
  const pending = await getUserMeta<string>(db, userId, TOTP_PENDING_KEY, "");
  if (pending === "") throw badRequest("No two-factor setup in progress. Start setup first.");
  if (!(await verifyTotp(pending, code, nowMs))) {
    throw badRequest("That code is not valid. Check the time on your device and try again.");
  }
  await updateUserMeta(db, userId, TOTP_SECRET_KEY, pending);
  await deleteUserMeta(db, userId, TOTP_PENDING_KEY);
  const recoveryCodes = generateRecoveryCodes();
  const hashes: string[] = [];
  for (const c of recoveryCodes) hashes.push(await hashRecoveryCode(c));
  await updateUserMeta(db, userId, TOTP_RECOVERY_KEY, hashes);
  return { recoveryCodes };
}

/** Disable 2FA (needs the account password). Signs the user out everywhere. */
export async function disableTotp(db: Db, userId: number, password: string): Promise<{ disabled: boolean }> {
  const user = await getUserById(db, userId);
  if (user === null) throw badRequest("User not found.");
  const ok = await checkUserPassword(db, user.login, password);
  if (ok === null) throw badRequest("That password is not correct.");
  await deleteUserMeta(db, userId, TOTP_SECRET_KEY);
  await deleteUserMeta(db, userId, TOTP_PENDING_KEY);
  await deleteUserMeta(db, userId, TOTP_RECOVERY_KEY);
  await revokeAllSessionsForUser(db, userId);
  return { disabled: true };
}

export interface SessionView {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  ipHashPrefix: string | null;
  revoked: boolean;
  current: boolean;
}

/** The user's own sessions (no token values are ever returned). */
export async function listUserSessions(db: Db, userId: number, currentToken?: string): Promise<SessionView[]> {
  const currentHash = currentToken !== undefined && currentToken !== "" ? await sha256Hex(currentToken) : null;
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM wl_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [userId],
  );
  return rows.map((row) => ({
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : "",
    lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
    userAgent: typeof row.user_agent === "string" ? row.user_agent : null,
    ipHashPrefix:
      typeof row.ip_hash === "string" && row.ip_hash.length > 0 ? (row.ip_hash as string).slice(0, 8) : null,
    revoked: Number(row.revoked ?? 0) === 1,
    current: currentHash !== null && row.token_hash === currentHash,
  }));
}

export interface SecurityOverview {
  headers: { policy: string; applied: boolean };
  lockout: {
    config: LockoutConfig;
    lockedKeys: Array<{ key: string; attempts: number; lockedUntil: string; lockoutCount: number }>;
  };
  twoFactor: Array<{ userId: number; login: string; role: string; enabled: boolean }>;
  sessions: { active: number };
  failedLogins: Array<{ userId: number; createdAt: string; details: string | null }>;
  defaultAdminLoginExists: boolean;
}

/** Admin overview: measured posture, never a claim of "secure". */
export async function getSecurityOverview(db: Db): Promise<SecurityOverview> {
  const config = await getLockoutConfig(db);
  const lockedKeys = await listLockedKeys(db);
  const users = await listUsers(db, { page: 1, perPage: 100 });
  const twoFactor: SecurityOverview["twoFactor"] = [];
  let defaultAdminLoginExists = false;
  for (const u of users.users) {
    if (u.login === "admin") defaultAdminLoginExists = true;
    if (u.role !== "administrator") continue;
    twoFactor.push({ userId: u.id, login: u.login, role: u.role, enabled: await isTotpEnabled(db, u.id) });
  }
  const activeRow = await queryOne<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM wl_sessions WHERE revoked = 0 AND expires_at > ?",
    [new Date().toISOString()],
  );
  const failedRows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT user_id, created_at, details FROM wl_audit_log WHERE action = 'auth.login_failed' ORDER BY created_at DESC LIMIT 20",
  );
  return {
    headers: { policy: CONTENT_SECURITY_POLICY, applied: true },
    lockout: { config, lockedKeys },
    twoFactor,
    sessions: { active: activeRow?.n ?? 0 },
    failedLogins: failedRows.map((r) => ({
      userId: typeof r.user_id === "number" ? r.user_id : 0,
      createdAt: typeof r.created_at === "string" ? r.created_at : "",
      details: typeof r.details === "string" ? r.details : null,
    })),
    defaultAdminLoginExists,
  };
}
