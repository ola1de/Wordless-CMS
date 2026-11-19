/**
 * Login rate limiting + lockout (Milestone 9).
 *
 * Two keys are tracked for every failed login: the login name
 * (`login:<name>`) and the IP hash (`ip:<sha256-hex>`). Either key being
 * locked refuses the login. A successful login clears both keys.
 *
 * Defaults (configurable in wp_options as wl_security_max_attempts,
 * wl_security_window_minutes, wl_security_lockout_minutes):
 * 5 failed attempts inside a 15-minute window → locked for 15 minutes.
 * Each consecutive lockout doubles the lockout (15 → 30 → 60 min, capped
 * at 60). The counter resets after a successful login or when the
 * window expires without a lockout.
 *
 * Nothing here stores a raw IP address — only its SHA-256 hex.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { getOption } from "../options/service";

export interface LockoutConfig {
  maxAttempts: number;
  windowMinutes: number;
  lockoutMinutes: number;
}

export const DEFAULT_LOCKOUT_CONFIG: LockoutConfig = {
  maxAttempts: 5,
  windowMinutes: 15,
  lockoutMinutes: 15,
};

export async function getLockoutConfig(db: Db): Promise<LockoutConfig> {
  const max = await getOption<number>(db, "wl_security_max_attempts", DEFAULT_LOCKOUT_CONFIG.maxAttempts);
  const window = await getOption<number>(db, "wl_security_window_minutes", DEFAULT_LOCKOUT_CONFIG.windowMinutes);
  const lockout = await getOption<number>(db, "wl_security_lockout_minutes", DEFAULT_LOCKOUT_CONFIG.lockoutMinutes);
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
  return {
    maxAttempts: num(max, DEFAULT_LOCKOUT_CONFIG.maxAttempts),
    windowMinutes: num(window, DEFAULT_LOCKOUT_CONFIG.windowMinutes),
    lockoutMinutes: num(lockout, DEFAULT_LOCKOUT_CONFIG.lockoutMinutes),
  };
}

interface AttemptRow {
  key: string;
  attempts: number;
  first_at: string;
  last_at: string;
  locked_until: string | null;
  lockout_count: number;
}

async function getRow(db: Db, key: string): Promise<AttemptRow | null> {
  return queryOne<AttemptRow>(db, "SELECT * FROM wl_login_attempts WHERE key = ? LIMIT 1", [key]);
}

/** Is this key currently locked? Returns the lockout expiry or null. */
export async function lockoutUntil(db: Db, key: string, nowMs = Date.now()): Promise<string | null> {
  const row = await getRow(db, key);
  if (row === null || row.locked_until === null) return null;
  return new Date(row.locked_until).getTime() > nowMs ? row.locked_until : null;
}

/** Record a failed login for one key. Returns the lockout expiry when the failure locks the key. */
export async function recordFailedLogin(
  db: Db,
  key: string,
  config: LockoutConfig = DEFAULT_LOCKOUT_CONFIG,
  nowMs = Date.now(),
): Promise<string | null> {
  const now = new Date(nowMs).toISOString();
  const row = await getRow(db, key);
  if (row === null) {
    await execRun(
      db,
      "INSERT INTO wl_login_attempts (key, attempts, first_at, last_at, locked_until, lockout_count) VALUES (?, 1, ?, ?, NULL, 0)",
      [key, now, now],
    );
    return null;
  }
  const windowStart = nowMs - config.windowMinutes * 60 * 1000;
  const inWindow = new Date(row.first_at).getTime() >= windowStart;
  const attempts = inWindow ? row.attempts + 1 : 1;
  const firstAt = inWindow ? row.first_at : now;
  if (attempts >= config.maxAttempts) {
    // Consecutive lockouts double the lockout, capped at 60 minutes.
    const lockoutCount = row.lockout_count + 1;
    const minutes = Math.min(config.lockoutMinutes * 2 ** (lockoutCount - 1), 60);
    const lockedUntil = new Date(nowMs + minutes * 60 * 1000).toISOString();
    await execRun(
      db,
      "UPDATE wl_login_attempts SET attempts = ?, first_at = ?, last_at = ?, locked_until = ?, lockout_count = ? WHERE key = ?",
      [attempts, firstAt, now, lockedUntil, lockoutCount, key],
    );
    return lockedUntil;
  }
  await execRun(
    db,
    "UPDATE wl_login_attempts SET attempts = ?, first_at = ?, last_at = ?, locked_until = NULL WHERE key = ?",
    [attempts, firstAt, now, key],
  );
  return null;
}

/** Clear a key's record (successful login). */
export async function clearFailedLogins(db: Db, key: string): Promise<void> {
  await execRun(db, "DELETE FROM wl_login_attempts WHERE key = ?", [key]);
}

/** All currently-locked keys (for the admin Security page). */
export async function listLockedKeys(
  db: Db,
  nowMs = Date.now(),
): Promise<Array<{ key: string; attempts: number; lockedUntil: string; lockoutCount: number }>> {
  const rows = await queryAll<AttemptRow>(
    db,
    "SELECT * FROM wl_login_attempts WHERE locked_until IS NOT NULL ORDER BY locked_until DESC LIMIT 100",
  );
  return rows
    .filter((r) => r.locked_until !== null && new Date(r.locked_until).getTime() > nowMs)
    .map((r) => ({
      key: r.key,
      attempts: r.attempts,
      lockedUntil: r.locked_until as string,
      lockoutCount: r.lockout_count,
    }));
}
