/**
 * Activity log — append-only audit trail in wl_audit_log.
 * Every administrative mutation (posts, comments, terms, menus, auth)
 * should log here with the acting user id (0 = anonymous / system).
 * Reads are admin-only (manage_options); see the /api/activity route.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import type { ActivityEntry, ActivityListResult, ListActivityOptions, LogActivityInput } from "./types";

type Row = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function rowToEntry(row: Row): ActivityEntry {
  return {
    id: asInt(row.id),
    actorId: asInt(row.user_id),
    action: asText(row.action),
    objectType: row.object_type === null || row.object_type === undefined ? null : asText(row.object_type),
    objectId: row.object_id === null || row.object_id === undefined ? null : asText(row.object_id),
    details: row.details === null || row.details === undefined ? null : asText(row.details),
    createdAt: asText(row.created_at),
  };
}

/** Action names follow the pattern `<object>.<verb>` (e.g. `post.create`). */
export async function logActivity(db: Db, input: LogActivityInput): Promise<ActivityEntry> {
  const now = nowIso();
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wl_audit_log (user_id, action, object_type, object_id, details, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.actorId,
      input.action,
      input.objectType ?? null,
      input.objectId !== undefined ? String(input.objectId) : null,
      input.details ?? null,
      input.ipHash ?? null,
      now,
    ],
  );
  const row = await queryOne<Row>(db, "SELECT * FROM wl_audit_log WHERE id = ? LIMIT 1", [lastRowId ?? 0]);
  if (!row) throw new Error("Failed to read back the audit log entry.");
  return rowToEntry(row);
}

export async function listActivity(db: Db, opts: ListActivityOptions = {}): Promise<ActivityListResult> {
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage = opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;
  const totalRow = await queryOne<{ total: unknown }>(db, "SELECT COUNT(*) AS total FROM wl_audit_log");
  const total = asInt(totalRow?.total);
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM wl_audit_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [perPage, (page - 1) * perPage],
  );
  return { entries: rows.map(rowToEntry), total, page, perPage, totalPages };
}
