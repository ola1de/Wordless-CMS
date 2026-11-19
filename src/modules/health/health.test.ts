import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import type { Env } from "../../env";
import { createPost } from "../posts/service";
import { createUser } from "../users/service";
import { siteHealth } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

function fakeEnv(): Env {
  return { DB: {}, MEDIA: {}, CONFIG: {} } as unknown as Env;
}

describe("site health", () => {
  it("reports real pass/fail checks with counts", async () => {
    await createUser(tdb.db, { login: "admin", email: "a@example.com", password: "password-123", role: "administrator" });
    await createPost(tdb.db, { title: "Hello", authorId: 1, status: "publish" });
    const health = await siteHealth(tdb.db, fakeEnv(), "0.2.0");
    expect(health.status).toBe("ok");
    const byName = new Map(health.checks.map((c) => [c.name, c]));
    expect(byName.get("database")?.status).toBe("pass");
    expect(byName.get("tables")?.status).toBe("pass");
    expect(byName.get("bindings")?.status).toBe("pass");
    expect(byName.get("content")?.status).toBe("pass");
    expect(byName.get("content")?.detail).toContain("1 posts/pages");
    expect(byName.get("content")?.detail).toContain("1 users");
    expect(byName.get("runtime")?.detail).toContain("0.2.0");
  });

  it("fails the bindings check when a binding is missing", async () => {
    const env = { DB: {}, MEDIA: undefined, CONFIG: {} } as unknown as Env;
    const health = await siteHealth(tdb.db, env, "0.2.0");
    expect(health.status).toBe("degraded");
    expect(health.checks.find((c) => c.name === "bindings")?.status).toBe("fail");
    expect(health.checks.find((c) => c.name === "bindings")?.detail).toContain("MEDIA");
  });

  it("fails the tables check when a required table is missing", async () => {
    tdb.sqlite.exec("DROP TABLE wl_redirects");
    const health = await siteHealth(tdb.db, fakeEnv(), "0.2.0");
    expect(health.status).toBe("degraded");
    expect(health.checks.find((c) => c.name === "tables")?.status).toBe("fail");
    expect(health.checks.find((c) => c.name === "tables")?.detail).toContain("wl_redirects");
  });
});
