/**
 * AI provider abstraction (Milestone 6).
 *
 * Providers are the only place that talks to an AI model. Everything else
 * (orchestrator, agents, command centre) talks to this interface, so a
 * site can switch providers without touching agent code.
 *
 * DEFAULT PROVIDER (user decision, 2026-11-19): Cloudflare Workers AI.
 * It needs no API key — only the `[ai]` binding in wrangler.toml (see the
 * commented block there). The OpenAI-compatible provider stays in code as
 * an OPTIONAL fallback only, clearly documented as optional. The mock
 * provider backs tests and local development with deterministic canned
 * responses — it is never presented as real AI.
 *
 * Honesty rule: a provider that is not configured reports
 * `configured: false` and any completion attempt fails with a clear
 * "not configured" error. Nothing in this layer ever pretends AI works
 * when no provider is configured, and no API key or secret is ever stored
 * in code — keys come only from env/secrets bindings.
 */
import type { Env } from "../../env";
import { WordlessError } from "../../kernel/errors";

export type ProviderId = "workers-ai" | "openai" | "mock";

export const PROVIDER_IDS: ProviderId[] = ["workers-ai", "openai", "mock"];

/** The default provider when the site has never chosen one. */
export const DEFAULT_PROVIDER_ID: ProviderId = "workers-ai";

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as string[]).includes(value);
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CompleteOptions {
  /** Override the provider's default model (Workers AI / OpenAI only). */
  model?: string;
  /** System prompt prepended to the user prompt. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  usage: ProviderUsage;
}

/** A tiny probe result: never throws for "not configured", it reports it. */
export interface ProviderProbe {
  ok: boolean;
  message: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Short honest description shown in the command centre. */
  description: string;
  /** True when the provider can actually complete a request right now. */
  configured: boolean;
  /** Why it is (not) configured, in plain language. */
  configuredDetail: string;
  /** Workers AI is the recommended/default route (user decision). */
  recommended: boolean;
  /** True when the provider needs an API key from env/secrets. */
  requiresKey: boolean;
}

export interface Provider {
  id: ProviderId;
  name: string;
  description: string;
  recommended: boolean;
  requiresKey: boolean;
  /** True only when a completion call could succeed right now. */
  isConfigured(env: Env): boolean;
  /** Plain-language reason for the current configured state. */
  configuredDetail(env: Env): string;
  complete(env: Env, prompt: string, opts?: CompleteOptions): Promise<CompleteResult>;
  /** Optional embeddings (used by website memory search in a later milestone). */
  embed?(env: Env, text: string): Promise<number[]>;
  /** Small probe: mock always passes; real providers report their real state. */
  test(env: Env): Promise<ProviderProbe>;
}

/**
 * Minimal structural type for the Workers AI binding (env.AI).
 * The real binding satisfies this shape; typing it structurally keeps the
 * provider layer independent of the exact @cloudflare/workers-types
 * export surface, and lets tests pass a stub.
 */
export interface AiBinding {
  run(
    model: string,
    input: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      max_tokens?: number;
      temperature?: number;
    },
  ): Promise<{
    response?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }>;
}

export function aiNotConfigured(message: string): WordlessError {
  return new WordlessError("ai_not_configured", 503, message);
}

export function aiProviderError(message: string): WordlessError {
  return new WordlessError("ai_provider_error", 502, message);
}
