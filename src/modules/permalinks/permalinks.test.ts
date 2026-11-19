import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execRun } from "../../db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost, updatePost } from "../posts/service";
import { createTerm } from "../terms/service";
import { getPermalinkStructure, postUrl, resolvePath, setPermalinkStructure } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("permalinks", () => {
  it("defaults to postname and builds URLs per structure", async () => {
    expect(await getPermalinkStructure(tdb.db)).toBe("postname");
    const post = await createPost(tdb.db, { title: "Hello World", authorId: 1, status: "publish" });
    // Force a known date for deterministic dated URLs.
    await execRun(tdb.db, "UPDATE wp_posts SET post_date = ?, post_date_gmt = ? WHERE ID = ?", [
      "2026-11-19T10:00:00.000Z",
      "2026-11-19T10:00:00.000Z",
      post.id,
    ]);
    const dated = { ...post, date: "2026-11-19T10:00:00.000Z", dateGmt: "2026-11-19T10:00:00.000Z" };
    expect(await postUrl(tdb.db, dated)).toBe("/hello-world");
    await setPermalinkStructure(tdb.db, "day-name");
    expect(await postUrl(tdb.db, dated)).toBe("/2026/11/19/hello-world");
    await setPermalinkStructure(tdb.db, "month-name");
    expect(await postUrl(tdb.db, dated)).toBe("/2026/11/hello-world");
    await setPermalinkStructure(tdb.db, "plain");
    expect(await postUrl(tdb.db, dated)).toBe(`/?p=${post.id}`);
    await expect(setPermalinkStructure(tdb.db, "bogus")).rejects.toThrow();
  });

  it("resolves posts, pages, terms and date archives", async () => {
    const post = await createPost(tdb.db, { title: "Hello", authorId: 1, status: "publish" });
    const page = await createPost(tdb.db, { title: "About", authorId: 1, status: "publish", type: "page" });
    const cat = await createTerm(tdb.db, { name: "News", taxonomy: "category" });
    expect(await resolvePath(tdb.db, "/")).toEqual({ kind: "home" });
    const bySlug = await resolvePath(tdb.db, "/hello");
    expect(bySlug.kind).toBe("post");
    if (bySlug.kind === "post") expect(bySlug.post.id).toBe(post.id);
    const byPage = await resolvePath(tdb.db, "/about");
    expect(byPage.kind).toBe("page");
    if (byPage.kind === "page") expect(byPage.post.id).toBe(page.id);
    const byTerm = await resolvePath(tdb.db, "/category/news");
    expect(byTerm.kind).toBe("term");
    if (byTerm.kind === "term") expect(byTerm.term.termTaxonomyId).toBe(cat.termTaxonomyId);
    expect(await resolvePath(tdb.db, "/category/nope")).toEqual({ kind: "not-found" });
    expect(await resolvePath(tdb.db, "/2026/")).toEqual({ kind: "date-archive", year: 2026, month: undefined });
    expect(await resolvePath(tdb.db, "/2026/11/")).toEqual({ kind: "date-archive", year: 2026, month: 11 });
    expect(await resolvePath(tdb.db, "/2026/13/")).toEqual({ kind: "not-found" });
    expect(await resolvePath(tdb.db, "/missing-slug")).toEqual({ kind: "not-found" });
  });

  it("resolves dated URLs only when the date matches the post", async () => {
    const post = await createPost(tdb.db, { title: "Dated", authorId: 1, status: "publish" });
    await execRun(tdb.db, "UPDATE wp_posts SET post_date = ?, post_date_gmt = ? WHERE ID = ?", [
      "2026-11-19T10:00:00.000Z",
      "2026-11-19T10:00:00.000Z",
      post.id,
    ]);
    await setPermalinkStructure(tdb.db, "day-name");
    const ok = await resolvePath(tdb.db, "/2026/11/19/dated");
    expect(ok.kind).toBe("post");
    expect(await resolvePath(tdb.db, "/2026/11/18/dated")).toEqual({ kind: "not-found" });
    // The resolver is lenient about dated forms: a month-form URL for the
    // same post still resolves (old links keep working).
    expect((await resolvePath(tdb.db, "/2026/11/dated")).kind).toBe("post");
  });

  it("records a 301 when a published post changes slug, and resolves it", async () => {
    const post = await createPost(tdb.db, { title: "Old Name", authorId: 1, status: "publish" });
    await updatePost(tdb.db, post.id, { slug: "new-name" });
    const redirect = await resolvePath(tdb.db, "/old-name");
    expect(redirect).toEqual({ kind: "redirect", target: "/new-name" });
    const current = await resolvePath(tdb.db, "/new-name");
    expect(current.kind).toBe("post");
  });

  it("does not record redirects for drafts or plain permalinks", async () => {
    const draft = await createPost(tdb.db, { title: "Drafty", authorId: 1, status: "draft" });
    await updatePost(tdb.db, draft.id, { slug: "drafty-2" });
    expect(await resolvePath(tdb.db, "/drafty")).toEqual({ kind: "not-found" });
    await setPermalinkStructure(tdb.db, "plain");
    const post = await createPost(tdb.db, { title: "Plain Post", authorId: 1, status: "publish" });
    await updatePost(tdb.db, post.id, { slug: "plain-post-2" });
    expect(await resolvePath(tdb.db, "/plain-post")).toEqual({ kind: "not-found" });
  });
});
