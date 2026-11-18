/**
 * Users service. Roles are stored the WordPress way: a `wp_capabilities`
 * row in wp_usermeta holding JSON, e.g. {"administrator": true}.
 * (WordPress stores a PHP-serialized array; Wordless stores JSON.)
 */
import { execRun, nowIso, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, conflict } from "../../kernel/errors";
import { requireEmail, requireString } from "../../kernel/validate";
import { isRole, type Role } from "./capabilities";
import { hashPassword, verifyPassword } from "./password";
import type { CreateUserInput, User } from "./types";

const LOGIN_RE = /^[A-Za-z0-9_.\-]+$/;
const ROLE_META_KEY = "wp_capabilities";

type UserRow = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function rowToUser(row: UserRow, role: Role): User {
  return {
    id: asInt(row.ID),
    login: asText(row.user_login),
    nicename: asText(row.user_nicename),
    email: asText(row.user_email),
    url: asText(row.user_url),
    registered: asText(row.user_registered),
    displayName: asText(row.display_name),
    role,
  };
}

async function roleForUser(db: Db, userId: number): Promise<Role> {
  const row = await queryOne<{ meta_value: unknown }>(
    db,
    "SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = ? LIMIT 1",
    [userId, ROLE_META_KEY],
  );
  if (!row) return "subscriber";
  try {
    const parsed: unknown = JSON.parse(asText(row.meta_value));
    if (parsed !== null && typeof parsed === "object") {
      for (const key of Object.keys(parsed)) {
        if (isRole(key) && (parsed as Record<string, unknown>)[key] === true) return key;
      }
    }
  } catch {
    // Corrupt role meta → safest default.
  }
  return "subscriber";
}

export async function createUser(db: Db, input: CreateUserInput): Promise<User> {
  const login = requireString(input.login, "login", { min: 1, max: 60 });
  if (!LOGIN_RE.test(login)) {
    throw badRequest('Field "login" may only contain letters, digits, underscore, dot and hyphen.');
  }
  const email = requireEmail(input.email, "email");
  const password = requireString(input.password, "password", { min: 8, max: 200 });
  const displayName = input.displayName?.trim() || login;
  const nicename = (input.nicename?.trim() || login).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = input.url?.trim() ?? "";
  const role: Role = input.role !== undefined && isRole(input.role) ? input.role : "subscriber";

  const existingLogin = await queryOne(db, "SELECT ID FROM wp_users WHERE user_login = ? LIMIT 1", [login]);
  if (existingLogin) throw conflict(`A user with login "${login}" already exists.`, "user_exists");
  const existingEmail = await queryOne(db, "SELECT ID FROM wp_users WHERE user_email = ? LIMIT 1", [email]);
  if (existingEmail) throw conflict(`A user with email "${email}" already exists.`, "user_exists");

  const hash = await hashPassword(password);
  const now = nowIso();
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_users (user_login, user_pass, user_nicename, user_email, user_url,
       user_registered, display_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [login, hash, nicename, email, url, now, displayName],
  );
  const id = lastRowId ?? 0;
  await execRun(
    db,
    "INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, ?, ?)",
    [id, ROLE_META_KEY, JSON.stringify({ [role]: true })],
  );
  const created = await getUserById(db, id);
  if (!created) throw new Error("Failed to read back the created user.");
  return created;
}

export async function getUserById(db: Db, id: number): Promise<User | null> {
  const row = await queryOne<UserRow>(db, "SELECT * FROM wp_users WHERE ID = ? LIMIT 1", [id]);
  if (!row) return null;
  return rowToUser(row, await roleForUser(db, id));
}

export async function getUserByLogin(db: Db, login: string): Promise<User | null> {
  const row = await queryOne<UserRow>(db, "SELECT * FROM wp_users WHERE user_login = ? LIMIT 1", [login]);
  if (!row) return null;
  return rowToUser(row, await roleForUser(db, asInt(row.ID)));
}

export async function getUserByEmail(db: Db, email: string): Promise<User | null> {
  const row = await queryOne<UserRow>(db, "SELECT * FROM wp_users WHERE user_email = ? LIMIT 1", [email]);
  if (!row) return null;
  return rowToUser(row, await roleForUser(db, asInt(row.ID)));
}

/** Check a login/password pair. Returns the user on success, null otherwise. */
export async function checkUserPassword(db: Db, login: string, password: string): Promise<User | null> {
  const row = await queryOne<UserRow>(db, "SELECT * FROM wp_users WHERE user_login = ? LIMIT 1", [login]);
  if (!row) return null;
  const ok = await verifyPassword(password, asText(row.user_pass));
  if (!ok) return null;
  return rowToUser(row, await roleForUser(db, asInt(row.ID)));
}

/** User meta (wp_usermeta). Values are stored as JSON. */
export async function getUserMeta<T>(db: Db, userId: number, key: string, defaultValue: T): Promise<T> {
  const row = await queryOne<{ meta_value: unknown }>(
    db,
    "SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = ? LIMIT 1",
    [userId, key],
  );
  if (!row) return defaultValue;
  try {
    return JSON.parse(asText(row.meta_value)) as T;
  } catch {
    return defaultValue;
  }
}

export async function updateUserMeta(db: Db, userId: number, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  const { changes } = await execRun(
    db,
    "UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = ?",
    [json, userId, key],
  );
  if (changes === 0) {
    await execRun(db, "INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, ?, ?)", [
      userId,
      key,
      json,
    ]);
  }
}

export async function deleteUserMeta(db: Db, userId: number, key: string): Promise<boolean> {
  const { changes } = await execRun(db, "DELETE FROM wp_usermeta WHERE user_id = ? AND meta_key = ?", [
    userId,
    key,
  ]);
  return changes > 0;
}
