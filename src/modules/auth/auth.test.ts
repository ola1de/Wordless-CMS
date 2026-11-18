import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { execRun } from "../../db";
import { createSession, login, revokeSession, userFromSession, verifySession } from "./service";
import { createUser } from "../users/service";
import { hashPassword, verifyPassword } from "../users/password";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("password hashing (PBKDF2 / WebCrypto)", () => {
  it("verifies the correct password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(await verifyPassword("correct horse battery staple", "not-a-hash")).toBe(false);
  });

  it("salts hashes so identical passwords differ", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(a.startsWith("pbkdf2$100000$")).toBe(true);
  });
});

describe("auth sessions (node:sqlite)", () => {
  it("creates, verifies and revokes a session", async () => {
    const user = await createUser(tdb.db, {
      login: "admin",
      email: "admin@example.test",
      password: "s3cret-password",
      role: "administrator",
    });
    const { token, session } = await createSession(tdb.db, user.id);
    expect(token.length).toBeGreaterThan(20);
    expect(session.userId).toBe(user.id);

    const verified = await verifySession(tdb.db, token);
    expect(verified?.id).toBe(session.id);
    expect(await verifySession(tdb.db, "bogus-token")).toBeNull();

    // The raw token must never be stored — only its hash.
    const rows = await tdb.sqlite
      .prepare("SELECT token_hash FROM wl_sessions WHERE id = ?")
      .all(session.id) as { token_hash: string }[];
    expect(rows[0]?.token_hash).not.toContain(token);

    expect(await revokeSession(tdb.db, token)).toBe(true);
    expect(await verifySession(tdb.db, token)).toBeNull();
    expect(await revokeSession(tdb.db, token)).toBe(false);
  });

  it("rejects expired sessions", async () => {
    const user = await createUser(tdb.db, {
      login: "editor1",
      email: "ed@example.test",
      password: "s3cret-password",
      role: "editor",
    });
    const { token } = await createSession(tdb.db, user.id);
    await execRun(tdb.db, "UPDATE wl_sessions SET expires_at = ? WHERE user_id = ?", [
      "2000-01-01T00:00:00.000Z",
      user.id,
    ]);
    expect(await verifySession(tdb.db, token)).toBeNull();
  });

  it("logs in with correct credentials and resolves the user from the session", async () => {
    await createUser(tdb.db, {
      login: "author1",
      email: "au@example.test",
      password: "s3cret-password",
      role: "author",
    });
    expect(await login(tdb.db, "author1", "wrong")).toBeNull();
    expect(await login(tdb.db, "nobody", "s3cret-password")).toBeNull();

    const result = await login(tdb.db, "author1", "s3cret-password");
    expect(result).not.toBeNull();
    const user = await userFromSession(tdb.db, result?.token ?? null);
    expect(user?.login).toBe("author1");
    expect(user?.role).toBe("author");
  });
});
