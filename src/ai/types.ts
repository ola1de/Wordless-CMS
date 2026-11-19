/**
 * AI operating system — shared types (Milestone 6).
 *
 * Operating modes (roadmap §8: supervised / controlled-autonomous /
 * manual — "autonomous" here is the controlled-autonomous mode):
 * - manual:      agents only draft. Nothing is applied, no approval is
 *                created. The result is text and data the admin can read.
 * - supervised:  agents propose changes; every proposal becomes an
 *                approval record and NOTHING is applied until an admin
 *                approves it in the command centre.
 * - autonomous:  LOW-risk proposals apply automatically; medium- and
 *                high-risk proposals still become approval records and
 *                wait for a human. Destructive and publishing actions are
 *                always high-risk and never auto-apply.
 */
import type { Db } from "../db";
import type { Env } from "../env";
import type { Provider, ProviderUsage } from "./providers/types";

export type AiMode = "manual" | "supervised" | "autonomous";

export const AI_MODES: AiMode[] = ["manual", "supervised", "autonomous"];

/** Safe default: nothing applies without a human saying so. */
export const DEFAULT_AI_MODE: AiMode = "supervised";

export function isAiMode(value: unknown): value is AiMode {
  return typeof value === "string" && (AI_MODES as string[]).includes(value);
}

export const AI_MODE_DESCRIPTIONS: Record<AiMode, string> = {
  manual:
    "Agents only draft. Nothing is applied and no approval is created — results are text and data for the admin to read.",
  supervised:
    "Agents propose changes; every proposal waits in the approvals queue until an admin approves or rejects it. Nothing applies on its own.",
  autonomous:
    "Low-risk proposals (e.g. creating a draft post) apply automatically. Medium- and high-risk proposals — anything destructive or publishing — still wait for approval.",
};

export type ProposalRisk = "low" | "medium" | "high";

/**
 * A change an agent proposes. Applying goes through the real applier
 * (src/modules/ai/apply.ts), which calls the existing services — never
 * raw SQL writes to content tables.
 */
export type ProposalActionType =
  | "create_post"
  | "update_post"
  | "publish_post"
  | "update_option"
  | "create_term"
  | "update_theme_variation";

export interface ProposedAction {
  type: ProposalActionType;
  /** Human-readable one-liner shown in the approvals queue. */
  summary: string;
  risk: ProposalRisk;
  payload: Record<string, unknown>;
}

export interface AgentResult {
  /** One-paragraph summary for the task list. */
  summary: string;
  /** Main text output (draft, report, reply). Labelled as AI output in the UI. */
  output?: string;
  /** Structured findings (counts, lists, checks) — only measured data, never invented. */
  data?: Record<string, unknown>;
  /** Changes the agent proposes, if any. */
  proposals?: ProposedAction[];
  /** Token usage from the provider, when a provider was used. */
  usage?: ProviderUsage;
}

/** What an agent handler receives. */
export interface AgentContext {
  db: Db;
  env: Env;
  /** The resolved provider (mock in tests/local dev, Workers AI by default). */
  provider: Provider;
  /** True when the provider can actually complete a request. */
  providerConfigured: boolean;
  /** The admin's request text. */
  input: string;
  /** Website memory rendered as context text (facts + notes). */
  memoryText: string;
  /** The user who started the task (for attribution on applied actions). */
  userId: number;
}

export type AgentRisk = "low" | "medium" | "high";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** What the agent can do, in plain language. */
  capabilities: string[];
  /** Highest risk of anything this agent proposes. */
  risk: AgentRisk;
  /** True when the agent needs a configured provider to run. */
  requiresProvider: boolean;
  /**
   * When set, the agent is honestly unavailable and the command centre
   * shows this reason instead of a fake result (e.g. commerce needs M8).
   */
  unavailableReason?: string;
  run(ctx: AgentContext): Promise<AgentResult>;
}

/** Public view of an agent for the command centre. */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  risk: AgentRisk;
  requiresProvider: boolean;
  available: boolean;
  unavailableReason?: string;
}
