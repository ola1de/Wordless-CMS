/**
 * AI module service (Milestone 6) — operating mode + approvals.
 *
 * Mode is a site setting (`wl_ai_mode`, default `supervised`). Approvals
 * are the human gate: an agent's proposal becomes a row in
 * `wl_ai_approvals` and nothing it proposes is applied until an admin
 * approves it here. Approving applies the action through the applier
 * (existing services only); rejecting records the reason.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { DEFAULT_AI_MODE, isAiMode, type AiMode, type ProposedAction } from "../../ai/types";
import { getOption, setOption } from "../options/service";
import { applyProposal } from "./apply";
import type { ApprovalList, ApprovalStatus, ApprovalView } from "./types";

export const AI_MODE_OPTION = "wl_ai_mode";

export async function getAiMode(db: Db): Promise<AiMode> {
  const stored = await getOption<unknown>(db, AI_MODE_OPTION, DEFAULT_AI_MODE);
  return isAiMode(stored) ? stored : DEFAULT_AI_MODE;
}

export async function setAiMode(db: Db, mode: unknown): Promise<AiMode> {
  if (!isAiMode(mode)) {
    throw badRequest('Field "mode" must be one of: manual, supervised, autonomous.');
  }
  await setOption(db, AI_MODE_OPTION, mode);
  return mode;
}

interface ApprovalRow {
  id: string;
  task_id: string;
  agent: string;
  action: string;
  status: string;
  created_by: number;
  decided_by: number | null;
  decided_at: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToView(row: ApprovalRow): ApprovalView {
  let action: ProposedAction;
  try {
    action = JSON.parse(row.action) as ProposedAction;
  } catch {
    action = { type: "create_post", summary: "Unparseable proposed action.", risk: "high", payload: {} };
  }
  return {
    id: row.id,
    taskId: row.task_id,
    agent: row.agent,
    action,
    status: row.status as ApprovalStatus,
    createdBy: row.created_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createApproval(
  db: Db,
  input: { taskId: string; agent: string; action: ProposedAction; createdBy: number },
): Promise<ApprovalView> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_ai_approvals (id, task_id, agent, action, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, input.taskId, input.agent, JSON.stringify(input.action), input.createdBy, now, now],
  );
  const row = await queryOne<ApprovalRow>(db, "SELECT * FROM wl_ai_approvals WHERE id = ? LIMIT 1", [id]);
  if (row === null) throw new Error("Approval was not created.");
  return rowToView(row);
}

export async function getApproval(db: Db, id: string): Promise<ApprovalView> {
  const row = await queryOne<ApprovalRow>(db, "SELECT * FROM wl_ai_approvals WHERE id = ? LIMIT 1", [id]);
  if (row === null) throw notFound("Approval not found.");
  return rowToView(row);
}

export async function listApprovals(
  db: Db,
  opts: { status?: ApprovalStatus; page?: number; perPage?: number } = {},
): Promise<ApprovalList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const where = opts.status !== undefined ? "WHERE status = ?" : "";
  const params: unknown[] = opts.status !== undefined ? [opts.status] : [];
  const totalRow = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM wl_ai_approvals ${where}`,
    params,
  );
  const rows = await queryAll<ApprovalRow>(
    db,
    `SELECT * FROM wl_ai_approvals ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );
  const total = totalRow?.n ?? 0;
  return { approvals: rows.map(rowToView), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

/**
 * Decide an approval. Approving applies the proposed action through the
 * applier; if applying fails the approval STAYS pending and the error is
 * reported, so a half-applied action can never be marked approved.
 * Rejecting records the reason. Deciding twice is an error.
 */
export async function decideApproval(
  db: Db,
  id: string,
  input: { approve: boolean; userId: number; reason?: string },
): Promise<ApprovalView> {
  const row = await queryOne<ApprovalRow>(db, "SELECT * FROM wl_ai_approvals WHERE id = ? LIMIT 1", [id]);
  if (row === null) throw notFound("Approval not found.");
  if (row.status !== "pending") {
    throw badRequest(`Approval has already been ${row.status}.`);
  }
  const view = rowToView(row);
  if (input.approve) {
    // Apply first; only mark approved when the action actually applied.
    await applyProposal(db, view.action, input.userId);
    await execRun(
      db,
      "UPDATE wl_ai_approvals SET status = 'approved', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?",
      [input.userId, nowIso(), nowIso(), id],
    );
  } else {
    const reason = typeof input.reason === "string" && input.reason.trim() !== "" ? input.reason.trim() : null;
    await execRun(
      db,
      "UPDATE wl_ai_approvals SET status = 'rejected', decided_by = ?, decided_at = ?, reason = ?, updated_at = ? WHERE id = ?",
      [input.userId, nowIso(), reason, nowIso(), id],
    );
  }
  return getApproval(db, id);
}
