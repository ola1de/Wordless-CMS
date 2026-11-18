/**
 * Opaque sessions stored in D1 (wl_sessions). The bearer token is random
 * 32 bytes, base64url-encoded; only its SHA-256 hash is stored, so a
 * database read alone cannot impersonate a user. Sessions are revocable
 * and expire (default 7 days).
 */
import { execRun, nowIso, queryOne } from "../../db";
import type { Db } from "../../db";
import { checkUserPassword, getUserById } from "../users/service";
import type { User } from "../users/types";

export interface Session {
  id: string;
  userId: number;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  ipHash: string | null;
  userAgent: string | null;
  revoked: boolean;
}

export interface SessionOptions {
  userAgent?: string;
  ipHash?: string;
  ttlDays?: number;
}

const SESSION_COOKIE = "wordless_session";
const DEFAULT_TTL_DAYS = 7;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type SessionRow = Record<string, unknown>;

function rowToSession(row: SessionRow): Session {
  return {
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    userId: typeof row.user_id === "number" ? row.user_id : Number(row.user_id ?? 0),
    tokenHash: typeof row.token_hash === "string" ? row.token_hash : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : "",
    ipHash: typeof row.ip_hash === "string" ? row.ip_hash : null,
    userAgent: typeof row.user_agent === "string" ? row.user_agent : null,
    revoked: Number(row.revoked ?? 0) === 1,
  };
}

export async function createSession(
  db: Db,
  userId: number,
  opts: SessionOptions = {},
): Promise<{ token: string; session: Session }> {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000);
  const session: Session = {
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ipHash: opts.ipHash ?? null,
    userAgent: opts.userAgent ?? null,
    revoked: false,
  };
  await execRun(
    db,
    `INSERT INTO wl_sessions (id, user_id, token_hash, created_at, expires_at, ip_hash, user_agent, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      session.id,
      session.userId,
      session.tokenHash,
      session.createdAt,
      session.expiresAt,
      session.ipHash,
      session.userAgent,
    ],
  );
  return { token, session };
}

export async function verifySession(db: Db, token: string): Promise<Session | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await queryOne<SessionRow>(
    db,
    "SELECT * FROM wl_sessions WHERE token_hash = ? AND revoked = 0 LIMIT 1",
    [tokenHash],
  );
  if (!row) return null;
  const session = rowToSession(row);
  if (session.expiresAt <= nowIso()) return null;
  return session;
}

export async function revokeSession(db: Db, token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const { changes } = await execRun(
    db,
    "UPDATE wl_sessions SET revoked = 1 WHERE token_hash = ? AND revoked = 0",
    [tokenHash],
  );
  return changes > 0;
}

export async function revokeAllSessionsForUser(db: Db, userId: number): Promise<number> {
  const { changes } = await execRun(
    db,
    "UPDATE wl_sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0",
    [userId],
  );
  return changes;
}

/** Authenticate by login + password; returns the user and a fresh session token. */
export async function login(
  db: Db,
  loginName: string,
  password: string,
  opts: SessionOptions = {},
): Promise<{ user: User; token: string; session: Session } | null> {
  const user = await checkUserPassword(db, loginName, password);
  if (!user) return null;
  const { token, session } = await createSession(db, user.id, opts);
  return { user, token, session };
}

/** Resolve the current user from a bearer token, or null. */
export async function userFromSession(db: Db, token: string | null): Promise<User | null> {
  if (!token) return null;
  const session = await verifySession(db, token);
  if (!session) return null;
  return getUserById(db, session.userId);
}

export function buildSessionCookie(token: string, maxAgeSeconds = DEFAULT_TTL_DAYS * 24 * 60 * 60): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
