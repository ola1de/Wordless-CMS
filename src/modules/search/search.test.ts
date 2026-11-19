import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost } from "../posts/service";
import { searchPosts } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("search", () => {
  it("ranks title matches before content matches", async () => {
    await createPost(tdb.db, { title: "Cooking tips", content: "Nothing about zebras.", authorId: 1, status: "publish" });
    await createPost(tdb.db, { title: "Daily notes", content: "A long essay about cooking.", authorId: 1, status: "publish" });
    await createPost(tdb.db, { title: "Zebra facts", content: "cooking is not mentioned here.", authorId: 1, status: "publish" });
    const result = await searchPosts(tdb.db, "cooking");
    expect(result.total).toBe(3);
    expect(result.posts[0]?.title).toBe("Cooking tips");
  });

  it("only searches published posts and pages", async () => {
    await createPost(tdb.db, { title: "Secret draft", content: "hidden", authorId: 1, status: "draft" });
    await createPost(tdb.db, { title: "Public page", content: "visible", authorId: 1, status: "publish", type: "page" });
    const result = await searchPosts(tdb.db, "secret");
    expect(result.total).toBe(0);
    const pageResult = await searchPosts(tdb.db, "public");
    expect(pageResult.total).toBe(1);
  });

  it("matches case-insensitively and treats % and _ literally", async () => {
    await createPost(tdb.db, { title: "100% Real", content: "body", authorId: 1, status: "publish" });
    await createPost(tdb.db, { title: "Under_score", content: "body", authorId: 1, status: "publish" });
    expect((await searchPosts(tdb.db, "100%")).total).toBe(1);
    expect((await searchPosts(tdb.db, "under_score")).total).toBe(1);
    expect((await searchPosts(tdb.db, "REAL")).total).toBe(1);
    expect((await searchPosts(tdb.db, "zzz")).total).toBe(0);
  });

  it("paginates results", async () => {
    for (let i = 1; i <= 5; i++) {
      await createPost(tdb.db, { title: `Common ${i}`, content: "shared word", authorId: 1, status: "publish" });
    }
    const page1 = await searchPosts(tdb.db, "common", { page: 1, perPage: 2 });
    expect(page1.posts).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    const page3 = await searchPosts(tdb.db, "common", { page: 3, perPage: 2 });
    expect(page3.posts).toHaveLength(1);
  });

  it("rejects empty and overlong queries", async () => {
    await expect(searchPosts(tdb.db, "   ")).rejects.toThrow();
    await expect(searchPosts(tdb.db, "x".repeat(201))).rejects.toThrow();
  });
});
