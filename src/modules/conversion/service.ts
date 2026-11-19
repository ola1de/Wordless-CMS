/**
 * Conversion jobs (Milestone 4) — service.
 *
 * A conversion job is a row in `wl_jobs` (kind = 'conversion') that runs
 * the static PHP → TypeScript pipeline (src/conversion). Processing runs
 * synchronously inside the request in local dev — the pipeline is CPU
 * work, but a single plugin file converts in milliseconds, far under the
 * Worker CPU budget. The module is structured so the same
 * `runConversionJob(db, jobId)` can be invoked by a Queue/Workflow
 * consumer later (production path — see ARCHITECTURE.md); nothing here
 * assumes it runs in a request.
 *
 * The pipeline NEVER executes the uploaded PHP. Blocked constructs fail
 * the job with a clear error; the job is never left half-done.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import {
  ConversionBlockedError,
  ConversionParseError,
  convertPhp,
  type ConversionReport,
} from "../../conversion/index";
import {
  CONVERSION_FIXTURES,
  MAX_PHP_BYTES,
  type ConversionJobList,
  type ConversionJobStatus,
  type ConversionJobView,
  type CreateConversionJobInput,
} from "./types";

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

function slugifyFilename(filename: string): string {
  const base = filename.replace(/\.php$/i, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return base === "" ? "converted-plugin" : base;
}

function parsePayload(row: JobRow): { filename: string; source?: string; fixture?: string } {
  try {
    return JSON.parse(row.payload) as { filename: string; source?: string; fixture?: string };
  } catch {
    return { filename: "unknown.php" };
  }
}

function rowToView(row: JobRow): ConversionJobView {
  const payload = parsePayload(row);
  const status = row.status as ConversionJobStatus;
  const view: ConversionJobView = {
    id: row.id,
    status,
    filename: payload.filename,
    progress: status === "done" ? 100 : status === "pending" || status === "failed" ? 0 : 10,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (payload.fixture !== undefined) view.fixture = payload.fixture;
  if (row.result !== null && row.result !== "") {
    try {
      const parsed = JSON.parse(row.result) as Record<string, unknown>;
      if (status === "done" && typeof parsed === "object" && parsed !== null && "output" in parsed) {
        view.report = parsed as unknown as ConversionReport;
        view.progress = 100;
      } else if (status === "running" && typeof parsed.progress === "number") {
        view.progress = parsed.progress as number;
      } else if (status === "failed") {
        view.error = typeof parsed.error === "string" ? parsed.error : "Conversion failed.";
      }
    } catch {
      if (status === "failed") view.error = row.result;
    }
  }
  return view;
}

async function updateJob(
  db: Db,
  id: string,
  status: ConversionJobStatus,
  result: string | null,
): Promise<void> {
  await execRun(
    db,
    "UPDATE wl_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?",
    [status, result, nowIso(), id],
  );
}

export async function createConversionJob(
  db: Db,
  input: CreateConversionJobInput,
): Promise<ConversionJobView> {
  let filename = input.filename;
  let source = input.source;
  let fixture = input.fixture;

  if (fixture !== undefined) {
    const known = CONVERSION_FIXTURES[fixture];
    if (known === undefined) {
      throw badRequest(`Unknown conversion fixture "${fixture}". Only "hello-dolly" is available in M4.`);
    }
    filename = known.filename;
    source = undefined;
  } else {
    if (source === undefined || source === "") {
      throw badRequest("A conversion job needs either a PHP file upload or a fixture name.");
    }
    if (!filename.toLowerCase().endsWith(".php")) {
      throw badRequest("Uploaded file must have a .php extension.");
    }
    const bytes = new TextEncoder().encode(source).length;
    if (bytes > MAX_PHP_BYTES) {
      throw badRequest(`PHP file is ${bytes} bytes; the conversion limit is ${MAX_PHP_BYTES} bytes (1 MB).`);
    }
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_jobs (id, kind, status, payload, attempts, created_at, updated_at)
     VALUES (?, 'conversion', 'pending', ?, 0, ?, ?)`,
    [id, JSON.stringify({ filename, source, fixture }), now, now],
  );
  const row = await queryOne<JobRow>(db, "SELECT * FROM wl_jobs WHERE id = ? LIMIT 1", [id]);
  if (row === null) throw new Error("Conversion job was not created.");
  void fixture;
  return rowToView(row);
}

export async function getConversionJob(db: Db, id: string): Promise<ConversionJobView> {
  const row = await queryOne<JobRow>(
    db,
    "SELECT * FROM wl_jobs WHERE id = ? AND kind = 'conversion' LIMIT 1",
    [id],
  );
  if (row === null) throw notFound("Conversion job not found.");
  return rowToView(row);
}

export async function listConversionJobs(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<ConversionJobList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const totalRow = await queryOne<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM wl_jobs WHERE kind = 'conversion'",
  );
  const total = totalRow?.n ?? 0;
  const rows = await queryAll<JobRow>(
    db,
    "SELECT * FROM wl_jobs WHERE kind = 'conversion' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [perPage, offset],
  );
  return {
    jobs: rows.map(rowToView),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export interface RunConversionJobOptions {
  /** Resolve a fixture name to its PHP source (fetched from upstream in the route). */
  resolveFixture?: (fixture: string) => Promise<{ source: string; filename: string }>;
  /** Called after a successful conversion (e.g. to install + activate the extension). */
  onSuccess?: (report: ConversionReport) => Promise<void>;
}

/**
 * Run one conversion job to completion. Safe to call from a request
 * handler (local dev) or from a Queue/Workflow consumer (production):
 * it only touches the job row and the conversion pipeline.
 */
export async function runConversionJob(
  db: Db,
  jobId: string,
  opts: RunConversionJobOptions = {},
): Promise<ConversionJobView> {
  const row = await queryOne<JobRow>(
    db,
    "SELECT * FROM wl_jobs WHERE id = ? AND kind = 'conversion' LIMIT 1",
    [jobId],
  );
  if (row === null) throw notFound("Conversion job not found.");
  const payload = parsePayload(row);
  const now = nowIso();
  await execRun(
    db,
    "UPDATE wl_jobs SET status = 'running', attempts = attempts + 1, result = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify({ progress: 10, phase: "converting" }), now, jobId],
  );

  try {
    let source = payload.source;
    let filename = payload.filename;
    if (payload.fixture !== undefined) {
      if (opts.resolveFixture === undefined) {
        throw new Error(`No fixture resolver was provided for fixture "${payload.fixture}".`);
      }
      const resolved = await opts.resolveFixture(payload.fixture);
      source = resolved.source;
      filename = resolved.filename;
    }
    if (source === undefined || source === "") {
      throw new Error("Conversion job has no PHP source.");
    }
    const fixture = CONVERSION_FIXTURES[payload.fixture ?? ""];
    const slug = payload.fixture !== undefined && fixture !== undefined ? fixture.slug : slugifyFilename(filename);
    const report = convertPhp(source, filename, { slug });
    await updateJob(db, jobId, "done", JSON.stringify(report));
    if (opts.onSuccess !== undefined) {
      await opts.onSuccess(report);
    }
    return await getConversionJob(db, jobId);
  } catch (err) {
    let message: string;
    if (err instanceof ConversionBlockedError || err instanceof ConversionParseError) {
      message = err.message;
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = "Conversion failed for an unknown reason.";
    }
    const failedResult = JSON.stringify({
      progress: 0,
      error: message,
      blocked:
        err instanceof ConversionBlockedError
          ? err.violations
          : undefined,
    });
    await updateJob(db, jobId, "failed", failedResult);
    return await getConversionJob(db, jobId);
  }
}
