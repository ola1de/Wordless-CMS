import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost, getPostById } from "../posts/service";
import { createComment, deleteComment, getComment, listApprovedThreaded, listComments, setCommentStatus } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

async function makePost(): Promise<number> {
  const post = await createPost(tdb.db, { title: "Post", content: "Body", authorId: 1, status: "publish" });
  return post.id;
}

describe("comments", () => {
  it("creates pending comments by default and approves them", async () => {
    const postId = await makePost();
    const comment = await createComment(tdb.db, { postId, author: "Ada", content: "Great post!" });
    expect(comment.status).toBe("pending");
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(0); // pending does not count

    const approved = await setCommentStatus(tdb.db, comment.id, "approved");
    expect(approved.status).toBe("approved");
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(1);
  });

  it("auto-approves comments from users who can moderate", async () => {
    const postId = await makePost();
    const comment = await createComment(
      tdb.db,
      { postId, author: "Ed", content: "Editor here." },
      { canModerate: true },
    );
    expect(comment.status).toBe("approved");
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(1);
  });

  it("sends honeypot-filled comments straight to spam", async () => {
    const postId = await makePost();
    const comment = await createComment(tdb.db, {
      postId,
      author: "Bot",
      content: "Buy cheap watches!",
      honeypot: "http://spam.example",
    });
    expect(comment.status).toBe("spam");
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(0);
  });

  it("holds link-heavy comments for moderation", async () => {
    const postId = await makePost();
    const manyLinks = await createComment(tdb.db, {
      postId,
      author: "Linky",
      content: "See https://a.example and https://b.example and https://c.example",
    });
    expect(manyLinks.status).toBe("pending");
    const twoLinks = await createComment(tdb.db, {
      postId,
      author: "Ok",
      content: "See https://a.example and https://b.example",
    });
    expect(twoLinks.status).toBe("pending"); // still pending: anonymous default
    const modLinks = await createComment(
      tdb.db,
      { postId, author: "Mod", content: "See https://a.example and https://b.example and https://c.example" },
      { canModerate: true },
    );
    expect(modLinks.status).toBe("pending"); // link limit overrides auto-approve
  });

  it("threads approved comments and hides the rest from the public list", async () => {
    const postId = await makePost();
    const top = await createComment(tdb.db, { postId, author: "A", content: "Top" }, { canModerate: true });
    const reply = await createComment(
      tdb.db,
      { postId, author: "B", content: "Reply", parentId: top.id },
      { canModerate: true },
    );
    await createComment(tdb.db, { postId, author: "C", content: "Still pending" });
    const threaded = await listApprovedThreaded(tdb.db, postId);
    expect(threaded).toHaveLength(1);
    expect(threaded[0]?.children?.[0]?.id).toBe(reply.id);
    const all = await listComments(tdb.db, { postId });
    expect(all.total).toBe(3);
  });

  it("rejects replies to comments on another post and missing parents", async () => {
    const p1 = await makePost();
    const p2 = await makePost();
    const c1 = await createComment(tdb.db, { postId: p1, author: "A", content: "Hi" });
    await expect(
      createComment(tdb.db, { postId: p2, author: "B", content: "Nope", parentId: c1.id }),
    ).rejects.toThrow();
    await expect(createComment(tdb.db, { postId: p1, author: "B", content: "Nope", parentId: 99999 })).rejects.toThrow();
  });

  it("rejects comments on a missing post and keeps counts in sync on delete", async () => {
    await expect(createComment(tdb.db, { postId: 9999, author: "A", content: "Hi" })).rejects.toThrow();
    const postId = await makePost();
    const c1 = await createComment(tdb.db, { postId, author: "A", content: "One" }, { canModerate: true });
    const c2 = await createComment(tdb.db, { postId, author: "B", content: "Two" }, { canModerate: true });
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(2);
    await setCommentStatus(tdb.db, c1.id, "spam");
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(1);
    await deleteComment(tdb.db, c2.id);
    expect((await getPostById(tdb.db, postId))?.commentCount).toBe(0);
    await expect(getComment(tdb.db, c2.id)).rejects.toThrow();
  });
});
