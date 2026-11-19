/**
 * First-administrator seeding (Milestone 10).
 *
 * Production login is not usable end-to-end until an administrator exists,
 * and the admin UI cannot create one (creating users requires an admin).
 * This module is the service-level half of `scripts/seed-admin.mjs`:
 * it validates the input, refuses when an administrator already exists,
 * and creates the administrator through the normal users service
 * (PBKDF2 via WebCrypto, `wp_capabilities` JSON — the same rows the
 * Users page creates). The CLI script mirrors these exact statements in
 * SQL for local/remote D1 access; the two paths are tested to agree
 * (see seed.test.ts and the M10 smoke test).
 *
 * No password is ever logged or stored anywhere except `wp_users.user_pass`.
 */
import { queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, conflict } from "../../kernel/errors";
import { createUser } from "../users/service";
import type { User } from "../users/types";

export const SEED_MIN_PASSWORD_LENGTH = 8;
export const SEED_MAX_PASSWORD_LENGTH = 200;

export interface SeedAdminInput {
  login: string;
  email: string;
  password: string;
  /** Must equal `password`; the CLI prompts twice. */
  confirm: string;
}

const LOGIN_RE = /^[A-Za-z0-9_.\-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate seed input without touching the database. Throws bad_request
 * with a plain message on the first problem found. The CLI runs this
 * before prompting for anything else and again before writing.
 */
export function validateSeedInput(input: SeedAdminInput): void {
  const login = typeof input.login === "string" ? input.login.trim() : "";
  if (login.length < 1 || login.length > 60) {
    throw badRequest("Login must be 1–60 characters.");
  }
  if (!LOGIN_RE.test(login)) {
    throw badRequest('Login may only contain letters, digits, underscore, dot and hyphen.');
  }
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email.length === 0 || email.length > 100 || !EMAIL_RE.test(email)) {
    throw badRequest("Email must be a valid email address.");
  }
  if (typeof input.password !== "string" || input.password.length < SEED_MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${SEED_MIN_PASSWORD_LENGTH} characters.`);
  }
  if (input.password.length > SEED_MAX_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at most ${SEED_MAX_PASSWORD_LENGTH} characters.`);
  }
  if (input.password !== input.confirm) {
    throw badRequest("Password and confirmation do not match.");
  }
}

/** True when at least one user carries the administrator role. */
export async function adminExists(db: Db): Promise<boolean> {
  const row = await queryOne<{ n: unknown }>(
    db,
    `SELECT COUNT(*) AS n FROM wp_usermeta
     WHERE meta_key = 'wp_capabilities'
       AND meta_value LIKE '%"administrator":true%'`,
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Create the first administrator. Refuses with a conflict when one already
 * exists (the caller prints how to use password reset instead).
 * Returns the created user (never the password).
 */
export async function seedAdmin(db: Db, input: SeedAdminInput): Promise<User> {
  validateSeedInput(input);
  if (await adminExists(db)) {
    throw conflict(
      "An administrator already exists. Use the Users page or password reset instead of seeding another one.",
      "admin_exists",
    );
  }
  return createUser(db, {
    login: input.login.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    role: "administrator",
    displayName: input.login.trim(),
  });
}
