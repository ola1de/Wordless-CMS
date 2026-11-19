/**
 * Provider tests (Milestone 6).
 *
 * The mock provider is deterministic (same prompt → same response) so
 * behaviour tests can assert on it. Real providers are tested for their
 * honest "not configured" behaviour when their binding/key is absent —
 * live Workers AI calls cannot be verified here (no Cloudflare account),
 * so no test pretends they were.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { createTestDb } from "../../test/test-db";
import {
  getSelectedProviderId,
  listProviderInfo,
  setSelectedProviderId,
} from "./index";
import { mockProvider } from "./mock";
import { openAiProvider } from "./openai";
import { workersAiProvider } from "./workers-ai";

const emptyEnv = {} as unknown as Env;

describe("mock provider", () => {
  it("is deterministic: the same prompt always gives the same response", async () => {
    const a = await mockProvider.complete(emptyEnv, "Write about cats");
    const b = await mockProvider.complete(emptyEnv, "Write about cats");
    expect(a.text).toBe(b.text);
    expect(a.model).toBe("mock-1.0");
  });

  it("gives a different response for a different prompt", async () => {
    const a = await mockProvider.complete(emptyEnv, "Write about cats");
    const b = await mockProvider.complete(emptyEnv, "Write about dogs");
    expect(a.text).not.toBe(b.text);
  });

  it("embeds deterministically with 8 dimensions", async () => {
    const a = await mockProvider.embed?.(emptyEnv, "hello");
    const b = await mockProvider.embed?.(emptyEnv, "hello");
    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
  });

  it("is always configured and its probe passes", async () => {
    expect(mockProvider.isConfigured(emptyEnv)).toBe(true);
    const probe = await mockProvider.test(emptyEnv);
    expect(probe.ok).toBe(true);
  });
});

describe("workers-ai provider (default)", () => {
  it("reports not configured when the AI binding is absent", () => {
    expect(workersAiProvider.isConfigured(emptyEnv)).toBe(false);
    expect(workersAiProvider.configuredDetail(emptyEnv)).toContain("not present");
  });

  it("fails honestly instead of crashing when the binding is absent", async () => {
    await expect(workersAiProvider.complete(emptyEnv, "hi")).rejects.toMatchObject({
      code: "ai_not_configured",
    });
    const probe = await workersAiProvider.test(emptyEnv);
    expect(probe.ok).toBe(false);
    expect(probe.message).toContain("not configured");
  });

  it("reports configured when the binding is present", () => {
    const env = { AI: { run: async () => ({ response: "ok" }) } } as unknown as Env;
    expect(workersAiProvider.isConfigured(env)).toBe(true);
  });
});

describe("openai-compatible provider (optional fallback)", () => {
  it("reports not configured without a key", () => {
    expect(openAiProvider.isConfigured(emptyEnv)).toBe(false);
    expect(openAiProvider.requiresKey).toBe(true);
  });

  it("fails honestly without a key", async () => {
    await expect(openAiProvider.complete(emptyEnv, "hi")).rejects.toMatchObject({
      code: "ai_not_configured",
    });
    const probe = await openAiProvider.test(emptyEnv);
    expect(probe.ok).toBe(false);
  });

  it("reports configured when the key is set (no network call is made)", () => {
    const env = { OPENAI_API_KEY: "sk-test" } as unknown as Env;
    expect(openAiProvider.isConfigured(env)).toBe(true);
  });
});

describe("provider registry", () => {
  it("lists all three providers; Workers AI is the recommended default", () => {
    const list = listProviderInfo(emptyEnv);
    expect(list.map((p) => p.id)).toEqual(["workers-ai", "openai", "mock"]);
    const workers = list.find((p) => p.id === "workers-ai");
    expect(workers?.recommended).toBe(true);
    expect(workers?.configured).toBe(false);
    expect(list.find((p) => p.id === "mock")?.configured).toBe(true);
  });

  it("defaults the selected provider to workers-ai", async () => {
    const tdb = createTestDb();
    try {
      expect(await getSelectedProviderId(tdb.db)).toBe("workers-ai");
    } finally {
      tdb.close();
    }
  });

  it("persists a provider selection and rejects unknown ids", async () => {
    const tdb = createTestDb();
    try {
      expect(await setSelectedProviderId(tdb.db, "mock")).toBe("mock");
      expect(await getSelectedProviderId(tdb.db)).toBe("mock");
      await expect(setSelectedProviderId(tdb.db, "anthropic")).rejects.toThrow();
    } finally {
      tdb.close();
    }
  });
});
