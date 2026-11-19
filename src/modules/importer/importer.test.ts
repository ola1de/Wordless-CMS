/**
 * Milestone 9 importer tests — safe PHP unserializing, mysqldump
 * parsing, WXR + SQL fixture round-trips, and the import job runner.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestDb, type TestDb } from "../../test/test-db";
import { FakeR2Bucket, fakeR2Bucket } from "../../test/fake-storage";
import { execRun, queryOne } from "../../db";
import type { Env } from "../../env";
import { createUser } from "../users/service";
import { checkUserPassword, getUserMeta } from "../users/service";
import { PhpUnserializeError, safeUnserialize } from "./php-serialize";
import { parseSqlDump } from "./sql-parser";
import { parseWxr } from "./wxr-parser";
import { importSql, importWxr, runImportJob } from "./service";
import { PASSWORD_RESET_META_KEY } from "../security/service";

let tdb: TestDb;
let r2: FakeR2Bucket;
let env: Env;

const fixtureDir = fileURLToPath(new URL("../../../test/fixtures/wordpress/", import.meta.url));

beforeEach(() => {
  tdb = createTestDb();
  r2 = new FakeR2Bucket();
  env = { MEDIA: fakeR2Bucket() } as unknown as Env;
  (env as unknown as { MEDIA: FakeR2Bucket }).MEDIA = r2;
});

afterEach(() => {
  tdb.close();
});

describe("safe PHP unserialize", () => {
  it("converts scalars, arrays and nested structures", () => {
    expect(safeUnserialize('a:2:{s:5:"color";s:4:"blue";s:4:"size";i:3;}')).toEqual({ color: "blue", size: 3 });
    expect(safeUnserialize("i:42;")).toBe(42);
    expect(safeUnserialize("i:-7;")).toBe(-7);
    expect(safeUnserialize("d:3.14;")).toBe(3.14);
    expect(safeUnserialize("b:1;")).toBe(true);
    expect(safeUnserialize("b:0;")).toBe(false);
    expect(safeUnserialize("N;")).toBeNull();
    expect(safeUnserialize('s:5:"hello";')).toBe("hello");
    expect(safeUnserialize('a:2:{i:0;s:1:"a";i:1;s:1:"b";}')).toEqual(["a", "b"]);
    expect(safeUnserialize('a:1:{s:3:"key";a:1:{s:1:"x";i:1;}}')).toEqual({ key: { x: 1 } });
  });

  it("returns plain strings unchanged", () => {
    expect(safeUnserialize("just a string")).toBe("just a string");
    expect(safeUnserialize("")).toBe("");
    expect(safeUnserialize("blogname")).toBe("blogname");
  });

  it("refuses serialized objects and references — never executes imported code", () => {
    expect(() => safeUnserialize('O:8:"stdClass":0:{}')).toThrow(PhpUnserializeError);
    expect(() => safeUnserialize('C:11:"ArrayObject":0:{}')).toThrow(PhpUnserializeError);
    expect(() => safeUnserialize("r:1;")).toThrow(PhpUnserializeError);
    expect(() => safeUnserialize("R:2;")).toThrow(PhpUnserializeError);
  });

  it("rejects malformed payloads instead of half-parsing them", () => {
    expect(() => safeUnserialize("i:notanumber;")).toThrow(PhpUnserializeError);
    expect(() => safeUnserialize('s:10:"short";')).toThrow(PhpUnserializeError);
    expect(() => safeUnserialize("a:5:{i:0;i:1;}")).toThrow(PhpUnserializeError);
    expect(() => safeUnserialize("x:1;")).toThrow(PhpUnserializeError);
  });
});

describe("mysqldump parser", () => {
  it("parses the fixture dump: rows, escaped quotes, ignored tables", () => {
    const sql = readFileSync(`${fixtureDir}wordpress-dump.sql`, "utf8");
    const parsed = parseSqlDump(sql);
    expect(parsed.statements).toBeGreaterThan(0);
    expect(parsed.ignoredTables).toContain("wp_custom_plugin");
    const users = parsed.rows.filter((r) => r.table === "wp_users");
    expect(users).toHaveLength(2);
    expect(users[0]?.values.user_login).toBe("fixture-admin");
    const comments = parsed.rows.filter((r) => r.table === "wp_comments");
    expect(comments).toHaveLength(2);
    expect(comments[0]?.values.comment_content).toBe("It's a fixture, and it works.");
    expect(comments[0]?.values.comment_approved).toBe("1");
    const options = parsed.rows.filter((r) => r.table === "wp_options");
    expect(options.some((o) => o.values.option_name === "fixture_object_option")).toBe(true);
  });

  it("handles INSERT with an explicit column list and NULL values", () => {
    const parsed = parseSqlDump(
      "INSERT INTO `wp_options` (`option_name`, `option_value`, `autoload`) VALUES ('a', NULL, 'yes'), ('b', 'x', 'no');",
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.values).toEqual({ option_name: "a", option_value: null, autoload: "yes" });
    expect(parsed.rows[1]?.values.option_value).toBe("x");
  });
});

describe("WXR import (fixture round-trip)", () => {
  const wxr = () => readFileSync(`${fixtureDir}wordpress-export.xml`, "utf8");

  it("parses the fixture export", () => {
    const parsed = parseWxr(wxr());
    expect(parsed.authors).toHaveLength(2);
    expect(parsed.terms).toHaveLength(4);
    expect(parsed.items).toHaveLength(4);
    expect(parsed.items.find((i) => i.postType === "revision")).toBeDefined();
    const post = parsed.items.find((i) => i.postId === 10);
    expect(post?.content).toContain("<!-- wp:paragraph -->");
    expect(post?.comments).toHaveLength(2);
    expect(post?.categories.map((c) => c.nicename)).toContain("news");
  });

  it("imports authors, terms, posts, comments and attachments with counts matching", async () => {
    const admin = await createUser(tdb.db, {
      login: "site-admin",
      email: "sa@example.test",
      password: "password-123",
      role: "administrator",
    });
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const report = await importWxr(tdb.db, env, wxr(), "wordpress-export.xml", admin.id, {
      fetchAttachment: async () => ({ bytes: pngBytes, mime: "image/png" }),
    });
    expect(report.counts.failed).toBe(0);
    expect(report.counts.byType.user?.imported).toBe(2);
    expect(report.counts.byType.term?.imported).toBe(4);
    expect(report.counts.byType.post?.imported).toBe(3); // post + page + attachment
    expect(report.counts.byType.post?.skipped).toBe(1); // the revision
    expect(report.counts.byType.comment?.imported).toBe(2);
    expect(report.counts.byType.attachment_media?.imported).toBe(1);

    // Block content preserved verbatim.
    const post = await queryOne<{ post_content: string; post_date: string }>(
      tdb.db,
      "SELECT post_content, post_date FROM wp_posts WHERE post_name = 'hello-from-wordpress' LIMIT 1",
    );
    expect(post?.post_content).toContain("<!-- wp:paragraph -->");
    expect(post?.post_date).toBe("2026-01-10T10:30:00.000Z");

    // A serialized postmeta value lands as JSON.
    const meta = await queryOne<{ meta_value: string }>(
      tdb.db,
      "SELECT meta_value FROM wp_postmeta WHERE meta_key = '_fixture_settings' LIMIT 1",
    );
    expect(JSON.parse(meta?.meta_value ?? "{}")).toEqual({ color: "blue", size: 3 });

    // Category parent resolved (tutorials → news).
    const tutorials = await queryOne<{ parent: number }>(
      tdb.db,
      "SELECT tt.parent FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id WHERE t.slug = 'tutorials' LIMIT 1",
    );
    const news = await queryOne<{ term_id: number }>(tdb.db, "SELECT term_id FROM wp_terms WHERE slug = 'news' LIMIT 1");
    expect(tutorials?.parent).toBe(news?.term_id);

    // Comment parent remapped (reply 101 → comment 100's new ID).
    const parent = await queryOne<{ comment_ID: number }>(
      tdb.db,
      "SELECT comment_ID FROM wp_comments WHERE comment_author = 'Reader One' LIMIT 1",
    );
    const reply = await queryOne<{ comment_parent: number; comment_approved: string }>(
      tdb.db,
      "SELECT comment_parent, comment_approved FROM wp_comments WHERE comment_author = 'Reader Two' LIMIT 1",
    );
    expect(reply?.comment_parent).toBe(parent?.comment_ID);
    expect(reply?.comment_approved).toBe("0");

    // The attachment file reached R2 and the post has the fetched MIME type.
    const attachment = await queryOne<{ post_mime_type: string; ID: number }>(
      tdb.db,
      "SELECT post_mime_type, ID FROM wp_posts WHERE post_type = 'attachment' LIMIT 1",
    );
    expect(attachment?.post_mime_type).toBe("image/png");
    expect(r2.keys.some((k) => k.startsWith("media/imported-"))).toBe(true);

    // Imported users cannot log in with any password and carry the flag.
    expect(await checkUserPassword(tdb.db, "fixture-admin", "anything")).toBeNull();
    const imported = await queryOne<{ ID: number }>(tdb.db, "SELECT ID FROM wp_users WHERE user_login = 'fixture-admin' LIMIT 1");
    expect(await getUserMeta<string>(tdb.db, imported?.ID ?? 0, PASSWORD_RESET_META_KEY, "")).toBe("1");
  });

  it("records a failed attachment fetch instead of dropping it", async () => {
    const admin = await createUser(tdb.db, {
      login: "site-admin2",
      email: "sa2@example.test",
      password: "password-123",
      role: "administrator",
    });
    const report = await importWxr(tdb.db, env, wxr(), "wordpress-export.xml", admin.id, {
      fetchAttachment: async () => null,
    });
    expect(report.counts.byType.attachment_media?.failed).toBe(1);
    expect(report.counts.byType.post?.imported).toBe(3); // the attachment post itself still imports
  });
});

describe("SQL import (fixture round-trip)", () => {
  const sql = () => readFileSync(`${fixtureDir}wordpress-dump.sql`, "utf8");

  it("imports the dump with counts matching and serialized values as JSON", async () => {
    const admin = await createUser(tdb.db, {
      login: "site-admin",
      email: "sa@example.test",
      password: "password-123",
      role: "administrator",
    });
    const report = await importSql(tdb.db, sql(), "wordpress-dump.sql", admin.id);
    expect(report.ignoredTables).toContain("wp_custom_plugin");
    expect(report.counts.byType.user?.imported).toBe(2);
    expect(report.counts.byType.post?.imported).toBe(2); // post + page
    expect(report.counts.byType.post?.skipped).toBe(1); // the revision
    expect(report.counts.byType.comment?.imported).toBe(2);
    expect(report.counts.byType.link?.imported).toBe(1);
    expect(report.counts.byType.term_relationship?.imported).toBe(2);

    // The serialized option lands as JSON.
    const option = await queryOne<{ option_value: string }>(
      tdb.db,
      "SELECT option_value FROM wp_options WHERE option_name = 'fixture_serialized_option' LIMIT 1",
    );
    expect(JSON.parse(option?.option_value ?? "{}")).toEqual({ color: "blue", size: 3 });

    // The serialized OBJECT option is refused and recorded as failed.
    const failedOption = report.items.find((i) => i.type === "option" && i.sourceId === "fixture_object_option");
    expect(failedOption?.status).toBe("failed");
    expect(failedOption?.reason).toMatch(/object/);

    // The serialized capabilities become a JSON object the roles system can read.
    const caps = await queryOne<{ meta_value: string }>(
      tdb.db,
      "SELECT meta_value FROM wp_usermeta WHERE meta_key = 'wp_capabilities' AND user_id = (SELECT ID FROM wp_users WHERE user_login = 'fixture-admin') LIMIT 1",
    );
    expect(JSON.parse(caps?.meta_value ?? "{}")).toEqual({ administrator: true });

    // Term relationships survived (post 10 → News + wordpress).
    const rels = await queryOne<{ n: number }>(
      tdb.db,
      "SELECT COUNT(*) AS n FROM wp_term_relationships WHERE object_id = (SELECT ID FROM wp_posts WHERE post_name = 'hello-from-wordpress')",
    );
    expect(rels?.n).toBe(2);

    // Comment parent remapped.
    const parent = await queryOne<{ comment_ID: number }>(
      tdb.db,
      "SELECT comment_ID FROM wp_comments WHERE comment_author = 'Reader One' LIMIT 1",
    );
    const reply = await queryOne<{ comment_parent: number }>(
      tdb.db,
      "SELECT comment_parent FROM wp_comments WHERE comment_author = 'Reader Two' LIMIT 1",
    );
    expect(reply?.comment_parent).toBe(parent?.comment_ID);

    // Imported users cannot log in with the old (phpass) password.
    expect(await checkUserPassword(tdb.db, "fixture-jane", "anything")).toBeNull();
    const imported = await queryOne<{ ID: number }>(tdb.db, "SELECT ID FROM wp_users WHERE user_login = 'fixture-jane' LIMIT 1");
    expect(await getUserMeta<string>(tdb.db, imported?.ID ?? 0, PASSWORD_RESET_META_KEY, "")).toBe("1");
  });

  it("is idempotent on re-import: existing users/terms are skipped, not duplicated", async () => {
    const admin = await createUser(tdb.db, {
      login: "site-admin",
      email: "sa@example.test",
      password: "password-123",
      role: "administrator",
    });
    await importSql(tdb.db, sql(), "wordpress-dump.sql", admin.id);
    const second = await importSql(tdb.db, sql(), "wordpress-dump.sql", admin.id);
    expect(second.counts.byType.user?.skipped).toBe(2);
    expect(second.counts.byType.term?.skipped).toBe(4);
    const users = await queryOne<{ n: number }>(tdb.db, "SELECT COUNT(*) AS n FROM wp_users WHERE user_login LIKE 'fixture-%'");
    expect(users?.n).toBe(2);
  });
});

describe("import jobs", () => {
  it("runs a WXR import as a wl_jobs job reading the file from R2", async () => {
    const admin = await createUser(tdb.db, {
      login: "site-admin",
      email: "sa@example.test",
      password: "password-123",
      role: "administrator",
    });
    const xml = readFileSync(`${fixtureDir}wordpress-export.xml`, "utf8");
    const r2Key = "imports/job-1-wordpress-export.xml";
    await r2.put(r2Key, new TextEncoder().encode(xml), { httpMetadata: { contentType: "text/xml" } });
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    await execRun(
      tdb.db,
      "INSERT INTO wl_jobs (id, kind, status, payload, result, attempts, created_at, updated_at) VALUES (?, 'import_wxr', 'queued', ?, NULL, 0, ?, ?)",
      [jobId, JSON.stringify({ r2Key, filename: "wordpress-export.xml" }), now, now],
    );
    // Attachment fetching is stubbed by the job runner's fetch only when
    // the URL is reachable; the fixture URL is not, so the media fetch
    // fails and is recorded — the job still completes.
    await runImportJob(tdb.db, env, jobId, admin.id);
    const job = await queryOne<{ status: string; result: string }>(tdb.db, "SELECT status, result FROM wl_jobs WHERE id = ?", [jobId]);
    expect(job?.status).toBe("done");
    const report = JSON.parse(job?.result ?? "{}") as { kind: string; counts: { byType: Record<string, { imported: number }> } };
    expect(report.kind).toBe("wxr");
    expect(report.counts.byType.user?.imported).toBe(2);
    expect(report.counts.byType.post?.imported).toBe(3);
  }, 30000);
});
