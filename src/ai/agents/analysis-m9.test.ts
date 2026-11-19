/**
 * Milestone 9 agent tests — the security-scanner and performance-analyst
 * now run the real M9 checks; their outputs must match direct queries.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { FakeR2Bucket, fakeR2Bucket } from "../../test/fake-storage";
import { queryOne } from "../../db";
import type { Env } from "../../env";
import type { AgentContext } from "../types";
import { createUser } from "../../modules/users/service";
import { createPost } from "../../modules/posts/service";
import { getLockoutConfig, recordFailedLogin } from "../../modules/security/lockout";
import { confirmTotp, setupTotp } from "../../modules/security/service";
import { totpCode } from "../../modules/security/totp";
import { listPosts } from "../../modules/posts/service";
import { listMedia } from "../../modules/media/service";
import { securityScanner, performanceAnalyst, backupAdvisor } from "./analysis";
import { createBackup } from "../../modules/backup/service";

let tdb: TestDb;
let r2: FakeR2Bucket;
let env: Env;

function ctx(): AgentContext {
  return {
    db: tdb.db,
    env,
    provider: {} as AgentContext["provider"],
    providerConfigured: false,
    input: "",
    memoryText: "",
    userId: 0,
  };
}

beforeEach(() => {
  tdb = createTestDb();
  r2 = new FakeR2Bucket();
  env = { MEDIA: fakeR2Bucket() } as unknown as Env;
  (env as unknown as { MEDIA: FakeR2Bucket }).MEDIA = r2;
});

afterEach(() => {
  tdb.close();
});

describe("security-scanner (Milestone 9, real checks)", () => {
  it("reports the measured lockout config, 2FA status, headers and default admin login", async () => {
    const admin = await createUser(tdb.db, {
      login: "admin",
      email: "a@example.test",
      password: "password-123",
      role: "administrator",
    });
    const editor = await createUser(tdb.db, {
      login: "ed1",
      email: "e@example.test",
      password: "password-123",
      role: "editor",
    });
    expect(editor.id).toBeGreaterThan(0);

    const result = await securityScanner.run(ctx());
    const data = result.data as Record<string, unknown>;
    expect(data.administrators).toBe(1);
    expect(data.administratorsWith2fa).toBe(0);
    expect(data.defaultAdminLoginExists).toBe(true);
    expect(data.lockout).toEqual(await getLockoutConfig(tdb.db));
    expect(data.lockedKeys).toBe(0);
    expect(data.headers).toContain("Content-Security-Policy");
    expect(data.uploadAllowlist).toContain("image/jpeg");
    expect(data.maxUploadBytes).toBe(10 * 1024 * 1024);

    // After 2FA is enabled and a lockout is recorded, the agent reports both.
    const nowMs = 1_800_000_000_000;
    const setup = await setupTotp(tdb.db, admin.id, admin.login);
    await confirmTotp(tdb.db, admin.id, (await totpCode(setup.secret, nowMs)) as string, nowMs);
    for (let i = 0; i < 5; i++) await recordFailedLogin(tdb.db, "login:someone");
    const after = await securityScanner.run(ctx());
    const afterData = after.data as Record<string, unknown>;
    expect(afterData.administratorsWith2fa).toBe(1);
    expect(afterData.lockedKeys).toBe(1);
    expect(after.output).toMatch(/1 of 1 administrator\(s\) have TOTP enabled/);
  });
});

describe("performance-analyst (Milestone 9, real numbers)", () => {
  it("measures post/media/comment counts and cache + derivative status from D1/R2", async () => {
    const user = await createUser(tdb.db, { login: "pa1", email: "p@example.test", password: "password-123", role: "author" });
    await createPost(tdb.db, { title: "Perf A", content: "hello", status: "publish", authorId: user.id });
    await createPost(tdb.db, { title: "Perf B", content: "world", status: "draft", authorId: user.id });
    await r2.put("media/a.png", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });

    const result = await performanceAnalyst.run(ctx());
    const data = result.data as Record<string, unknown>;
    const posts = await listPosts(tdb.db, { status: "publish", type: "post", page: 1, perPage: 1 });
    const media = await listMedia(tdb.db, { page: 1, perPage: 100 });
    expect(data.posts).toBe(posts.total);
    expect(data.mediaFiles).toBe(media.total);
    expect(data.r2Objects).toBe(1);
    expect(data.cache).toEqual({
      maxAgeSeconds: 60,
      staleWhileRevalidateSeconds: 60,
      anonymousGetsCached: true,
    });
    expect((data.derivatives as { bound: boolean }).bound).toBe(false);
    expect(result.output).toMatch(/Cache hit rate is not observable/);
    expect(result.output).toMatch(/Cloudflare Images is NOT bound/);
  });
});

describe("backup-advisor (Milestone 9, real registry)", () => {
  it("reports the real backup registry and flags an unverified latest backup", async () => {
    const before = await backupAdvisor.run(ctx());
    expect((before.data as Record<string, unknown>).backups).toBe(0);
    expect(before.output).toMatch(/No backup has been created yet/);

    const admin = await createUser(tdb.db, { login: "ba1", email: "b@example.test", password: "password-123", role: "administrator" });
    await createBackup(tdb.db, env, admin.id, "0.9.0");
    const after = await backupAdvisor.run(ctx());
    const data = after.data as Record<string, unknown>;
    expect(data.backups).toBe(1);
    expect(data.verifiedBackups).toBe(0);
    expect(data.latestBackupVerified).toBe(false);
    expect(after.output).toMatch(/NOT verified yet/);
    expect((after.data as Record<string, unknown>).latestBackupId).toBeTruthy();
    expect(await queryOne<{ n: number }>(tdb.db, "SELECT COUNT(*) AS n FROM wl_backups")).toMatchObject({ n: 1 });
  });
});
