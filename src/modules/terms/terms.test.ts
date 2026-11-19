import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost } from "../posts/service";
import {
  addPostTerm,
  createTerm,
  deleteTerm,
  getPostTerms,
  getTermBySlug,
  listPostsByTerm,
  listTerms,
  listTermTree,
  removePostTerm,
  setPostTerms,
  updateTerm,
} from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("terms", () => {
  it("creates categories and tags with per-taxonomy unique slugs", async () => {
    const cat = await createTerm(tdb.db, { name: "News", taxonomy: "category" });
    expect(cat.slug).toBe("news");
    const dup = await createTerm(tdb.db, { name: "News", taxonomy: "category" });
    expect(dup.slug).toBe("news-2");
    // Same slug in a different taxonomy is allowed.
    const tag = await createTerm(tdb.db, { name: "News", taxonomy: "tag" });
    expect(tag.slug).toBe("news");
    expect(tag.termTaxonomyId).not.toBe(cat.termTaxonomyId);
  });

  it("rejects a parent on tags and a missing parent on categories", async () => {
    await expect(createTerm(tdb.db, { name: "T", taxonomy: "tag", parentId: 5 })).rejects.toThrow();
    await expect(createTerm(tdb.db, { name: "C", taxonomy: "category", parentId: 9999 })).rejects.toThrow();
  });

  it("builds a hierarchy and reparents children on delete", async () => {
    const parent = await createTerm(tdb.db, { name: "Tech", taxonomy: "category" });
    const child = await createTerm(tdb.db, { name: "AI", taxonomy: "category", parentId: parent.id });
    const grandchild = await createTerm(tdb.db, { name: "LLMs", taxonomy: "category", parentId: child.id });
    const tree = await listTermTree(tdb.db, "category");
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe("Tech");
    expect(tree[0]?.children?.[0]?.name).toBe("AI");
    expect(tree[0]?.children?.[0]?.children?.[0]?.name).toBe("LLMs");

    await deleteTerm(tdb.db, child.termTaxonomyId);
    const reparented = await getTermBySlug(tdb.db, "category", "llms");
    expect(reparented.parentId).toBe(parent.id);
  });

  it("prevents cycles when moving a term", async () => {
    const a = await createTerm(tdb.db, { name: "A", taxonomy: "category" });
    const b = await createTerm(tdb.db, { name: "B", taxonomy: "category", parentId: a.id });
    await expect(updateTerm(tdb.db, a.termTaxonomyId, { parentId: b.id })).rejects.toThrow();
    await expect(updateTerm(tdb.db, a.termTaxonomyId, { parentId: a.id })).rejects.toThrow();
  });

  it("assigns terms to posts and maintains counts", async () => {
    const post = await createPost(tdb.db, { title: "Hello", authorId: 1, status: "publish" });
    const cat = await createTerm(tdb.db, { name: "News", taxonomy: "category" });
    const tag = await createTerm(tdb.db, { name: "Hot", taxonomy: "tag" });
    await setPostTerms(tdb.db, post.id, "category", [cat.termTaxonomyId]);
    await addPostTerm(tdb.db, post.id, tag.termTaxonomyId);

    expect((await getPostTerms(tdb.db, post.id, "category")).map((t) => t.slug)).toEqual(["news"]);
    expect((await getTermBySlug(tdb.db, "category", "news")).count).toBe(1);
    expect((await getTermBySlug(tdb.db, "tag", "hot")).count).toBe(1);

    const listed = await listPostsByTerm(tdb.db, cat.termTaxonomyId);
    expect(listed.total).toBe(1);
    expect(listed.posts[0]?.id).toBe(post.id);

    await removePostTerm(tdb.db, post.id, tag.termTaxonomyId);
    expect((await getTermBySlug(tdb.db, "tag", "hot")).count).toBe(0);
    expect((await getPostTerms(tdb.db, post.id)).map((t) => t.slug)).toEqual(["news"]);
  });

  it("replaces a post's terms in one taxonomy only", async () => {
    const post = await createPost(tdb.db, { title: "P", authorId: 1, status: "publish" });
    const a = await createTerm(tdb.db, { name: "A", taxonomy: "category" });
    const b = await createTerm(tdb.db, { name: "B", taxonomy: "category" });
    const tag = await createTerm(tdb.db, { name: "T", taxonomy: "tag" });
    await setPostTerms(tdb.db, post.id, "category", [a.termTaxonomyId, b.termTaxonomyId]);
    await addPostTerm(tdb.db, post.id, tag.termTaxonomyId);
    await setPostTerms(tdb.db, post.id, "category", [b.termTaxonomyId]);
    expect((await getPostTerms(tdb.db, post.id, "category")).map((t) => t.slug)).toEqual(["b"]);
    expect((await getTermBySlug(tdb.db, "category", "a")).count).toBe(0);
    expect((await getPostTerms(tdb.db, post.id, "tag")).map((t) => t.slug)).toEqual(["t"]);
  });

  it("lists terms with pagination and parent filter", async () => {
    for (let i = 1; i <= 5; i++) {
      await createTerm(tdb.db, { name: `Cat ${i}`, taxonomy: "category" });
    }
    const page1 = await listTerms(tdb.db, "category", { page: 1, perPage: 2 });
    expect(page1.terms).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    const kids = await listTerms(tdb.db, "category", { parentId: 0 });
    expect(kids.total).toBe(5);
  });
});
