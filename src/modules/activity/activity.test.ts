import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { listActivity, logActivity } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("activity log", () => {
  it("logs entries and lists them newest first, paginated", async () => {
    await logActivity(tdb.db, { actorId: 1, action: "post.create", objectType: "post", objectId: 5, details: "Hello" });
    await logActivity(tdb.db, { actorId: 0, action: "comment.create", objectType: "comment", objectId: 9 });
    await logActivity(tdb.db, { actorId: 1, action: "auth.login", objectType: "user", objectId: 1 });
    const page1 = await listActivity(tdb.db, { page: 1, perPage: 2 });
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.entries).toHaveLength(2);
    expect(page1.entries[0]?.action).toBe("auth.login");
    expect(page1.entries[0]?.actorId).toBe(1);
    const page2 = await listActivity(tdb.db, { page: 2, perPage: 2 });
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries[0]?.action).toBe("post.create");
    expect(page2.entries[0]?.objectId).toBe("5");
    expect(page2.entries[0]?.details).toBe("Hello");
  });
});
