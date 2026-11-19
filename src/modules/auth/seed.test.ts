/**
 * Seed-admin tests (Milestone 10).
 *
 * Covers the refusal path (an administrator already exists), the creation
 * path (first admin created with the administrator role and a verifiable
 * password), and input validation. The CLI script's SQL path is proven
 * separately by the M10 smoke test against a real local D1.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createUser } from "../users/service";
import { checkUserPassword } from "../users/service";
import { adminExists, seedAdmin, validateSeedInput, type SeedAdminInput } from "./seed";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

const GOOD: SeedAdminInput = {
  login: "site-admin",
  email: "admin@example.test",
  password: "correct horse battery staple",
  confirm: "correct horse battery staple",
};

describe("validateSeedInput", () => {
  it("accepts a well-formed input", () => {
    expect(() => validateSeedInput(GOOD)).not.toThrow();
  });

  it("rejects a short password", () => {
    expect(() => validateSeedInput({ ...GOOD, password: "short", confirm: "short" })).toThrow(
      /at least 8/,
    );
  });

  it("rejects a mismatched confirmation", () => {
    expect(() => validateSeedInput({ ...GOOD, confirm: "different password here" })).toThrow(
      /do not match/,
    );
  });

  it("rejects a bad email", () => {
    expect(() => validateSeedInput({ ...GOOD, email: "not-an-email" })).toThrow(/valid email/);
  });

  it("rejects a bad login", () => {
    expect(() => validateSeedInput({ ...GOOD, login: "bad login!" })).toThrow(
      /letters, digits, underscore/,
    );
  });
});

describe("seedAdmin", () => {
  it("creates the first administrator with a verifiable password", async () => {
    expect(await adminExists(tdb.db)).toBe(false);
    const user = await seedAdmin(tdb.db, GOOD);
    expect(user.login).toBe("site-admin");
    expect(user.email).toBe("admin@example.test");
    expect(user.role).toBe("administrator");
    expect(await adminExists(tdb.db)).toBe(true);
    // The stored hash verifies through the normal login path.
    const checked = await checkUserPassword(tdb.db, "site-admin", "correct horse battery staple");
    expect(checked?.id).toBe(user.id);
    expect(await checkUserPassword(tdb.db, "site-admin", "wrong password")).toBeNull();
  });

  it("refuses when an administrator already exists", async () => {
    await createUser(tdb.db, {
      login: "first-admin",
      email: "first@example.test",
      password: "correct horse battery staple",
      role: "administrator",
    });
    expect(await adminExists(tdb.db)).toBe(true);
    await expect(seedAdmin(tdb.db, GOOD)).rejects.toThrow(/already exists/);
    // A non-admin user does NOT block seeding.
    const tdb2 = createTestDb();
    try {
      await createUser(tdb2.db, {
        login: "plain-user",
        email: "plain@example.test",
        password: "correct horse battery staple",
        role: "subscriber",
      });
      expect(await adminExists(tdb2.db)).toBe(false);
      const user = await seedAdmin(tdb2.db, GOOD);
      expect(user.role).toBe("administrator");
    } finally {
      tdb2.close();
    }
  });

  it("refuses a duplicate login or email with the users-service error", async () => {
    await seedAdmin(tdb.db, GOOD);
    await expect(seedAdmin(tdb.db, { ...GOOD, login: "other-admin" })).rejects.toThrow(
      /already exists/,
    );
  });
});
