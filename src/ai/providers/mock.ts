/**
 * Mock provider (Milestone 6) — deterministic canned responses.
 *
 * Used by tests and by local development when no real provider is
 * configured. It is NEVER presented as real AI: the command centre labels
 * it "Mock (local development only — canned responses, no real AI)" and
 * every result it produces is deterministic for a given prompt, so tests
 * can assert on it.
 *
 * Determinism: the response is built from the prompt itself (a short
 * excerpt + a stable hash), never from randomness or the clock.
 */
import type { Env } from "../../env";
import type { CompleteOptions, CompleteResult, Provider, ProviderProbe } from "./types";

/** Tiny FNV-1a hash, stable across runs (no Math.random, no Date). */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const MOCK_MODEL = "mock-1.0";

export const mockProvider: Provider = {
  id: "mock",
  name: "Mock provider",
  description:
    "Local development only — deterministic canned responses, no real AI. Use it for tests and for trying the command centre without a Cloudflare account.",
  recommended: false,
  requiresKey: false,

  isConfigured(_env: Env): boolean {
    return true;
  },

  configuredDetail(_env: Env): string {
    return "Always available in local development and tests. Canned responses only.";
  },

  async complete(_env: Env, prompt: string, opts?: CompleteOptions): Promise<CompleteResult> {
    const excerpt = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
    const hash = stableHash(prompt);
    const text =
      `[Mock AI draft — not a real model response]\n` +
      `Request #${hash} (prompt: "${excerpt}${prompt.length > 120 ? "…" : ""}").\n` +
      `This is a deterministic placeholder so the orchestrator, approvals and command centre can be exercised without a configured provider. ` +
      `Configure Workers AI (the default) to get a real response.`;
    return {
      text,
      model: opts?.model ?? MOCK_MODEL,
      usage: { promptTokens: prompt.length, completionTokens: text.length, totalTokens: prompt.length + text.length },
    };
  },

  async embed(_env: Env, text: string): Promise<number[]> {
    // Deterministic 8-dimensional pseudo-embedding from the text hash.
    const out: number[] = [];
    let h = stableHash(text);
    for (let i = 0; i < 8; i++) {
      h = (Math.imul(h, 0x01000193) ^ (h >>> 13)) >>> 0;
      out.push(((h % 1000) / 1000) * 2 - 1);
    }
    return out;
  },

  async test(_env: Env): Promise<ProviderProbe> {
    return { ok: true, message: "Mock provider is always available (canned responses, no real AI)." };
  },
};
