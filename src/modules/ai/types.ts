/**
 * AI module — API views (Milestone 6).
 *
 * AI tasks are `wl_jobs` rows (kind = 'ai_task'); the result JSON holds
 * the agent's output, proposals, approvals created and actions applied.
 * Approvals are `wl_ai_approvals` rows (migration 0006).
 */
import type { AiMode, ProposedAction } from "../../ai/types";

export type AiTaskStatus = "pending" | "running" | "done" | "failed";

export interface AiTaskResult {
  agent: string;
  mode: AiMode;
  summary: string;
  output?: string;
  data?: Record<string, unknown>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  proposals: ProposedAction[];
  approvals: Array<{ id: string; summary: string; risk: string }>;
  applied: Array<{ summary: string; result: Record<string, unknown> }>;
  applyErrors?: Array<{ summary: string; error: string }>;
}

export interface AiTaskView {
  id: string;
  agent: string;
  input: string;
  mode: AiMode;
  status: AiTaskStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  result?: AiTaskResult;
  error?: string;
}

export interface AiTaskList {
  tasks: AiTaskView[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface CreateAiTaskInput {
  agent: string;
  input: string;
  /** Overrides the site mode for this one task; defaults to the site mode. */
  mode?: AiMode;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalView {
  id: string;
  taskId: string;
  agent: string;
  action: ProposedAction;
  status: ApprovalStatus;
  createdBy: number;
  decidedBy: number | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalList {
  approvals: ApprovalView[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
