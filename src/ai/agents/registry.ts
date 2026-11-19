/**
 * Agent registry (Milestone 6) — the 15 specialist agents.
 *
 * The roster is fixed here so the command centre, the orchestrator and
 * the docs all agree. An agent is available only when its handler can do
 * real work today: provider-based agents need a configured provider,
 * commerce-assistant needs Milestone 8. Availability is computed from
 * the definitions, never hardcoded in the UI.
 */
import type { Env } from "../../env";
import type { AgentDefinition, AgentInfo } from "../types";
import {
  contentWriter,
  emailComposer,
  researchAssistant,
  socialComposer,
  supportResponder,
} from "./content";
import {
  accessibilityChecker,
  analyticsReporter,
  backupAdvisor,
  codeReviewer,
  designAdvisor,
  migrationAssistant,
  performanceAnalyst,
  securityScanner,
  seoAuditor,
} from "./analysis";
import { commerceAssistant } from "./commerce";

export const AGENTS: AgentDefinition[] = [
  contentWriter,
  seoAuditor,
  securityScanner,
  performanceAnalyst,
  designAdvisor,
  supportResponder,
  analyticsReporter,
  commerceAssistant,
  emailComposer,
  socialComposer,
  backupAdvisor,
  migrationAssistant,
  accessibilityChecker,
  codeReviewer,
  researchAssistant,
];

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}

/**
 * Public agent list. `providerConfigured` reflects the selected
 * provider's live state: a provider-based agent is unavailable when no
 * provider is configured, with a plain-language reason.
 */
export function listAgents(providerConfigured: boolean, _env?: Env): AgentInfo[] {
  return AGENTS.map((a) => {
    const unavailableReason =
      a.unavailableReason !== undefined
        ? a.unavailableReason
        : a.requiresProvider && !providerConfigured
          ? "No AI provider is configured. Select Workers AI (the default) in the command centre, or use the mock provider for local development."
          : undefined;
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
      risk: a.risk,
      requiresProvider: a.requiresProvider,
      available: unavailableReason === undefined,
      unavailableReason,
    };
  });
}
