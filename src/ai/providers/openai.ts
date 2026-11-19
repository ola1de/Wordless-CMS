/**
 * OpenAI-compatible provider (Milestone 6) — OPTIONAL fallback only
 * (user decision, 2026-11-19). Workers AI is the default and only
 * required provider; this one exists for sites that already have an
 * OpenAI-compatible key and prefer it.
 *
 * The key comes ONLY from env/secrets (`OPENAI_API_KEY`, set with
 * `wrangler secret put OPENAI_API_KEY` — never in code, never in the
 * repo). The base URL is configurable (`OPENAI_BASE_URL`, default
 * https://api.openai.com/v1) so compatible endpoints work. Without a key
 * the provider reports `configured: false` and fails honestly.
 * The key is never logged and never appears in error messages.
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

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 30000;

const NOT_CONFIGURED_MESSAGE =
  "OpenAI-compatible provider is not configured: no OPENAI_API_KEY secret is set. " +
  "Set it with `wrangler secret put OPENAI_API_KEY`, or use Workers AI (the default, no key needed).";

export const openAiProvider: Provider = {
  id: "openai",
  name: "OpenAI-compatible",
  description:
    "Optional fallback only — any OpenAI-compatible chat endpoint. Needs an OPENAI_API_KEY secret; Workers AI is the default and needs no key.",
  recommended: false,
  requiresKey: true,

  isConfigured(env: Env): boolean {
    return typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.length > 0;
  },

  configuredDetail(env: Env): string {
    return this.isConfigured(env)
      ? "OPENAI_API_KEY secret is set."
      : "No OPENAI_API_KEY secret is set.";
  },

  async complete(env: Env, prompt: string, opts?: CompleteOptions): Promise<CompleteResult> {
    if (!this.isConfigured(env) || env.OPENAI_API_KEY === undefined) {
      throw aiNotConfigured(NOT_CONFIGURED_MESSAGE);
    }
    const baseUrl = (env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = opts?.model ?? env.OPENAI_MODEL ?? DEFAULT_MODEL;
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (opts?.system !== undefined && opts.system !== "") {
      messages.push({ role: "system", content: opts.system });
    }
    messages.push({ role: "user", content: prompt });
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts?.maxTokens ?? 1024,
          temperature: opts?.temperature ?? 0.7,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw aiProviderError(
        `OpenAI-compatible request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      // Never include the key or the raw body (it can echo credentials).
      throw aiProviderError(
        `OpenAI-compatible provider returned HTTP ${res.status}. Check the API key and base URL.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = (await res.json()) as unknown;
    } catch {
      throw aiProviderError("OpenAI-compatible provider returned invalid JSON.");
    }
    const content =
      parsed !== null &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { choices?: unknown }).choices) &&
      (parsed as { choices: Array<{ message?: { content?: unknown } }> }).choices.length > 0
        ? (parsed as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]?.message?.content
        : undefined;
    if (typeof content !== "string" || content === "") {
      throw aiProviderError("OpenAI-compatible provider returned an empty response.");
    }
    const usage =
      parsed !== null && typeof parsed === "object"
        ? ((parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage ?? {})
        : {};
    return {
      text: content,
      model,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
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
      return { ok: true, message: `OpenAI-compatible provider responded (${result.model}).` };
    } catch (err) {
      return {
        ok: false,
        message: `OpenAI-compatible probe failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
