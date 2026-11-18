import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { WordlessError } from "../../kernel/errors";
import {
  createPost,
  deletePost,
  ensureUniqueSlug,
  getPostById,
  getPostBySlug,
  listPosts,
  restorePost,
  slugify,
  trashPost,
  updatePost,
} from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("slugify", () => {
  it("lowercases, hyphenates and strips punctuation", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Café & Bar  ")).toBe("cafe-bar");
    expect(slugify("a--b___c")).toBe("a-b-c");
    expect(slugify("2026 Report: Q4")).toBe("2026-report-q4");
  });

  it("falls back to 'post' for empty input", () => {
    expect(slugify("")).toBe("post");
    expect(slugify("!!!")).toBe("post");
  });
});

describe("posts CRUD (node:sqlite)", () => {
  it("creates a post with defaults and reads it back by id and slug", async () => {
    const post = await createPost(tdb.db, { title: "Hello World", content: "Body.", authorId: 1 });
    expect(post.id).toBeGreaterThan(0);
    expect(post.slug).toBe("hello-world");
    expect(post.status).toBe("draft");
    expect(post.type).toBe("post");
    expect(post.authorId).toBe(1);

    const byId = await getPostById(tdb.db, post.id);
    expect(byId?.title).toBe("Hello World");
    const bySlug = await getPostBySlug(tdb.db, "hello-world");
    expect(bySlug?.id).toBe(post.id);
  });

  it("rejects an empty title and an unknown status", async () => {
    await expect(createPost(tdb.db, { title: "   ", authorId: 1 })).rejects.toThrow(WordlessError);
    await expect(
      createPost(tdb.db, { title: "x", authorId: 1, status: "bogus" as never }),
    ).rejects.toThrow(WordlessError);
  });

  it("generates unique slugs for duplicate titles", async () => {
    const a = await createPost(tdb.db, { title: "Same Title", authorId: 1 });
    const b = await createPost(tdb.db, { title: "Same Title", authorId: 1 });
    const c = await createPost(tdb.db, { title: "Same Title", authorId: 1 });
    expect(a.slug).toBe("same-title");
    expect(b.slug).toBe("same-title-2");
    expect(c.slug).toBe("same-title-3");
    expect(await ensureUniqueSlug(tdb.db, "same-title")).toBe("same-title-4");
  });

  it("updates a post and re-slugs on title change only when asked", async () => {
    const post = await createPost(tdb.db, { title: "Old", authorId: 1 });
    const updated = await updatePost(tdb.db, post.id, { title: "New Title", status: "publish" });
    expect(updated.title).toBe("New Title");
    expect(updated.status).toBe("publish");
    expect(updated.slug).toBe("old"); // slug only changes when explicitly patched
    const reslugged = await updatePost(tdb.db, post.id, { slug: "New Title" });
    expect(reslugged.slug).toBe("new-title");
  });

  it("paginates and filters by status", async () => {
    for (let i = 1; i <= 25; i++) {
      await createPost(tdb.db, {
        title: `Post ${i}`,
        authorId: 1,
        status: i % 2 === 0 ? "publish" : "draft",
      });
    }
    const page1 = await listPosts(tdb.db, { page: 1, perPage: 10 });
    expect(page1.posts).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.totalPages).toBe(3);
    const page3 = await listPosts(tdb.db, { page: 3, perPage: 10 });
    expect(page3.posts).toHaveLength(5);

    const published = await listPosts(tdb.db, { status: "publish", perPage: 100 });
    expect(published.total).toBe(12);
    expect(published.posts.every((p) => p.status === "publish")).toBe(true);

    const drafts = await listPosts(tdb.db, { status: "draft", perPage: 100 });
    expect(drafts.total).toBe(13);
  });

  it("trashes, hides from slug lookup, restores and hard-deletes", async () => {
    const post = await createPost(tdb.db, { title: "To Trash", authorId: 1, status: "publish" });
    await trashPost(tdb.db, post.id);
    expect(await getPostBySlug(tdb.db, "to-trash")).toBeNull();
    const listed = await listPosts(tdb.db, { perPage: 100 });
    expect(listed.total).toBe(0);
    const trashed = await listPosts(tdb.db, { status: "trash" });
    expect(trashed.total).toBe(1);

    const restored = await restorePost(tdb.db, post.id);
    expect(restored.status).toBe("draft");
    expect((await getPostBySlug(tdb.db, "to-trash"))?.id).toBe(post.id);

    expect(await deletePost(tdb.db, post.id)).toBe(true);
    expect(await getPostById(tdb.db, post.id)).toBeNull();
    await expect(deletePost(tdb.db, post.id)).rejects.toThrow(WordlessError);
  });

  it("throws 404 when updating a missing post", async () => {
    await expect(updatePost(tdb.db, 9999, { title: "x" })).rejects.toThrow(WordlessError);
  });
});
