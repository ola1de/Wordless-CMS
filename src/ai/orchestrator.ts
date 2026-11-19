/**
 * AI orchestrator (Milestone 6).
 *
 * An AI task is a row in `wl_jobs` (kind = 'ai_task'). The flow:
 * create → run (synchronously in the request in local dev; structured so
 * the same `runAiTask(db, jobId, ctx)` can be invoked by a Queue/Workflow
 * consumer in production) → the agent runs → its proposals are handled
 * according to the operating mode → the result JSON is stored on the job.
 *
 * Mode enforcement lives HERE, in `processProposals`, and nowhere else:
 * - manual:      proposals are recorded in the result only. No approval
 *                rows, no application.
 * - supervised:  every proposal becomes a pending approval row. Nothing
 *                is applied.
 * - autonomous:  LOW-risk proposals apply immediately through the
 *                applier; medium/high-risk proposals become approval
 *                rows. A failed auto-apply is recorded, never hidden.
 *
 * Prompt-injection rule (architecture §8): external content (uploads,
 * pages, plugins) is DATA, never instructions. Agents only ever receive
 * the admin's input plus website memory; tool calls never accept
 * instruction text from untrusted sources.
 */
import { execRun, nowIso, queryAll, queryOne } from "../db";
import type { Db } from "../db";
import type { Env } from "../env";
import { badRequest, notFound, WordlessError } from "../kernel/errors";
import { requireString } from "../kernel/validate";
import { getAgent } from "./agents/registry";
import { buildMemoryContext } from "./memory";
import { resolveProvider } from "./providers/index";
import { aiNotConfigured } from "./providers/types";
import type { AgentContext, AiMode, ProposedAction } from "./types";
import { isAiMode } from "./types";
import { getAiMode } from "../modules/ai/service";
import { applyProposal } from "../modules/ai/apply";
import { createApproval } from "../modules/ai/service";
import type {
  AiTaskList,
  AiTaskResult,
  AiTaskStatus,
  AiTaskView,
  ApprovalView,
  CreateAiTaskInput,
} from "../modules/ai/types";

interface JobRow {
  id: string;
  kind: string;
  status: string;
  payload: string;
  result: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  run_at: string | null;
}

function parsePayload(row: JobRow): { agent: string; input: string; mode: AiMode } {
  try {
    const parsed = JSON.parse(row.payload) as { agent?: unknown; input?: unknown; mode?: unknown };
    return {
      agent: typeof parsed.agent === "string" ? parsed.agent : "unknown",
      input: typeof parsed.input === "string" ? parsed.input : "",
      mode: (parsed.mode as AiMode) ?? "supervised",
    };
  } catch {
    return { agent: "unknown", input: "", mode: "supervised" };
  }
}

function rowToView(row: JobRow): AiTaskView {
  const payload = parsePayload(row);
  const status = row.status as AiTaskStatus;
  const view: AiTaskView = {
    id: row.id,
    agent: payload.agent,
    input: payload.input,
    mode: payload.mode,
    status,
    progress: status === "done" ? 100 : status === "pending" || status === "failed" ? 0 : 50,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.result !== null && row.result !== "") {
    try {
      const parsed = JSON.parse(row.result) as Record<string, unknown>;
      if (status === "done" && typeof parsed === "object" && parsed !== null && "summary" in parsed) {
        view.result = parsed as unknown as AiTaskResult;
      } else if (status === "failed") {
        view.error = typeof parsed.error === "string" ? parsed.error : "AI task failed.";
      }
    } catch {
      if (status === "failed") view.error = row.result;
    }
  }
  return view;
}

export async function createAiTask(db: Db, input: CreateAiTaskInput): Promise<AiTaskView> {
  const agentId = requireString(input.agent, "agent", { max: 100 });
  const text = requireString(input.input, "input", { max: 10000 });
  const agent = getAgent(agentId);
  if (agent === undefined) {
    throw badRequest(`Unknown AI agent "${agentId}".`);
  }
  if (agent.unavailableReason !== undefined) {
    throw badRequest(`Agent "${agent.name}" is unavailable: ${agent.unavailableReason}`);
  }
  if (input.mode !== undefined && !isAiMode(input.mode)) {
    throw badRequest('Field "mode" must be one of: manual, supervised, autonomous.');
  }
  const mode: AiMode = input.mode ?? (await getAiMode(db));
  const id = crypto.randomUUID();
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_jobs (id, kind, status, payload, attempts, created_at, updated_at)
     VALUES (?, 'ai_task', 'pending', ?, 0, ?, ?)`,
    [id, JSON.stringify({ agent: agentId, input: text, mode }), now, now],
  );
  const row = await queryOne<JobRow>(db, "SELECT * FROM wl_jobs WHERE id = ? LIMIT 1", [id]);
  if (row === null) throw new Error("AI task was not created.");
  return rowToView(row);
}

export async function getAiTask(db: Db, id: string): Promise<AiTaskView> {
  const row = await queryOne<JobRow>(
    db,
    "SELECT * FROM wl_jobs WHERE id = ? AND kind = 'ai_task' LIMIT 1",
    [id],
  );
  if (row === null) throw notFound("AI task not found.");
  return rowToView(row);
}

export async function listAiTasks(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<AiTaskList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const totalRow = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_jobs WHERE kind = 'ai_task'");
  const total = totalRow?.n ?? 0;
  const rows = await queryAll<JobRow>(
    db,
    "SELECT * FROM wl_jobs WHERE kind = 'ai_task' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [perPage, offset],
  );
  return {
    tasks: rows.map(rowToView),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export interface ProcessProposalsResult {
  approvals: ApprovalView[];
  applied: Array<{ summary: string; result: Record<string, unknown> }>;
  applyErrors: Array<{ summary: string; error: string }>;
}

/**
 * Handle an agent's proposals under the operating mode. Exported for
 * tests: mode enforcement must be provable without running a whole task.
 */
export async function processProposals(
  db: Db,
  mode: AiMode,
  proposals: ProposedAction[],
  taskId: string,
  agentId: string,
  userId: number,
): Promise<ProcessProposalsResult> {
  const approvals: ApprovalView[] = [];
  const applied: Array<{ summary: string; result: Record<string, unknown> }> = [];
  const applyErrors: Array<{ summary: string; error: string }> = [];
  if (mode === "manual") return { approvals, applied, applyErrors };
  for (const proposal of proposals) {
    if (mode === "autonomous" && proposal.risk === "low") {
      try {
        const result = await applyProposal(db, proposal, userId);
        applied.push({ summary: proposal.summary, result });
      } catch (err) {
        applyErrors.push({
          summary: proposal.summary,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      const approval = await createApproval(db, {
        taskId,
        agent: agentId,
        action: proposal,
        createdBy: userId,
      });
      approvals.push(approval);
    }
  }
  return { approvals, applied, applyErrors };
}

export interface RunAiTaskContext {
  env: Env;
  userId: number;
}

/**
 * Run one AI task to completion. Safe to call from a request handler
 * (local dev) or from a Queue/Workflow consumer (production): it only
 * touches the job row, the provider, the agent and the approvals table.
 */
export async function runAiTask(db: Db, jobId: string, ctx: RunAiTaskContext): Promise<AiTaskView> {
  const row = await queryOne<JobRow>(
    db,
    "SELECT * FROM wl_jobs WHERE id = ? AND kind = 'ai_task' LIMIT 1",
    [jobId],
  );
  if (row === null) throw notFound("AI task not found.");
  const payload = parsePayload(row);
  const agent = getAgent(payload.agent);
  if (agent === undefined) {
    throw new WordlessError("bad_request", 400, `Unknown AI agent "${payload.agent}".`);
  }
  if (agent.unavailableReason !== undefined) {
    throw new WordlessError("bad_request", 400, `Agent "${agent.name}" is unavailable: ${agent.unavailableReason}`);
  }
  const now = nowIso();
  await execRun(
    db,
    "UPDATE wl_jobs SET status = 'running', attempts = attempts + 1, result = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify({ progress: 50, phase: "running" }), now, jobId],
  );

  try {
    const { provider, configured } = await resolveProvider(db, ctx.env);
    if (agent.requiresProvider && !configured) {
      throw aiNotConfigured(
        `No AI provider is configured for agent "${agent.name}". ` +
          `Workers AI (the default) needs the [ai] binding in wrangler.toml; ` +
          `or select the mock provider for local development.`,
      );
    }
    const memoryText = await buildMemoryContext(db);
    const agentCtx: AgentContext = {
      db,
      env: ctx.env,
      provider,
      providerConfigured: configured,
      input: payload.input,
      memoryText,
      userId: ctx.userId,
    };
    const result = await agent.run(agentCtx);
    const proposals = result.proposals ?? [];
    const handled = await processProposals(db, payload.mode, proposals, jobId, agent.id, ctx.userId);
    const taskResult: AiTaskResult = {
      agent: agent.id,
      mode: payload.mode,
      summary: result.summary,
      output: result.output,
      data: result.data,
      usage: result.usage,
      proposals,
      approvals: handled.approvals.map((a) => ({ id: a.id, summary: a.action.summary, risk: a.action.risk })),
      applied: handled.applied,
      applyErrors: handled.applyErrors.length > 0 ? handled.applyErrors : undefined,
    };
    await execRun(db, "UPDATE wl_jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(taskResult),
      nowIso(),
      jobId,
    ]);
    return await getAiTask(db, jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI task failed for an unknown reason.";
    await execRun(db, "UPDATE wl_jobs SET status = 'failed', result = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify({ progress: 0, error: message }),
      nowIso(),
      jobId,
    ]);
    return await getAiTask(db, jobId);
  }
}
