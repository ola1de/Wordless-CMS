/**
 * Workers AI provider (Milestone 6) — the DEFAULT and only required
 * provider (user decision, 2026-11-19). No API key: it runs on the
 * Cloudflare account's Workers AI binding (`[ai]` in wrangler.toml).
 *
 * The binding is OPTIONAL in wrangler.toml (commented out by default,
 * because no Cloudflare account is connected yet). When it is absent the
 * provider reports `configured: false` and every completion fails with a
 * clear "not configured" error — it never crashes and never pretends.
 * Live Workers AI calls cannot be verified in this environment (no
 * account), so this file is covered by interface-level tests (not
 * configured without the binding) plus the mock provider for behaviour.
 */
import type { Env } from "../../env";
import {
  aiNotConfigured,
  aiProviderError,
  type CompleteOptions,
  type CompleteResult,
  type Provider,
  type ProviderProbe,
} from "./types";

/** Default chat model. Override per call via CompleteOptions.model. */
export const WORKERS_AI_DEFAULT_MODEL = "@cf/meta/llama-3-8b-instruct";

const NOT_CONFIGURED_MESSAGE =
  "Workers AI is not configured. Uncomment the [ai] binding in wrangler.toml and deploy to Cloudflare, " +
  "or select the mock provider for local development (canned responses only).";

export const workersAiProvider: Provider = {
  id: "workers-ai",
  name: "Workers AI (Cloudflare)",
  description:
    "Cloudflare's built-in AI — the default and only required provider. No API key; runs on your Cloudflare account via the [ai] binding.",
  recommended: true,
  requiresKey: false,

  isConfigured(env: Env): boolean {
    return env.AI !== undefined && env.AI !== null;
  },

  configuredDetail(env: Env): string {
    return this.isConfigured(env)
      ? `Workers AI binding is present (default model ${WORKERS_AI_DEFAULT_MODEL}).`
      : "Workers AI binding is not present. Uncomment the [ai] binding in wrangler.toml and deploy to Cloudflare.";
  },

  async complete(env: Env, prompt: string, opts?: CompleteOptions): Promise<CompleteResult> {
    if (!this.isConfigured(env) || env.AI === undefined) {
      throw aiNotConfigured(NOT_CONFIGURED_MESSAGE);
    }
    const model = opts?.model ?? WORKERS_AI_DEFAULT_MODEL;
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (opts?.system !== undefined && opts.system !== "") {
      messages.push({ role: "system", content: opts.system });
    }
    messages.push({ role: "user", content: prompt });
    let out: { response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    try {
      out = await env.AI.run(model, {
        messages,
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.7,
      });
    } catch (err) {
      throw aiProviderError(
        `Workers AI call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = typeof out.response === "string" ? out.response : "";
    if (text === "") {
      throw aiProviderError("Workers AI returned an empty response.");
    }
    return {
      text,
      model,
      usage: {
        promptTokens: out.usage?.prompt_tokens,
        completionTokens: out.usage?.completion_tokens,
        totalTokens: out.usage?.total_tokens,
      },
    };
  },

  async test(env: Env): Promise<ProviderProbe> {
    if (!this.isConfigured(env)) {
      return { ok: false, message: NOT_CONFIGURED_MESSAGE };
    }
    try {
      const result = await this.complete(env, "Reply with exactly the single word: ok", {
        maxTokens: 8,
        temperature: 0,
      });
      return { ok: true, message: `Workers AI responded (${result.model}).` };
    } catch (err) {
      return {
        ok: false,
        message: `Workers AI probe failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
