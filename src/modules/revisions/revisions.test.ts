import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost, trashPost, updatePost } from "../posts/service";
import { diffLines, diffRevisions, getRevision, listRevisions, restoreRevision, saveAutosave } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("revisions", () => {
  it("snapshots the pre-update content on every update", async () => {
    const post = await createPost(tdb.db, { title: "v1", content: "one", authorId: 1 });
    await updatePost(tdb.db, post.id, { title: "v2", content: "two" });
    await updatePost(tdb.db, post.id, { title: "v3", content: "three" });
    const revisions = await listRevisions(tdb.db, post.id);
    expect(revisions).toHaveLength(2);
    // Newest revision first: the snapshot taken before the second update.
    expect(revisions[0]?.title).toBe("v2");
    expect(revisions[0]?.content).toBe("two");
    expect(revisions[1]?.title).toBe("v1");
    expect(revisions[1]?.status).toBe("inherit");
  });

  it("does not create a revision for trash/restore transitions", async () => {
    const post = await createPost(tdb.db, { title: "x", authorId: 1 });
    await updatePost(tdb.db, post.id, { title: "y" });
    await trashPost(tdb.db, post.id);
    expect(await listRevisions(tdb.db, post.id)).toHaveLength(1);
  });

  it("restores an old revision and snapshots the pre-restore content", async () => {
    const post = await createPost(tdb.db, { title: "v1", content: "one", authorId: 1 });
    await updatePost(tdb.db, post.id, { title: "v2", content: "two" });
    await updatePost(tdb.db, post.id, { title: "v3", content: "three" });
    const revisions = await listRevisions(tdb.db, post.id);
    const oldest = revisions[revisions.length - 1];
    if (!oldest) throw new Error("expected a revision");
    const restored = await restoreRevision(tdb.db, oldest.id);
    expect(restored.title).toBe("v1");
    expect(restored.content).toBe("one");
    expect(restored.slug).toBe(post.slug); // restore never changes the slug
    // Pre-restore snapshot (v3) was added: 2 old + 1 new.
    expect(await listRevisions(tdb.db, post.id)).toHaveLength(3);
  });

  it("keeps one autosave per post + author, updated in place", async () => {
    const post = await createPost(tdb.db, { title: "Draft", content: "a", authorId: 1 });
    const first = await saveAutosave(tdb.db, post.id, 1, { content: "a1" });
    const second = await saveAutosave(tdb.db, post.id, 1, { content: "a2" });
    expect(second.id).toBe(first.id);
    expect(second.content).toBe("a2");
    expect(second.isAutosave).toBe(true);
    const otherAuthor = await saveAutosave(tdb.db, post.id, 2, { content: "b1" });
    expect(otherAuthor.id).not.toBe(first.id);
    const revisions = await listRevisions(tdb.db, post.id);
    expect(revisions.filter((r) => r.isAutosave)).toHaveLength(2);
    // The live post is untouched by autosaves.
    expect((await getRevision(tdb.db, first.id)).content).toBe("a2");
  });

  it("diffs two revisions line by line", async () => {
    const a = diffLines("one\ntwo\nthree", "one\nTWO\nthree\nfour");
    expect(a.added).toBe(2);
    expect(a.removed).toBe(1);
    expect(a.exact).toBe(true);
    expect(a.addedLines).toContain("TWO");
    expect(a.removedLines).toContain("two");

    const post = await createPost(tdb.db, { title: "d", content: "alpha\nbeta", authorId: 1 });
    await updatePost(tdb.db, post.id, { content: "alpha\ngamma" });
    await updatePost(tdb.db, post.id, { content: "alpha\ngamma\ndelta" });
    const revisions = await listRevisions(tdb.db, post.id);
    const oldest = revisions[revisions.length - 1];
    const newest = revisions[0];
    if (!oldest || !newest) throw new Error("expected revisions");
    const diff = await diffRevisions(tdb.db, oldest.id, newest.id);
    expect(diff.fromId).toBe(oldest.id);
    expect(diff.toId).toBe(newest.id);
    expect(diff.added).toBe(1); // gamma
    expect(diff.removed).toBe(1); // beta
  });

  it("rejects diffs across posts and missing revisions", async () => {
    const p1 = await createPost(tdb.db, { title: "p1", content: "a", authorId: 1 });
    const p2 = await createPost(tdb.db, { title: "p2", content: "b", authorId: 1 });
    await updatePost(tdb.db, p1.id, { content: "a2" });
    await updatePost(tdb.db, p2.id, { content: "b2" });
    const r1 = (await listRevisions(tdb.db, p1.id))[0];
    const r2 = (await listRevisions(tdb.db, p2.id))[0];
    if (!r1 || !r2) throw new Error("expected revisions");
    await expect(diffRevisions(tdb.db, r1.id, r2.id)).rejects.toThrow();
    await expect(getRevision(tdb.db, 99999)).rejects.toThrow();
  });
});
