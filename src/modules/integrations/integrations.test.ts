/**
 * Integrations tests (Milestone 8): secret fields are never stored,
 * config round-trips, the email mock logs instead of delivering,
 * analytics status + snippet, share links, Cloudflare binding status,
 * and the marketplace ZIP install (valid + bad manifest + traversal).
 */
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { InMemoryMediaStorage } from "../../test/fake-storage";
import type { Env } from "../../env";
import { getIntegrationConfig, setIntegrationConfig } from "./config";
import { listIntegrations } from "./registry";
import { getMailFrom, listMailLog, sendMail } from "./email";
import { buildAnalyticsSnippet, getAnalyticsStatus } from "./analytics";
import { shareLinks } from "./social";
import { cloudflareBindingStatus } from "./cloudflare";
import { installExtensionFromZip, listMarketplaceExtensions, setMarketplaceExtensionStatus } from "./marketplace";

const emptyEnv = {} as unknown as Env;

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("integration config", () => {
  it("stores and returns non-secret settings", async () => {
    const saved = await setIntegrationConfig(tdb.db, "analytics", { provider: "ga4", measurementId: "G-TEST123" });
    expect(saved).toMatchObject({ provider: "ga4", measurementId: "G-TEST123" });
    expect(await getIntegrationConfig(tdb.db, "analytics")).toMatchObject({ provider: "ga4" });
  });

  it("rejects any field that looks like a secret", async () => {
    for (const key of ["apiKey", "secret", "token", "password", "privateKey", "PAYSTACK_SECRET_KEY"]) {
      await expect(setIntegrationConfig(tdb.db, "email", { [key]: "sk_live_abc" })).rejects.toThrow(/never stored in the database/);
    }
    // Nothing was written.
    expect(await getIntegrationConfig(tdb.db, "email")).toEqual({});
  });

  it("rejects fields that are not settings for the integration", async () => {
    await expect(setIntegrationConfig(tdb.db, "social", { provider: "ga4" })).rejects.toThrow(/not a setting/);
    await expect(setIntegrationConfig(tdb.db, "email", { mode: "live" })).rejects.toThrow(/not a setting/);
  });

  it("rejects invalid values", async () => {
    await expect(setIntegrationConfig(tdb.db, "paystack", { mode: "production" })).rejects.toThrow(/test.*live/);
    await expect(setIntegrationConfig(tdb.db, "analytics", { provider: "mixpanel" })).rejects.toThrow(/none.*ga4.*plausible/);
    await expect(setIntegrationConfig(tdb.db, "email", { apiUrl: "not a url" })).rejects.toThrow(/valid absolute/);
  });

  it("404s for an unknown integration", async () => {
    await expect(getIntegrationConfig(tdb.db, "nope")).rejects.toThrow(/does not exist/);
    await expect(setIntegrationConfig(tdb.db, "nope", {})).rejects.toThrow(/does not exist/);
  });
});

describe("integration registry", () => {
  it("lists every integration with live configured state", async () => {
    const list = await listIntegrations(tdb.db, emptyEnv);
    expect(list.map((i) => i.id)).toEqual([
      "email",
      "paystack",
      "flutterwave",
      "stripe",
      "analytics",
      "social",
      "cloudflare",
      "marketplace",
    ]);
    const email = list.find((i) => i.id === "email");
    expect(email?.configured).toBe(false);
    expect(email?.configuredDetail).toMatch(/not delivered/);
    const social = list.find((i) => i.id === "social");
    expect(social?.configured).toBe(true);
    // Configuring analytics flips its state.
    await setIntegrationConfig(tdb.db, "analytics", { provider: "plausible", measurementId: "example.com" });
    const again = await listIntegrations(tdb.db, emptyEnv);
    expect(again.find((i) => i.id === "analytics")?.configured).toBe(true);
  });
});

describe("email", () => {
  it("logs instead of delivering when no provider is configured", async () => {
    const result = await sendMail(tdb.db, emptyEnv, {
      to: "ada@example.test",
      subject: "Hello",
      text: "Test message.",
    });
    expect(result).toMatchObject({ delivered: false, provider: "mock" });
    const log = await listMailLog(tdb.db, {});
    expect(log.total).toBe(1);
    expect(log.entries[0]).toMatchObject({ toEmail: "ada@example.test", subject: "Hello", status: "logged" });
  });

  it("derives the from address from the site host", async () => {
    expect(await getMailFrom(tdb.db, emptyEnv)).toBe("noreply@localhost");
  });

  it("uses a configured from address when set", async () => {
    await setIntegrationConfig(tdb.db, "email", { from: "shop@example.com" });
    expect(await getMailFrom(tdb.db, emptyEnv)).toBe("shop@example.com");
  });
});

describe("analytics", () => {
  it("reports not configured until a provider + id are set", async () => {
    const status = await getAnalyticsStatus(tdb.db);
    expect(status).toMatchObject({ configured: false, provider: "none", snippet: null });
    await setIntegrationConfig(tdb.db, "analytics", { provider: "ga4", measurementId: "G-TEST123" });
    const configured = await getAnalyticsStatus(tdb.db);
    expect(configured.configured).toBe(true);
    expect(configured.snippet).toContain("G-TEST123");
    expect(configured.snippet).toContain("googletagmanager");
  });

  it("builds the Plausible snippet with the domain", async () => {
    await setIntegrationConfig(tdb.db, "analytics", { provider: "plausible", measurementId: "example.com" });
    const snippet = await buildAnalyticsSnippet(tdb.db);
    expect(snippet).toContain('data-domain="example.com"');
    expect(snippet).toContain("plausible.io");
  });
});

describe("social + cloudflare status", () => {
  it("builds share links for the four networks", () => {
    const links = shareLinks("http://localhost:8787/hello", "Hello World");
    expect(links.x).toContain("twitter.com/intent/tweet");
    expect(links.facebook).toContain("facebook.com/sharer");
    expect(links.whatsapp).toContain("wa.me");
    expect(links.telegram).toContain("t.me/share");
    expect(links.x).toContain(encodeURIComponent("http://localhost:8787/hello"));
  });

  it("reports the bindings that actually exist", () => {
    const withAi = cloudflareBindingStatus({ AI: {} } as unknown as Env);
    expect(withAi.find((b) => b.binding.startsWith("AI"))?.present).toBe(true);
    const withoutAi = cloudflareBindingStatus({} as unknown as Env);
    expect(withoutAi.find((b) => b.binding.startsWith("AI"))?.present).toBe(false);
    expect(withoutAi.find((b) => b.binding.startsWith("AI"))?.detail).toMatch(/Not bound/);
  });
});

describe("marketplace skeleton", () => {
  const storage = new InMemoryMediaStorage();

  function makeZip(files: Record<string, string>): Uint8Array {
    const input: Record<string, Uint8Array> = {};
    for (const [path, text] of Object.entries(files)) input[path] = new TextEncoder().encode(text);
    return zipSync(input);
  }

  it("installs a valid extension ZIP and records it inactive", async () => {
    const zip = makeZip({
      "my-ext/wordless.json": JSON.stringify({ slug: "my-ext", name: "My Ext", version: "1.0.0", kind: "plugin" }),
      "my-ext/index.ts": "export const x = 1;\n",
    });
    const result = await installExtensionFromZip(tdb.db, storage, "my-ext.zip", zip);
    expect(result.extension).toMatchObject({ slug: "my-ext", name: "My Ext", version: "1.0.0", status: "inactive" });
    expect(result.files).toBe(2);
    expect(await storage.exists("extensions/my-ext/wordless.json")).toBe(true);
    const listed = await listMarketplaceExtensions(tdb.db);
    expect(listed.map((e) => e.slug)).toContain("my-ext");
    const activated = await setMarketplaceExtensionStatus(tdb.db, "my-ext", "active");
    expect(activated.status).toBe("active");
  });

  it("rejects a ZIP without a manifest", async () => {
    const zip = makeZip({ "my-ext/index.ts": "export const x = 1;\n" });
    await expect(installExtensionFromZip(tdb.db, storage, "my-ext.zip", zip)).rejects.toThrow(/wordless\.json/);
  });

  it("rejects a bad manifest version", async () => {
    const zip = makeZip({
      "wordless.json": JSON.stringify({ slug: "bad", name: "Bad", version: "v1" }),
    });
    await expect(installExtensionFromZip(tdb.db, storage, "bad.zip", zip)).rejects.toThrow(/1\.0\.0/);
  });

  it("rejects path traversal in the ZIP", async () => {
    const zip = makeZip({
      "wordless.json": JSON.stringify({ slug: "evil", name: "Evil", version: "1.0.0" }),
      "../escape.txt": "nope",
    });
    await expect(installExtensionFromZip(tdb.db, storage, "evil.zip", zip)).rejects.toThrow(/unsafe path/);
  });

  it("rejects a non-ZIP upload", async () => {
    await expect(
      installExtensionFromZip(tdb.db, storage, "readme.txt", new TextEncoder().encode("hello")),
    ).rejects.toThrow(/\.zip/);
  });
});
