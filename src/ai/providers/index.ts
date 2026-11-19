/**
 * Provider registry (Milestone 6).
 *
 * The site's selected provider is stored in the `wl_ai_provider` option.
 * The default is Workers AI (user decision, 2026-11-19) — the only
 * required provider; OpenAI-compatible is an optional fallback, mock is
 * for local development and tests.
 */
import type { Db } from "../../db";
import type { Env } from "../../env";
import { badRequest } from "../../kernel/errors";
import { getOption, setOption } from "../../modules/options/service";
import { mockProvider } from "./mock";
import { openAiProvider } from "./openai";
import { workersAiProvider } from "./workers-ai";
import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  type Provider,
  type ProviderId,
  type ProviderInfo,
} from "./types";

export const PROVIDERS: Provider[] = [workersAiProvider, openAiProvider, mockProvider];

export function getProvider(id: ProviderId): Provider {
  const found = PROVIDERS.find((p) => p.id === id);
  if (found === undefined) throw badRequest(`Unknown AI provider "${id}".`);
  return found;
}

/** All providers with their live configured state for this environment. */
export function listProviderInfo(env: Env): ProviderInfo[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    configured: p.isConfigured(env),
    configuredDetail: p.configuredDetail(env),
    recommended: p.recommended,
    requiresKey: p.requiresKey,
  }));
}

export const AI_PROVIDER_OPTION = "wl_ai_provider";

/** Selected provider id; defaults to Workers AI when never set. */
export async function getSelectedProviderId(db: Db): Promise<ProviderId> {
  const stored = await getOption<unknown>(db, AI_PROVIDER_OPTION, DEFAULT_PROVIDER_ID);
  return isProviderId(stored) ? stored : DEFAULT_PROVIDER_ID;
}

export async function setSelectedProviderId(db: Db, id: unknown): Promise<ProviderId> {
  if (!isProviderId(id)) {
    throw badRequest(`Field "provider" must be one of: workers-ai, openai, mock.`);
  }
  await setOption(db, AI_PROVIDER_OPTION, id);
  return id;
}

export interface ResolvedProvider {
  provider: Provider;
  configured: boolean;
}

/** The selected provider plus whether it can actually complete a request. */
export async function resolveProvider(db: Db, env: Env): Promise<ResolvedProvider> {
  const id = await getSelectedProviderId(db);
  const provider = getProvider(id);
  return { provider, configured: provider.isConfigured(env) };
}
