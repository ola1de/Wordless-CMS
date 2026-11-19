/**
 * Conversion jobs (Milestone 4) — types.
 *
 * Jobs live in the existing `wl_jobs` table (kind = 'conversion'); the
 * report JSON is stored in the `result` column. No new table was needed,
 * so there is no migrations/0004_m4.sql.
 */
import type { ConversionReport } from "../../conversion/index";

export type ConversionJobStatus = "pending" | "running" | "done" | "failed";

export interface ConversionJobView {
  id: string;
  status: ConversionJobStatus;
  /** Original uploaded filename (or the fixture's file, e.g. hello.php). */
  filename: string;
  /** Fixture name when the job was started from a fixture. */
  fixture?: string;
  /** 0–100. Local processing is synchronous, so progress jumps 10 → 100. */
  progress: number;
  createdAt: string;
  updatedAt: string;
  /** Present when status is "done". */
  report?: ConversionReport;
  /** Present when status is "failed". */
  error?: string;
}

export interface ConversionJobList {
  jobs: ConversionJobView[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface CreateConversionJobInput {
  filename: string;
  /** Raw PHP source (upload path). */
  source?: string;
  /** Fixture name (fixture path). Only "hello-dolly" in M4. */
  fixture?: string;
}

export const MAX_PHP_BYTES = 1024 * 1024; // 1 MB

export const CONVERSION_FIXTURES: Record<string, { filename: string; slug: string }> = {
  "hello-dolly": { filename: "hello.php", slug: "hello-dolly" },
};
